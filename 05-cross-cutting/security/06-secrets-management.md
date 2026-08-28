---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-security-basics.md
related:
  - ../../02-backend-api/04-architecture/05-configuration.md
  - ../../04-infrastructure/04-kubernetes/03-config-secrets-resources.md
---

# Secrets management

> Một API key của nhà cung cấp thanh toán bị lộ. Nó không nằm trong repository — nó nằm trong **log của một build từ tám tháng trước**, khi ai đó thêm `set -x` để debug pipeline và quên gỡ. Log build được lưu vô thời hạn và ai trong tổ chức cũng đọc được. Key đó chưa bao giờ được xoay vòng kể từ ngày tạo.

## Position

```text
Bí mật đi qua bao nhiêu chỗ trước khi tới process của bạn:

lập trình viên → git → CI → registry → orchestrator → container → process
       ↑          ↑     ↑        ↑           ↑            ↑         ↑
    máy cá nhân  lịch sử log   image      etcd      biến môi trường  core dump
                 vĩnh viễn   layer                                   crash report

Mỗi mũi tên là một nơi bí mật có thể ở lại lâu hơn bạn nghĩ.
```

## Problem

```text
Bí mật khác cấu hình ở một điểm duy nhất, nhưng điểm đó thay đổi mọi thứ:
  cấu hình  sai → hệ thống chạy sai
  bí mật    lộ → hệ thống bị chiếm, và bạn thường KHÔNG BIẾT nó đã lộ

⇒ hai yêu cầu:
   ① hạn chế nơi bí mật đi qua
   ② giả định nó SẼ lộ → làm cho việc xoay vòng rẻ và nhanh
```

Yêu cầu ② là yêu cầu bị bỏ qua. Hầu hết tổ chức bảo vệ bí mật khá tốt và **không có khả năng xoay nó** khi cần.

## Mental Model

### Bí mật rò rỉ ở đâu — theo thứ tự thực tế

```text
① LỊCH SỬ GIT       xoá file ở commit sau KHÔNG xoá nó khỏi lịch sử
② LOG               log build, log ứng dụng, log lỗi, APM
③ THÔNG BÁO LỖI     stack trace chứa connection string
④ IMAGE DOCKER      ARG/COPY nằm lại trong layer dù đã xoá ở layer sau
⑤ ẢNH CHỤP MÀN HÌNH · tài liệu · tin nhắn chat · ticket
⑥ BIẾN MÔI TRƯỜNG   thư viện in toàn bộ env khi crash; /proc/<pid>/environ
⑦ BACKUP            bản sao database chứa bí mật lưu trong bảng cấu hình
⑧ TIẾN TRÌNH CON    env được kế thừa cho mọi lệnh bạn spawn
```

Bốn cái đầu chiếm phần lớn sự cố thực tế. Không cái nào trong số đó bị chặn bởi việc "không commit file `.env`".

### Bí mật trong git là vĩnh viễn

```text
git commit thêm secret  →  git rm secret  →  commit
                            ↑ file biến mất khỏi HEAD
                              nhưng vẫn ở trong LỊCH SỬ và trong mọi bản clone

⇒ Quy trình đúng khi phát hiện:
   ① XOAY BÍ MẬT TRƯỚC     ← bước quan trọng nhất, làm ngay
   ② rồi mới dọn lịch sử   (git-filter-repo / BFG) nếu cần
   ③ báo cho mọi người re-clone
```

Đảo thứ tự là sai lầm phổ biến: dành hai giờ viết lại lịch sử trong khi credential vẫn còn hiệu lực.

**Bí mật đã push lên remote công khai phải coi là đã lộ.** Bot quét GitHub liên tục và thời gian từ push tới lần dùng đầu tiên thường tính bằng phút.

### Ba tầng lưu trữ bí mật

```text
① BIẾN MÔI TRƯỜNG (12-factor)
   + đơn giản, mọi nền tảng hỗ trợ
   − hiện trong `ps` ở một số hệ thống, /proc/<pid>/environ, crash dump
   − kế thừa cho tiến trình con
   − xoay vòng cần restart

② FILE MOUNT (Kubernetes Secret dạng volume, Docker secret)
   + không kế thừa cho tiến trình con
   + không nằm trong env dump
   + cập nhật được mà không restart (nếu app đọc lại)
   − app phải biết đọc file

③ SECRET MANAGER (Vault, AWS Secrets Manager, GCP Secret Manager)
   + xoay vòng tự động, credential ĐỘNG có TTL
   + audit ai đọc bí mật nào lúc nào
   + kiểm soát truy cập chi tiết
   − thêm phụ thuộc lúc khởi động; cần xử lý khi nó không phản hồi
```

