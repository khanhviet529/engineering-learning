---
level: advanced
area: system-design
related:
  - 10-design-exercise-template.md
  - ../05-cross-cutting/reliability/04-capacity-and-limits.md
---

# Requirements trước kiến trúc

> Một team dành sáu tuần dựng Kafka, Elasticsearch và một cụm Kubernetes ba node cho sản phẩm mới. Ngày ra mắt, hệ thống có 40 người dùng và 200 request mỗi giờ. Sáu tháng sau vẫn thế. Chi phí hạ tầng gấp bốn lần doanh thu, và mỗi thay đổi nhỏ mất ba ngày vì phải qua bốn hệ thống. **Không có quyết định kỹ thuật nào trong sáu tuần đó là sai về mặt kỹ thuật. Chúng chỉ trả lời những câu hỏi không ai hỏi.**

## Position

```text
YÊU CẦU → RÀNG BUỘC → ĐÁNH ĐỔI → kiến trúc
   ↑ nếu bỏ ba bước đầu, bạn đang chọn công nghệ theo thói quen
```

## Problem

```text
"Thiết kế hệ thống X" là câu hỏi KHÔNG TRẢ LỜI ĐƯỢC nếu thiếu:

  · quy mô nào?              1.000 hay 100 triệu người dùng
  · đọc hay ghi nhiều?       tỉ lệ quyết định gần như mọi thứ
  · độ trễ chấp nhận được?   200ms hay 5 giây
  · dữ liệu cũ được không?   giây, phút, hay không bao giờ
  · mất dữ liệu được không?  và mất bao nhiêu
  · ngân sách và đội ngũ?    ràng buộc thật nhất, thường bị bỏ qua

Cùng một bài toán với hai bộ câu trả lời → hai kiến trúc hoàn toàn khác nhau,
và cả hai đều đúng.
```

## Mental Model

### Bảy câu hỏi trước mọi thiết kế

```text
① AI DÙNG, ĐỂ LÀM GÌ
   ba use case chính, không phải danh sách 40 tính năng

② QUY MÔ
   người dùng hoạt động · request/giây trung bình và ĐỈNH
   · dung lượng dữ liệu hôm nay và sau 2 năm
   · tốc độ tăng

③ HÌNH DẠNG TẢI
   tỉ lệ đọc/ghi · kích thước mỗi bản ghi
   · phân bố lệch không (80% truy cập vào 1% dữ liệu?)
   · đột biến theo mùa/sự kiện

④ YÊU CẦU PHI CHỨC NĂNG — bằng SỐ
   độ trễ p99 · khả dụng · độ tươi của dữ liệu
   · mất mát chấp nhận được (RPO) · thời gian phục hồi (RTO)

⑤ NHẤT QUÁN
   thao tác nào PHẢI nhất quán mạnh, thao tác nào chấp nhận trễ

⑥ RÀNG BUỘC
   ngân sách · số người · kỹ năng hiện có · deadline
   · yêu cầu pháp lý (dữ liệu ở đâu, giữ bao lâu)

⑦ CÁI GÌ KHÔNG CẦN
   ← câu quan trọng nhất và hầu như không ai hỏi
```

Câu ⑦ là câu tiết kiệm nhiều nhất: "chúng ta **không** cần multi-region", "chúng ta **không** cần realtime", "chúng ta **không** cần giữ dữ liệu quá 90 ngày" — mỗi câu loại bỏ cả một nhánh phức tạp.

### Ước lượng: bậc độ lớn, không phải con số chính xác

```text
Mục đích của ước lượng KHÔNG phải dự đoán đúng.
Nó là để biết bạn đang ở VÙNG NÀO:

  100 rps      → một máy chủ, một database. Xong.
  10.000 rps   → cần cache, đọc từ replica, có thể cần queue
  1.000.000 rps→ sharding, nhiều region, kiến trúc khác hẳn

Sai 2 lần: không sao. Sai 100 lần: kiến trúc sai hoàn toàn.
```

