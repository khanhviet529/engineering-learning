---
level: advanced
area: system-design
prerequisites:
  - 01-requirements-tradeoffs.md
related:
  - 09-distributed-systems-fallacies.md
  - ../07-projects/fullstack-lab/README.md
---

# Template làm bài system design

> Trong một buổi thiết kế, hai người vẽ mười hai hộp và tám mũi tên lên bảng trong hai mươi phút. Khi được hỏi "hệ thống này chịu bao nhiêu request mỗi giây", không ai trả lời được. Khi được hỏi "vì sao có Kafka ở đây", câu trả lời là "để tách các service". Bản vẽ trông giống một kiến trúc. **Nó không chứa một quyết định nào — chỉ có một danh sách công nghệ được sắp xếp theo không gian.**

## Position

```text
Bài tập system design KHÔNG phải bài kiểm tra xem bạn biết bao nhiêu công nghệ.
Nó kiểm tra: bạn có suy nghĩ theo YÊU CẦU → RÀNG BUỘC → ĐÁNH ĐỔI không.

Cùng một bài, hai bộ yêu cầu → hai kiến trúc, cả hai đều đúng.
Vẽ hộp và mũi tên mà không có số → không có kiến trúc nào cả.
```

## Problem

```text
Ba lỗi phổ biến khi làm bài thiết kế:

① VẼ TRƯỚC KHI HỎI
   nhảy thẳng vào giải pháp; không ai biết đang giải bài toán nào

② KHÔNG CÓ SỐ
   "cần scale" · "phải nhanh" · "chịu tải cao"
   → không kiểm chứng được, không so sánh phương án được

③ LIỆT KÊ CÔNG NGHỆ THAY VÌ RA QUYẾT ĐỊNH
   "dùng Kafka, Redis, Elasticsearch, K8s"
   → mỗi cái giải quyết vấn đề gì? đánh đổi gì? bỏ được không?
```

## Mental Model

### Sáu bước, theo thứ tự

```text
① LÀM RÕ            10%   yêu cầu chức năng và PHI CHỨC NĂNG, phạm vi
② ƯỚC LƯỢNG          10%   rps, dung lượng, băng thông — bậc độ lớn
③ MÔ HÌNH DỮ LIỆU    15%   thực thể, quan hệ, MÔ HÌNH TRUY CẬP
④ THIẾT KẾ CAO       20%   luồng chính từ đầu tới cuối
⑤ ĐI SÂU             35%   1–2 phần khó nhất, có đánh đổi cụ thể
⑥ VẬN HÀNH           10%   hỏng thế nào, quan sát thế nào, mở rộng ra sao

Bước ⑤ là nơi thể hiện năng lực. Bước ①② là nơi quyết định
liệu bước ⑤ có ý nghĩa hay không.
```

### Bước ① — Làm rõ: hỏi trước khi vẽ

```text
CHỨC NĂNG
  · ba use case CHÍNH là gì? (không phải danh sách 40 tính năng)
  · ai dùng? · cái gì NGOÀI phạm vi?

PHI CHỨC NĂNG — bằng SỐ
  · bao nhiêu người dùng? tăng thế nào?
  · đọc/ghi ratio? · độ trễ p99 mục tiêu?
  · khả dụng? · dữ liệu cũ chấp nhận tới đâu?
  · mất dữ liệu chấp nhận tới đâu (RPO)?

RÀNG BUỘC
  · đội bao nhiêu người? · ngân sách? · deadline?
  · yêu cầu pháp lý? · hệ thống sẵn có phải tích hợp?
```

```text
Câu hỏi giá trị nhất: "CÁI GÌ KHÔNG CẦN?"
  không cần multi-region · không cần realtime · không cần giữ dữ liệu quá 90 ngày
  → mỗi câu loại bỏ cả một nhánh phức tạp trước khi nó được vẽ
```

### Bước ② — Ước lượng: bốn phép tính

```text
rps      = DAU × hành động/ngày / 86.400
đỉnh     = rps × hệ số đỉnh (3–10)
dung lượng = ghi/giây × kích thước bản ghi × 86.400 × 365
băng thông = rps × kích thước phản hồi

Nói TO các giả định:
  "giả sử 100.000 DAU, mỗi người 50 lần đọc và 2 lần ghi mỗi ngày,
   hệ số đỉnh 6 → 350 rps đọc, 15 rps ghi đỉnh"
```

