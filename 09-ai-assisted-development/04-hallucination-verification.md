---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-what-ai-changes.md
related:
  - 03-reviewing-ai-code.md
  - 05-ai-security-limits.md
---

# Hallucination & verification

> Một cấu hình Kubernetes được thêm vào manifest production: `spec.template.spec.terminationGracePeriod: 60`. Nó không gây lỗi khi apply — Kubernetes bỏ qua trường không nhận diện được ở một số phiên bản client. Trường đúng là `terminationGracePeriodSeconds`. Trong ba tháng, mọi pod bị SIGKILL sau 30 giây mặc định, và mỗi lần deploy mất một số request đang xử lý. **Không có lỗi nào, không có cảnh báo nào, và cấu hình trông hoàn toàn hợp lý.**

## Position

```text
Mô hình sinh văn bản dự đoán chuỗi CÓ KHẢ NĂNG CAO.
"Có khả năng cao" ≠ "tồn tại".

  `terminationGracePeriod` trông rất giống một trường Kubernetes hợp lệ
  → và đó chính xác là lý do nó được sinh ra
```

## Problem

```text
Hallucination nguy hiểm không phải vì nó sai rõ ràng,
mà vì nó sai theo cách RẤT HỢP LÝ:

  · tên hàm khớp quy ước đặt tên của thư viện
  · tham số có kiểu và thứ tự trông đúng
  · cấu hình dùng đúng phong cách của định dạng đó
  · giải thích kèm theo mạch lạc và tự tin

⇒ trực giác "cái này trông sai" KHÔNG kích hoạt.
⇒ và một số loại KHÔNG gây lỗi khi chạy — chúng chỉ im lặng không có tác dụng.
```

## Mental Model

### Sáu loại, xếp theo độ khó phát hiện

```text
① THƯ VIỆN KHÔNG TỒN TẠI        `npm install` thất bại → phát hiện ngay
② HÀM/METHOD KHÔNG TỒN TẠI      TypeScript hoặc runtime báo → nhanh
③ THAM SỐ SAI                    có thể chạy với hành vi khác → chậm hơn
④ SAI PHIÊN BẢN                  API có thật nhưng ở bản khác → phụ thuộc bản đang dùng
⑤ CẤU HÌNH BỊ BỎ QUA IM LẶNG    ← nguy hiểm nhất, không lỗi nào
⑥ SỰ THẬT SAI                    "PostgreSQL mặc định SERIALIZABLE" → sai quyết định thiết kế
```

```text
Loại ⑤ và ⑥ là hai loại phải chủ động kiểm tra:
  ⑤ không có tín hiệu nào cho tới khi hậu quả xuất hiện
  ⑥ ảnh hưởng tới QUYẾT ĐỊNH, không chỉ tới code
```

### Nơi hallucination hay xuất hiện nhất

```text
CAO — dữ liệu huấn luyện thưa hoặc mâu thuẫn
  · thư viện ít phổ biến
  · phiên bản MỚI (sau thời điểm cắt dữ liệu)
  · thư viện thay đổi API lớn giữa các phiên bản
  · tệp cấu hình YAML/TOML — cú pháp dễ đoán, không có type check
  · cờ dòng lệnh và biến môi trường
  · giá trị mặc định của hệ thống ("timeout mặc định là...")

THẤP
  · thư viện chuẩn của ngôn ngữ
  · framework rất phổ biến, phiên bản ổn định lâu
  · thuật toán và mẫu chung
```

Cấu hình đứng ở vị trí tệ nhất: nó vừa nằm trong nhóm "cao", vừa thuộc loại ⑤ (bị bỏ qua im lặng).

### Bốn lớp xác minh, theo thứ tự chi phí

