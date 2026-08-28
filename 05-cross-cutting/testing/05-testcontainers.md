---
level: intermediate
area: cross-cutting
prerequisites:
  - 02-unit-vs-integration.md
related:
  - 06-deterministic-tests.md
  - ../../04-infrastructure/02-docker/06-compose.md
---

# Testcontainers: hạ tầng thật trong test

> Một dự án dùng SQLite trong test cho nhanh, PostgreSQL trong production. Bộ test xanh suốt hai năm. Rồi một tính năng dùng `SELECT ... FOR UPDATE SKIP LOCKED` để lấy job từ hàng đợi. SQLite bỏ qua cú pháp đó một cách lặng lẽ, test xanh; PostgreSQL thì không — và cũng không phải nguồn lỗi: **lỗi là hai worker cùng lấy một job, một hành vi mà môi trường test không thể tái hiện.**

## Position

```text
Unit test          không cần hạ tầng
Integration test   cần hạ tầng THẬT  ← testcontainers ở đây
E2E                cần cả hệ thống
```

## Problem

```text
Bốn lựa chọn khi integration test cần database:

① DB dùng chung trên máy dev/CI
   − trạng thái rò rỉ giữa các lần chạy, giữa các người
   − "chạy được trên máy tôi"
   − không chạy song song nhiều nhánh được

② DB nhúng khác loại (SQLite thay PostgreSQL)
   − HÀNH VI KHÁC → test nói dối  ← sự cố ở đầu note

③ docker compose thủ công
   + đúng loại, đúng phiên bản
   − phải nhớ khởi động; cổng xung đột; dọn dẹp thủ công

④ TESTCONTAINERS — container do CHÍNH TEST khởi động và dọn
   + đúng loại và phiên bản, cổng ngẫu nhiên, tự dọn
   + cùng hành vi trên máy dev và trong CI
   − cần Docker; thêm vài giây khởi động
```

## Mental Model

### Vòng đời

```text
① test khởi động   kéo image (lần đầu) → chạy container → cổng NGẪU NHIÊN
② chờ SẴN SÀNG     wait strategy — không phải "sleep 5"
③ lấy connection string từ container (host + cổng thật)
④ chạy migration
⑤ test chạy
⑥ container bị xoá — kể cả khi test crash (Ryuk container dọn hộ)
```

Cổng ngẫu nhiên là chi tiết quan trọng: nó cho phép **nhiều bộ test chạy song song trên cùng một máy** mà không xung đột — điều mà docker compose với cổng cố định không làm được.

### Wait strategy: nguồn flaky số một

```text
Container ĐANG CHẠY ≠ dịch vụ SẴN SÀNG NHẬN KẾT NỐI

PostgreSQL khởi động, ghi log, khởi động LẠI trong quá trình init
→ chờ log "ready to accept connections" MỘT LẦN là chưa đủ
```

```ts
// ✗ đoán thời gian — vừa chậm vừa flaky
await new Promise(r => setTimeout(r, 5000));

// ✓ chờ ĐIỀU KIỆN
const container = await new PostgreSqlContainer('postgres:16-alpine')
  .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
  .start();                                                       //                    ↑ lần thứ 2
```

Module dựng sẵn (`PostgreSqlContainer`, `RedisContainer`) đã cấu hình chiến lược chờ đúng — dùng chúng thay vì `GenericContainer` khi có.

### Chi phí khởi động và cách trả nó một lần

```text
Khởi động container: 1–5 giây (image đã có sẵn cục bộ)

✗ mỗi FILE test một container  → 50 file = 50 lần khởi động
✓ MỘT container cho cả bộ test → 1 lần, dữ liệu cô lập bằng cách khác
```

```ts
// globalSetup — chạy một lần cho toàn bộ bộ test
export default async function () {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  await runMigrations(process.env.DATABASE_URL);
  (globalThis as any).__PG__ = container;             // để teardown dùng
}

export async function teardown() {
  await (globalThis as any).__PG__?.stop();
}
```

Sau đó cô lập dữ liệu giữa các test bằng **schema riêng cho mỗi worker** hoặc **dữ liệu duy nhất mỗi test** — không phải bằng container riêng.

```ts
// mỗi worker song song một schema — cô lập thật, một container
const schema = `test_${process.env.VITEST_WORKER_ID ?? process.env.JEST_WORKER_ID ?? '1'}`;
process.env.DATABASE_URL = `${baseUri}?schema=${schema}`;
```

### Tái sử dụng container giữa các lần chạy local

```ts
const container = await new PostgreSqlContainer('postgres:16-alpine')
  .withReuse()                                  // giữ container sống giữa các lần chạy
  .start();
```

```text
+ vòng lặp phản hồi local nhanh hơn nhiều (bỏ luôn 3 giây khởi động)
− trạng thái CÓ THỂ còn sót → dọn dữ liệu phải đúng
→ bật ở local (`testcontainers.reuse.enable=true`), TẮT trong CI
```