```text
Mục đích không phải chính xác. Nó là để biết đang ở VÙNG nào:
  ~100 rps    → một máy chủ, một database
  ~10.000 rps → cache, replica đọc, có thể queue
  ~1M rps     → sharding, nhiều region, kiến trúc khác hẳn

Và để phát hiện khi một phương án rõ ràng thừa hoặc rõ ràng thiếu.
```

### Bước ③ — Mô hình dữ liệu: bắt đầu từ truy cập

```text
Không vẽ ERD trước. Liệt kê CÂU HỎI hệ thống phải trả lời:

  "đơn hàng của người dùng X, sắp theo thời gian, 20 cái gần nhất"
  "tổng doanh thu theo ngày trong 90 ngày"
  "sản phẩm khớp từ khoá, xếp theo độ liên quan"

Từ đó suy ra: thực thể · quan hệ · khoá · index · và KHO DỮ LIỆU nào
```

```text
Ba câu hỏi cho mô hình dữ liệu:
  · truy vấn nào là NÓNG NHẤT? → nó quyết định index và có thể quyết định kho
  · dữ liệu nào phải NHẤT QUÁN MẠNH? → thường dưới 10%
  · dữ liệu nào TĂNG VÔ HẠN? → cần phân vùng và chính sách lưu trữ
```

### Bước ④ — Thiết kế cao: một luồng, từ đầu tới cuối

```text
Vẽ MỘT luồng chính đi hết:
  client → CDN/LB → API → cache/DB → phản hồi
  và với ghi: → transaction → outbox → worker → tác dụng phụ

Với MỖI thành phần, nói rõ NÓ GIẢI QUYẾT VẤN ĐỀ GÌ.
Thành phần không có câu trả lời → XOÁ NÓ.
```

```text
Bắt đầu từ phương án ĐƠN GIẢN NHẤT hoạt động được ở quy mô đã ước lượng:
  "350 rps đọc, 15 rps ghi → một API, một PostgreSQL với một replica.
   Chưa cần cache. Chưa cần queue."

Rồi thêm từng thứ khi chỉ ra được nó giải quyết điều gì.
Đây là cách trình bày mạnh hơn nhiều so với vẽ sẵn kiến trúc phức tạp.
```

### Bước ⑤ — Đi sâu: nơi thể hiện năng lực

```text
Chọn 1–2 phần KHÓ NHẤT và đi sâu thật sự:

  · phần có đánh đổi thú vị nhất
  · phần người phỏng vấn/đồng nghiệp quan tâm
  · phần bạn hiểu rõ nhất

Với mỗi quyết định, nói ĐỦ BA VẾ:
  "Tôi chọn X vì Y. Đánh đổi là Z. Nếu điều kiện đổi thành W, tôi sẽ chọn khác."
  ↑ vế thứ ba là thứ phân biệt người hiểu với người thuộc lòng
```

```text
Ví dụ đầy đủ:
  "Tôi chọn cache-aside với TTL 5 phút vì tỉ lệ đọc:ghi là 200:1
   và dữ liệu cũ 5 phút không ảnh hưởng nghiệp vụ.
   Đánh đổi: người dùng có thể thấy giá cũ trong tối đa 5 phút,
   và tôi thêm một hệ thống phải vận hành.
   Nếu giá thay đổi theo phút, tôi sẽ xoá cache chủ động khi ghi
   và giữ TTL làm lưới an toàn."
```

### Bước ⑥ — Vận hành: câu hỏi hay bị bỏ

```text
HỎNG THẾ NÀO
  · dependency nào bắt buộc, cái nào không?
  · một thành phần chết → hệ thống thế nào?
  · quá tải → shed load hay sập?

QUAN SÁT THẾ NÀO
  · ba metric quan trọng nhất là gì?
  · sự cố lúc 3 giờ sáng: bạn nhìn vào đâu?

MỞ RỘNG THẾ NÀO
  · nút thắt đầu tiên khi tải × 10 là gì?
  · thay đổi nào đắt nhất để làm sau?
```

```text
Câu cuối là câu quan trọng nhất về mặt kiến trúc:
  quyết định khó đảo ngược nhất phải được nhận diện SỚM
  (khoá sharding · định danh công khai · hợp đồng event · mô hình dữ liệu)
```

### Bảy sai lầm cần tránh

