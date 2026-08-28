---
level: intermediate
area: cross-cutting
related:
  - 02-context-engineering.md
  - ../00-roadmap/03-ai-assisted-learning.md
---

# AI thay đổi cái gì, và không thay đổi cái gì

> Một lập trình viên hoàn thành một tính năng trong bốn giờ thay vì hai ngày nhờ AI. Ba tuần sau, tính năng đó có một bug ở đường xử lý lỗi. Họ mở file và nhận ra: họ **chưa từng đọc** đoạn đó. Nó hoạt động khi test, nên nó được merge. Việc sửa bug mất một ngày rưỡi — phần lớn thời gian là để hiểu code mà chính họ đã "viết". **AI đã rút ngắn thời gian viết và kéo dài thời gian hiểu.**

## Position

```text
MODEL → PREDICT/BUILD → BREAK → EXPLAIN → RECALL
          ↑ AI làm rất nhanh bước này
          nhưng chu trình học nằm ở bốn bước còn lại

Nguyên tắc xuyên suốt folder này:
  AI có thể làm hộ IMPLEMENTATION, nhưng không được lấy mất
  FEEDBACK cần thiết để bạn hình thành mental model.
```

## Problem

```text
AI làm thay đổi CHI PHÍ của từng loại công việc, không đồng đều:

  viết code            rẻ hơn nhiều      ↓↓↓
  đọc và hiểu code     KHÔNG đổi          →
  gỡ lỗi               KHÔNG đổi (đôi khi khó hơn)
  quyết định thiết kế  KHÔNG đổi
  chịu trách nhiệm     KHÔNG đổi

⇒ Tỉ lệ giữa "code tồn tại" và "code được hiểu" thay đổi.
⇒ Nút thắt dịch chuyển từ VIẾT sang XÁC MINH và HIỂU.
```

## Mental Model

### AI mạnh ở đâu, yếu ở đâu

```text
MẠNH — mẫu đã thấy nhiều lần
  boilerplate · chuyển đổi định dạng · viết test cho behavior BẠN đã nêu
  · giải thích stack trace · đề xuất tên · refactor cơ học
  · viết migration từ schema · sinh dữ liệu test · tra cú pháp
  · giải thích code người khác viết · liệt kê trường hợp biên có thể bỏ sót

YẾU — thứ phụ thuộc ngữ cảnh nó không có
  quyết định kiến trúc trong hệ thống của BẠN
  · đánh đổi dựa trên ràng buộc BẠN chưa nói ra
  · nguyên nhân gốc của bug cần quan sát hệ thống thật
  · điều gì đúng với PHIÊN BẢN bạn đang dùng
  · quy ước ngầm của đội bạn
```

```text
Điểm chung của nhóm "yếu": AI không có ngữ cảnh mà bạn chưa cung cấp.
→ phần lớn có thể chuyển sang nhóm "mạnh" bằng ngữ cảnh tốt hơn.
→ phần còn lại (trách nhiệm, đánh đổi có hậu quả) thì không.
```

### Bản chất của công cụ: xác suất, không phải sự thật

```text
Mô hình sinh văn bản dự đoán chuỗi ký tự CÓ KHẢ NĂNG CAO,
không tra cứu sự thật.

Hệ quả trực tiếp:
  · code TRÔNG đúng và ĐỌC trôi chảy dù API không tồn tại
  · độ tự tin trong câu trả lời KHÔNG tương quan với độ chính xác
  · nó không biết nó không biết
  · nó ưu tiên mẫu PHỔ BIẾN, không phải mẫu ĐÚNG cho trường hợp của bạn
```

```text
⇒ Đây không phải khiếm khuyết cần chờ sửa. Nó là bản chất của công cụ.
  Quy trình làm việc phải giả định điều đó, không hy vọng nó biến mất.
```

### Ba chế độ làm việc

```text
① TỰ ĐỘNG HOÁ — việc bạn ĐÃ BIẾT làm, chỉ tốn thời gian
   ✓ giao hết cho AI, kiểm tra kết quả
   ví dụ: 40 DTO từ một schema, chuyển 200 test sang API mới

② CỘNG TÁC — việc bạn biết ĐÍCH nhưng không biết ĐƯỜNG
   ✓ AI đề xuất, bạn đánh giá và chọn
   ví dụ: "cách nào để làm X trong thư viện Y" → đọc, kiểm chứng, quyết định

③ HỌC — việc bạn ĐANG XÂY mental model
   ✗ KHÔNG giao phần suy nghĩ
   → dự đoán trước, tự làm, rồi mới hỏi AI để đối chiếu
```