```text
① COMPILER / TYPE CHECK      miễn phí, tự động
   → bắt ② và phần lớn ③
   → điều kiện: KHÔNG dùng `any`, bật `strict`

② CHẠY THỬ                    rẻ
   → bắt ① và phần còn lại của ③
   → nhưng KHÔNG bắt được ⑤ (cấu hình bị bỏ qua)

③ ĐỌC TÀI LIỆU CHÍNH THỨC     tốn phút
   → bắt ④ ⑤ ⑥
   → bắt buộc cho: cấu hình, cờ, giá trị mặc định, hành vi phiên bản

④ TEST XÁC NHẬN HÀNH VI       tốn nhất, đáng nhất
   → bắt ⑤ — cách duy nhất chắc chắn
   → "cấu hình này có THỰC SỰ có tác dụng không?"
```

```text
Quy tắc: mọi thứ KHÔNG được compiler hoặc runtime kiểm tra
phải được xác minh bằng lớp ③ hoặc ④.

Danh sách đó ngắn và cụ thể:
  YAML · biến môi trường · cờ dòng lệnh · giá trị mặc định
  · hành vi khi lỗi · giới hạn của dịch vụ
```

### Loại ⑤ chi tiết: vì sao cấu hình im lặng

```text
Nhiều hệ thống BỎ QUA trường không nhận diện được, thay vì báo lỗi:

  Kubernetes    client cũ có thể bỏ qua trường lạ khi gửi lên API server
  nginx         chỉ thị sai vị trí → có thể không có tác dụng
  package.json  trường lạ → im lặng
  tsconfig      option sai tên → cảnh báo hoặc bỏ qua tuỳ phiên bản
  .env          biến không ai đọc → không có gì báo

⇒ "apply thành công" KHÔNG có nghĩa là "cấu hình có tác dụng".
```

```text
Cách duy nhất chắc chắn: XÁC NHẬN HÀNH VI, không xác nhận cú pháp.

  kubectl get pod X -o jsonpath='{.spec.terminationGracePeriodSeconds}'
  → trả về giá trị bạn đặt, hay giá trị mặc định 30?
```

### Loại ⑥: sự thật sai ảnh hưởng tới quyết định

```text
Ví dụ những khẳng định nghe hợp lý và sai:

  "PostgreSQL mặc định là SERIALIZABLE"        → thực tế READ COMMITTED
  "Redis đảm bảo không mất dữ liệu"            → phụ thuộc cấu hình persistence
  "Kafka đảm bảo exactly-once"                 → chỉ trong điều kiện rất hẹp
  "UUID v4 sắp xếp được theo thời gian"        → không; v7 mới có
  "HTTP/2 loại bỏ hoàn toàn head-of-line blocking" → chỉ ở tầng ứng dụng, không ở TCP

⇒ loại này không gây lỗi code. Nó làm bạn THIẾT KẾ SAI.
⇒ và nó chỉ lộ ra khi hệ thống gặp đúng điều kiện đó ở production.
```

```text
Kiểm tra: với mọi khẳng định ảnh hưởng tới THIẾT KẾ, hỏi
  "nguồn nào nói vậy?" và tra tài liệu chính thức.
Đặc biệt với: giá trị mặc định · đảm bảo (guarantee) · giới hạn.
```

### Cấu hình dự án chống hallucination

```text
Ba thiết lập biến hallucination từ "im lặng" thành "báo lỗi":

① TypeScript strict + noUncheckedIndexedAccess + không `any`
   → API không tồn tại trở thành lỗi biên dịch

② Schema validation cho cấu hình lúc khởi động (Zod)
   → biến môi trường sai tên → app không khởi động

③ Kiểm tra schema cho YAML
   kubeconform / kubectl --dry-run=server / json-schema cho CI
   → trường lạ trong manifest → CI đỏ
```

```text
Thiết lập ③ là thứ ngăn được chính xác sự cố ở đầu note,
và nó tốn khoảng 20 phút để cài đặt một lần.
```

### Kỹ thuật hỏi giảm hallucination