Lộ trình thực tế: bắt đầu ở ① với kỷ luật tốt, chuyển sang ② khi lên Kubernetes, thêm ③ khi số bí mật hoặc yêu cầu tuân thủ đòi hỏi.

### Credential động: thay đổi bản chất bài toán

```text
Credential TĨNH   một mật khẩu DB, tồn tại nhiều năm
                  → lộ = nguy hiểm cho tới khi ai đó xoay nó
                  → không ai biết nó đã lộ

Credential ĐỘNG   Vault tạo user DB riêng cho mỗi instance, TTL 1 giờ
                  → lộ = nguy hiểm tối đa 1 giờ
                  → xoay vòng là hành vi mặc định, không phải sự kiện
```

Đây là thay đổi có tác động lớn nhất trong toàn bộ chủ đề này: nó biến "xoay vòng" từ một dự án thành một thuộc tính của hệ thống.

Cùng ý tưởng ở dạng nhẹ hơn: **workload identity** (IRSA trên EKS, Workload Identity trên GKE) — pod nhận credential ngắn hạn từ danh tính của service account, không có bí mật nào được lưu ở đâu cả.

### Kubernetes Secret không phải là mã hoá

```text
kind: Secret → dữ liệu base64 → base64 KHÔNG PHẢI mã hoá

Mặc định (nhiều bản phân phối): lưu trong etcd dưới dạng plaintext.
Ai đọc được etcd hoặc có quyền `get secrets` trong namespace đều đọc được.

Để nó thật sự được bảo vệ, cần cả bốn:
  ① encryption at rest cho etcd (EncryptionConfiguration)
  ② RBAC chặt: rất ít chủ thể có `get`/`list` trên secrets
  ③ mount dạng FILE, không dùng envFrom
  ④ audit log cho truy cập secret
```

Xem [Config, Secret & resources](../../04-infrastructure/04-kubernetes/03-config-secrets-resources.md).

### Bí mật trong Docker image

```text
✗ ARG NPM_TOKEN + RUN npm install
  → giá trị nằm trong LỊCH SỬ IMAGE, đọc được bằng `docker history`

✗ COPY .npmrc . + RUN npm install + RUN rm .npmrc
  → layer thứ nhất vẫn chứa file; xoá ở layer sau không xoá khỏi image

✓ BuildKit secret mount — không tạo layer nào
```

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
COPY package*.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci --ignore-scripts
```

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc .
```

### Xoay vòng phải là quy trình đã diễn tập

```text
Câu hỏi kiểm tra: "database password bị lộ lúc 2 giờ sáng — mất bao lâu để xoay?"

Nếu câu trả lời không phải "vài phút, có runbook", bạn chưa có khả năng xoay vòng.
```

Điều làm xoay vòng khả thi là **hỗ trợ hai giá trị cùng lúc**:

```text
① thêm credential MỚI, hệ thống chấp nhận CẢ HAI
② triển khai dần sang credential mới
③ xác nhận không còn ai dùng cái cũ (log/metric)
④ thu hồi credential cũ

Không có bước ①, xoay vòng = downtime → nên nó bị hoãn → nên nó không xảy ra.
```

Với khoá ký JWT, cơ chế này là `kid` + JWKS nhiều khoá. Với API key, là hỗ trợ nhiều key hoạt động đồng thời. Với mật khẩu DB, là tạo user thứ hai trước khi xoá user thứ nhất.

### Phát hiện rò rỉ

```text
Trước khi commit   pre-commit hook (gitleaks, trufflehog) — chặn tại nguồn
Trong CI           quét mọi PR và toàn bộ lịch sử định kỳ
Ở nhà cung cấp     GitHub secret scanning + push protection
Ở phía dịch vụ     nhiều nhà cung cấp tự phát hiện key của họ bị lộ công khai
                   và thông báo hoặc tự thu hồi
Trong log          redact ở tầng logger, không dựa vào sự cẩn thận của người viết log
```

```ts
// redact ở logger — không dựa vào việc mọi người luôn nhớ
const REDACT = ['password', 'token', 'secret', 'authorization', 'cookie', 'apiKey', 'set-cookie'];

const logger = pino({
  redact: {
    paths: [
      ...REDACT,
      ...REDACT.map(k => `*.${k}`),
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
});
```

Cấu hình này chặn được lớp lỗi phổ biến nhất: ai đó log cả object request để debug và quên gỡ.

### Bí mật nào KHÔNG nên tồn tại