```text
Câu hỏi phân biệt: "nếu AI làm bước này, tôi có mất feedback cần thiết không?"

Trong chế độ ③, feedback CHÍNH LÀ sản phẩm.
Bỏ qua nó để có code nhanh hơn là đánh đổi sai — bạn nhận code
và mất thứ khiến lần sau bạn tự làm được.
```

### Cái bẫy: hiểu tưởng chừng đã có

```text
Đọc một lời giải thích rõ ràng tạo cảm giác hiểu.
Cảm giác đó KHÔNG PHẢI năng lực.

Kiểm chứng bằng ba câu hỏi:
  · tôi DỰ ĐOÁN được nó làm gì trước khi chạy không?
  · tôi GIẢI THÍCH được cho người khác mà không nhìn code không?
  · tôi biết nó HỎNG thế nào và trong điều kiện nào không?

Ba câu "không" = bạn có code, không có kiến thức.
```

Đây là lý do repo này có mục `Prediction` và `Explain Without Notes` trong mọi note: chúng kiểm tra đúng thứ mà việc đọc giải thích không kiểm tra được.

### Ranh giới trách nhiệm không dịch chuyển

```text
Code trong repo của bạn là code CỦA BẠN, bất kể ai gõ nó.

  · bug ở production là của bạn
  · lỗ hổng bảo mật là của bạn
  · giấy phép của thư viện AI đề xuất là của bạn
  · quyết định kiến trúc AI gợi ý là quyết định của bạn

"AI viết đoạn đó" không phải một lời giải thích trong postmortem.
```

### Nợ hiểu biết: khoản nợ mới

```text
Nợ kỹ thuật:  code hoạt động nhưng khó thay đổi
Nợ HIỂU BIẾT: code hoạt động nhưng KHÔNG AI HIỂU nó

Nợ hiểu biết tệ hơn ở ba điểm:
  · nó vô hình — code trông sạch, test xanh
  · nó tích luỹ nhanh hơn nhiều — viết nhanh hơn nghĩa là nợ nhanh hơn
  · nó chỉ lộ ra khi cần SỬA, tức là lúc bạn ít có thời gian nhất
```

```text
Quy tắc chặn nợ: KHÔNG MERGE CODE BẠN KHÔNG GIẢI THÍCH ĐƯỢC.

Kiểm tra: "nếu đoạn này gây sự cố lúc 3 giờ sáng,
          tôi có sửa được mà không hỏi lại AI không?"
```

### Cái AI làm tốt mà ít người dùng tới

```text
Ba việc AI làm rất tốt và thường bị bỏ qua:

① PHẢN BIỆN THIẾT KẾ CỦA BẠN
   "đây là thiết kế của tôi và các ràng buộc. Nó hỏng ở đâu?"
   → nó liệt kê trường hợp biên nhanh hơn bạn nghĩ ra

② GIẢI THÍCH CODE NGƯỜI KHÁC VIẾT
   codebase cũ, thư viện lạ, stack trace khó
   → đây là chỗ nó tiết kiệm nhiều thời gian nhất và ít rủi ro nhất

③ SINH CÂU HỎI KIỂM TRA HIỂU BIẾT
   "hỏi tôi 10 câu về đoạn code này để kiểm tra tôi có thật sự hiểu không"
   → biến AI thành công cụ HỌC thay vì công cụ thay thế việc học
```

Mẫu ③ đảo ngược quan hệ: thay vì AI đưa câu trả lời, nó đưa câu hỏi — và bạn vẫn phải nghĩ.

### Điều thật sự thay đổi trong quy trình

```text
TRƯỚC              SAU
viết code chậm     viết code nhanh
review ít code     REVIEW NHIỀU CODE HƠN      ← nút thắt mới
test viết sau      test viết cùng lúc (rẻ hơn nhiều)
tài liệu bị bỏ     tài liệu rẻ hơn để viết
                   NHƯNG: xác minh trở thành kỹ năng chính
```

```text
Ba điều chỉnh thực tế cho quy trình:
  · code review kỹ HƠN, không phải ít hơn
  · test là hợp đồng bạn định nghĩa TRƯỚC, không phải thứ AI sinh sau
  · thời gian tiết kiệm được ở khâu viết nên dùng cho ĐO và XÁC MINH
```

## Example

Cùng một nhiệm vụ, ba cách dùng AI:

```text
NHIỆM VỤ: "thêm rate limit cho endpoint /api/export"

── CÁCH 1: giao trọn gói ────────────────────────────────
"Viết rate limiting cho endpoint export trong NestJS"

Nhận về: một guard dùng bộ nhớ trong process, giới hạn 10 req/phút.

Vấn đề — không cái nào lộ ra khi test:
  · in-memory → SAI khi chạy nhiều pod (mỗi pod đếm riêng)
  · 10 req/phút → con số từ đâu? không ai biết
  · không có `Retry-After` → client không biết chờ bao lâu
  · fail closed hay open khi store lỗi? không xác định

⇒ code chạy, test xanh, và sai ở production khi scale.
```

```text
── CÁCH 2: cộng tác có ngữ cảnh ─────────────────────────
"NestJS 10, chạy 6 pod trên K8s, có Redis 7 dùng chung.
 Endpoint /api/export tốn ~3 giây CPU mỗi lần.
 Cần giới hạn theo tenant, không theo IP.
 Nếu Redis chết, tôi muốn fail OPEN (thà cho qua còn hơn chặn hết).
 Đề xuất 2 cách và nêu đánh đổi."

Nhận về: sliding window log vs token bucket, kèm đánh đổi về bộ nhớ và độ chính xác.
→ bạn CHỌN, và bạn biết vì sao.
```

```text
── CÁCH 3: dùng AI để kiểm tra thiết kế của mình ────────
"Đây là thiết kế của tôi: [dán code].
 Ràng buộc: 6 pod, Redis dùng chung, fail open, giới hạn theo tenant.
 Nó hỏng ở đâu? Liệt kê trường hợp biên tôi có thể đã bỏ sót."

Nhận về những thứ dễ bỏ sót:
  · Redis chết giữa chừng → nhánh fail open đã test chưa?
  · tenant mới chưa có khoá → hành vi mặc định là gì?
  · đồng hồ lệch giữa các pod ảnh hưởng sliding window thế nào?
  · giới hạn có áp cho request nội bộ và health check không?
  · `Retry-After` có được đặt không?

⇒ đây là chế độ có tỉ lệ giá trị/rủi ro cao nhất:
  bạn giữ quyền thiết kế, AI mở rộng danh sách kiểm tra.
```

Và mẫu dùng AI để **kiểm tra hiểu biết** thay vì thay thế nó:

```text
"Tôi vừa viết đoạn xử lý retry này. Đừng sửa nó.
 Hỏi tôi 8 câu để kiểm tra tôi có thật sự hiểu:
 điều gì xảy ra khi X, tại sao chọn Y thay vì Z, nó hỏng thế nào khi W."
```

## Prediction

1. Viết code nhanh gấp ba, đọc và hiểu không đổi — nút thắt mới ở đâu?
2. Merge code bạn chưa đọc kỹ, ba tuần sau có bug — sửa nhanh hơn hay chậm hơn tự viết?
3. AI trả lời rất tự tin — điều đó nói gì về độ chính xác?
4. Prompt không nêu "chạy 6 pod" — giải pháp in-memory có sai không? AI có biết không?
5. Nêu ràng buộc đầy đủ — chất lượng đề xuất đổi thế nào?
6. Đọc một lời giải thích rõ ràng — bạn đã hiểu chưa?
7. Ba câu kiểm tra (dự đoán / giải thích / biết nó hỏng thế nào) — trả lời "không" cả ba nghĩa là gì?
8. Nợ hiểu biết so với nợ kỹ thuật — cái nào khó phát hiện hơn? Vì sao?
9. Code AI viết gây sự cố production — trách nhiệm thuộc về ai?
10. Dùng AI ở chế độ "học" cho behavior bạn đang xây mental model — bạn được gì, mất gì?
11. Nhờ AI giải thích codebase cũ — rủi ro cao hay thấp?
12. Nhờ AI quyết định kiến trúc mà không nêu ràng buộc — rủi ro cao hay thấp?
13. Thời gian tiết kiệm ở khâu viết nên dùng vào đâu?
14. "Hỏi tôi 10 câu về đoạn code này" — nó đảo ngược điều gì?

<details>
<summary>Đáp án</summary>

