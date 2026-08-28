---
level: intermediate
area: backend
prerequisites:
  - ../02-nestjs/05-config-lifecycle.md
related:
  - ../../05-cross-cutting/security/06-secrets-management.md
  - ../../04-infrastructure/04-kubernetes/03-config-secrets-resources.md
  - ../../04-infrastructure/02-docker/07-production-image.md
---

# Configuration

> Cùng một artifact — cùng một image digest — phải chạy được ở local, CI, staging và production, và phải cư xử khác nhau ở mỗi nơi. Toàn bộ chủ đề configuration là câu trả lời cho câu đó: **cái gì đi vào image (giống nhau ở mọi nơi), và cái gì đi vào môi trường (khác nhau ở mỗi nơi)**.

## Position

```text
Nguồn cấu hình (bên ngoài artifact)
   .env local · CI variables · K8s ConfigMap · K8s Secret · secret manager
        ↓
   process.env  /  file mount
        ↓
   PARSE + VALIDATE  ◀── một cửa, một lần, fail fast
        ↓
   config object có kiểu → mọi tầng của app
```

Note [Config & lifecycle](../02-nestjs/05-config-lifecycle.md) nói về cơ chế trong NestJS. Note này nói về **nguyên tắc** — thứ đúng bất kể framework, và thứ quyết định ứng dụng của bạn có deploy được một cách an toàn hay không.

## Problem

### Vấn đề 1: cấu hình nằm trong artifact

```ts
const DB_HOST = 'prod-db.internal';
const FEATURE_NEW_CHECKOUT = true;
```

Hệ quả dây chuyền: mỗi môi trường cần một bản build riêng → build staging và build production là **hai artifact khác nhau** → thứ bạn test ở staging không phải thứ chạy ở production.

Đây là lý do nguyên tắc "build once, deploy many" tồn tại: nếu artifact khác nhau, việc test ở staging chỉ chứng minh một điều là *bản staging* hoạt động.

### Vấn đề 2: cấu hình không có ranh giới

```text
Cái gì là config?           Cái gì KHÔNG phải config?
DATABASE_URL                 danh sách trạng thái hợp lệ của một task
LOG_LEVEL                    công thức tính thuế
MAX_UPLOAD_MB                thứ tự các bước trong một use case
FEATURE_X_ENABLED            tên bảng
```

Khi ranh giới mờ, một trong hai chuyện xảy ra, và cả hai đều tệ:

```text
Quá ÍT config → phải build lại để đổi một con số
Quá NHIỀU config → 80 biến môi trường, không ai biết cái nào còn dùng,
                   và hành vi hệ thống không đọc được từ code
```

Cái thứ hai nguy hiểm hơn vì nó âm thầm: một hệ thống với 80 flag có `2^80` cấu hình khả dĩ, và bạn chỉ test một trong số đó.

### Vấn đề 3: secret bị đối xử như config

Secret **là** config, nhưng nó có ba yêu cầu mà config thường không có: không được xuất hiện trong log/`docker inspect`/git, phải xoay vòng được, và phải kiểm soát được ai đọc. Xử lý secret bằng cùng cơ chế với `LOG_LEVEL` là cách chúng rò rỉ.

## Mental Model

### Bài kiểm tra "cái này có phải config không?"

```text
Giá trị này có KHÁC NHAU giữa các môi trường,
  hoặc cần đổi mà KHÔNG build lại?

CÓ    → config (env var / file mount / secret manager)
KHÔNG → hằng số trong code
```

Bài kiểm tra thứ hai, chặt hơn: **nếu đưa giá trị này lên GitHub công khai, có sao không?**

```text
không sao      → config thường  (LOG_LEVEL, PORT, MAX_UPLOAD_MB)
có vấn đề      → SECRET          (DATABASE_URL, JWT_SECRET, API key)
```

### Ba loại, ba vòng đời

```text                                 đổi khi nào        lưu ở đâu
CONFIG      LOG_LEVEL, PORT, timeout    khi deploy         ConfigMap / env
SECRET      mật khẩu, khoá, token       khi xoay vòng      Secret / vault, file mount
FEATURE FLAG bật/tắt tính năng          bất kỳ lúc nào     DB / dịch vụ flag
```

