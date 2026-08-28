---
level: intermediate
area: backend
prerequisites:
  - 02-modules-di.md
related:
  - ../../04-architecture/05-configuration.md
  - ../../01-nodejs/production/02-graceful-shutdown.md
  - ../../../05-cross-cutting/security/06-secrets-management.md
---

# Config & lifecycle

> App chạy hoàn hảo trên máy bạn. Deploy lên staging: khởi động bình thường, health check xanh, và 40 phút sau ai đó phát hiện email không gửi được vì `SMTP_URL` là `undefined`. Không có lỗi nào. Không có log nào. `undefined` đã âm thầm đi qua 6 tầng và biến thành một chuỗi rỗng ở đâu đó.

## Position

```text
Docker ENV / K8s ConfigMap+Secret / .env
        │
        ▼
   process.env  (string | undefined — luôn luôn)
        │
        ▼
   ConfigModule (parse + validate + ép kiểu)  ◀── biên giới: sau đây config là đáng tin
        │
        ▼
   Provider ← ConfigService ← useFactory ← ... → DB pool, Redis, HTTP client
        │
        ▼
   Lifecycle: onModuleInit → listen → SIGTERM → onApplicationShutdown
```

Config và lifecycle nằm cùng một note vì chúng là **cùng một câu chuyện**: những gì xảy ra ở hai đầu vòng đời của process, trước request đầu tiên và sau request cuối cùng.

## Problem

### Vấn đề 1: `process.env` nói dối về kiểu

```ts
const port = process.env.PORT;                 // string | undefined
const debug = process.env.DEBUG;               // "false" là TRUTHY
const maxRetry = process.env.MAX_RETRY;        // "3" + 1 === "31"
const dbUrl = process.env.DATABASE_URL!;       // dấu ! là một lời hứa, không phải kiểm tra
```

Bốn dòng, bốn loại bug khác nhau:

| Viết | Client/hệ thống thấy |
|---|---|
| `if (process.env.DEBUG)` với `DEBUG=false` | debug mode **bật** ở production |
| `process.env.MAX_RETRY + 1` | `"31"` lần retry |
| `process.env.PORT` truyền vào `listen()` | thường vẫn chạy — vì `listen("3000")` được chấp nhận |
| `process.env.DATABASE_URL!` khi biến thiếu | connection string `undefined`, lỗi ở lần query đầu tiên chứ không phải lúc khởi động |

Dòng cuối là mẫu chung của cả lớp vấn đề này: **lỗi cấu hình xuất hiện muộn, ở xa nơi gây ra nó**. Biến thiếu lúc 09:00 khi deploy, phát hiện lúc 09:40 khi có người dùng chạm vào tính năng dùng nó.

### Vấn đề 2: thời điểm đọc env

```ts
// mailer.service.ts
const SMTP = process.env.SMTP_URL;      // ← chạy lúc MODULE ĐƯỢC IMPORT

@Injectable()
export class MailerService {
  private client = new SmtpClient(SMTP);
}
```

```ts
// main.ts
import { AppModule } from './app.module';   // ← import kéo theo mailer.service.ts
import * as dotenv from 'dotenv';
dotenv.config();                             // ← chạy SAU khi import xong
```

ES module import được **hoisted**: mọi `import` chạy trước dòng code đầu tiên. Nên `SMTP` được đọc trước khi `dotenv.config()` chạy → `undefined`. Trên máy local có sẵn biến trong shell thì không thấy; trong container thì tuỳ cách chạy.

Đây là lý do gốc để **không bao giờ đọc `process.env` ở top-level của module**. Đọc nó ở đúng một nơi, đúng một lúc.

### Vấn đề 3: process không tắt sạch

```text
kubectl rollout restart
  → SIGTERM
  → app thoát ngay
  → 12 connection PostgreSQL còn "đang mở" ở phía server
  → 3 job BullMQ đang chạy biến mất, không ai retry
  → vài request đang bay bị cắt
```