```text
✗ credential dùng chung giữa nhiều dịch vụ  → không truy vết được, không xoay riêng được
✗ credential dùng chung giữa các môi trường → dev bị chiếm = production bị chiếm
✗ tài khoản cá nhân dùng cho tự động hoá    → người nghỉ việc = pipeline hỏng
✗ credential vĩnh viễn khi có lựa chọn ngắn hạn
✗ bí mật cho việc đã có cơ chế identity     → dùng workload identity thay vì API key
```

Bí mật tốt nhất là bí mật **không tồn tại**. Trước khi hỏi "lưu ở đâu", hỏi "có cần nó không".

## Example

Tải bí mật lúc khởi động, fail fast, và không bao giờ in ra:

```ts
// config/secrets.ts
import { z } from 'zod';
import { readFileSync } from 'node:fs';

// đọc từ FILE nếu có (_FILE hậu tố), ngược lại từ env
function read(name: string): string | undefined {
  const path = process.env[`${name}_FILE`];
  return path ? readFileSync(path, 'utf8').trim() : process.env[name];
}

const Schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_PRIVATE_KEY: z.string().min(100),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
});

const parsed = Schema.safeParse({
  DATABASE_URL: read('DATABASE_URL'),
  JWT_PRIVATE_KEY: read('JWT_PRIVATE_KEY'),
  STRIPE_SECRET_KEY: read('STRIPE_SECRET_KEY'),
});

if (!parsed.success) {
  // in TÊN trường thiếu, KHÔNG in giá trị
  console.error('Thiếu hoặc sai định dạng:', parsed.error.issues.map(i => i.path.join('.')));
  process.exit(1);
}

export const secrets = Object.freeze(parsed.data);
```

Hai chi tiết:

```text
`_FILE` hậu tố    quy ước phổ biến (Docker/Kubernetes) cho phép chuyển từ env sang
                  file mount mà KHÔNG sửa code — đây là bước nâng cấp rẻ nhất

in tên, không in giá trị
                  thông báo lỗi khởi động là nơi bí mật rò rỉ vào log rất thường xuyên
```

Và chặn việc bí mật vô tình bị serialize:

```ts
// nếu object cấu hình bị JSON.stringify vào log
export class Secrets {
  constructor(private readonly values: Record<string, string>) {}
  get(key: string) { return this.values[key]; }
  toJSON() { return '[SECRETS]'; }                    // JSON.stringify
  [Symbol.for('nodejs.util.inspect.custom')]() { return '[SECRETS]'; }   // console.log
}
```

Hai method này biến một lỗi tiềm ẩn (`logger.info({ config })`) thành vô hại.

## Prediction

1. Commit secret rồi `git rm` ở commit sau — nó còn trong repository không?
2. Repo private, secret bị commit, sau đó repo chuyển sang public — cần làm gì?
3. Secret bị push lên GitHub public trong 5 phút rồi xoá — coi như an toàn không?
4. `ARG TOKEN` + `RUN npm install` trong Dockerfile — token nằm ở đâu?
5. `COPY .npmrc` + `RUN npm i` + `RUN rm .npmrc` — token nằm ở đâu?
6. BuildKit `--mount=type=secret` — nằm ở đâu?
7. Kubernetes Secret dạng base64 — nó được mã hoá không?
8. Ai có quyền `get secrets` trong namespace — họ đọc được gì?
9. Bí mật qua `envFrom`, app crash và thư viện in toàn bộ env — chuyện gì xảy ra?
10. Bí mật mount dạng file — cùng tình huống?
11. Không có cơ chế hai-giá-trị, cần xoay mật khẩu DB — hệ quả?
12. Có cơ chế hai-giá-trị — hệ quả?
13. Credential động TTL 1 giờ bị lộ — cửa sổ rủi ro?
14. `logger.info({ req })` với header `Authorization` — log chứa gì?

<details>
<summary>Đáp án</summary>