Nhầm loại là nguồn của những vấn đề vận hành cụ thể:

- Feature flag trong env var → phải deploy để bật/tắt, tức là xoá lý do tồn tại của flag.
- Secret trong ConfigMap → bất kỳ ai đọc được namespace đều đọc được secret; và nó xuất hiện trong `kubectl describe`.
- Config trong DB → app không khởi động được khi DB chưa sẵn sàng (phụ thuộc vòng).

### Ranh giới tin cậy

```text
process.env   là INPUT KHÔNG ĐÁNG TIN  — string | undefined, ai cũng đặt được
     ↓
  validate    ← biên giới
     ↓
config object là dữ liệu ĐÃ KIỂM TRA, có kiểu
```

Đây là cùng một mô hình với validation của request body ở [Validation & errors](../02-nestjs/03-validation-errors.md). Sự khác biệt: request sai chỉ hỏng một request; config sai hỏng toàn bộ instance.

Vì thế **fail fast** ở đây quan trọng hơn: process không được khởi động với config không hợp lệ.

## How It Works

### Bốn nguyên tắc

**1. Cấu hình đến từ môi trường, không từ artifact.**

```dockerfile
# ❌ giá trị nướng vào image
ENV DATABASE_URL=postgres://prod-db/app
COPY .env .

# ✅ chỉ giá trị mặc định vô hại; giá trị thật đến lúc chạy
ENV NODE_ENV=production
```

**2. Một cửa vào.** Chỉ một module đọc `process.env`.

```bash
# bài kiểm tra: lệnh này phải ra đúng một file
grep -rn "process.env" src/ --include="*.ts" | grep -v "src/config/"
```

Vì sao quan trọng ngoài chuyện gọn gàng: chỉ khi có một cửa vào, bạn mới trả lời được câu *"app này cần biến gì để chạy?"* — câu hỏi mà mọi người deploy đều hỏi và hầu như không codebase nào trả lời được.

**3. Validate và fail fast.**

```ts
const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid config:\n' + formatIssues(result.error));  // in HẾT lỗi, không phải cái đầu
  process.exit(1);
}
```

Crash lúc khởi động là hành vi **mong muốn**: pod mới không bao giờ vào Service, rollout dừng, phiên bản cũ tiếp tục phục vụ, không người dùng nào bị ảnh hưởng. So với việc app start bình thường rồi lỗi 40 phút sau ở một tính năng ít dùng.

**4. Mặc định an toàn.**

```text
❌ DEBUG mặc định true, production phải nhớ tắt      → quên = lộ thông tin
✅ DEBUG mặc định false, dev phải bật                → quên = bất tiện

❌ ALLOWED_ORIGINS mặc định '*'                      → quên = CORS mở toang
✅ ALLOWED_ORIGINS bắt buộc, không có mặc định       → quên = không start
```

Nguyên tắc chung: **hướng của lỗi khi con người quên phải là hướng an toàn.** Đây là cùng nguyên tắc với "guard toàn cục + opt-out" ở [Guards & interceptors](../02-nestjs/04-guards-interceptors.md).

### Phân tầng nguồn cấu hình

```text
độ ưu tiên tăng dần →
mặc định trong code  <  file config theo môi trường  <  env var  <  cờ dòng lệnh
```

Quy tắc: **cấu hình cụ thể hơn thắng.** Và đừng có quá ba tầng — mỗi tầng là một chỗ phải kiểm tra khi giá trị không như mong đợi.

Với secret, nên có một tầng riêng: `X_FILE` trỏ tới file mount, ưu tiên hơn `X`.

```ts
// mẫu phổ biến, tương thích với Docker secrets và K8s file mount
function readSecret(name: string): string {
  const path = process.env[`${name}_FILE`];
  if (path) return fs.readFileSync(path, 'utf8').trim();
  const value = process.env[name];
  if (!value) throw new Error(`missing secret ${name}`);
  return value;
}
```

### Secret: bốn cấp, chọn theo rủi ro