```text
Phép tính khung:

  DAU × hành động/ngày / 86.400 = rps trung bình
  rps trung bình × hệ số đỉnh (3–10) = rps đỉnh
  rps ghi × kích thước bản ghi × 86.400 × 365 = dung lượng/năm
  rps × kích thước phản hồi = băng thông
```

```text
Ví dụ — mạng xã hội nội bộ 100.000 DAU:
  đọc:  100.000 × 50 = 5.000.000/ngày → 58 rps, đỉnh ~350 rps
  ghi:  100.000 × 2  =   200.000/ngày → 2,3 rps, đỉnh ~15 rps
  dữ liệu: 200.000 × 1 KB × 365 = 73 GB/năm

  ⇒ 350 rps đọc, 15 rps ghi, 73 GB/năm
  ⇒ MỘT PostgreSQL với một replica đọc là đủ, còn dư nhiều
  ⇒ không cần Kafka, không cần sharding, không cần Elasticsearch
```

Phép tính này mất mười phút và thường thay đổi hoàn toàn thiết kế.

### Tỉ lệ đọc/ghi quyết định kiến trúc

```text
ĐỌC ÁP ĐẢO (100:1)   → cache · replica đọc · denormalize · CDN
                       ghi là đường hiếm, có thể chậm hơn

GHI ÁP ĐẢO (1:1)     → cache ít giá trị (invalidate liên tục)
                       → tối ưu đường ghi: batch, append-only, phân vùng

CÂN BẰNG             → khó nhất; cần đo kỹ trước khi tối ưu bên nào
```

### Yêu cầu phi chức năng phải là SỐ

```text
✗ "hệ thống phải nhanh"          → không kiểm chứng được, không thiết kế được
✓ "p99 của tìm kiếm < 300ms"

✗ "phải luôn sẵn sàng"           → dẫn tới theo đuổi 100%
✓ "99,9% trong giờ hành chính; 99% ngoài giờ"

✗ "dữ liệu phải mới"
✓ "số liệu tổng hợp trễ tối đa 5 phút; số dư phải chính xác tức thì"

✗ "không được mất dữ liệu"
✓ "RPO = 5 phút cho đơn hàng; RPO = 1 giờ cho log hành vi"
```

```text
Con số buộc phải có sự đánh đổi:
  "99,99% thay vì 99,9%" nghe giống nhau, nhưng nó là
  4 phút vs 43 phút mỗi tháng — và thường là chi phí gấp nhiều lần.
```

### Phân biệt yêu cầu thật với yêu cầu tưởng tượng

```text
"Chúng ta cần realtime"
  → thật sự cần bao nhiêu? 100ms hay 5 giây?
  → polling 5 giây đơn giản hơn WebSocket rất nhiều

"Chúng ta cần scale tới hàng triệu người dùng"
  → khi nào? nếu là 3 năm nữa, thiết kế cho HÔM NAY và giữ khả năng đổi

"Chúng ta cần microservices"
  → đó là GIẢI PHÁP, không phải yêu cầu
  → yêu cầu đằng sau là gì: đội ngũ độc lập? scale riêng? cô lập lỗi?

"Chúng ta cần nhất quán mạnh"
  → cho THAO TÁC NÀO? thường chỉ 5% thao tác thật sự cần
```

Kỹ thuật hữu ích: khi nghe một yêu cầu là **tên công nghệ**, hỏi ngược lại "vấn đề gì khiến bạn nghĩ tới nó". Câu trả lời thường dẫn tới giải pháp đơn giản hơn.

### Đánh đổi phải viết ra

```text
Mọi quyết định kiến trúc là ĐÁNH ĐỔI, không phải lựa chọn "tốt nhất":

  cache          nhanh hơn ↔ dữ liệu cũ, phức tạp invalidation
  queue          chịu đột biến ↔ độ trễ, phức tạp, khó debug
  microservices  đội ngũ độc lập ↔ mạng, vận hành, nhất quán
  sharding       mở rộng ghi ↔ mất join và transaction xuyên shard
  denormalize    đọc nhanh ↔ ghi phức tạp, rủi ro không nhất quán
  multi-region   độ trễ thấp, chịu mất region ↔ chi phí, nhất quán rất khó
```