Cả ba đều là vấn đề **lifecycle**, và trong NestJS chúng có một nguyên nhân chung: một dòng code không được gọi.

## Mental Model

### Config

```text
process.env  (string | undefined, không kiểm soát)
     │
     │  PARSE + VALIDATE  ← đúng MỘT lần, lúc khởi động, FAIL FAST
     ▼
config object  (đã có kiểu, đã đảm bảo tồn tại)
     │
     ▼  tiêm qua DI
mọi nơi khác trong app
```

Ba tính chất bắt buộc, và mỗi cái loại bỏ một lớp bug:

1. **Một cửa vào.** Chỉ `ConfigModule` chạm `process.env`. Grep `process.env` trong `src/` phải ra đúng một file.
2. **Fail fast.** Thiếu hoặc sai định dạng → **process không khởi động được**. Không có "chạy tạm rồi lỗi sau".
3. **Có kiểu.** Sau biên giới này, `config.port` là `number`, không phải `string | undefined`.

Tính chất 2 là quan trọng nhất và cũng phản trực giác nhất: **crash lúc khởi động là hành vi tốt**. Nó biến một sự cố production 40 phút thành một pod không bao giờ vào Service — rollout dừng, phiên bản cũ vẫn phục vụ, không ai bị ảnh hưởng. Xem [Rollout & rollback](../../../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md).

### Lifecycle

```text
KHỞI ĐỘNG
  NestFactory.create()
    → dựng module graph, resolve mọi provider  (lỗi DI lộ ở đây)
    → onModuleInit         mỗi module, sau khi provider của nó sẵn sàng
    → onApplicationBootstrap  sau khi TẤT CẢ module init xong
  app.listen()             ◀── bắt đầu nhận request

CHẠY
  ...

TẮT  (chỉ khi app.enableShutdownHooks() đã được gọi)
  SIGTERM
    → onModuleDestroy
    → beforeApplicationShutdown
    → onApplicationShutdown(signal)
  process exit
```

Hai điều đáng nhớ:

- **`app.listen()` chỉ chạy sau khi mọi provider resolve xong.** Nếu `useFactory` async mất 8 giây, app không nhận request trong 8 giây đó — và readiness probe của K8s sẽ fail nếu `initialDelaySeconds` không đủ.
- **Nhóm shutdown không chạy nếu thiếu `enableShutdownHooks()`.** Đây là một dòng, và thiếu nó thì mọi `onApplicationShutdown` bạn viết đều là code chết.

## How It Works

### `ConfigModule` với validation — cấu hình đúng

```ts
// config/env.validation.ts — dùng Zod: một schema, suy ra kiểu luôn
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),                       // độ dài tối thiểu là một kiểm tra thật
  JWT_ACCESS_TTL: z.string().default('15m'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ENABLE_SIGNUP: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;            // kiểu suy ra, không khai báo hai lần

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    // in ra TẤT CẢ lỗi, không phải cái đầu tiên — người deploy sửa một lần
    console.error('Invalid environment:\n' + result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
    process.exit(1);
  }
  return result.data;
}
```

```ts
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,                     // hạ tầng dùng ở khắp nơi — đây là chỗ @Global() hợp lý
      validate: validateEnv,
      cache: true,
      envFilePath: ['.env.local', '.env'],   // KHÔNG dùng ở production — xem phần dưới
      expandVariables: true,
    }),
  ],
})
export class AppModule {}
```

Hai chi tiết đáng chú ý:

- **`z.coerce.number()`** xử lý đúng chuyện env luôn là string. `z.number()` sẽ luôn fail.
- **In tất cả lỗi cùng lúc.** Người deploy sửa `DATABASE_URL`, deploy lại, thấy tiếp `REDIS_URL` sai — ba vòng lặp cho một việc lẽ ra một vòng.

### Config có kiểu ở nơi dùng

`ConfigService.get('PORT')` trả `any` hoặc `string | undefined` tuỳ cấu hình, và nó đưa bạn về lại điểm xuất phát. Hai cách giữ kiểu:

```ts
// (1) namespace + type — hợp khi config nhiều và có nhóm
export const dbConfig = registerAs('db', () => ({
  url: process.env.DATABASE_URL!,
  poolMax: Number(process.env.DATABASE_POOL_MAX ?? 10),
}));
export type DbConfig = ConfigType<typeof dbConfig>;

@Injectable()
export class Repo {
  constructor(@Inject(dbConfig.KEY) private readonly cfg: DbConfig) {}   // cfg.poolMax: number
}
```

```ts
// (2) provider trả thẳng object đã validate — đơn giản nhất, và đủ cho hầu hết app
{ provide: 'ENV', useFactory: () => validateEnv(process.env) }

constructor(@Inject('ENV') private readonly env: Env) {}     // env.PORT: number
```

Dùng `getOrThrow` nếu vẫn muốn `ConfigService`:

```ts
const url = this.config.getOrThrow<string>('DATABASE_URL');    // ném nếu thiếu, không trả undefined
```

### Provider phụ thuộc config — `forRootAsync`

```ts
TypeOrmModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({
    type: 'postgres',
    url: cfg.getOrThrow('DATABASE_URL'),
    extra: { max: cfg.get<number>('DATABASE_POOL_MAX') },
    synchronize: false,                 // KHÔNG BAO GIỜ true ngoài local — xem note migration
    logging: cfg.get('NODE_ENV') !== 'production',
  }),
})
```

`useFactory` async được Nest **chờ** trước khi bootstrap hoàn tất. Điều đó cho bạn một tính chất quý: nếu factory ném lỗi (DB không tới được), app không start, và pod mới không vào Service. Nhưng nó cũng là một cái bẫy về thời gian khởi động — xem *Production Considerations*.

### Lifecycle hook — dùng để làm gì, và không dùng để làm gì

```ts
@Injectable()
export class SearchIndexer implements OnModuleInit, OnApplicationShutdown {
  private client!: MeiliClient;

  async onModuleInit() {
    this.client = new MeiliClient(this.cfg.url);
    await this.client.health();        // fail fast: sai config thì app không start
  }

  async onApplicationShutdown(signal?: string) {
    this.logger.log({ signal }, 'closing search client');
    await this.client.close();
  }
}
```

```ts
// main.ts — thiếu dòng này thì onApplicationShutdown là code chết
app.enableShutdownHooks();
await app.listen(env.PORT, '0.0.0.0');     // '0.0.0.0' — xem phần Production
```

Điều **không** nên làm trong `onModuleInit`:

- Chạy migration. Nhiều replica cùng start = nhiều migration chạy song song. Migration thuộc về một bước riêng trong pipeline deploy. Xem [Migrations](../../../03-database/03-data-modeling/04-migrations.md).
- Warm-up cache nặng đồng bộ. Nó kéo dài thời gian khởi động, làm rollout chậm và làm thời gian phục hồi sau crash tệ hơn.
- Bắt đầu tiêu thụ queue **trước khi** app sẵn sàng. Nếu job cần một service chưa init xong, job đầu tiên sẽ lỗi.

### Thứ tự đóng khi shutdown

Thứ tự sai làm hỏng đúng cái mà graceful shutdown định cứu:

```text
1. readiness = false        (ngừng nhận traffic mới — LB cần vài giây để cập nhật)
2. chờ ~5s
3. ngừng nhận HTTP mới, chờ request đang xử lý xong
4. queue worker: ngừng nhận job mới, chờ job hiện tại xong
5. ĐÓNG storage: Redis, DB pool     ◀── sau cùng
6. exit 0
```

Đảo bước 4 và 5 → job đang chạy nhận `connection closed` giữa chừng. Chi tiết đầy đủ, kèm cấu hình K8s tương ứng: [Graceful shutdown](../../01-nodejs/production/02-graceful-shutdown.md).

Trong NestJS, `app.close()` chạy nhóm hook shutdown theo thứ tự **ngược** với thứ tự khởi tạo module, nên phụ thuộc được đóng sau người dùng nó — nếu bạn để Nest quản lý tài nguyên qua provider thay vì tạo thủ công.

