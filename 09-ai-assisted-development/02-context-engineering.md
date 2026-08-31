---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-what-ai-changes.md
related:
  - 03-reviewing-ai-code.md
  - 04-hallucination-verification.md
---

# Context engineering

> Hai kỹ sư trong cùng đội hỏi AI cùng một câu: "viết hàm xử lý upload file". Người thứ nhất nhận về đoạn code đọc toàn bộ file vào bộ nhớ và lưu ra `./uploads`. Người thứ hai nhận về đoạn code dùng stream, giới hạn kích thước, kiểm tra magic bytes, và ghi lên S3 với tên do server sinh. **Khác biệt không nằm ở mô hình. Nó nằm ở 12 dòng ngữ cảnh mà người thứ hai đã viết.**

## Position

```text
Chất lượng đầu ra ≈ f(chất lượng NGỮ CẢNH)

Phần lớn những gì trông như "AI không đủ giỏi"
thực ra là "AI không biết điều bạn chưa nói".
```

## Problem

```text
AI không có quyền truy cập vào:
  · kiến trúc hệ thống của bạn      · quy ước của đội
  · phiên bản thư viện bạn dùng      · ràng buộc vận hành
  · lý do đằng sau code hiện tại     · điều bạn KHÔNG muốn

Nó lấp khoảng trống bằng MẶC ĐỊNH PHỔ BIẾN NHẤT trong dữ liệu huấn luyện.
Mặc định phổ biến ≠ đúng cho bạn.

⇒ Mỗi ràng buộc không nêu là một quyết định bạn giao cho xác suất.
```

## Mental Model

### Trước đó: context window là gì

Từ "ngữ cảnh" trong note này có một nghĩa kỹ thuật cụ thể, và không biết nó dẫn tới kỳ vọng sai.

> **Context window** là số lượng token tối đa mà mô hình có thể "nhìn thấy" trong **một lần** sinh ra câu trả lời. Nó bao gồm **tất cả**: system prompt, mọi lượt hội thoại trước, file bạn dán vào, kết quả tool, và cả câu trả lời đang được viết ra.

```text
┌─── context window ────────────────────────────────────┐
│ system prompt │ lịch sử hội thoại │ code bạn dán │ ... │  ← chỗ trống còn lại
└───────────────────────────────────────────────────────┘
```

**Token** là đơn vị mà mô hình đọc — xấp xỉ một từ ngắn hoặc một mẩu từ. Với code, ước lượng thô: 1 token ≈ 3–4 ký tự.

Ba hệ quả trực tiếp, và cả ba đều trái với trực giác:

```text
① Mô hình KHÔNG có bộ nhớ giữa các lần gọi.
   Cảm giác "nó nhớ cuộc nói chuyện" là do toàn bộ lịch sử
   được gửi lại MỖI LẦN. Hết chỗ ⇒ phần đầu bị cắt hoặc tóm tắt.
   → chi tiết bạn nói ở đầu buổi có thể đã không còn ở đó.

② Nhiều ngữ cảnh không tự động tốt hơn.
   Dán cả repo vào làm loãng những dòng thật sự quan trọng.
   → chọn 12 dòng đúng thắng 2000 dòng "cho chắc".

③ Đây là ràng buộc vật lý, không phải giới hạn tạm thời của công cụ.
   Cửa sổ lớn hơn làm nó ít đau hơn, không làm nó mất đi.
```

Điểm ① là lý do note này tồn tại: nếu mô hình thật sự nhớ, bạn chỉ cần nói ràng buộc một lần. Vì nó không nhớ, **ngữ cảnh phải được đưa vào một cách có chủ đích và lặp lại** — đó chính là công việc gọi là context engineering.

### Sáu loại ngữ cảnh, xếp theo giá trị