```text
1. .env trong git                    ❌ không bao giờ — nó ở đó vĩnh viễn
2. .env ngoài git, env var lúc chạy  ⚠️  chấp nhận được cho dự án nhỏ
3. K8s Secret mount thành file        ✅ mặc định tốt cho hầu hết trường hợp
4. Secret manager (Vault, KMS...)     ✅ khi cần xoay vòng tự động, audit truy cập
```

Vì sao **file mount hơn env var** cho secret:

```text
env var lộ ở:  docker inspect · /proc/<pid>/environ · crash dump ·
               log của thư viện in toàn bộ env · process list của một số công cụ
env var không xoay vòng được: chỉ đọc lúc khởi động → xoay = restart

file mount:    K8s cập nhật nội dung file TẠI CHỖ khi Secret đổi
               (app phải chủ động đọc lại, nhưng ít nhất là có thể)
               phân quyền được bằng file permission
```

Ba việc bắt buộc dù chọn cấp nào:

```bash
# 1. .env trong .gitignore, .env.example trong git (chỉ TÊN biến)
echo ".env*" >> .gitignore && echo "!.env.example" >> .gitignore

# 2. quét secret trong CI — bao gồm cả lịch sử
gitleaks detect --source . --redact

# 3. secret KHÁC NHAU giữa các môi trường
#    staging và production dùng chung JWT_SECRET
#    ⇒ token staging hợp lệ ở production
```

Nếu secret đã bị commit: **xoay nó ngay**. Xoá khỏi lịch sử git là việc thứ hai, và nó không cứu được gì vì mọi bản clone đã có.

Xem [Secrets management](../../05-cross-cutting/security/06-secrets-management.md).

### Cấu hình cùng một app cho bốn môi trường

```text
                local          CI/test        staging        production
nguồn           .env.local     env của runner ConfigMap      ConfigMap
secret          .env.local     giá trị giả    K8s Secret     Secret / vault
DB              docker compose ephemeral      riêng          riêng
LOG_LEVEL       debug          error          info           info
LOG_FORMAT      pretty         pretty         json           json
dữ liệu ngoài   mock/sandbox   mock           sandbox        thật
```

Hai điều thường bị làm sai:

1. **Staging dùng dữ liệu/khoá production.** Một bug ở staging trở thành sự cố thật. Sandbox hoặc tài khoản riêng, luôn luôn.
2. **Local khác production quá nhiều.** Nếu local dùng SQLite còn production dùng PostgreSQL, cả một lớp bug chỉ xuất hiện sau khi deploy. Docker Compose giữ local gần production với chi phí thấp. Xem [Compose](../../04-infrastructure/02-docker/06-compose.md).

### Feature flag: khác config, không phải một biến thể của config

```ts
// config: đổi khi deploy
if (config.maxUploadMb < size) throw new ValidationError(...);

// feature flag: đổi runtime, có thể theo từng người dùng
if (await flags.enabled('new-checkout', { userId })) return this.newCheckout(...);
return this.legacyCheckout(...);
```

Ba lý do dùng feature flag, và mỗi lý do cần một vòng đời khác nhau:

```text
RELEASE   tách deploy khỏi release; bật dần theo %      → xoá sau 2–4 tuần
OPS       kill switch tắt tính năng nặng khi quá tải    → giữ lâu dài
PERMISSION tính năng theo gói dịch vụ                   → không phải flag, là AUTHORIZATION
```

Dòng thứ ba là nhầm lẫn hay gặp: "gói Pro mới có tính năng X" thuộc về phân quyền, không thuộc về flag. Đặt nó vào hệ thống flag nghĩa là quyền của khách hàng nằm ngoài hệ thống phân quyền của bạn.

Và về flag loại RELEASE: **flag không xoá là nợ kỹ thuật có lãi suất.** Mỗi flag nhân đôi số đường đi qua code. Mười flag = 1.024 tổ hợp, trong đó bạn test được vài cái. Đặt hạn xoá ngay khi tạo.

## Example

Một schema, và điều nó chặn:

```ts
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),                 // thiếu ⇒ không start
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  JWT_SECRET: z.string().min(32),                 // chặn secret yếu kiểu 'secret'
  ALLOWED_ORIGINS: z.string().transform((s) => s.split(',')),   // không có mặc định '*'

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ENABLE_SIGNUP: z.coerce.boolean().default(false),             // mặc định ĐÓNG
})
.refine((c) => c.NODE_ENV !== 'production' || c.LOG_LEVEL !== 'debug',
        { message: 'LOG_LEVEL=debug bị cấm ở production' });
```