1. **Còn** — trong lịch sử và trong mọi bản clone.
2. **Xoay bí mật**; toàn bộ lịch sử giờ đã công khai.
3. **Không** — bot quét liên tục; giả định đã lộ.
4. Trong **lịch sử image**, đọc được bằng `docker history`.
5. Trong **layer thứ nhất** — xoá ở layer sau không xoá khỏi image.
6. **Không nằm ở đâu trong image** — chỉ tồn tại lúc chạy lệnh build.
7. **Không** — base64 là mã hoá ký tự, không phải mã hoá bảo mật.
8. **Mọi bí mật trong namespace đó** ở dạng đọc được.
9. Bí mật **vào log** — và log thường được lưu lâu, chia sẻ rộng.
10. Env dump **không chứa** bí mật.
11. Xoay = **downtime** → bị hoãn → không bao giờ xảy ra.
12. Xoay được **không downtime** → làm được thường xuyên.
13. **Tối đa 1 giờ.**
14. **Token của người dùng** — đây là nguồn rò rỉ rất phổ biến.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `git log -p \| grep -i 'secret\|password\|api_key'` | Có gì trong lịch sử? |
| Chạy `gitleaks detect` trên toàn bộ lịch sử | Danh sách phát hiện |
| `docker history <image> --no-trunc` | Có ARG/ENV chứa bí mật không? |
| `docker run --rm <image> env` | Bí mật nào trong image? |
| `kubectl get secret x -o yaml \| base64 -d` | Đọc được ngay |
| `kubectl auth can-i get secrets --as=<sa>` | Ai đọc được? |
| `cat /proc/<pid>/environ \| tr '\0' '\n'` trong container | Bí mật trong env |
| Gây lỗi khởi động do thiếu env, xem log | Có in giá trị không? |
| `logger.info({ req })` rồi xem output | Header có bị redact không? |
| Tìm bí mật trong log build của CI | `set -x` ở đâu đó? |
| Thử xoay một credential trong staging, bấm giờ | Bao lâu? Có downtime không? |
| `JSON.stringify(config)` | In ra gì? |

## What Usually Goes Wrong

- **Commit bí mật**, rồi dọn lịch sử **trước khi** xoay.
- **Bí mật trong log build** do `set -x` hoặc `echo` để debug.
- **Bí mật trong stack trace** (connection string trong lỗi kết nối).
- **`ARG`/`COPY` trong Dockerfile** thay vì BuildKit secret.
- **Coi base64 là mã hoá.**
- **RBAC lỏng** cho `secrets` trong Kubernetes.
- **`envFrom`** thay vì mount file.
- **Dùng chung credential** giữa môi trường hoặc giữa dịch vụ.
- **Không có cơ chế hai-giá-trị** → xoay vòng bất khả thi → không bao giờ xoay.
- **Không xoay sau khi người có quyền truy cập nghỉ việc.**
- **Không redact ở logger** — dựa vào sự cẩn thận của người viết log.
- **Bí mật trong biến CI hiển thị cho mọi job**, kể cả job từ PR bên ngoài.
- **Không có audit** ai đọc bí mật nào.
- **`.env` trong ảnh chụp màn hình / tài liệu / chat.**

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Xoá file là xoá bí mật | Lịch sử git giữ lại vĩnh viễn |
| Repo private nên an toàn | Nó có thể thành public, hoặc bị clone |
| base64 là mã hoá | Nó là mã hoá ký tự |
| Kubernetes Secret được mã hoá mặc định | Nhiều bản phân phối lưu plaintext trong etcd |
| Biến môi trường là riêng tư | Kế thừa cho tiến trình con, hiện trong crash dump |
| Xoá layer sau xoá được bí mật | Layer trước vẫn nằm trong image |
| Xoay vòng là việc hiếm khi cần | Nó là cơ chế phục hồi chính khi có sự cố |
| Chỉ cần bảo vệ production | Dev bị chiếm nếu dùng chung credential |
| Secret manager giải quyết mọi thứ | Bí mật vẫn rò rỉ vào log và stack trace |
| Không ai đọc log build | Chúng thường mở cho cả tổ chức và lưu vô thời hạn |

## Debugging

1. **Nghi ngờ rò rỉ → xoay trước, điều tra sau.** Chi phí xoay thấp hơn nhiều so với đoán sai.
2. **Xác định phạm vi**: credential đó dùng ở đâu? Nếu không trả lời được nhanh, đó là hạng mục cần sửa.
3. **Quét lịch sử**: `gitleaks detect --source . --log-opts="--all"`.
4. **Kiểm tra image**: `docker history --no-trunc` và `docker run --rm <img> env`.
5. **Kiểm tra ai đọc được**: `kubectl auth can-i --list --as=system:serviceaccount:<ns>:<sa>`.
6. **Kiểm tra audit log** của secret manager: ai đọc bí mật này, lúc nào, từ đâu.
7. **Sau khi xoay**: xác nhận không còn ai dùng giá trị cũ (log, metric, error rate) rồi mới thu hồi.
8. **Kiểm tra log lưu trữ** có chứa giá trị cũ không — nếu có, log cũng cần xử lý.

## Production Considerations