```text
✓ "Dùng Next.js 15 App Router. Nếu bạn không chắc API này tồn tại ở bản đó,
   hãy nói rõ thay vì đoán."

✓ "Liệt kê các API bạn dùng và cho biết chúng có từ phiên bản nào."

✓ "Chỉ dùng thư viện đã có trong package.json này: [dán]"

✓ "Với mỗi giá trị cấu hình, cho biết tên trường CHÍNH XÁC và tài liệu tham chiếu."
```

```text
Chúng không loại bỏ hallucination, nhưng chúng:
  · làm giả định hiện rõ để bạn kiểm tra
  · giảm không gian nó có thể bịa ra
  · biến "im lặng sai" thành "nói rõ không chắc" trong nhiều trường hợp
```

### Dấu hiệu đáng nghi

```text
Nghi ngờ mạnh hơn khi:
  · API giải quyết vấn đề của bạn QUÁ GỌN GÀNG
  · tên hàm bạn chưa từng thấy dù đã dùng thư viện đó lâu
  · cấu hình có một trường "vừa đúng cái bạn cần"
  · giải thích rất tự tin về một chi tiết rất cụ thể
  · hai phiên bản câu trả lời khác nhau cho cùng câu hỏi
  · con số cụ thể không kèm nguồn ("timeout mặc định là 30 giây")

Dấu hiệu cuối đáng chú ý: con số cụ thể tạo cảm giác chính xác,
nhưng chúng cũng chính là thứ dễ bịa nhất.
```

## Example

Bốn loại hallucination trong một PR, và cách bắt từng loại:

```ts
// ② HÀM KHÔNG TỒN TẠI
const users = await this.repo.findAllWhere({ active: true });
//                            ↑ TypeORM không có method này
// → BẮT BỞI: TypeScript. Miễn phí, tức thì.
```

```ts
// ④ SAI PHIÊN BẢN
import { unstable_cache } from 'next/cache';
// → có thật, nhưng khác nhau giữa các bản Next.js
// → BẮT BỞI: đọc tài liệu của ĐÚNG phiên bản trong package.json
```

```yaml
# ⑤ CẤU HÌNH BỊ BỎ QUA IM LẶNG — nguy hiểm nhất
spec:
  template:
    spec:
      terminationGracePeriod: 60      # ✗ đúng là terminationGracePeriodSeconds
      containers:
        - name: api
          resources:
            limits:
              memory: 512M            # ✗ đơn vị đúng là Mi (512M = 512 triệu byte,
                                      #    512Mi = 536 triệu byte — khác 5%)
# → KHÔNG lỗi khi apply. Không cảnh báo.
# → BẮT BỞI: kiểm tra schema trong CI + xác nhận giá trị thực tế sau khi apply
```

```ts
// ⑥ SỰ THẬT SAI — ảnh hưởng tới thiết kế
// AI nói: "PostgreSQL mặc định dùng SERIALIZABLE nên không cần lo lost update"
// → SAI: mặc định là READ COMMITTED, KHÔNG chặn lost update
// → hệ quả: một quyết định thiết kế sai, không phải một dòng code sai
// → BẮT BỞI: tra tài liệu cho mọi khẳng định về GIÁ TRỊ MẶC ĐỊNH
```

Ba lớp bảo vệ đặt một lần, dùng mãi:

```ts
// ① cấu hình được validate lúc khởi động — biến môi trường sai tên = app không chạy
import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
}).strict();          // ← `.strict()`: biến LẠ cũng báo lỗi, không im lặng bỏ qua

export const env = Env.parse(process.env);
```

```bash
# ② kiểm tra schema YAML trong CI — ngăn đúng lỗi ở đầu note
kubeconform -strict -summary k8s/*.yaml
# `-strict` từ chối trường không có trong schema

# và kiểm tra với API server thật (bắt cả CRD)
kubectl apply --dry-run=server -f k8s/
```

```ts
// ③ test XÁC NHẬN HÀNH VI — cách duy nhất chắc chắn cho loại ⑤
it('grace period thực tế là 60 giây, không phải mặc định 30', async () => {
  const { stdout } = await exec(
    `kubectl get deploy api -o jsonpath='{.spec.template.spec.terminationGracePeriodSeconds}'`
  );
  expect(stdout.trim()).toBe('60');     // nếu trường bị bỏ qua → nhận '30'
});
```