`refine` cuối là loại ràng buộc mà chỉ schema mới diễn đạt được: **quan hệ giữa các giá trị**, không chỉ giá trị đơn lẻ. Vài dòng như vậy chặn được các cấu hình "hợp lệ từng phần nhưng sai khi ghép".

Và một dòng log lúc khởi động:

```ts
logger.info({
  nodeEnv: config.NODE_ENV, port: config.PORT, logLevel: config.LOG_LEVEL,
  poolMax: config.DATABASE_POOL_MAX,
  secrets: { jwt: !!config.JWT_SECRET, db: !!config.DATABASE_URL },   // set/unset, KHÔNG in giá trị
}, 'config loaded');
```

Dòng này trả lời câu hỏi đầu tiên của mọi cuộc điều tra sự cố: *"instance này đang chạy với cấu hình gì?"*

## Prediction

1. `DATABASE_URL` nướng vào image, cần chạy ở staging — bạn phải làm gì? Điều đó phá vỡ nguyên tắc nào?
2. Không validate, thiếu `SMTP_URL` — app start được không? Bao lâu tới lỗi đầu tiên?
3. `ALLOWED_ORIGINS` mặc định `'*'`, ai đó quên đặt ở production — hậu quả?
4. `DEBUG` mặc định `true`, quên tắt ở production — lộ gì?
5. Secret trong ConfigMap thay vì Secret — ai đọc được? Nó xuất hiện ở đâu?
6. Secret trong env var, một thư viện log toàn bộ `process.env` khi crash — chuyện gì xảy ra?
7. Staging và production dùng chung `JWT_SECRET`, lấy token staging gọi production — được chấp nhận không?
8. Config đọc từ database, DB chưa sẵn sàng lúc app start — kết quả?
9. Feature flag trong env var, cần tắt gấp một tính năng đang gây sự cố — mất bao lâu?
10. 10 feature flag chưa xoá — bao nhiêu tổ hợp đường đi? Bạn test được bao nhiêu?
11. `.env` bị commit, bạn xoá file ở commit tiếp theo — secret còn lộ không?

<details>
<summary>Đáp án</summary>

1. Build lại image với giá trị khác — phá vỡ "build once, deploy many"; artifact test và artifact chạy không còn là một.
2. Start bình thường. Lỗi khi có người dùng chạm vào tính năng email — có thể hàng giờ sau.
3. CORS mở cho mọi origin. Bất kỳ trang web nào cũng gọi API của bạn được từ trình duyệt người dùng.
4. Tuỳ code: stack trace, query SQL, giá trị biến — tất cả cho client hoặc cho log.
5. Bất kỳ ai có quyền đọc namespace. Xuất hiện trong `kubectl get configmap -o yaml`, `kubectl describe`, và thường cả trong git nếu bạn dùng GitOps.
6. Toàn bộ secret vào log — và log thường có phạm vi truy cập rộng hơn database.
7. **Có.** Ranh giới môi trường biến mất; một tài khoản staging có thể hành động ở production.
8. App không start được. Nếu DB phụ thuộc app (hiếm nhưng có), bạn có deadlock lúc khởi động.
9. Một chu kỳ deploy — vài phút tới vài chục phút. Đúng lúc bạn cần nó nhanh nhất.
10. 2^10 = 1.024. Bạn test vài cái. Phần còn lại là hành vi chưa từng được quan sát.
11. **Còn.** Nó nằm trong lịch sử git và trong mọi bản clone. Phải xoay secret.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `grep -rn "process.env" src/ \| grep -v src/config/` | Đếm số chỗ vi phạm "một cửa vào" |
| Xoá một biến bắt buộc, không validate | Thời gian từ deploy tới lỗi đầu tiên |
| Thêm validate, xoá lại biến đó | Crash lúc boot, exit 1 — so sánh |
| Đặt `LOG_LEVEL=debug` ở production, gọi một endpoint | Log lộ gì? |
| Đặt `ALLOWED_ORIGINS=*`, gọi API từ một trang khác | Trình duyệt cho phép |
| `docker inspect <container> \| grep -i secret` | Env var lộ ra |
| `kubectl get configmap -o yaml` sau khi để nhầm secret ở đó | Giá trị hiện nguyên |
| Dùng token staging gọi production (secret chung) | Được chấp nhận |
| `gitleaks detect` trên toàn bộ lịch sử repo | Có gì đã lọt vào |
| Thêm 5 feature flag, liệt kê tổ hợp | Số đường đi qua code |
| Đổi K8s Secret khi pod đang chạy, với env var | Giá trị **không** đổi cho tới khi restart |
| Cùng thí nghiệm với file mount | File đổi (sau một độ trễ), app có đọc lại không? |