```text
① RÀNG BUỘC       phiên bản · quy mô · số instance · giới hạn vận hành
                  → ảnh hưởng lớn nhất, tốn ít chữ nhất

② MỤC TIÊU        vấn đề cần giải, KHÔNG phải giải pháp bạn nghĩ tới
                  → "cần giới hạn tải" thay vì "viết middleware rate limit"

③ MẪU CÓ SẴN      code hiện tại làm việc tương tự
                  → định nghĩa quy ước rõ hơn mọi lời mô tả

④ PHẢN VÍ DỤ      cái bạn KHÔNG muốn, và vì sao
                  → thu hẹp không gian tìm kiếm rất hiệu quả

⑤ TIÊU CHÍ CHẤP NHẬN  cách bạn sẽ đánh giá kết quả
                  → biến câu trả lời mơ hồ thành kiểm chứng được

⑥ ĐỊNH DẠNG ĐẦU RA   code · so sánh phương án · danh sách câu hỏi
```

```text
Loại ① có tỉ lệ giá trị/chữ cao nhất:
  "NestJS 10, 6 pod, Redis dùng chung" — 8 từ
  → loại bỏ ngay mọi giải pháp in-memory
```

### Ràng buộc quan trọng nhất, theo thứ tự

```text
PHIÊN BẢN      "Next.js 15 App Router" ≠ "Next.js 12 Pages Router"
               → sai phiên bản = API không tồn tại

SỐ INSTANCE    một process hay nhiều pod?
               → quyết định trạng thái ở đâu: bộ nhớ hay store chung

QUY MÔ         100 hay 100.000 bản ghi?
               → quyết định thuật toán, phân trang, index

ĐỒNG THỜI      có thể có hai request cùng lúc trên cùng dữ liệu không?
               → quyết định có cần khoá, transaction, idempotency

CHẾ ĐỘ LỖI     dependency chết thì fail open hay closed?
               → quyết định hành vi trong sự cố

QUY ƯỚC ĐỘI    thư viện, cấu trúc thư mục, cách xử lý lỗi
               → quyết định code có khớp phần còn lại không
```

Năm ràng buộc đầu là năm câu hỏi mà một đồng nghiệp có kinh nghiệm sẽ hỏi bạn trước khi bắt đầu. AI không hỏi — nên bạn phải nói trước.

### Nêu VẤN ĐỀ, không nêu GIẢI PHÁP

```text
✗ "viết middleware rate limit dùng Redis sorted set"
   → bạn đã khoá cả cách tiếp cận lẫn cấu trúc dữ liệu
   → nhận đúng thứ bạn yêu cầu, kể cả khi có cách tốt hơn

✓ "endpoint export tốn 3 giây CPU mỗi lần. Cần ngăn một tenant
   chiếm hết tài nguyên. 6 pod, có Redis. Đề xuất 2 cách và nêu đánh đổi."
   → nhận về lựa chọn, và bạn quyết định
```

```text
Trừ khi bạn ĐÃ quyết định — lúc đó nêu giải pháp là đúng,
nhưng hãy nói rõ đó là quyết định đã chốt:
  "tôi đã chọn token bucket vì lý do X. Viết cài đặt cho nó."
```

### Mẫu có sẵn: cách rẻ nhất truyền quy ước

```text
Thay vì mô tả quy ước bằng lời (dài, dễ thiếu):

  "Đây là một service tương tự trong codebase: [dán 40 dòng].
   Viết service mới cho X theo CÙNG cấu trúc và quy ước."

Nó truyền được những thứ khó mô tả:
  · cách xử lý lỗi          · cách đặt tên
  · cấu trúc DTO             · cách inject phụ thuộc
  · mức độ comment           · cách viết test
```

Đây là kỹ thuật hiệu quả nhất mà ít người dùng thường xuyên: một ví dụ tốt thay được một trang mô tả.

### Phản ví dụ: thu hẹp không gian nhanh

```text
"KHÔNG dùng thư viện mới — chỉ dùng những gì đã có trong package.json"
"KHÔNG lưu trạng thái trong bộ nhớ process"
"KHÔNG dùng `any`"
"KHÔNG thêm abstraction cho trường hợp chưa tồn tại"
"KHÔNG đổi API công khai của module này"
```

```text
Mỗi phản ví dụ loại bỏ một nhánh giải pháp lớn.
Chúng thường hiệu quả hơn việc mô tả cái bạn muốn.
```

### Chia nhỏ nhiệm vụ lớn