### Config theo môi trường — và cái bẫy `.env` trong container

```text
local        .env.local  (git-ignored)      → tiện
CI/test      biến trong runner              → không có file
staging/prod K8s ConfigMap + Secret          → KHÔNG có file .env trong image
```

Ba điều tuyệt đối:

1. **Không commit `.env` chứa giá trị thật.** Commit `.env.example` chỉ có tên biến. Xem [Secrets management](../../../05-cross-cutting/security/06-secrets-management.md).
2. **Không `COPY .env` vào Docker image.** Image được đẩy lên registry và bất kỳ ai `docker pull` được đều đọc được layer. Xem [Production image](../../../04-infrastructure/02-docker/07-production-image.md).
3. **Không dùng cùng một secret cho hai môi trường.** Nếu staging và production dùng chung `JWT_SECRET`, token staging hợp lệ ở production.

Với secret có xoay vòng (rotation), biến môi trường có nhược điểm cố hữu: chúng chỉ đọc **một lần lúc khởi động**. Secret mount dạng file được K8s cập nhật tại chỗ, nhưng app phải chủ động đọc lại — hoặc chấp nhận rằng xoay secret nghĩa là restart pod.

### Feature flag vs config

```text
CONFIG        thay đổi theo MÔI TRƯỜNG, đổi khi deploy      → env var
FEATURE FLAG  thay đổi theo THỜI ĐIỂM/NGƯỜI DÙNG, đổi runtime → DB hoặc dịch vụ flag
```

Nhồi feature flag vào env var buộc bạn phải deploy để bật/tắt một tính năng — điều đó xoá mất lý do tồn tại của feature flag. Ngược lại, để `DATABASE_URL` trong một dịch vụ flag là tạo một phụ thuộc vòng lúc khởi động.

## Example

```ts
// main.ts — toàn bộ vòng đời, 20 dòng
import 'reflect-metadata';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();                       // ◀── một dòng, dễ quên nhất

  const env = app.get<Env>('ENV');
  await app.listen(env.PORT, '0.0.0.0');
  app.get(Logger).log(`listening on ${env.PORT} (${env.NODE_ENV})`);
}

bootstrap().catch((err) => {
  console.error('bootstrap failed', err);
  process.exit(1);                                 // fail fast, exit code khác 0
});
```

`process.exit(1)` ở cuối quan trọng: không có nó, một promise reject lúc bootstrap có thể để process sống vật vờ mà không listen — K8s thấy container "đang chạy", liveness probe fail, restart, lặp lại. Bạn mất 20 phút trước khi nhìn vào log.

## Prediction

1. `DATABASE_URL` không được đặt, dùng `process.env.DATABASE_URL!` — app start được không? Lỗi xuất hiện lúc nào?
2. Cùng tình huống nhưng dùng `ConfigModule` có `validate` — lỗi lúc nào? Exit code?
3. `DEBUG=false` và code `if (process.env.DEBUG)` — nhánh nào chạy?
4. `PORT=3000`, `const port: number = process.env.PORT as any` rồi `app.listen(port)` — chạy được không? Vì sao đây vẫn là bug?
5. Đọc `process.env.X` ở top-level của một service, `dotenv.config()` gọi trong `main.ts` — giá trị là gì?
6. Không gọi `enableShutdownHooks()`, gửi SIGTERM — `onApplicationShutdown` chạy không? Connection DB thế nào?
7. `useFactory` async kết nối Redis mất 10 giây, `readinessProbe.initialDelaySeconds: 5` — chuyện gì xảy ra với pod?
8. `onModuleInit` chạy migration, deploy 3 replica cùng lúc — kết quả?
9. Đóng DB pool **trước** khi queue worker xong job — job thấy gì?
10. `app.listen(3000)` không có host, chạy trong container — host bên ngoài truy cập được không?
11. `.env` được `COPY` vào Dockerfile, image push lên registry công ty — ai đọc được secret?