## What Usually Goes Wrong

- **Config nướng vào image** → không "build once, deploy many"; test staging không chứng minh gì.
- **Không validate** → lỗi muộn, xa nguyên nhân, ở production.
- **`process.env` rải khắp** → không ai biết app cần biến gì.
- **Mặc định không an toàn** (`DEBUG=true`, `CORS=*`) → quên = lỗ hổng.
- **Secret trong git** → lộ vĩnh viễn; xoá file không cứu được.
- **Secret trong image** → ai pull được image đọc được.
- **Secret trong ConfigMap** → sai cơ chế, sai phân quyền.
- **Secret chung giữa môi trường** → ranh giới môi trường biến mất.
- **Không xoay được secret** → một lần rò rỉ là một lần khẩn cấp.
- **Feature flag trong env var** → cần deploy để bật/tắt.
- **Flag không xoá** → bùng nổ tổ hợp, code không đọc được.
- **Config trong DB cho thứ cần lúc khởi động** → phụ thuộc vòng.
- **Local khác production quá xa** → cả một lớp bug chỉ lộ sau deploy.
- **Không log config lúc khởi động** → không biết instance đang chạy với gì.
- **Log giá trị secret trong config summary** → tự tạo rò rỉ.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Config và secret dùng chung cơ chế được | Secret cần xoay vòng, kiểm soát truy cập, và không xuất hiện trong log |
| `.env` an toàn vì đã gitignore | Nó vẫn nằm trên đĩa, trong backup, trong `docker cp` |
| Xoá secret khỏi git là đủ | Lịch sử và mọi bản clone vẫn có; phải xoay |
| Env var là nơi tự nhiên cho mọi cấu hình | Với secret, file mount tốt hơn về mọi mặt trừ độ đơn giản |
| Nhiều tuỳ chọn cấu hình = linh hoạt | Mỗi tuỳ chọn nhân đôi không gian trạng thái phải test |
| Feature flag là một biến môi trường | Flag phải đổi được **không cần deploy** |
| Crash khi thiếu config là hành vi xấu | Là hành vi tốt: chặn trước khi ảnh hưởng người dùng |
| Staging nên giống production tuyệt đối | Giống về **cấu hình**, khác về **secret và dữ liệu** |
| K8s Secret được mã hoá | Mặc định chỉ base64; cần bật encryption at rest |

## Debugging

1. **"Instance này đang chạy với config gì?"** — nếu không trả lời được ngay, thêm log config summary lúc khởi động. Đó là việc đầu tiên.
2. **Chạy local được, môi trường khác không** → `diff` danh sách tên biến giữa hai nơi (`docker exec <c> env | sort`). Khác biệt nằm ở đó.
3. **Giá trị đúng nhưng app không thấy** → nghi thời điểm đọc (top-level module chạy trước `dotenv`), hoặc nghi tầng ưu tiên (một tầng khác đang ghi đè).
4. **Không biết giá trị đến từ tầng nào** → log cả nguồn: `{ key: 'PORT', value: 3000, source: 'env' }`.
5. **Secret không đúng** → kiểm tra khoảng trắng và newline. Secret đọc từ file rất hay có `\n` ở cuối; `.trim()` là bắt buộc.
6. **Đổi Secret mà app không nhận** → env var chỉ đọc lúc khởi động. Restart, hoặc chuyển sang file mount + đọc lại.
7. **Nghi ngờ rò rỉ** → `gitleaks` trên toàn bộ lịch sử, `docker history --no-trunc`, `kubectl get secret -o yaml`.