Test cuối là loại test ít người viết và đáng viết: nó kiểm chứng rằng **cấu hình có tác dụng**, không chỉ rằng nó được chấp nhận.

Và một quy trình xác minh nhanh khi nhận code mới:

```text
① compiler có xanh không?                        → bắt ② ③
② `npm ls <package>` — thư viện có thật không?    → bắt ①
③ mở tài liệu ĐÚNG PHIÊN BẢN trong package.json  → bắt ④
④ mọi cấu hình: xác nhận GIÁ TRỊ THỰC TẾ sau khi apply → bắt ⑤
⑤ mọi khẳng định về mặc định/đảm bảo: tra nguồn   → bắt ⑥
```

## Prediction

1. `terminationGracePeriod` thay vì `terminationGracePeriodSeconds` trong manifest — apply có lỗi không?
2. Giá trị thực tế được dùng là bao nhiêu?
3. `memory: 512M` so với `512Mi` — khác nhau bao nhiêu?
4. Gọi một method không tồn tại trong TypeScript strict — bắt được ở đâu?
5. Cùng vậy nhưng object có kiểu `any` — bắt được ở đâu?
6. Biến môi trường viết sai tên, không có validation — chuyện gì xảy ra?
7. Có `z.object({...}).strict()` — chuyện gì xảy ra?
8. AI nói "PostgreSQL mặc định SERIALIZABLE" — bạn thiết kế sai chỗ nào?
9. Loại lỗi đó lộ ra khi nào?
10. `npm install` một thư viện AI đề xuất, nó thất bại — loại hallucination nào?
11. Thư viện tồn tại nhưng API khác — loại nào? Bắt bằng gì?
12. AI đưa "timeout mặc định là 30 giây" không kèm nguồn — nên làm gì?
13. Hỏi cùng câu hỏi hai lần, nhận hai câu trả lời khác nhau — điều đó nói gì?
14. Cấu hình apply thành công — nó có tác dụng không?

<details>
<summary>Đáp án</summary>

1. **Không lỗi** — trường lạ có thể bị bỏ qua im lặng.
2. **30 giây** — giá trị mặc định.
3. `512M` = 512×10⁶; `512Mi` = 512×2²⁰ ≈ 537×10⁶ — **khác ~5%**.
4. **Compiler** — miễn phí, tức thì.
5. **Runtime**, hoặc không bao giờ nếu nhánh đó ít chạy.
6. Ứng dụng chạy với **giá trị mặc định hoặc `undefined`**, không báo gì.
7. **App không khởi động** — fail fast, phát hiện ngay.
8. Bạn **bỏ qua lost update** vì tin rằng isolation đã lo.
9. Ở **production, khi có đồng thời cao** — muộn nhất có thể.
10. Loại ① — dễ phát hiện nhất.
11. Loại ② hoặc ④ — bắt bằng compiler hoặc tài liệu đúng phiên bản.
12. **Tra tài liệu** — con số cụ thể không nguồn là dấu hiệu đáng nghi.
13. Đó là **vùng nó không chắc** — cần kiểm chứng.
14. **Chưa biết** — apply thành công chỉ nói cú pháp hợp lệ.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm một trường bịa vào manifest K8s và apply | Có lỗi không? |
| Chạy `kubeconform -strict` trên manifest đó | Có bắt được không? |
| Kiểm tra giá trị thực tế sau khi apply | Khớp với ý định không? |
| Thêm biến môi trường sai tên | App có báo không? |
| Thêm `.strict()` vào schema và lặp lại | Khác thế nào? |
| Đặt một field thành `any` rồi gọi method bịa | Compiler có bắt không? |
| Hỏi AI về API của thư viện rất ít phổ biến | Nó có bịa không? |
| Hỏi cùng câu hỏi ba lần trong ba phiên | Câu trả lời có nhất quán không? |
| Hỏi về API mới ra sau thời điểm cắt dữ liệu | Nó nói không biết hay đoán? |
| Tra một khẳng định về "giá trị mặc định" trong tài liệu | Có đúng không? |
| `npm ls` mọi thư viện xuất hiện trong PR | Có cái nào chưa cài không? |