```text
① vẽ hộp trước khi hỏi yêu cầu
② không có số ở bất kỳ đâu
③ liệt kê công nghệ thay vì nêu quyết định
④ over-engineer: thiết kế cho 1M rps khi cần 350
⑤ bỏ qua vận hành: không nói gì về hỏng hóc và quan sát
⑥ không nêu đánh đổi: mọi lựa chọn đều "tốt nhất"
⑦ im lặng khi không biết: nói "tôi không chắc, tôi sẽ đo X để quyết định"
   mạnh hơn nhiều so với đoán bừa
```

## Example

Bài: **"Thiết kế hệ thống rút gọn URL"** — sáu bước, có số.

```text
── ① LÀM RÕ ─────────────────────────────────────────────
Chức năng: tạo link ngắn · chuyển hướng · thống kê lượt click
Ngoài phạm vi: link tuỳ chỉnh, hết hạn, mật khẩu (hỏi và xác nhận)

Phi chức năng:
  · 10 triệu link mới/tháng
  · đọc:ghi = 100:1
  · chuyển hướng p99 < 100ms
  · khả dụng 99,95% cho chuyển hướng, 99,9% cho tạo link
  · thống kê trễ 1 phút chấp nhận được
  · link tồn tại vĩnh viễn

KHÔNG CẦN: multi-region · thống kê realtime · sửa link sau khi tạo
```

```text
── ② ƯỚC LƯỢNG ──────────────────────────────────────────
ghi:  10.000.000/tháng = 4 rps, đỉnh ×6 = 24 rps
đọc:  4 × 100 = 400 rps, đỉnh = 2.400 rps
dung lượng: 10M × 500 byte × 12 = 60 GB/năm
      → sau 5 năm: 300 GB, 600 triệu dòng

⇒ ghi rất nhỏ. đọc vừa phải. dữ liệu vừa.
⇒ KHÔNG cần sharding. KHÔNG cần Kafka. Một PostgreSQL đi rất xa.
```

```text
── ③ MÔ HÌNH DỮ LIỆU ────────────────────────────────────
Câu hỏi hệ thống phải trả lời:
  Q1 "code `abc123` trỏ tới URL nào?"        → 2.400 rps, NÓNG NHẤT
  Q2 "link của user X"                        → hiếm
  Q3 "link này có bao nhiêu click hôm nay?"   → hiếm, chấp nhận gần đúng

links(code PK, long_url, user_id, created_at)
  → Q1 là tra theo khoá chính: index B-tree, ~0,1ms
clicks_daily(code, day, count)   PRIMARY KEY (code, day)
  → tổng hợp sẵn thay vì lưu từng click (600 triệu dòng/năm nếu lưu thô)

Sinh code: base62 của một sequence → ngắn, không trùng, không cần kiểm tra
  KHÔNG dùng hash(url) → cùng URL cho cùng code, mất khả năng theo dõi riêng
  KHÔNG dùng random → phải kiểm tra trùng, và có thể đoán được
```

```text
── ④ THIẾT KẾ CAO ───────────────────────────────────────
GHI:  POST /links → sinh code từ sequence → INSERT → trả về
      24 rps: một API instance thừa sức

ĐỌC:  GET /:code → cache Redis → miss thì PostgreSQL → 301/302 → tăng bộ đếm
      2.400 rps, phân bố lệch mạnh (link viral chiếm phần lớn)
      → tỉ lệ trúng cache dự kiến > 95%

THỐNG KÊ: tăng bộ đếm trong Redis, flush xuống PostgreSQL mỗi phút
      → không ghi 2.400 dòng/giây vào database
```

```text
── ⑤ ĐI SÂU (hai phần khó) ──────────────────────────────

A. SINH CODE
   Chọn: base62(sequence) từ PostgreSQL sequence.
   Vì sao: không trùng theo thiết kế, không cần kiểm tra, ngắn (7 ký tự = 3,5 nghìn tỉ).
   Đánh đổi: code TUẦN TỰ → đoán được link kế tiếp → lộ link của người khác.
   Giảm nhẹ: nhân sequence với một số nguyên tố lớn modulo 62^7 → xáo trộn
             mà vẫn không trùng, không cần lưu thêm gì.
   Nếu điều kiện đổi: nếu cần chống liệt kê hoàn toàn → thêm 3 ký tự ngẫu nhiên,
             đổi lấy code dài hơn.

B. ĐẾM CLICK Ở 2.400 rps
   Chọn: INCR trong Redis, worker flush xuống PostgreSQL mỗi 60 giây.
   Vì sao: 2.400 ghi/giây vào PostgreSQL là lãng phí cho dữ liệu gần đúng.
   Đánh đổi: mất tối đa 60 giây dữ liệu nếu Redis chết.
             Với thống kê hiển thị, mất mát đó chấp nhận được.
   Nếu điều kiện đổi: nếu số click dùng để TÍNH TIỀN → không chấp nhận mất
             → ghi vào bảng append-only có phân vùng, tổng hợp theo lô,
             hoặc dùng Redis với AOF `appendfsync everysec` và chấp nhận rủi ro nhỏ hơn.
```