```text
Ghi lại quyết định (ADR — Architecture Decision Record):
  · BỐI CẢNH: yêu cầu và ràng buộc lúc đó
  · QUYẾT ĐỊNH: chọn gì
  · LỰA CHỌN KHÁC: đã cân nhắc gì, vì sao loại
  · HỆ QUẢ: được gì, mất gì, cái gì sẽ khó hơn về sau

Giá trị lớn nhất của ADR không phải cho hôm nay.
Nó là để 18 tháng sau, khi bối cảnh đổi, bạn biết quyết định nào cần xem lại.
```

### Bắt đầu đơn giản, giữ khả năng đổi

```text
Kiến trúc tốt nhất cho hầu hết sản phẩm mới:

  một ứng dụng (modular monolith) · một PostgreSQL
  · một cache khi cần · một queue khi cần
  → đơn giản, dễ thay đổi, dễ vận hành, rẻ

Thêm phức tạp khi và chỉ khi có BẰNG CHỨNG cần nó:
  · số đo cho thấy giới hạn
  · yêu cầu nghiệp vụ không đáp ứng được
  · đội ngũ đủ lớn để cần ranh giới độc lập
```

```text
Điều quan trọng: giữ khả năng đổi bằng RANH GIỚI RÕ TRONG CODE,
không phải bằng cách tách service sớm.
  → module có ranh giới rõ tách thành service được khi cần
  → service tách sai ranh giới không gộp lại được dễ dàng
```

Xem [Modular monolith](../02-backend-api/04-architecture/02-modular-monolith.md).

### Chi phí là một yêu cầu phi chức năng

```text
Ba loại chi phí, và loại thứ ba thường lớn nhất:

  ① HẠ TẦNG      máy chủ, dịch vụ quản lý, băng thông
  ② PHÁT TRIỂN   thời gian xây dựng
  ③ VẬN HÀNH     ai trực? ai debug? ai nâng cấp? ai onboard người mới?

Một hệ thống dùng 6 công nghệ cần đội ngũ hiểu 6 công nghệ.
Với đội 4 người, đó thường là ràng buộc chặt hơn mọi giới hạn kỹ thuật.
```

## Example

Cùng một bài toán, hai bộ yêu cầu, hai kiến trúc:

```text
BÀI TOÁN: "hệ thống thông báo cho người dùng"

── TRƯỜNG HỢP A ────────────────────────────────────────
  50.000 DAU · 3 thông báo/người/ngày · trễ 1 phút chấp nhận được
  · mất một thông báo hiếm là chấp nhận được · đội 3 người

  ước lượng: 150.000 thông báo/ngày = 1,7/giây, đỉnh ~10/giây

  KIẾN TRÚC:
    bảng notifications trong PostgreSQL
    + một worker đọc bằng FOR UPDATE SKIP LOCKED
    + client polling mỗi 30 giây
    → không cần queue, không cần WebSocket, không cần service riêng

── TRƯỜNG HỢP B ────────────────────────────────────────
  5.000.000 DAU · 20 thông báo/người/ngày · phải hiện trong 2 giây
  · không được mất · fan-out: một sự kiện → tới 100.000 người nhận
  · đội 25 người

  ước lượng: 100 triệu/ngày = 1.150/giây, đỉnh ~8.000/giây
             fan-out đỉnh: một sự kiện tạo 100.000 bản ghi

  KIẾN TRÚC:
    Kafka phân vùng theo userId · worker fan-out riêng
    · WebSocket qua gateway có Redis adapter
    · lưu trữ phân vùng theo thời gian · outbox để không mất event
    → phức tạp là BẮT BUỘC ở quy mô này
```

```text
Khác biệt: 4 con số trong phần yêu cầu.
Nếu team ở trường hợp A xây kiến trúc B, họ mất sáu tháng
và có một hệ thống mà 3 người không vận hành nổi.
```

Và một ADR cho quyết định trong trường hợp A:

```text
ADR-007: Dùng bảng PostgreSQL thay vì message queue cho thông báo

BỐI CẢNH
  1,7 thông báo/giây, đỉnh 10/giây. Trễ 1 phút chấp nhận được.
  Đội 3 người, chưa ai vận hành Kafka hay RabbitMQ.

QUYẾT ĐỊNH
  Bảng `notifications` + worker dùng FOR UPDATE SKIP LOCKED.

LỰA CHỌN KHÁC
  · BullMQ/Redis — thêm một hệ thống stateful phải vận hành; chưa cần ở quy mô này
  · Kafka — không có nhu cầu nào biện minh được chi phí vận hành

HỆ QUẢ
  + không thêm hạ tầng; transaction cùng với dữ liệu nghiệp vụ (không cần outbox)
  + debug bằng SQL
  − giới hạn ~vài nghìn job/giây; vượt qua thì phải chuyển
  − không có retry/DLQ sẵn — phải tự viết (khoảng 80 dòng)

XEM LẠI KHI
  vượt 500 thông báo/giây, hoặc khi cần fan-out > 10.000 người nhận.
```

Dòng "XEM LẠI KHI" là phần có giá trị nhất: nó biến một quyết định tạm thời thành một quyết định **có điều kiện thoát rõ ràng**.

## Prediction

1. 100.000 DAU × 50 lần đọc/ngày — rps trung bình? Đỉnh với hệ số 6?
2. Con số đó cần kiến trúc phân tán không?
3. Ước lượng sai 2 lần — kiến trúc có sai không?
4. Sai 100 lần — có sai không?
5. Tỉ lệ đọc:ghi = 100:1 — tối ưu hướng nào?
6. Tỉ lệ 1:1 — cache còn nhiều giá trị không?
7. "Hệ thống phải nhanh" — thiết kế được không? Kiểm chứng được không?
8. Khách hàng nói "cần realtime", hỏi kỹ ra 5 giây là đủ — khác biệt về kiến trúc?
9. 99,9% so với 99,99% — khác bao nhiêu phút mỗi tháng? Chi phí?
10. Đội 4 người vận hành hệ thống dùng 6 công nghệ — ràng buộc nào chặt nhất?
11. Tách microservices sai ranh giới — gộp lại dễ hay khó?
12. Module có ranh giới rõ trong monolith — tách ra dễ hay khó?
13. Không viết ADR, 18 tháng sau bối cảnh đổi — làm sao biết quyết định nào cần xem lại?
14. Câu hỏi "cái gì KHÔNG cần" — nó tiết kiệm gì?

<details>
<summary>Đáp án</summary>

1. `5.000.000 / 86.400 ≈ 58 rps`; đỉnh **≈350 rps**.
2. **Không** — một database với một replica xử lý được thoải mái.
3. **Thường không** — vẫn cùng vùng kiến trúc.
4. **Có** — 350 rps và 35.000 rps là hai thế giới khác nhau.
5. **Đường đọc**: cache, replica, denormalize.
6. **Ít** — invalidate liên tục làm tỉ lệ trúng thấp.
7. **Không** cả hai — không có số thì không có tiêu chí.
8. Rất lớn: **polling** thay vì WebSocket + gateway + Redis adapter.
9. **43 phút** so với **4,3 phút**; chi phí thường gấp nhiều lần.
10. **Năng lực vận hành của đội** — chặt hơn mọi giới hạn kỹ thuật.
11. **Rất khó** — dữ liệu đã tách, hợp đồng đã công khai.
12. **Dễ hơn nhiều** — ranh giới đã rõ, chỉ đổi cách gọi.
13. **Không biết được** — phải đọc lại code và đoán ý định.
14. Nó **loại bỏ cả một nhánh phức tạp** trước khi nhánh đó được xây.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Ước lượng rps từ số người dùng thật | Có cần kiến trúc hiện tại không? |
| Hỏi "p99 chấp nhận được là bao nhiêu ms" | Có ai trả lời bằng số không? |
| Hỏi "mất bao nhiêu dữ liệu là chấp nhận được" | Có RPO/RTO không? |
| Đếm số công nghệ trong hệ thống so với số người | Ai vận hành cái nào? |
| Hỏi "cái gì chúng ta KHÔNG cần" | Có ai từng hỏi chưa? |
| Tìm ADR cho ba quyết định lớn nhất | Có không? |
| Hỏi "vì sao chọn công nghệ X" | Có lý do hay là thói quen? |
| Tính chi phí hạ tầng/người dùng | Có bền vững không? |
| Kiểm tra tỉ lệ đọc/ghi thật | Có khớp giả định không? |
| Hỏi "khi nào thì cần xem lại quyết định này" | Có điều kiện thoát không? |