CI nên luôn khởi động sạch: đó là nơi bạn muốn phát hiện giả định về trạng thái còn sót.

### Không chỉ database

```text
PostgreSQL / MySQL   → thay cho SQLite
Redis                → hành vi TTL, eviction, script Lua thật
Kafka / RabbitMQ     → thứ tự, ack, DLQ thật
LocalStack           → S3, SQS, SNS giả lập
Wiremock             → HTTP bên thứ ba, có thể lập trình
Ứng dụng của bạn     → build image và chạy như trong production
```

Container cho **chính ứng dụng của bạn** là cách kiểm chứng mà không cách nào khác làm được: nó chạy đúng image sẽ lên production, với PID 1 thật, user thật, biến môi trường thật. Đây là chỗ bắt được lỗi "chạy được trên máy tôi nhưng container thì không".

### Điều kiện thật sự cần

```text
Testcontainers cần một Docker daemon truy cập được:
  · Docker Desktop / Colima / Rancher Desktop / Podman (chế độ tương thích)
  · trong CI: docker-in-docker hoặc mount socket của host
  · GitHub Actions ubuntu runner: có sẵn

Nếu không có Docker ở đâu đó trong quy trình của đội,
lựa chọn này không dùng được — và đó là đánh đổi phải cân nhắc trước.
```

### Cùng phiên bản với production

```text
✗ postgres:latest      → đổi dưới chân bạn, không tái lập được
✗ postgres:16          → tag di chuyển theo patch
✓ postgres:16.4-alpine → cụ thể
✓ postgres:16.4-alpine@sha256:...   → bất biến hoàn toàn

Và phải KHỚP với production. Test trên 16 rồi chạy 15 ở production
= bạn đang test một hệ thống khác.
```

## Example

Thiết lập đầy đủ cho một dự án NestJS + PostgreSQL + Redis:

```ts
// test/global-setup.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { execSync } from 'node:child_process';

export async function setup() {
  const [pg, redis] = await Promise.all([                  // song song — tiết kiệm vài giây
    new PostgreSqlContainer('postgres:16.4-alpine')
      .withDatabase('app_test')
      .withReuse(process.env.CI ? false : true)            // reuse chỉ ở local
      .start(),
    new RedisContainer('redis:7.4-alpine').withReuse(!process.env.CI).start(),
  ]);

  process.env.DATABASE_URL = pg.getConnectionUri();
  process.env.REDIS_URL = redis.getConnectionUrl();

  execSync('npx prisma migrate deploy', {                   // migration THẬT, không db push
    env: { ...process.env },
    stdio: 'inherit',
  });

  return async () => { await Promise.all([pg.stop(), redis.stop()]); };
}
```

```ts
// test/setup-each.ts — cô lập dữ liệu, KHÔNG cô lập bằng container
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

// truncate mọi bảng trừ bảng migration — một câu lệnh, nhanh hơn xoá từng bảng
beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  const list = tables.map(t => `"public"."${t.tablename}"`).join(', ');
  if (list) await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
});
```

Hai chi tiết đáng chú ý:

```text
`prisma migrate deploy` chứ không phải `db push`
  → test chạy đúng chuỗi migration sẽ chạy trên production
  → nó cũng KIỂM CHỨNG migration, miễn phí

TRUNCATE ... CASCADE một lệnh cho mọi bảng
  → tránh phải biết thứ tự khoá ngoại
  → RESTART IDENTITY để ID bắt đầu lại, test không phụ thuộc ID cụ thể
```

Và một test dùng container của chính ứng dụng — kiểm chứng thứ không tầng nào khác thấy:

```ts
it('image production khởi động và trả /health trong 30 giây', async () => {
  const app = await new GenericContainer('myapp:test')
    .withEnvironment({ DATABASE_URL: internalDbUrl, NODE_ENV: 'production' })
    .withExposedPorts(3000)
    .withWaitStrategy(Wait.forHttp('/health', 3000).forStatusCode(200))
    .withStartupTimeout(30_000)
    .start();

  const res = await fetch(`http://localhost:${app.getMappedPort(3000)}/health`);
  expect(res.status).toBe(200);
  await app.stop();
});
```

Test này bắt được: biến môi trường thiếu, user non-root không ghi được thư mục, CMD sai dạng, dependency production bị cắt nhầm trong multi-stage build. Không unit test hay API test nào thấy được nhóm lỗi đó.

## Prediction

1. Test dùng SQLite, production dùng PostgreSQL, code dùng `SKIP LOCKED` — test có phát hiện vấn đề không?
2. `postgres:latest` trong test, image được cập nhật — bộ test có tái lập được không?
3. Chờ 5 giây rồi kết nối, CI chậm hơn dev — kết quả?
4. `Wait.forLogMessage(..., 2)` — vì sao cần lần thứ hai với PostgreSQL?
5. Một container cho mỗi file test, 50 file, khởi động 3 giây — tổng thêm bao nhiêu?
6. Một container cho cả bộ — tổng thêm bao nhiêu?
7. `withReuse()` bật trong CI, test trước để lại dữ liệu — kết quả?
8. Cổng cố định 5432 với hai bộ test chạy song song — kết quả?
9. Cổng ngẫu nhiên — kết quả?
10. Test crash giữa chừng, không có teardown — container còn sống không?
11. Dùng `prisma db push` thay `migrate deploy` trong test — mất kiểm chứng gì?
12. Chạy container image production trong test, thiếu một biến môi trường bắt buộc — test có bắt được không?
13. Máy CI không có Docker — chuyện gì xảy ra?

<details>
<summary>Đáp án</summary>

1. **Không** — SQLite bỏ qua cú pháp; hành vi khoá không tồn tại để tái hiện.
2. **Không** — hành vi đổi dưới chân bạn.
3. **Flaky** — đôi khi 5 giây không đủ, và luôn chậm hơn cần thiết.
4. PostgreSQL **khởi động lại** trong quá trình init; lần đầu không phải trạng thái cuối.
5. **150 giây** chỉ để khởi động.
6. **3 giây.**
7. Test **phụ thuộc trạng thái còn sót** — flaky hoặc, tệ hơn, xanh sai.
8. **Xung đột cổng** — một trong hai thất bại.
9. Cả hai **chạy được song song**.
10. Ryuk (container dọn dẹp của Testcontainers) **xoá nó** — trừ khi reuse được bật.
11. Mất kiểm chứng **chuỗi migration**; schema có thể khác production.
12. **Có** — container không khởi động được hoặc `/health` không trả 200.
13. Không chạy được — cần phương án khác cho môi trường đó.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi image sang `latest` và chạy lại sau một tháng | Kết quả có đổi không? |
| Thay wait strategy bằng `sleep 1` | Flaky xuất hiện chưa? |
| Chạy hai bộ test song song trên cùng máy | Cổng có xung đột không? |
| Bật `withReuse()` rồi chạy hai lần liên tiếp | Dữ liệu có sót không? |
| Giết tiến trình test giữa chừng, rồi `docker ps` | Container còn sống không? |
| Đổi phiên bản PostgreSQL trong test so với production | Có test nào đỏ không? |
| Bỏ `TRUNCATE` giữa các test | Test nào bắt đầu phụ thuộc thứ tự? |
| Dùng `db push` thay `migrate deploy` | Migration hỏng có bị phát hiện không? |
| Chạy image production thiếu một env | Container khởi động được không? |
| Đo thời gian khởi động container lần đầu và lần sau | Chênh lệch = thời gian kéo image |

## What Usually Goes Wrong

- **Dùng DB khác loại** (SQLite thay PostgreSQL) → test nói dối.
- **Phiên bản khác production.**
- **Tag `latest`** → không tái lập được.
- **Chờ theo thời gian** thay vì wait strategy.
- **Một container mỗi file test** → bộ test chậm gấp nhiều lần.
- **`withReuse()` bật trong CI** → trạng thái sót.
- **Không dọn dữ liệu giữa các test** → phụ thuộc thứ tự.
- **`db push` thay `migrate deploy`** → mất kiểm chứng migration.
- **Không có Docker trong CI** → phát hiện muộn, phải làm lại chiến lược.
- **Không giới hạn tài nguyên container** → CI hết bộ nhớ khi chạy nhiều container.
- **Kéo image trong mỗi lần chạy CI** → chậm; cache image hoặc dùng registry gần.
- **Container cho dịch vụ mà fake in-memory là đủ** → chậm không cần thiết.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| SQLite đủ để test logic DB | Hành vi khoá, kiểu, cú pháp đều khác |
| Container làm test chậm không chấp nhận được | Một container cho cả bộ tốn vài giây |
| Container chạy = dịch vụ sẵn sàng | Cần wait strategy |
| Mỗi test cần container riêng để cô lập | Cô lập bằng schema hoặc dữ liệu rẻ hơn nhiều |
| `withReuse()` luôn tốt vì nhanh | Trong CI nó che giấu giả định về trạng thái |
| Testcontainers chỉ dùng cho database | Redis, Kafka, S3 giả lập, và cả app của bạn |
| Container sót lại nếu test crash | Ryuk dọn hộ |
| Phiên bản patch không quan trọng | Hành vi thay đổi giữa các bản chính, và đôi khi cả patch |
| Test container thay được E2E | Nó là tầng khác, không thay thế |

## Debugging

1. **Container không khởi động** → `container.logs()` hoặc chạy image thủ công bằng `docker run` với cùng env.
2. **Timeout khi chờ sẵn sàng** → wait strategy sai; tăng `withStartupTimeout` để phân biệt "chậm" với "sai".
3. **Kết nối bị từ chối** → dùng `getMappedPort()`, không dùng cổng gốc; dùng `getHost()`, không hard-code `localhost` (khác nhau trong docker-in-docker).
4. **Chậm trong CI** → đo thời gian kéo image; cache layer hoặc dùng registry mirror.
5. **Container sót lại** → `docker ps -a --filter label=org.testcontainers=true`; kiểm tra Ryuk có chạy không.
6. **Test đỏ chỉ trong CI** → phiên bản image khác? tài nguyên ít hơn? Docker socket khác?
7. **Hết bộ nhớ trong CI** → giới hạn số container đồng thời; đặt `withResourcesQuota` hoặc giảm số worker.
8. **Migration lỗi trong test** → chạy `migrate deploy` thủ công với `DATABASE_URL` của container để xem log đầy đủ.

## Production Considerations

- **Cùng loại và cùng phiên bản với production**, ghim tag cụ thể.
- **Một container cho cả bộ test**, cô lập dữ liệu bằng schema hoặc truncate.
- **Wait strategy đúng**, không dùng sleep.
- **`withReuse()` chỉ ở local**, tắt trong CI.
- **`migrate deploy` trong test** — kiểm chứng migration miễn phí.
- **Cache image trong CI** để tránh kéo lại mỗi lần.
- **Container cho image production của chính bạn** trong pipeline — bắt lớp lỗi mà không gì khác thấy.
- **Giới hạn tài nguyên** khi chạy nhiều container song song.
- **Phương án dự phòng** nếu môi trường nào đó không có Docker (ví dụ một compose file dùng chung).
- **Không dùng container cho thứ fake in-memory làm tốt hơn** — cân nhắc theo giá trị.
- **Đưa `docker ps -a` vào bước dọn dẹp CI** để phát hiện container rò rỉ sớm.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Testcontainers | đúng hạ tầng, tự dọn, song song được | cần Docker, thêm vài giây |
| DB dùng chung | không cần Docker | trạng thái rò rỉ, "chạy được trên máy tôi" |
| SQLite | rất nhanh | hành vi khác → test nói dối |
| docker compose thủ công | đơn giản, quen thuộc | cổng cố định, dọn thủ công |
| Một container cả bộ | nhanh | cần chiến lược cô lập dữ liệu |
| Container mỗi test | cô lập tuyệt đối | rất chậm |
| `withReuse()` | vòng lặp local nhanh | trạng thái sót |
| Container cho app của bạn | bắt lỗi đóng gói | build image trong CI |
| Ghim digest | bất biến | phải chủ động cập nhật |

## Explain Without Notes

1. Bốn lựa chọn cho hạ tầng trong integration test và đánh đổi của từng cái?
2. Vì sao dùng SQLite thay PostgreSQL là lựa chọn tồi? Cho hai ví dụ hành vi khác nhau.
3. Vì sao "container đang chạy" không có nghĩa là "sẵn sàng"?
4. Vì sao một container cho cả bộ test tốt hơn một container mỗi file?
5. Cô lập dữ liệu bằng gì nếu không bằng container riêng?
6. Vì sao `withReuse()` nên tắt trong CI?
7. Vì sao dùng `migrate deploy` thay vì `db push` trong test?
8. Container chạy image production của bạn bắt được lớp lỗi nào?

## Related

- [Unit vs integration](02-unit-vs-integration.md) — khi nào cần hạ tầng thật
- [Mocking & test doubles](04-mocking-test-doubles.md) — khi nào fake là đủ
- [Deterministic tests](06-deterministic-tests.md) — cô lập và thứ tự
- [Compose](../../04-infrastructure/02-docker/06-compose.md) — lựa chọn thay thế
- [Migrations](../../03-database/03-data-modeling/04-migrations.md) — thứ được kiểm chứng miễn phí
- [Production image](../../04-infrastructure/02-docker/07-production-image.md) — image được test
- [Pipeline](../../04-infrastructure/03-cicd/01-pipeline.md) — chạy container trong CI
- [Testing NestJS](../../02-backend-api/02-nestjs/09-testing-nestjs.md) — ghép vào bộ test

## Version / Context

`testcontainers` cho Node v10+ với module riêng theo dịch vụ (`@testcontainers/postgresql`, `@testcontainers/redis`). Ryuk dọn container mồ côi (tắt bằng `TESTCONTAINERS_RYUK_DISABLED`, không khuyến nghị). `withReuse()` cần `testcontainers.reuse.enable=true` trong `~/.testcontainers.properties`. Ví dụ dùng PostgreSQL 16, Redis 7, Prisma.