```text
✗ "xây hệ thống thông báo"
   → nhận về một khối lớn, khó review, nhiều giả định ngầm

✓ chia thành các bước có thể kiểm chứng riêng:
   ① "thiết kế schema cho thông báo, ràng buộc là X, Y. Nêu đánh đổi."
      → bạn xem, sửa, chốt
   ② "viết repository theo schema đã chốt và theo mẫu này: [dán]"
      → bạn review
   ③ "viết test cho các behavior sau: [liệt kê]"
      → bạn định nghĩa behavior, không để AI suy ra
   ④ "viết worker gửi thông báo; ràng buộc: at-least-once, phải idempotent"
```

```text
Lợi ích: mỗi bước review được, sai thì sửa sớm,
và bạn giữ quyền quyết định ở những chỗ quan trọng.
```

### Ngữ cảnh dài không phải ngữ cảnh tốt

```text
Dán 3000 dòng code vào prompt:
  · phần liên quan bị loãng
  · mâu thuẫn giữa các phần làm nhiễu
  · tốn chi phí và thời gian

✓ dán ĐÚNG phần liên quan: interface, type, một ví dụ, schema
✓ mô tả phần còn lại bằng một câu
```

```text
Kiểm tra: nếu đưa cùng ngữ cảnh này cho một đồng nghiệp mới,
họ có đủ thông tin để làm không? Có bị ngợp không?
```

### Ngữ cảnh bền vững: đừng lặp lại mỗi lần

```text
Ràng buộc lặp lại nên nằm trong FILE, không nằm trong prompt:

  · file quy ước dự án mà công cụ tự đọc (CLAUDE.md, .cursorrules, ...)
  · README mô tả kiến trúc và quyết định
  · ADR ghi lý do
  · type và schema — chúng LÀ đặc tả, và chúng được kiểm tra bởi compiler

Type mạnh là dạng ngữ cảnh tốt nhất: nó vừa mô tả ý định,
vừa được thực thi tự động, vừa không bao giờ lỗi thời.
```

### Vòng lặp sửa ngữ cảnh

```text
Kết quả kém → ĐỪNG hỏi lại cùng câu hỏi.
Hỏi: "ràng buộc nào tôi chưa nêu dẫn tới kết quả này?"

  code dùng in-memory       → chưa nêu số instance
  code dùng API không tồn tại → chưa nêu phiên bản
  code không khớp codebase   → chưa đưa mẫu
  code over-engineer          → chưa nêu quy mô, chưa nêu phản ví dụ
  code thiếu xử lý lỗi        → chưa nêu chế độ lỗi mong muốn
```

Mỗi lần sửa ngữ cảnh là một lần cải thiện có tính tích luỹ: ràng buộc đó nên được đưa vào file quy ước để không phải nêu lại.

## Example

Cùng nhiệm vụ, hai prompt:

```text
── PROMPT 1 ─────────────────────────────────────────────
"Viết hàm xử lý upload file"

Nhận về:
  · đọc toàn bộ file vào bộ nhớ (`req.file.buffer`)
  · lưu ra `./uploads` với tên gốc từ client
  · không giới hạn kích thước, không kiểm tra loại
  · không xử lý lỗi

Bốn lỗ hổng và một bug bộ nhớ — tất cả đều là hệ quả của
mặc định phổ biến, không phải của mô hình kém.
```

```text
── PROMPT 2 ─────────────────────────────────────────────
NGỮ CẢNH
  NestJS 10, chạy 6 pod trên Kubernetes, filesystem là ephemeral.
  Lưu trữ: S3. File từ người dùng: ảnh avatar, tối đa 5 MB.
  Ảnh được phục vụ công khai qua CDN ở TÊN MIỀN RIÊNG.

RÀNG BUỘC
  - KHÔNG đọc toàn bộ file vào bộ nhớ
  - KHÔNG dùng tên file từ client
  - kiểm tra loại theo MAGIC BYTES, không theo đuôi hoặc Content-Type
  - giới hạn cả DUNG LƯỢNG và SỐ ĐIỂM ẢNH (chống ảnh nén cực tốt)
  - Content-Type do SERVER đặt
  - xoá EXIF

MẪU
  [dán 30 dòng một service hiện có để thấy quy ước xử lý lỗi và DI]

TIÊU CHÍ
  - upload .svg đổi đuôi .png → bị từ chối
  - file 6 MB → 413
  - ảnh 20000×20000 (file nhỏ) → bị từ chối
  - Content-Type trả về từ CDN luôn là image/*

Viết service và liệt kê trường hợp biên tôi có thể đã bỏ sót.
```