1. **Review, xác minh, và hiểu** — không còn ở khâu gõ code.
2. **Chậm hơn** — bạn phải hiểu code lần đầu, dưới áp lực.
3. **Không gì cả** — độ tự tin không tương quan với độ chính xác.
4. **Có sai**, và AI **không biết** — nó không có ngữ cảnh đó.
5. Tốt hơn rõ rệt — phần lớn "AI yếu" thực ra là "thiếu ngữ cảnh".
6. **Chưa chắc** — cảm giác hiểu không phải năng lực.
7. Bạn có **code, không có kiến thức**.
8. **Nợ hiểu biết** — nó vô hình, code trông sạch và test xanh.
9. **Bạn** — "AI viết đoạn đó" không phải lời giải thích.
10. Được code nhanh, **mất thứ khiến lần sau bạn tự làm được**.
11. **Thấp** — đây là một trong những chỗ giá trị nhất.
12. **Cao** — nó sẽ đưa ra mẫu phổ biến, không phải mẫu đúng cho bạn.
13. **Đo và xác minh** — nút thắt đã dịch chuyển sang đó.
14. Nó đảo ngược vai trò: **AI đặt câu hỏi, bạn vẫn phải nghĩ**.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Hỏi cùng câu hỏi ba lần trong ba phiên khác nhau | Câu trả lời có nhất quán không? |
| Hỏi về một API bạn biết chắc không tồn tại | Nó có nói không biết, hay bịa ra? |
| Bỏ hết ràng buộc khỏi prompt | Chất lượng đề xuất đổi thế nào? |
| Thêm phiên bản, quy mô, ràng buộc | Đổi thế nào? |
| Mở một PR bạn merge tuần trước, giải thích lại từ đầu | Giải thích được không? |
| Chọn một file AI sinh, hỏi "nó hỏng khi nào" | Trả lời được không? |
| Nhờ AI phản biện thiết kế của bạn | Nó tìm ra bao nhiêu trường hợp biên? |
| Nhờ AI hỏi bạn 10 câu về code bạn vừa viết | Trả lời được mấy câu? |
| Đo thời gian: viết vs review vs debug trong một tuần | Tỉ lệ đã đổi chưa? |
| Đếm dòng code merge mà bạn chưa đọc từng dòng | Bao nhiêu? |

## What Usually Goes Wrong

- **Merge code chưa đọc** vì test xanh.
- **Không nêu ràng buộc** → nhận mẫu phổ biến, không phải mẫu đúng.
- **Nhầm độ trôi chảy với độ chính xác.**
- **Giao phần suy nghĩ** khi đang học behavior đó.
- **Nhầm cảm giác hiểu với năng lực.**
- **Không điều chỉnh quy trình review** khi lượng code tăng.
- **Để AI sinh test từ code** thay vì từ behavior mong muốn → test khoá chặt bug.
- **Tích luỹ nợ hiểu biết** mà không nhận ra.
- **Dùng AI cho quyết định kiến trúc** không nêu ràng buộc.
- **Không kiểm chứng API, flag, cấu hình** AI đưa ra.
- **Coi "AI viết" là lời giải thích** khi có sự cố.
- **Bỏ qua ba việc AI làm tốt nhất** (phản biện, giải thích code cũ, đặt câu hỏi).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| AI làm lập trình viên bớt cần thiết | Nó dịch chuyển nút thắt sang xác minh và quyết định |
| Câu trả lời tự tin là câu trả lời đúng | Độ tự tin không tương quan với độ chính xác |
| AI biết codebase của bạn | Nó chỉ biết những gì bạn đưa vào ngữ cảnh |
| AI "yếu" ở quyết định thiết kế | Phần lớn là thiếu ngữ cảnh, không phải thiếu năng lực |
| Test xanh nghĩa là code đúng | Test cũng có thể do AI sinh từ chính code đó |
| Hiểu giải thích = hiểu vấn đề | Dự đoán và giải thích lại mới là kiểm chứng |
| Dùng AI làm chậm việc học | Chỉ khi nó thay bạn làm phần feedback |
| Code AI viết ít lỗi hơn | Nó có lỗi khác loại và khó phát hiện hơn |
| Nợ hiểu biết tự biến mất khi đọc lại | Đọc lại dưới áp lực sự cố là lúc tệ nhất |
| Trách nhiệm chia sẻ với công cụ | Nó không chia sẻ; nó ở nguyên chỗ cũ |

## Debugging

Khi làm việc với AI cho kết quả kém:

1. **Kiểm tra ngữ cảnh trước**: phiên bản, quy mô, ràng buộc, quy ước — có trong prompt không?
2. **Câu trả lời chung chung** → yêu cầu cụ thể: "cho hệ thống có X, Y, Z; nêu đánh đổi".
3. **Code không chạy** → phiên bản thư viện; xem [Hallucination & verification](04-hallucination-verification.md).
4. **Code chạy nhưng sai ở production** → ràng buộc nào chưa nêu? (nhiều instance, đồng thời, tải, lỗi mạng)
5. **Không hiểu code nhận được** → yêu cầu giải thích từng phần, rồi tự viết lại — đừng merge.
6. **Đề xuất mâu thuẫn giữa các phiên** → dấu hiệu vùng nó không chắc; kiểm chứng bằng tài liệu chính thức.
7. **Bạn đang dùng chế độ nào?** Nếu đang học mà dùng chế độ tự động hoá, đó là gốc vấn đề.

## Production Considerations

- **Không merge code không giải thích được** — quy tắc cứng, không có ngoại lệ.
- **Nêu ràng buộc trong mọi prompt**: phiên bản, quy mô, số instance, quy ước đội.
- **Review kỹ hơn, không ít hơn**, khi lượng code tăng.
- **Định nghĩa behavior trước, để AI viết test sau** — không để AI suy test từ code.
- **Kiểm chứng mọi API, flag, cấu hình** với tài liệu chính thức.
- **Dùng AI để phản biện thiết kế** — chế độ có tỉ lệ giá trị/rủi ro cao nhất.
- **Dùng AI để giải thích code cũ** — rủi ro thấp, giá trị cao.
- **Bảo vệ chế độ học**: dự đoán trước, tự làm, rồi mới đối chiếu.
- **Ghi lại quyết định** (ADR) — AI không nhớ vì sao bạn chọn thế.
- **Thời gian tiết kiệm dùng cho đo lường và xác minh**, không dùng để viết thêm code.
- **Quy ước đội về khi nào dùng AI**, và điều gì phải người kiểm tra.
- **Theo dõi nợ hiểu biết**: có bao nhiêu code trong hệ thống mà không ai giải thích được?

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Giao trọn gói | nhanh nhất | không hiểu, nợ hiểu biết |
| Cộng tác có ngữ cảnh | nhanh và hiểu được | tốn công viết prompt tốt |
| Tự làm rồi mới hỏi | học được nhiều nhất | chậm nhất |
| Để AI viết test | phủ nhanh | test có thể khoá chặt hành vi sai |
| Tự định nghĩa test trước | test là hợp đồng thật | chậm hơn |
| Review kỹ mọi dòng | chặn nợ hiểu biết | mất phần lớn thời gian tiết kiệm |
| Review lướt | nhanh | nợ tích luỹ vô hình |
| Dùng AI khi đang học | code nhanh | mất feedback hình thành mental model |
| Không dùng AI khi học | mental model chắc | chậm hơn nhiều |

## Explain Without Notes

1. AI thay đổi chi phí của loại công việc nào, và không đổi của loại nào?
2. Vì sao "độ tự tin không tương quan với độ chính xác" là hệ quả của bản chất công cụ?
3. Ba chế độ làm việc, và câu hỏi phân biệt chúng?
4. Ba câu kiểm tra để phân biệt hiểu thật với cảm giác hiểu?
5. Nợ hiểu biết khác nợ kỹ thuật ở ba điểm nào?
6. Ba việc AI làm tốt mà ít người dùng tới?
7. Vì sao review phải kỹ hơn chứ không ít hơn?
8. Vì sao "AI viết đoạn đó" không phải một lời giải thích?

## Related

- [Context engineering](02-context-engineering.md) — biến "AI yếu" thành "AI mạnh"
- [Reviewing AI code](03-reviewing-ai-code.md) — nút thắt mới
- [Hallucination & verification](04-hallucination-verification.md) — xác minh cái không tồn tại
- [AI security & limits](05-ai-security-limits.md) — rủi ro cần biết
- [AI-Assisted Learning](../00-roadmap/03-ai-assisted-learning.md) — dùng AI để **học**
- [Learning system](../00-roadmap/00-learning-system.md) — chu trình MODEL → PREDICT → BREAK → EXPLAIN
- [Test theo behavior](../05-cross-cutting/testing/01-testing-pyramid-behavior.md) — test là hợp đồng bạn định nghĩa
- [Requirements & trade-offs](../06-system-design/01-requirements-tradeoffs.md) — quyết định vẫn là của bạn

## Version / Context

Nội dung mô tả cách làm việc, không gắn với một công cụ AI cụ thể; nó áp dụng cho trợ lý viết code nói chung. Các mô hình và công cụ thay đổi nhanh — nguyên tắc "xác minh ngữ cảnh, giữ feedback loop, chịu trách nhiệm cuối" thì không.