```text
── ⑥ VẬN HÀNH ───────────────────────────────────────────
HỎNG:
  Redis chết  → cache miss 100% → PostgreSQL nhận 2.400 rps
                → vẫn phục vụ được với connection pool đủ; độ trễ tăng
                → đây là suy giảm CHẤP NHẬN ĐƯỢC, không phải sập
  PostgreSQL chết → chuyển hướng vẫn chạy từ cache (link cũ), tạo link mới thất bại
                → phụ thuộc bắt buộc chỉ cho đường GHI

QUAN SÁT:
  ba metric: tỉ lệ trúng cache · p99 chuyển hướng · tỉ lệ 404 (code không tồn tại)
  3 giờ sáng: dashboard chuyển hướng — p99, tỉ lệ lỗi, tỉ lệ trúng cache

MỞ RỘNG:
  nút thắt đầu tiên khi ×10 (24.000 rps đọc): băng thông và số kết nối
  → thêm instance API và replica đọc; cache đã hấp thụ phần lớn
  quyết định KHÓ ĐẢO NGƯỢC NHẤT: định dạng code
  → nó nằm trong link đã phát hành ra thế giới, không đổi được
  → đây là quyết định phải đúng từ đầu
```

Chú ý điều mà bản thiết kế này **không** có: không Kafka, không microservices, không sharding, không multi-region. Mỗi thứ đó bị loại bởi một con số ở bước ②.

## Prediction

1. Vẽ 12 hộp trong 20 phút mà không hỏi yêu cầu — bản vẽ chứa bao nhiêu quyết định?
2. "Hệ thống phải nhanh" — thiết kế được không? Kiểm chứng được không?
3. Ước lượng ra 350 rps, thiết kế cho 1 triệu rps — hậu quả?
4. Không ước lượng gì — làm sao biết cần cache hay không?
5. 4 rps ghi, 400 rps đọc, 300 GB sau 5 năm — cần sharding không?
6. Vẽ ERD trước khi liệt kê câu hỏi truy vấn — rủi ro gì?
7. Nói "dùng Kafka" mà không nêu vấn đề nó giải quyết — người nghe biết gì?
8. Nói "chọn X vì Y, đánh đổi Z" — thiếu vế nào?
9. Sinh code bằng `hash(url)` — hai người rút gọn cùng URL thì sao?
10. Sinh code bằng sequence thuần — rủi ro gì?
11. Ghi 2.400 dòng click/giây vào PostgreSQL — có hợp lý không?
12. Redis chết, cache miss 100%, PostgreSQL nhận 2.400 rps — sập hay suy giảm?
13. Quyết định nào trong bài rút gọn URL khó đảo ngược nhất?
14. Không biết câu trả lời cho một câu hỏi — nói gì?

<details>
<summary>Đáp án</summary>