```text
Kết quả: code dùng stream, validate đúng chỗ, tên object là uuid,
re-encode để xoá EXIF, và một danh sách trường hợp biên bổ sung.

Chi phí: 12 dòng ngữ cảnh.
Lợi ích: bốn lỗ hổng không tồn tại, và code khớp codebase.
```

Và mẫu **sửa ngữ cảnh** khi kết quả chưa đúng:

```text
"Đoạn code trên lưu trạng thái upload trong một Map ở tầng module.
 Ràng buộc nào tôi chưa nêu khiến bạn chọn cách đó?"

→ "Bạn chưa nêu rằng hệ thống chạy nhiều instance và trạng thái
   cần dùng chung giữa chúng."

⇒ đưa ràng buộc đó vào FILE QUY ƯỚC của dự án,
  để không phải nêu lại ở mọi prompt.
```

Và ngữ cảnh dưới dạng type — bền và được compiler thực thi:

```ts
// type mạnh là đặc tả tự thực thi: nó nói rõ ý định
// và ngăn cả bạn lẫn AI viết sai
export type UploadResult =
  | { ok: true; url: string; bytes: number }
  | { ok: false; reason: 'too_large' | 'invalid_type' | 'too_many_pixels' };

export interface AvatarUploader {
  /** Ném lỗi nếu store không khả dụng; trả về ok:false cho lỗi VALIDATE. */
  upload(stream: Readable, userId: string): Promise<UploadResult>;
}
```

Đưa interface này vào prompt truyền được nhiều thông tin hơn một đoạn mô tả dài: nó nói rõ những lỗi nào là giá trị trả về và những lỗi nào là exception.

## Prediction

1. Prompt "viết hàm upload file" không có ngữ cảnh — AI dùng mặc định nào?
2. Thêm "6 pod, filesystem ephemeral" — điều gì bị loại bỏ ngay?
3. Không nêu phiên bản framework — rủi ro gì?
4. Không nêu số instance — giải pháp in-memory có sai không? AI có biết không?
5. Nêu "viết middleware rate limit dùng Redis sorted set" — bạn có nhận được phương án khác không?
6. Nêu vấn đề thay vì giải pháp — bạn nhận được gì?
7. Dán một service hiện có làm mẫu — nó truyền được gì mà mô tả bằng lời khó truyền?
8. Thêm "KHÔNG dùng thư viện mới" — nó loại bỏ bao nhiêu không gian giải pháp?
9. Dán 3000 dòng code vào prompt — chất lượng tăng hay giảm?
10. Chia nhiệm vụ lớn thành 4 bước review được — bạn được gì?
11. Kết quả kém, hỏi lại cùng câu hỏi — kết quả đổi không?
12. Hỏi "ràng buộc nào tôi chưa nêu" — bạn được gì?
13. Đưa ràng buộc lặp lại vào file quy ước — lợi ích tích luỹ ở đâu?
14. Interface TypeScript chặt so với mô tả bằng lời — cái nào bền hơn?

<details>
<summary>Đáp án</summary>