## What Usually Goes Wrong

- **Tin cấu hình vì nó apply thành công.**
- **Không kiểm tra schema YAML trong CI.**
- **Không validate biến môi trường**, hoặc validate không `.strict()`.
- **Dùng `any`** → vô hiệu hoá lớp bảo vệ rẻ nhất.
- **Đọc tài liệu của phiên bản khác** với phiên bản đang dùng.
- **Tin khẳng định về giá trị mặc định** mà không tra nguồn.
- **Tin con số cụ thể** không kèm nguồn.
- **Không xác nhận hành vi thực tế** của cấu hình sau khi apply.
- **Copy đơn vị sai** (`M` vs `Mi`, `s` vs `ms`).
- **Không kiểm tra thư viện đã có trong `package.json` chưa** → thêm phụ thuộc thừa.
- **Bỏ qua khi hai lần hỏi cho hai câu trả lời khác nhau.**
- **Cho rằng lỗi loại ⑥ là lỗi code** — nó là lỗi thiết kế.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Hallucination dễ nhận ra | Nó được sinh ra vì trông rất hợp lý |
| Code chạy được nghĩa là API đúng | Cấu hình sai không gây lỗi khi chạy |
| Apply thành công = cấu hình có tác dụng | Nhiều hệ thống bỏ qua trường lạ im lặng |
| Type check bắt được mọi thứ | Nó không bắt YAML, env, cờ, và sự thật sai |
| Hallucination chỉ ảnh hưởng code | Loại ⑥ ảnh hưởng tới **thiết kế** |
| Hỏi lại sẽ ra câu trả lời đúng | Hai câu trả lời khác nhau = vùng không chắc |
| Mô hình mới hết hallucination | Nó là bản chất của công cụ, không phải lỗi |
| Con số cụ thể đáng tin hơn | Chúng dễ bịa nhất và tạo cảm giác chính xác nhất |
| Thư viện phổ biến thì an toàn | Vẫn sai phiên bản |
| Đọc tài liệu là tốn thời gian | Nó rẻ hơn nhiều so với ba tháng mất request mỗi lần deploy |

## Debugging

Khi nghi ngờ một hallucination:

1. **Xác định loại** (① đến ⑥) — nó quyết định cách kiểm tra.
2. **`npm ls <package>`** — thư viện có thật và đã cài chưa?
3. **Mở tài liệu của ĐÚNG phiên bản** trong `package.json` hoặc lockfile.
4. **Với cấu hình: xác nhận giá trị THỰC TẾ**, không xác nhận cú pháp.
   `kubectl get ... -o jsonpath`, `nginx -T`, `psql -c 'SHOW ...'`
5. **Với khẳng định về mặc định hoặc đảm bảo: tra tài liệu chính thức** — không tra blog.
6. **Kiểm chứng bằng thực nghiệm** nếu tài liệu không rõ: dựng thử và đo.
7. **Nếu tìm thấy một hallucination**, kiểm tra cả những chỗ tương tự trong cùng PR — chúng thường đi theo cụm.
8. **Ghi lại loại lỗi lặp lại** vào file quy ước dự án để giảm tần suất.

## Production Considerations