<details>
<summary>Đáp án</summary>

1. **Start được bình thường.** Lỗi xuất hiện ở query đầu tiên — có thể là hàng chục phút sau, ở một request của người dùng thật.
2. Lỗi ngay lúc bootstrap, **exit code 1**, pod không bao giờ vào Service. Đây là kết quả mong muốn.
3. Nhánh **true** — `"false"` là chuỗi không rỗng.
4. Chạy được (`listen` chấp nhận string). Bug vì `port + 1` sẽ là `"30001"` và vì bạn vừa nói dối trình biên dịch — lần sau chỗ khác sẽ vỡ.
5. `undefined`. `import` được hoisted, chạy trước `dotenv.config()`.
6. **Không chạy.** Connection bị cắt đột ngột; phía PostgreSQL phải chờ TCP timeout mới dọn.
7. Probe fail nhiều lần → K8s có thể restart container → vòng lặp không bao giờ start được. Cần `startupProbe` hoặc tăng `initialDelaySeconds`.
8. Ba migration chạy song song. Tuỳ công cụ: hoặc lỗi khoá, hoặc — tệ hơn — chạy trùng một phần.
9. `connection closed` / `Client has already been connected and closed` giữa job. Job coi như thất bại, có thể để lại dữ liệu nửa vời.
10. **Không.** Mặc định Node bind mọi interface, nhưng nhiều framework/cấu hình bind `127.0.0.1` — trong container nghĩa là chỉ chính container đó. Ghi rõ `'0.0.0.0'` là cách chắc chắn. Xem [Container networking](../../../04-infrastructure/02-docker/02-container-networking.md).
11. Bất kỳ ai pull được image. Layer của image không được mã hoá và `docker history` đọc được.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Xoá một biến bắt buộc, không có validation | App start bình thường; đo bao lâu tới lỗi đầu tiên |
| Thêm validation rồi xoá lại biến đó | Crash lúc boot, exit 1 — so sánh với dòng trên |
| Đặt `DEBUG=false`, kiểm tra bằng `if (process.env.DEBUG)` | Nhánh true chạy |
| Đọc `process.env` ở top-level, chạy bằng `node dist/main.js` không có shell env | `undefined` |
| Bỏ `enableShutdownHooks()`, `kubectl delete pod`, xem `SELECT count(*) FROM pg_stat_activity` | Connection còn treo bao lâu |
| Đảo thứ tự đóng: DB trước, worker sau | Job lỗi giữa chừng; kiểm tra dữ liệu có nửa vời không |
| `useFactory` sleep 15s, `initialDelaySeconds: 5` | Pod CrashLoopBackOff |
| Chạy migration trong `onModuleInit` với 3 replica | Đọc log ba pod, tìm dấu hiệu chạy song song |
| `app.listen(3000)` bind `127.0.0.1` trong container | `curl` từ host: connection refused |
| `COPY .env` rồi `docker history --no-trunc <image>` | Secret hiện ra |
| Dùng chung `JWT_SECRET` giữa staging và prod, lấy token staging gọi prod | Token được chấp nhận |
| `z.string()` thay vì `z.coerce.number()` cho `PORT` | Validation fail dù giá trị đúng |

## What Usually Goes Wrong