- **Không bí mật nào trong git.** `.gitignore` + pre-commit hook + push protection + quét trong CI.
- **Xoay trước, dọn lịch sử sau** — luôn theo thứ tự này.
- **BuildKit secret mount** cho bí mật lúc build.
- **Mount dạng file** thay vì `envFrom`; hỗ trợ quy ước `_FILE`.
- **Encryption at rest cho etcd** + RBAC chặt cho `secrets`.
- **Secret manager** khi số lượng hoặc yêu cầu tuân thủ đòi hỏi; **credential động** khi có thể.
- **Workload identity** thay cho API key tĩnh ở nơi cloud hỗ trợ.
- **Credential riêng cho mỗi môi trường và mỗi dịch vụ** — không dùng chung.
- **Cơ chế hai-giá-trị** cho mọi credential quan trọng; đây là điều kiện để xoay vòng thực sự khả thi.
- **Runbook xoay vòng đã diễn tập**, có bấm giờ.
- **Redact ở tầng logger**, không dựa vào người viết log; `toJSON()` cho object cấu hình.
- **Validate bí mật lúc khởi động**, fail fast, in tên chứ không in giá trị.
- **Bí mật CI chỉ hiện cho job cần**; không expose cho workflow từ fork.
- **Audit truy cập bí mật** và alert trên mẫu bất thường.
- **Xoay khi có thay đổi nhân sự** — coi đó là sự kiện kích hoạt mặc định.
- **Kiểm kê định kỳ**: bí mật nào tồn tại, ai truy cập được, lần xoay gần nhất là khi nào.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Biến môi trường | đơn giản, phổ biến | rò rỉ qua dump, kế thừa, cần restart để đổi |
| File mount | không kế thừa, đổi nóng được | app phải đọc file |
| Secret manager | xoay tự động, audit | phụ thuộc lúc khởi động, chi phí |
| Credential động | cửa sổ rủi ro rất ngắn | hạ tầng phức tạp |
| Credential tĩnh | đơn giản | lộ = nguy hiểm cho tới khi xoay |
| Cơ chế hai-giá-trị | xoay không downtime | code phức tạp hơn |
| Xoay thường xuyên | giới hạn thiệt hại | rủi ro vận hành mỗi lần xoay |
| Quét trong CI | bắt sớm | cảnh báo giả, cần phân loại |
| Redact rộng ở logger | an toàn | đôi khi che mất thứ cần debug |
| Credential riêng mỗi dịch vụ | truy vết và giới hạn được | nhiều thứ phải quản lý |

## Explain Without Notes

1. Bốn nơi bí mật rò rỉ phổ biến nhất, và vì sao `.gitignore` không chặn được ba trong số đó?
2. Vì sao xoay bí mật phải làm **trước** khi dọn lịch sử git?
3. Vì sao xoá file ở layer Docker sau không xoá bí mật khỏi image?
4. Kubernetes Secret cần thêm gì để thật sự được bảo vệ?
5. Env và file mount khác nhau ở ba điểm nào?
6. Credential động thay đổi bài toán như thế nào?
7. Vì sao cơ chế hai-giá-trị là điều kiện tiên quyết cho xoay vòng?
8. Vì sao redact phải ở tầng logger chứ không ở chỗ gọi log?

## Related

- [Security basics](01-security-basics.md) — đặc quyền tối thiểu, ranh giới tin cậy
- [SSRF & supply chain](05-ssrf-supply-chain.md) — credential mà SSRF nhắm tới
- [Configuration](../../02-backend-api/04-architecture/05-configuration.md) — validate lúc khởi động
- [Config, Secret & resources](../../04-infrastructure/04-kubernetes/03-config-secrets-resources.md) — Secret trong K8s
- [Production image](../../04-infrastructure/02-docker/07-production-image.md) — BuildKit secret
- [Pipeline](../../04-infrastructure/03-cicd/01-pipeline.md) — bí mật trong CI
- [JWT & refresh token](../../02-backend-api/03-auth/03-jwt-refresh-token.md) — xoay khoá ký qua JWKS
- [Structured logging](../observability/02-structured-logging.md) — redact

## Version / Context

Ví dụ dùng Node.js 20+, Zod, pino, Docker BuildKit (`# syntax=docker/dockerfile:1`), Kubernetes 1.29+. Công cụ quét: gitleaks, trufflehog, GitHub secret scanning với push protection. Secret manager: HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager; External Secrets Operator để đồng bộ vào Kubernetes. Workload identity: IRSA (EKS), Workload Identity (GKE), Managed Identity (AKS).