1. **Không quyết định nào** — chỉ là danh sách công nghệ sắp theo không gian.
2. **Không** cả hai — không có tiêu chí.
3. **Over-engineer**: chi phí, phức tạp, và thời gian cho quy mô không tồn tại.
4. **Không biết được** — quyết định thành phỏng đoán.
5. **Không** — một PostgreSQL thoải mái.
6. Mô hình dữ liệu **không phục vụ truy vấn thật** — phát hiện muộn.
7. **Không gì** — họ chỉ biết bạn nhớ tên một công nghệ.
8. Vế thứ ba: **"nếu điều kiện đổi thành W, tôi sẽ chọn khác"**.
9. Cùng một code — **không theo dõi riêng được**, và mất quyền sở hữu link.
10. Code **tuần tự, đoán được** → liệt kê được link của người khác.
11. **Không** — dữ liệu gần đúng không đáng chi phí đó.
12. **Suy giảm** — độ trễ tăng nhưng vẫn phục vụ, nếu pool đủ.
13. **Định dạng code** — nó đã nằm trong link phát hành ra thế giới.
14. **"Tôi không chắc; tôi sẽ đo X để quyết định"** — mạnh hơn đoán bừa.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Lấy một thiết kế cũ và hỏi "rps là bao nhiêu" | Có ai trả lời được không? |
| Với mỗi thành phần, hỏi "nó giải quyết vấn đề gì" | Cái nào không có câu trả lời? |
| Xoá một thành phần khỏi bản vẽ | Cái gì hỏng? Nếu không gì, xoá thật |
| Hỏi "nếu tải × 10, nút thắt đầu tiên ở đâu" | Có câu trả lời không? |
| Hỏi "quyết định nào khó đảo ngược nhất" | Nó có được cân nhắc kỹ không? |
| Hỏi "3 giờ sáng có sự cố, bạn nhìn vào đâu" | Có dashboard đó không? |
| Hỏi "cái gì KHÔNG cần" | Có ai từng hỏi chưa? |
| Ước lượng lại với số thật hôm nay | Thiết kế còn phù hợp không? |
| Với mỗi quyết định, nêu đủ ba vế | Có nêu được không? |
| So thiết kế với hệ thống đang chạy | Chênh lệch ở đâu, vì sao? |

## What Usually Goes Wrong

- **Vẽ trước khi hỏi** — giải bài toán chưa được định nghĩa.
- **Không có số** ở bất kỳ đâu trong thiết kế.
- **Liệt kê công nghệ** thay vì nêu quyết định.
- **Over-engineer** cho quy mô tưởng tượng.
- **Không nêu đánh đổi** — mọi lựa chọn đều "tốt nhất".
- **Thiếu vế thứ ba** — không nói khi nào sẽ chọn khác.
- **Bỏ qua vận hành** — không nói về hỏng hóc, quan sát, mở rộng.
- **Vẽ ERD trước khi biết truy vấn.**
- **Không nhận diện quyết định khó đảo ngược.**
- **Đi sâu quá sớm** vào chi tiết không quan trọng.
- **Không đi sâu chỗ nào** — mọi thứ ở mức bề mặt.
- **Đoán bừa khi không biết** thay vì nói cách sẽ tìm ra câu trả lời.
- **Không quản lý thời gian** — hết giờ khi chưa tới bước ⑤.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Bài thiết kế kiểm tra kiến thức công nghệ | Nó kiểm tra cách suy nghĩ theo đánh đổi |
| Kiến trúc phức tạp = trình độ cao | Kiến trúc đơn giản phù hợp = trình độ cao |
| Phải biết đáp án "chuẩn" | Không có đáp án chuẩn; có lập luận tốt hoặc kém |
| Vẽ nhiều hộp là thể hiện hiểu biết | Mỗi hộp phải giải quyết một vấn đề nêu được |
| Ước lượng phải chính xác | Bậc độ lớn là đủ; giả định phải nói ra |
| Nên bắt đầu từ kiến trúc mở rộng được | Bắt đầu từ đơn giản nhất hoạt động được |
| Nói "tôi không biết" là điểm trừ | Đoán bừa tệ hơn nhiều |
| Vận hành là chi tiết phụ | Nó là phần phân biệt người đã chạy hệ thống thật |
| Chọn công nghệ phổ biến là an toàn | An toàn phụ thuộc vào đội của bạn |
| Thiết kế xong là xong | Ghi đánh đổi và điều kiện xem lại mới là xong |

## Debugging

Áp dụng template này để **rà soát một thiết kế đang có**:

1. **Viết lại yêu cầu bằng số** từ dữ liệu thật hôm nay.
2. **Ước lượng lại** và so với thiết kế hiện tại — có thành phần nào rõ ràng thừa không?
3. **Với mỗi thành phần, hỏi "nó giải quyết vấn đề gì"** — cái nào không trả lời được là ứng viên xoá.
4. **Liệt kê truy vấn nóng nhất** và kiểm tra mô hình dữ liệu có phục vụ chúng không.
5. **Nhận diện quyết định khó đảo ngược** và kiểm tra chúng còn đúng không.
6. **Hỏi câu hỏi vận hành**: hỏng thế nào, quan sát thế nào, nút thắt tiếp theo ở đâu.
7. **So thiết kế trên giấy với hệ thống thật** — chênh lệch là nợ kiến trúc chưa ghi nhận.
8. **Viết ADR** cho các quyết định lớn nếu chưa có, kèm điều kiện xem lại.