- **Không validate env** → lỗi muộn, ở xa nguyên nhân. Đây là lỗi tốn nhiều thời gian nhất trong danh sách.
- **`process.env` rải khắp codebase** → không biết app cần biến gì; onboarding người mới là một cuộc săn tìm.
- **Đọc env ở top-level** → thứ tự khởi tạo quyết định giá trị, và nó khác nhau giữa dev và prod.
- **`!` thay cho kiểm tra** → nói dối trình biên dịch, nhận `undefined` lúc runtime.
- **Quên `enableShutdownHooks()`** → rò rỉ connection mỗi lần deploy; DB dần chạm trần.
- **Thứ tự đóng sai** → job/transaction hỏng giữa chừng.
- **Migration trong `onModuleInit`** → chạy song song nhiều replica.
- **Khởi động chậm vì factory async nặng** → rollout chậm, probe fail, CrashLoopBackOff.
- **`.env` trong image hoặc trong git** → rò rỉ secret, và nó nằm mãi trong lịch sử git.
- **Cùng secret cho nhiều môi trường** → ranh giới môi trường biến mất.
- **`synchronize: true` của TypeORM ở production** → schema bị đổi tự động, có thể mất cột.
- **Bind `127.0.0.1` trong container** → "connection refused" không giải thích được.
- **Không exit code khác 0 khi bootstrap fail** → K8s tưởng container khoẻ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `process.env.X` có kiểu như TypeScript nói | Luôn là `string \| undefined` |
| `"false"` là falsy | Chuỗi không rỗng luôn truthy |
| `dotenv` chạy trước mọi thứ | Nó chạy sau khi `import` đã thực thi xong |
| App start được nghĩa là config đúng | Chỉ nghĩa là chưa có ai chạm vào phần sai |
| Crash lúc boot là hành vi xấu | Là hành vi **tốt**: lỗi được chặn trước khi ảnh hưởng người dùng |
| Nest tự đóng connection khi SIGTERM | Chỉ khi `enableShutdownHooks()` được gọi |
| `onModuleInit` là nơi tốt để chạy migration | Nó chạy trên mọi replica, song song |
| `.env` trong image thì tiện và vô hại | Image là artifact công khai trong nội bộ |
| Env var xoay vòng được nóng | Chỉ đọc lúc khởi động; xoay = restart |
| Feature flag nên để trong env | Vậy thì bật/tắt tính năng cần một lần deploy |

## Debugging

1. **`undefined` ở đâu đó** → in **toàn bộ** danh sách tên biến lúc khởi động (chỉ tên, **không** giá trị): `console.log(Object.keys(process.env).filter(k => k.startsWith('APP_')))`.
2. **Chạy local được, container không** → so sánh `docker exec <c> env` với `.env` local. Khác biệt nằm ở đó, không nằm trong code.
3. **Giá trị đúng nhưng app không thấy** → nghi thời điểm đọc. Log giá trị ở ba nơi: top-level module, trong `useFactory`, trong `onModuleInit`. Nơi đầu tiên khác hai nơi sau là bằng chứng.
4. **App start rất chậm** → đo từng `onModuleInit` (`console.time` mỗi hook). Gần như luôn là một kết nối mạng đồng bộ.
5. **Pod CrashLoopBackOff ngay sau deploy** → `kubectl logs --previous`. Nếu log rỗng: crash trước khi logger sẵn sàng → nghi validate env hoặc lỗi DI.
6. **Connection tăng dần mỗi lần deploy** → `SELECT count(*), state FROM pg_stat_activity GROUP BY state`. Nghi thiếu `enableShutdownHooks`.
7. **Exit code**: `0` = tắt sạch; `1` = lỗi app; `137` = SIGKILL (grace period hết); `143` = SIGTERM và thoát. Xem [Signals & lifecycle](../../../04-infrastructure/00-linux/04-signals-lifecycle.md).

## Production Considerations