1. **Mặc định phổ biến nhất** trong dữ liệu huấn luyện — thường là ví dụ đơn giản nhất.
2. Mọi giải pháp **ghi ra local filesystem** và **trạng thái in-memory**.
3. API **không tồn tại** ở phiên bản bạn dùng.
4. **Có sai**; AI **không biết** — nó không có thông tin đó.
5. **Không** — bạn đã khoá cả cách tiếp cận.
6. **Lựa chọn kèm đánh đổi**, và bạn giữ quyền quyết định.
7. Quy ước xử lý lỗi, đặt tên, cấu trúc, mức comment — **thứ khó mô tả bằng lời**.
8. Rất nhiều — nó ép dùng thứ đã có.
9. **Giảm** — phần liên quan bị loãng.
10. Mỗi bước **review được**, sai thì sửa sớm, giữ quyền quyết định ở chỗ quan trọng.
11. Thường **không** — cùng đầu vào, cùng loại đầu ra.
12. Nó chỉ ra **lỗ hổng trong ngữ cảnh**, có thể sửa vĩnh viễn.
13. Không phải nêu lại; **mọi prompt sau đều tốt hơn**.
14. **Interface** — nó được compiler thực thi và không lỗi thời.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Hỏi cùng nhiệm vụ với và không có ràng buộc | Khác nhau bao nhiêu? |
| Bỏ phiên bản khỏi prompt | Code có dùng API đúng phiên bản không? |
| Bỏ "nhiều instance" | Có nhận về giải pháp in-memory không? |
| Nêu giải pháp thay vì vấn đề | Có nhận được phương án nào khác không? |
| Dán một mẫu code có sẵn | Code mới có khớp quy ước không? |
| Thêm 5 phản ví dụ | Kết quả thu hẹp thế nào? |
| Dán 3000 dòng thay vì 100 dòng liên quan | Chất lượng đổi thế nào? |
| Chia nhiệm vụ lớn thành 4 bước | Bạn phát hiện vấn đề ở bước nào? |
| Hỏi "ràng buộc nào tôi chưa nêu" | Nó chỉ ra gì? |
| So kết quả với interface chặt và với mô tả bằng lời | Cái nào sát hơn? |

## What Usually Goes Wrong

- **Không nêu phiên bản** → API không tồn tại.
- **Không nêu số instance** → trạng thái in-memory.
- **Không nêu quy mô** → thuật toán không mở rộng, hoặc over-engineer.
- **Không nêu đồng thời** → thiếu khoá, transaction, idempotency.
- **Nêu giải pháp thay vì vấn đề** → mất phương án tốt hơn.
- **Không đưa mẫu** → code không khớp codebase.
- **Không nêu phản ví dụ** → nhận thứ bạn không muốn.
- **Ngữ cảnh quá dài** → phần liên quan bị loãng.
- **Nhiệm vụ quá lớn** → khối code không review nổi.
- **Hỏi lại cùng câu hỏi** khi kết quả kém.
- **Lặp lại ràng buộc mỗi lần** thay vì đưa vào file quy ước.
- **Để AI suy test từ code** thay vì từ behavior bạn nêu.
- **Không nêu tiêu chí chấp nhận** → không có cách đánh giá kết quả.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Prompt dài = ngữ cảnh tốt | Ngữ cảnh ĐÚNG mới tốt; dài làm loãng |
| AI biết codebase của bạn | Nó chỉ biết những gì bạn đưa vào |
| Kết quả kém là do mô hình | Thường là do thiếu ràng buộc |
| Nên nói chính xác cách làm | Nêu vấn đề thường cho kết quả tốt hơn |
| Phản ví dụ là thừa | Chúng thu hẹp không gian rất hiệu quả |
| Mẫu code chỉ để tham khảo | Nó là cách truyền quy ước hiệu quả nhất |
| Nhiệm vụ lớn tiết kiệm thời gian | Nó tạo khối code không review nổi |
| Hỏi lại sẽ ra kết quả tốt hơn | Cùng đầu vào, cùng loại đầu ra |
| Ngữ cảnh phải viết lại mỗi lần | Nó nên nằm trong file, type, và ADR |
| Type chỉ để tránh lỗi | Nó là đặc tả được thực thi tự động |

## Debugging

Khi kết quả không như mong đợi, đi theo thứ tự này:

1. **Liệt kê ràng buộc bạn ĐÃ nêu** và so với sáu ràng buộc quan trọng nhất — thiếu cái nào?
2. **Hỏi thẳng AI**: "ràng buộc nào tôi chưa nêu dẫn tới kết quả này?"
3. **Code không khớp codebase** → chưa đưa mẫu.
4. **Code over-engineer** → chưa nêu quy mô và phản ví dụ.
5. **Code dùng API lạ** → chưa nêu phiên bản; kiểm chứng với tài liệu chính thức.
6. **Code bỏ qua lỗi** → chưa nêu chế độ lỗi mong muốn.
7. **Khối code quá lớn để review** → chia nhiệm vụ và làm lại.
8. **Ràng buộc phải nêu lần thứ ba** → đưa nó vào file quy ước của dự án.