- **TypeScript strict, không `any`** — lớp bảo vệ rẻ nhất.
- **Schema validation cho cấu hình lúc khởi động**, với `.strict()` để bắt biến lạ.
- **Kiểm tra schema YAML trong CI** (`kubeconform -strict`, `kubectl --dry-run=server`).
- **Xác nhận giá trị thực tế sau khi apply**, không tin "apply thành công".
- **Test xác nhận hành vi** cho cấu hình quan trọng (grace period, timeout, giới hạn).
- **Đọc tài liệu đúng phiên bản** — ghim phiên bản trong lockfile và tra theo đó.
- **Tra nguồn cho mọi khẳng định về giá trị mặc định, đảm bảo, và giới hạn.**
- **Nêu phiên bản trong prompt** và yêu cầu AI nói rõ khi không chắc.
- **Giới hạn thư viện được dùng** — dán `package.json` vào prompt.
- **Chú ý đơn vị**: `M` vs `Mi`, giây vs mili-giây, byte vs KB.
- **Khi hai lần hỏi cho hai câu trả lời** — coi đó là tín hiệu cần kiểm chứng.
- **Đưa loại lỗi lặp lại vào file quy ước dự án.**

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Type check chặt | bắt lỗi tự động, miễn phí | ma sát khi viết |
| Cho phép `any` | linh hoạt | mất lớp bảo vệ rẻ nhất |
| Validate config lúc khởi động | fail fast | app không chạy khi thiếu biến |
| Không validate | khởi động dễ | lỗi im lặng ở production |
| `.strict()` cho schema | bắt biến lạ | phải khai báo đủ mọi biến |
| Kiểm tra schema YAML trong CI | chặn loại ⑤ | thêm bước, cần cập nhật schema |
| Test xác nhận hành vi | chắc chắn nhất | tốn công viết và duy trì |
| Tra tài liệu mọi khẳng định | chính xác | chậm |
| Tin AI cho việc nhỏ | nhanh | rủi ro loại ⑤ ⑥ tích luỹ |

## Explain Without Notes

1. Vì sao hallucination trông hợp lý là hệ quả của bản chất công cụ?
2. Sáu loại hallucination, và hai loại nào nguy hiểm nhất? Vì sao?
3. Bốn lớp xác minh và mỗi lớp bắt được loại nào?
4. Vì sao "apply thành công" không đủ để tin cấu hình có tác dụng?
5. Loại ⑥ khác các loại khác ở điểm nào?
6. Ba thiết lập dự án biến hallucination im lặng thành lỗi rõ ràng?
7. Sáu dấu hiệu đáng nghi, và vì sao con số cụ thể đáng nghi?
8. Nơi nào hallucination hay xuất hiện nhất, và vì sao cấu hình ở vị trí tệ nhất?

## Related

- [AI thay đổi cái gì](01-what-ai-changes.md) — bản chất xác suất của công cụ
- [Context engineering](02-context-engineering.md) — nêu phiên bản giảm loại ④
- [Reviewing AI code](03-reviewing-ai-code.md) — xác minh là bước ⑤ của review
- [AI security & limits](05-ai-security-limits.md) — hallucination về thư viện và rủi ro chuỗi cung ứng
- [TypeScript runtime boundary](../01-web-frontend/01-javascript-typescript/02-typescript-runtime-boundary.md) — type không kiểm tra dữ liệu runtime
- [Configuration](../02-backend-api/04-architecture/05-configuration.md) — validate lúc khởi động
- [Config, Secret & resources](../04-infrastructure/04-kubernetes/03-config-secrets-resources.md) — đơn vị và trường trong manifest
- [Graceful shutdown](../02-backend-api/01-nodejs/05-graceful-shutdown.md) — grace period thật sự làm gì
- [Transaction isolation](../03-database/01-postgresql/01-transaction-isolation.md) — mặc định thật của PostgreSQL

## Version / Context

Ví dụ dùng Kubernetes 1.29+ (`terminationGracePeriodSeconds`; đơn vị bộ nhớ theo quy ước IEC: `Mi` = 2²⁰ byte, `M` = 10⁶ byte), TypeScript 5 (`strict`, `noUncheckedIndexedAccess`), Zod 3 (`.strict()`), kubeconform. PostgreSQL 16 mặc định `READ COMMITTED`. Hành vi bỏ qua trường lạ khác nhau giữa các phiên bản client và server Kubernetes — đó chính là lý do phải xác nhận giá trị thực tế thay vì dựa vào kết quả apply.