## Production Considerations

- **Một artifact cho mọi môi trường**, xác định bằng digest. Nếu staging và production chạy khác digest, bạn chưa test cái sẽ chạy.
- **Config summary lúc khởi động** — tên biến và giá trị không nhạy cảm; secret in dưới dạng `set/unset`.
- **Ràng buộc quan hệ trong schema**, không chỉ ràng buộc từng giá trị (`production ⇒ log level ≠ debug`).
- **Xoay secret định kỳ**, và có quy trình viết sẵn cho trường hợp khẩn cấp. Quy trình chỉ đáng tin nếu đã diễn tập.
- **Kiểm tra config drift**: biến bạn thêm vào staging có ở production không? Một schema chung + validate biến câu hỏi đó thành một lần crash lúc deploy thay vì một sự cố.
- **Bật encryption at rest cho K8s Secret** — mặc định chúng chỉ được base64 hoá trong etcd.
- **Quét secret trong CI** với `gitleaks`/`trufflehog`, chạy trên cả lịch sử ở lần đầu.
- **Đặt hạn xoá cho mỗi feature flag** lúc tạo, và có một job định kỳ liệt kê flag quá hạn.
- **Feature flag cần fail-safe**: nếu dịch vụ flag không phản hồi, mặc định phải là giá trị an toàn (thường là "tắt"), không phải là lỗi.
- **Đưa danh sách biến bắt buộc vào README**, sinh tự động từ schema nếu được — tài liệu viết tay sẽ lệch.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Config qua env var | đơn giản, chạy mọi nơi | lộ trong inspect, không xoay nóng |
| Config qua file mount | xoay được, phân quyền được | phức tạp hơn, phải xử lý đọc lại |
| Secret manager | audit, xoay tự động | thêm hạ tầng, thêm phụ thuộc lúc khởi động |
| Validate + fail fast | lỗi lộ lúc deploy | không "chạy tạm" khi thiếu biến phụ |
| Nhiều tuỳ chọn | linh hoạt | không gian trạng thái lớn, khó test |
| Ít tuỳ chọn | dễ hiểu, dễ test | phải deploy để đổi hành vi |
| Feature flag trong DB | đổi runtime | thêm phụ thuộc trên đường request |
| Feature flag qua env | không thêm phụ thuộc | cần deploy để đổi |
| Local giống production (Compose) | ít bug "chỉ có ở production" | máy dev nặng hơn |
| Local đơn giản (SQLite, in-memory) | khởi động nhanh | cả một lớp bug lộ muộn |

## Explain Without Notes

1. Hai bài kiểm tra để biết một giá trị có phải config không, và có phải secret không?
2. Vì sao "build once, deploy many" quan trọng, và config nướng vào image phá vỡ nó thế nào?
3. Vì sao crash lúc khởi động là hành vi mong muốn? Kể chuỗi sự kiện trên K8s.
4. Ba lý do file mount tốt hơn env var cho secret?
5. Config, secret và feature flag khác nhau ở tiêu chí nào? Điều gì hỏng khi đổi chỗ chúng?
6. Vì sao mặc định phải an toàn? Cho hai ví dụ mặc định nguy hiểm.
7. Vì sao flag không xoá là nợ có lãi suất?

## Related

- [Config & lifecycle (NestJS)](../02-nestjs/05-config-lifecycle.md) — implementation cụ thể
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md) — secret ở tầng bảo mật
- [Config, secrets & resources (K8s)](../../04-infrastructure/04-kubernetes/03-config-secrets-resources.md) — ConfigMap, Secret, mount
- [Production image](../../04-infrastructure/02-docker/07-production-image.md) — không nướng secret vào image
- [Compose](../../04-infrastructure/02-docker/06-compose.md) — giữ local gần production
- [Build & artifact promotion](../../04-infrastructure/03-cicd/02-build-artifact-promotion.md) — một artifact, nhiều môi trường
- [Error handling strategy](04-error-handling-strategy.md) — config sai là lỗi khởi động
- [TypeScript ↔ runtime boundary](../../01-web-frontend/01-javascript-typescript/02-typescript-runtime-boundary.md) — `process.env` là `string | undefined`