## What Usually Goes Wrong

- **Chọn công nghệ trước khi có yêu cầu.**
- **Không ước lượng** → không biết đang ở vùng nào.
- **Yêu cầu phi chức năng dạng tính từ** thay vì số.
- **Thiết kế cho quy mô tưởng tượng** thay vì quy mô thật.
- **Không hỏi "cái gì không cần".**
- **Nhận giải pháp làm yêu cầu** ("chúng ta cần Kafka").
- **Bỏ qua ràng buộc đội ngũ và ngân sách** — thường là ràng buộc chặt nhất.
- **Không ghi ADR** → 18 tháng sau không ai biết vì sao.
- **Không có điều kiện xem lại** → quyết định tạm thành vĩnh viễn.
- **Tách service sớm** → ranh giới sai, không gộp lại được.
- **Nhất quán mạnh cho mọi thứ** khi chỉ 5% thao tác cần.
- **Bỏ qua chi phí vận hành** — loại chi phí lớn nhất.
- **Không xem lại yêu cầu** khi sản phẩm thay đổi.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Có một kiến trúc "đúng" | Có kiến trúc phù hợp với **bộ yêu cầu cụ thể** |
| Thiết kế cho quy mô lớn là an toàn | Nó là chi phí trả trước cho tương lai chưa chắc tới |
| Microservices là kiến trúc trưởng thành | Nó là đánh đổi, thường sai với đội nhỏ |
| Công nghệ phổ biến là lựa chọn an toàn | An toàn phụ thuộc vào việc **đội bạn** vận hành được |
| Ước lượng phải chính xác | Bậc độ lớn là đủ |
| Yêu cầu là thứ khách hàng nói | Chúng thường là giải pháp trá hình |
| Nhất quán mạnh luôn tốt hơn | Nó đắt và hiếm khi cần cho mọi thao tác |
| Bắt đầu đơn giản = nợ kỹ thuật | Nợ là phức tạp không cần thiết |
| Thêm cache/queue là cải thiện | Mỗi cái là một hệ thống phải vận hành |
| ADR là thủ tục giấy tờ | Nó là thứ duy nhất giải thích quyết định 18 tháng sau |

## Debugging

Khi kiến trúc "có vẻ sai" nhưng không rõ sai ở đâu:

1. **Viết lại yêu cầu bằng số** từ dữ liệu thật hôm nay — không dùng giả định cũ.
2. **So với thiết kế hiện tại**: thành phần nào đang giải quyết vấn đề không tồn tại?
3. **Đo chi phí ba loại**: hạ tầng, phát triển, vận hành. Loại nào đang lớn bất thường?
4. **Tìm thành phần không ai hiểu** — nó là rủi ro vận hành lớn nhất.
5. **Kiểm tra giả định về tải**: tỉ lệ đọc/ghi, hệ số đỉnh, phân bố có đúng như thiết kế giả định không?
6. **Tìm ADR**; nếu không có, viết lại cho các quyết định lớn dựa trên những gì suy ra được.
7. **Hỏi "nếu xây lại hôm nay với yêu cầu hiện tại, chúng ta có làm thế này không"** — chênh lệch là nợ kiến trúc.
8. **Xác định điều kiện thoát** cho từng thành phần: khi nào bỏ được, khi nào phải thay?

## Production Considerations