- **Validate env là dòng bảo vệ rẻ nhất trong toàn hệ thống.** Chi phí: một schema. Lợi ích: cả một lớp sự cố production biến mất.
- **In "config summary" lúc khởi động** — tên biến, và giá trị chỉ với những cái không nhạy cảm (`NODE_ENV`, `LOG_LEVEL`, `POOL_MAX`). Secret in dưới dạng `set/unset`, không bao giờ in giá trị.
- **Thời gian khởi động là một SLO.** Nó quyết định tốc độ rollout, tốc độ scale-out khi có tải, và thời gian phục hồi sau crash. Đo `bootstrap → listening`; nếu quá 5 giây, tìm xem đang chờ gì.
- **Dùng `startupProbe`** cho app khởi động chậm, thay vì nới `initialDelaySeconds` của liveness — hai cái này giải quyết hai vấn đề khác nhau. Xem [Readiness & liveness](../../../04-infrastructure/04-kubernetes/scheduling-reliability/01-health-readiness-liveness.md).
- **Không kết nối tới dependency không thiết yếu trong `onModuleInit` theo kiểu chặn.** Nếu dịch vụ analytics chết, app của bạn không nên từ chối khởi động. Phân biệt dependency *bắt buộc* (DB) và *tuỳ chọn* (analytics) một cách tường minh.
- **Secret không đi qua env nếu tránh được.** File mount hoặc secret manager cho phép xoay vòng và không xuất hiện trong `docker inspect`, `/proc/<pid>/environ`, hay crash dump.
- **Config drift là có thật.** Biến bạn thêm vào staging tháng trước có trong production không? Một schema chung + `validate` biến câu hỏi đó thành một lần crash lúc deploy thay vì một sự cố.
- **`enableShutdownHooks()` + `terminationGracePeriodSeconds` phải khớp nhau.** Tổng thời gian shutdown phải nhỏ hơn grace period, nếu không K8s gửi SIGKILL và mọi công phu là vô ích.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Validate + fail fast | lỗi lộ lúc deploy | không thể "chạy tạm" khi thiếu biến phụ |
| Zod cho env | một schema, suy ra kiểu | thêm một phụ thuộc |
| `ConfigService.get` | linh hoạt, quen thuộc | mất kiểu, dễ gõ nhầm key |
| Object config có kiểu tiêm thẳng | an toàn kiểu | phải khai báo provider |
| `isGlobal: true` cho ConfigModule | không phải import khắp nơi | thêm một thứ ẩn (chấp nhận được với hạ tầng) |
| Secret qua env | đơn giản, chạy ở mọi nơi | xoay vòng cần restart; lộ trong `inspect` |
| Secret qua file mount | xoay vòng được, kín hơn | phức tạp hơn, phải xử lý đọc lại |
| Kết nối dependency lúc khởi động | fail fast | khởi động chậm, phụ thuộc lúc boot |
| Kết nối lười (lazy) | khởi động nhanh | lỗi cấu hình lộ muộn |
| Feature flag trong DB | đổi runtime | thêm một phụ thuộc trên đường request |

## Explain Without Notes

1. Vì sao "app khởi động được" không chứng minh config đúng?
2. Vì sao crash lúc khởi động lại là hành vi mong muốn? Kể chuỗi sự kiện trên K8s.
3. Vì sao không được đọc `process.env` ở top-level của module?
4. Kể sáu bước shutdown theo đúng thứ tự và giải thích một lý do cho mỗi bước.
5. Điều gì xảy ra nếu thiếu `app.enableShutdownHooks()`? Triệu chứng quan sát được ở phía DB là gì?
6. Config và feature flag khác nhau ở tiêu chí nào, và vì sao không nên đổi chỗ chúng?

## Related

- [Configuration](../../04-architecture/05-configuration.md) — nguyên tắc chung, ngoài phạm vi NestJS
- [Modules & DI](02-modules-di.md) — `forRootAsync`, thứ tự khởi tạo provider
- [Graceful shutdown](../../01-nodejs/production/02-graceful-shutdown.md) — chi tiết đầy đủ chuỗi tắt
- [Signals & lifecycle](../../../04-infrastructure/00-linux/04-signals-lifecycle.md) — SIGTERM, exit code
- [Secrets management](../../../05-cross-cutting/security/06-secrets-management.md) — nơi secret nên sống
- [Production image](../../../04-infrastructure/02-docker/07-production-image.md) — vì sao không `COPY .env`
- [Config, secrets & resources (K8s)](../../../04-infrastructure/04-kubernetes/operations/01-config-secrets-resources.md)
- [Migrations](../../../03-database/03-data-modeling/04-migrations.md) — vì sao migration không thuộc `onModuleInit`

## Version / Context

NestJS 10/11, `@nestjs/config` 3.x. Ví dụ validation dùng Zod 3; `@nestjs/config` cũng hỗ trợ Joi qua `validationSchema`.