## Production Considerations

- **Dùng template này cho mọi thiết kế thật**, không chỉ cho phỏng vấn.
- **Yêu cầu bằng số, viết ra**, xem lại mỗi quý.
- **Nói to giả định khi ước lượng** — chúng là thứ sẽ sai, và cần kiểm chứng lại.
- **Bắt đầu từ phương án đơn giản nhất** hoạt động được ở quy mô đã ước lượng.
- **Mỗi thành phần phải nêu được vấn đề nó giải quyết**; không thì xoá.
- **Ghi đủ ba vế cho mỗi quyết định** vào ADR.
- **Nhận diện quyết định khó đảo ngược sớm** và dành thời gian tương xứng cho chúng.
- **Luôn có phần vận hành**: hỏng thế nào, quan sát thế nào, mở rộng ra sao.
- **Ghi rõ cái gì KHÔNG làm** và vì sao — nó tiết kiệm tranh luận về sau.
- **Điều kiện xem lại** cho mỗi quyết định lớn.
- **Rà soát thiết kế khi quy mô đổi 10 lần**, không phải 2 lần.
- **Lưu bản thiết kế cùng repo**, không để trong slide hay ảnh chụp bảng.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Dành thời gian cho bước ①② | phần còn lại có nền | ít thời gian đi sâu hơn |
| Nhảy nhanh vào thiết kế | vẽ được nhiều | giải bài toán chưa định nghĩa |
| Đi sâu 1–2 phần | thể hiện năng lực thật | không phủ hết bề rộng |
| Phủ rộng | nhắc tới mọi khía cạnh | mọi thứ ở mức bề mặt |
| Bắt đầu đơn giản | dễ hiểu, dễ mở rộng lập luận | trông "kém ấn tượng" ban đầu |
| Bắt đầu phức tạp | trông ấn tượng | khó biện minh từng phần |
| Nói "tôi không biết" | trung thực, thể hiện cách tư duy | có vẻ thiếu kiến thức |
| Đoán bừa | có vẻ tự tin | sai và không kiểm chứng được |

## Explain Without Notes

1. Sáu bước và tỉ lệ thời gian cho mỗi bước?
2. Câu hỏi giá trị nhất ở bước làm rõ, và vì sao?
3. Bốn phép tính ước lượng, và mục đích thật của việc ước lượng?
4. Vì sao liệt kê câu hỏi truy vấn trước khi vẽ ERD?
5. Ba vế của một quyết định được trình bày đầy đủ?
6. Ba câu hỏi vận hành, và câu nào quan trọng nhất về mặt kiến trúc?
7. Bảy sai lầm phổ biến khi làm bài thiết kế?
8. Vì sao "tôi không chắc, tôi sẽ đo X" mạnh hơn đoán bừa?

## Related

- [Requirements & trade-offs](01-requirements-tradeoffs.md) — bước ① và ② chi tiết
- [Scaling: cache & queue](02-scaling-cache-queue.md) — bước ④ khi có số
- [Storage selection](06-storage-selection.md) — bước ③
- [Consistency & availability](04-consistency-availability.md) — đánh đổi ở bước ⑤
- [Distributed systems fallacies](09-distributed-systems-fallacies.md) — danh sách kiểm tra giả định
- [Data partitioning & sharding](05-data-partitioning-sharding.md) — quyết định khó đảo ngược
- [Capacity & limits](../05-cross-cutting/reliability/04-capacity-and-limits.md) — bước ⑥
- [Failure modes](../05-cross-cutting/reliability/01-failure-modes.md) — "hỏng thế nào"
- [Metrics & SLO](../05-cross-cutting/observability/04-metrics-slo.md) — "quan sát thế nào"
- [Fullstack Lab](../07-projects/fullstack-lab/README.md) — nơi áp dụng vào hệ thống thật

## Version / Context

Template không gắn công nghệ. Cấu trúc sáu bước phản ánh thực hành phổ biến trong phỏng vấn system design và trong tài liệu thiết kế nội bộ (design doc / RFC). Ví dụ dùng PostgreSQL 16 và Redis 7. Hệ số đỉnh 3–10× là quan sát thực nghiệm cho ứng dụng B2C.