- **Viết yêu cầu bằng số** trước mọi thiết kế; xem lại mỗi quý.
- **Ước lượng bậc độ lớn** cho rps, dung lượng, băng thông, chi phí.
- **Đo hệ số đỉnh thật**, không dùng con số mặc định.
- **SLO cho từng nhóm thao tác**, không một SLO cho cả hệ thống.
- **RPO/RTO cho từng loại dữ liệu** — chúng khác nhau.
- **Hỏi "cái gì không cần"** trong mọi buổi thiết kế.
- **ADR cho mọi quyết định khó đảo ngược**, kèm điều kiện xem lại.
- **Bắt đầu bằng modular monolith + PostgreSQL** trừ khi có bằng chứng ngược lại.
- **Ranh giới rõ trong code** trước khi nghĩ tới ranh giới triển khai.
- **Tính chi phí vận hành** vào mọi quyết định thêm công nghệ.
- **Một người trong đội phải hiểu sâu** mỗi công nghệ được đưa vào; nếu không, đừng đưa vào.
- **Xem lại kiến trúc khi quy mô đổi 10 lần**, không phải khi đổi 2 lần.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Thiết kế cho hôm nay | đơn giản, nhanh, rẻ | phải làm lại khi lớn |
| Thiết kế cho tương lai | không phải làm lại | phức tạp ngay, có thể không bao giờ cần |
| Nhiều công nghệ chuyên biệt | mỗi việc dùng công cụ tốt nhất | chi phí vận hành nhân lên |
| Ít công nghệ | đội hiểu sâu, vận hành dễ | dùng công cụ không tối ưu cho một số việc |
| Monolith | đơn giản, transaction dễ | scale và tổ chức đội khó khi lớn |
| Microservices | đội độc lập, scale riêng | mạng, vận hành, nhất quán |
| Nhất quán mạnh | dễ suy luận | đắt, giới hạn khả dụng |
| Nhất quán cuối cùng | mở rộng tốt | logic phức tạp, khó suy luận |
| Dịch vụ quản lý | ít vận hành | chi phí, khoá nhà cung cấp |
| Tự vận hành | rẻ hơn, kiểm soát | tốn người, rủi ro |

## Explain Without Notes

1. Bảy câu hỏi trước mọi thiết kế, và câu nào tiết kiệm nhiều nhất?
2. Vì sao ước lượng bậc độ lớn đủ, và khi nào sai số trở nên quan trọng?
3. Ước lượng rps và dung lượng cho 100.000 DAU với 50 hành động/ngày.
4. Tỉ lệ đọc/ghi ảnh hưởng tới kiến trúc thế nào?
5. Chuyển ba yêu cầu dạng tính từ thành yêu cầu dạng số.
6. Ba loại chi phí, và vì sao loại thứ ba thường lớn nhất?
7. Vì sao ranh giới trong code quan trọng hơn ranh giới triển khai lúc đầu?
8. ADR gồm bốn phần nào, và phần nào có giá trị lâu dài nhất?

## Related

- [Design exercise template](10-design-exercise-template.md) — quy trình làm bài thiết kế
- [Scaling: cache & queue](02-scaling-cache-queue.md) — bước tiếp theo khi có số
- [Consistency & availability](04-consistency-availability.md) — đánh đổi nền tảng
- [Storage selection](06-storage-selection.md) — chọn kho dữ liệu theo yêu cầu
- [Distributed systems fallacies](09-distributed-systems-fallacies.md) — giả định sai phổ biến
- [Modular monolith](../02-backend-api/04-architecture/02-modular-monolith.md) — điểm khởi đầu thực dụng
- [Capacity & limits](../05-cross-cutting/reliability/04-capacity-and-limits.md) — biến ước lượng thành giới hạn
- [Metrics & SLO](../05-cross-cutting/observability/04-metrics-slo.md) — biến yêu cầu thành số đo

## Version / Context

Nội dung không gắn công nghệ cụ thể. ADR theo định dạng của Michael Nygard. Hệ số đỉnh 3–10× là quan sát thực nghiệm cho ứng dụng B2C — hãy đo hệ số của chính bạn. Ví dụ tham chiếu PostgreSQL 16 và Kafka; nguyên tắc áp dụng cho mọi lựa chọn tương đương.