## Production Considerations

- **File quy ước dự án** mà công cụ tự đọc: stack, phiên bản, số instance, quy ước, phản ví dụ.
- **Type và schema chặt** — chúng là đặc tả bền nhất.
- **ADR ghi lý do** — AI không biết vì sao bạn chọn thế.
- **Nêu sáu ràng buộc quan trọng** trong mọi nhiệm vụ không tầm thường.
- **Nêu vấn đề, không nêu giải pháp**, trừ khi đã quyết định.
- **Đưa mẫu code có sẵn** thay vì mô tả quy ước bằng lời.
- **Phản ví dụ tường minh** cho những thứ đội bạn không dùng.
- **Chia nhiệm vụ thành bước review được.**
- **Tiêu chí chấp nhận trong prompt** — biến kết quả thành thứ kiểm chứng được.
- **Định nghĩa behavior trước khi để AI viết test.**
- **Sửa ngữ cảnh, không hỏi lại**, khi kết quả kém.
- **Ràng buộc lặp lại ba lần thì đưa vào file** — cải thiện có tính tích luỹ.
- **Chia sẻ prompt tốt trong đội** như chia sẻ script — chúng là tài sản chung.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Ngữ cảnh đầy đủ | kết quả sát, ít sửa | tốn thời gian viết prompt |
| Prompt ngắn | nhanh | nhận mặc định phổ biến |
| Nêu vấn đề | có phương án và đánh đổi | dài hơn, cần đọc và chọn |
| Nêu giải pháp | thẳng vào việc | mất phương án tốt hơn |
| Dán nhiều mẫu | quy ước khớp | ngữ cảnh dài, có thể loãng |
| Không dán mẫu | ngắn gọn | code không khớp codebase |
| Chia nhỏ nhiệm vụ | review được từng bước | nhiều vòng lặp hơn |
| Nhiệm vụ lớn | ít vòng lặp | khối code khó review |
| File quy ước | không lặp lại, tích luỹ | phải duy trì cho cập nhật |
| Type chặt | đặc tả tự thực thi | tốn công định nghĩa |

## Explain Without Notes

1. Sáu loại ngữ cảnh, và loại nào có tỉ lệ giá trị/chữ cao nhất?
2. Sáu ràng buộc quan trọng nhất, và điều gì xảy ra khi thiếu từng cái?
3. Vì sao nêu vấn đề thường tốt hơn nêu giải pháp? Khi nào ngoại lệ?
4. Vì sao dán mẫu code hiệu quả hơn mô tả quy ước bằng lời?
5. Vì sao ngữ cảnh dài không đồng nghĩa với ngữ cảnh tốt?
6. Vòng lặp sửa ngữ cảnh hoạt động thế nào, và vì sao nó tích luỹ?
7. Vì sao type mạnh là dạng ngữ cảnh tốt nhất?
8. Khi kết quả kém, làm gì thay vì hỏi lại cùng câu hỏi?

## Related

- [AI thay đổi cái gì](01-what-ai-changes.md) — nút thắt dịch chuyển sang xác minh
- [Reviewing AI code](03-reviewing-ai-code.md) — kiểm tra kết quả
- [Hallucination & verification](04-hallucination-verification.md) — vì sao phiên bản quan trọng
- [AI security & limits](05-ai-security-limits.md) — cái không nên đưa vào ngữ cảnh
- [TypeScript runtime boundary](../01-web-frontend/01-javascript-typescript/typescript/01-runtime-boundary.md) — type là đặc tả
- [Configuration](../02-backend-api/04-architecture/05-configuration.md) — ràng buộc vận hành
- [Requirements & trade-offs](../06-system-design/01-requirements-tradeoffs.md) — nêu ràng buộc bằng số
- [Test theo behavior](../05-cross-cutting/testing/01-testing-pyramid-behavior.md) — behavior là hợp đồng bạn định nghĩa

## Version / Context

Nguyên tắc không gắn với một công cụ cụ thể. Cơ chế "file quy ước dự án mà công cụ tự đọc" tồn tại dưới nhiều tên (`CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`) — tên thay đổi, ý tưởng thì không: ràng buộc lặp lại nên sống trong repo, không trong prompt.
