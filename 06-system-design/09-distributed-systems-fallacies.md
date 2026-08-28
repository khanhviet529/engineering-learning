---
level: advanced
area: system-design
prerequisites:
  - 04-consistency-availability.md
related:
  - 08-monolith-to-microservices.md
  - ../05-cross-cutting/reliability/01-failure-modes.md
---

# Tám ngộ nhận về hệ thống phân tán

> Một dịch vụ nội bộ được gọi từ API chính "vì nó nằm ngay trong cùng cluster, mạng nội bộ nhanh và ổn định". Không timeout, không retry, không circuit breaker. Trong một lần nâng cấp CNI, độ trễ mạng nội bộ tăng từ 0,5ms lên 8 giây trong bốn phút. API chính chết hoàn toàn. **Mọi dòng code trong đó đều đúng — dựa trên một giả định mà không ai từng viết ra.**

## Position

```text
Tám ngộ nhận (Peter Deutsch, James Gosling, Sun Microsystems, 1994–1997)
là một DANH SÁCH KIỂM TRA GIẢ ĐỊNH.

Mỗi lần code của bạn đi qua mạng, tám giả định này được đưa ra ngầm.
Note này làm chúng hiện ra.
```

## Problem

```text
Lời gọi hàm và lời gọi mạng trông GIỐNG NHAU trong code:

  const user = await userService.find(id);      // trong process? qua mạng?
                                                 // code không cho biết

Nhưng chúng khác nhau về bản chất:
  lời gọi hàm:  ~10 ns · không thất bại · nguyên tử · type-safe
  lời gọi mạng: ~500 μs · CÓ THỂ THẤT BẠI · có thể thành công một phần
                · có thể tới hai lần · có thể tới muộn 30 giây

⇒ Sự giống nhau về cú pháp là cái bẫy trung tâm của lập trình phân tán.
```

## Mental Model

### ① Mạng đáng tin cậy

```text
SAI. Gói tin mất, kết nối đứt, thiết bị hỏng, cấu hình sai, cáp bị cắt.

Hệ quả trong code:
  · MỌI lời gọi mạng phải xử lý thất bại
  · lời gọi thành công một phần là có thật: server nhận và xử lý,
    phản hồi mất trên đường về
  · "không nhận được phản hồi" ≠ "không xảy ra"

Biện pháp: timeout · retry cho lỗi tạm · idempotency · circuit breaker
```

### ② Độ trễ bằng không

```text
SAI. Và độ trễ không đồng nhất:

  trong process          ~10 ns
  cùng máy (IPC)         ~10 μs
  cùng datacenter        ~500 μs
  giữa các region        ~50–150 ms
  xuyên lục địa          ~150–300 ms

Hệ quả:
  · N lời gọi tuần tự = N × RTT     → gộp lại hoặc chạy song song
  · N+1 qua mạng đắt hơn N+1 trong database hàng chục lần
  · chatty API (nhiều lời gọi nhỏ) là phản mẫu ở tầng phân tán
```

```text
Thiết kế API phân tán ngược với thiết kế API trong process:
  trong process: nhiều hàm nhỏ, rõ ràng
  qua mạng:      ít lời gọi, mỗi lời gọi trả về đủ dữ liệu
```

### ③ Băng thông vô hạn

```text
SAI. Và nó tốn tiền, đặc biệt giữa các region hoặc ra Internet.

Hệ quả:
  · trả về 10.000 dòng "phòng khi cần" là lãng phí thật
  · payload event lớn nhân với số consumer
  · JSON không nén cho dữ liệu lớn tốn nhiều lần so với cần thiết
  · chi phí truyền dữ liệu ra khỏi region thường bị bỏ quên trong ước tính
```

### ④ Mạng an toàn

```text
SAI. Mạng nội bộ không phải vùng tin cậy.

Hệ quả:
  · service-to-service cần XÁC THỰC, không chỉ dựa vào "nằm trong VPC"
  · mTLS hoặc token cho lời gọi nội bộ
  · NetworkPolicy: mặc định từ chối, mở từng đường
  · một service bị chiếm không được phép truy cập mọi service khác
```

```text
Đây là ngộ nhận có hậu quả bảo mật trực tiếp:
  "nó nằm sau firewall nên không cần xác thực" là lý do
  một lỗ hổng nhỏ trở thành truy cập toàn hệ thống.
```

### ⑤ Cấu trúc mạng không đổi

```text
SAI. IP đổi, pod được lên lịch lại, DNS thay đổi, region được thêm.

Hệ quả:
  · KHÔNG hard-code IP — dùng service discovery
  · tôn trọng DNS TTL; và biết rằng nhiều runtime CACHE DNS lâu hơn TTL
  · kết nối lâu dài (connection pool, WebSocket) giữ IP CŨ sau khi pod đổi
    → cần health check ở tầng kết nối, không chỉ ở tầng ứng dụng
  · giả định "IP này luôn là service kia" hỏng lặng lẽ
```

### ⑥ Chỉ có một quản trị viên

```text
SAI. Nhiều team, nhiều nhà cung cấp, nhiều lịch bảo trì.

Hệ quả:
  · dependency có thể nâng cấp, đổi hành vi, hoặc bảo trì mà không báo bạn
  · cấu hình mạng đổi bởi team khác  ← chính là sự cố ở đầu note
  · nhà cung cấp bên thứ ba đổi rate limit hoặc API
  · bạn không kiểm soát lịch triển khai của người khác

Biện pháp: hợp đồng tường minh · versioning · giám sát dependency
           · thiết kế chịu được việc dependency đổi hành vi
```

### ⑦ Chi phí vận chuyển bằng không

```text
SAI. Serialize và deserialize tốn CPU thật.

  JSON.stringify một object 1 MB → hàng chục ms CPU
  → và nó CHẶN event loop trong Node.js

Hệ quả:
  · payload lớn tốn CPU ở CẢ HAI đầu
  · chi phí này nhân với số lời gọi
  · gzip đổi CPU lấy băng thông — đúng cho payload lớn, sai cho payload nhỏ
  · định dạng nhị phân (Protobuf) rẻ hơn nhiều cho lưu lượng cao
```

### ⑧ Mạng đồng nhất

```text
SAI. Các phần khác nhau có đặc tính khác nhau.

  · MTU khác nhau → phân mảnh
  · một số đường có mất gói cao hơn
  · thiết bị mạng có giới hạn khác nhau
  · client di động: mạng chập chờn, chuyển giữa WiFi và 4G, NAT timeout

Hệ quả: đừng giả định điều kiện mạng của bạn giống của người dùng.
```

### Ngộ nhận thứ chín: đồng hồ đồng bộ

```text
Thường được thêm vào danh sách, và nó gây nhiều lỗi tinh vi nhất:

  đồng hồ giữa các máy LỆCH NHAU (mili-giây tới giây, đôi khi hơn)
  đồng hồ có thể NHẢY LÙI (NTP điều chỉnh, leap second)

Hệ quả:
  · so sánh timestamp giữa hai máy KHÔNG cho biết thứ tự thật
  · last-write-wins theo timestamp → MẤT DỮ LIỆU
  · TTL và hết hạn tính bằng đồng hồ tường có thể sai
  · đo khoảng thời gian phải dùng ĐỒNG HỒ ĐƠN ĐIỆU
    (`process.hrtime.bigint()`, không phải `Date.now()`)

Biện pháp: số thứ tự logic (Lamport, vector clock) · fencing token
           · để MỘT nguồn duy nhất sinh thứ tự (database sequence)
```

### Cái bẫy trung tâm: cú pháp giống nhau

```text
Ba thứ khác biệt mà cú pháp che giấu:

① THẤT BẠI MỘT PHẦN
   lời gọi hàm: chạy hoặc ném lỗi
   lời gọi mạng: có thể thành công ở phía kia và thất bại ở phía bạn

② KHÔNG CÓ TRẠNG THÁI CHUNG
   không transaction, không lock chung, không "bây giờ" chung

③ TÍNH QUAN SÁT KHÁC
   lỗi trong process có stack trace
   lỗi qua mạng cần correlation id và trace để dựng lại
```

```text
⇒ Làm cho ranh giới mạng HIỆN RÕ trong code:
  đặt lời gọi mạng sau một adapter có timeout, retry, và kiểu lỗi riêng
  → người đọc code biết ngay đây là lời gọi có thể thất bại
```

## Example

Cùng một chức năng, viết theo giả định sai và viết đúng:

```ts
// ✗ TÁM GIẢ ĐỊNH ẨN trong bốn dòng
async function getOrderSummary(orderId: string) {
  const order = await orderService.get(orderId);           // ① mạng đáng tin
  const customer = await customerService.get(order.userId); // ② độ trễ bằng 0
  const shipping = await shippingService.get(orderId);      // ② tuần tự
  const items = await catalogService.getAll(order.itemIds); // ③ băng thông vô hạn
  return { order, customer, shipping, items };
}
```

```text
Vấn đề cụ thể:
  · 4 lời gọi TUẦN TỰ = 4 × RTT, và ba trong số đó độc lập
  · không timeout → một service chậm giữ request vô hạn
  · không xử lý lỗi → một service chết = toàn bộ hỏng
  · không phân biệt dữ liệu BẮT BUỘC và KHÔNG bắt buộc
  · khả dụng = 0,999⁴ ≈ 99,6%
```

```ts
// ✓ giả định được nêu rõ và xử lý
async function getOrderSummary(orderId: string, deadline: Deadline) {
  // ① dữ liệu BẮT BUỘC — không có nó thì không trả lời được
  const order = await orders.get(orderId, {
    timeoutMs: Math.min(2000, deadline.remainingMs()),
  });

  // ② ba lời gọi ĐỘC LẬP → song song, không tuần tự
  //    allSettled: một cái hỏng không kéo hai cái kia
  const [customer, shipping, items] = await Promise.allSettled([
    customers.get(order.userId, { timeoutMs: 500 }),
    shipping.get(orderId, { timeoutMs: 500 }),
    catalog.getMany(order.itemIds, { timeoutMs: 800 }),   // ③ MỘT lời gọi, không N
  ]);

  return {
    order,
    // ④ suy giảm cho dữ liệu KHÔNG bắt buộc, và nói rõ cái gì thiếu
    customer: valueOr(customer, null),
    shipping: valueOr(shipping, null),
    items: valueOr(items, []),
    degraded: [customer, shipping, items]
      .map((r, i) => r.status === 'rejected' ? ['customer', 'shipping', 'items'][i] : null)
      .filter(Boolean),
  };
}
```

```text
Thay đổi về hành vi:
  độ trễ:    4 × RTT → 1 × RTT + max(3 lời gọi song song)
  khả dụng:  99,6% → 99,9% (chỉ `order` là bắt buộc)
  khi lỗi:   toàn bộ hỏng → trang hiển thị, thiếu phần phụ, và NÓI RÕ thiếu gì
```

Và ngộ nhận thứ chín trong thực tế:

```ts
// ✗ so sánh timestamp giữa hai máy để quyết định thứ tự
if (incomingEvent.timestamp > storedRecord.updatedAt) {
  await save(incomingEvent);           // đồng hồ lệch 3 giây → GHI ĐÈ SAI
}

// ✓ số thứ tự do MỘT nguồn sinh ra
if (incomingEvent.sequenceNumber > storedRecord.sequenceNumber) {
  await save(incomingEvent);           // thứ tự logic, không phụ thuộc đồng hồ
}

// ✗ đo khoảng thời gian bằng đồng hồ tường — có thể NHẢY LÙI
const start = Date.now();
await work();
const elapsed = Date.now() - start;    // có thể ÂM sau khi NTP điều chỉnh

// ✓ đồng hồ đơn điệu
const start = process.hrtime.bigint();
await work();
const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
```

## Prediction

1. Mạng nội bộ trong cùng cluster, không timeout, độ trễ tăng lên 8 giây — chuyện gì xảy ra?
2. 4 lời gọi mạng tuần tự, RTT 100ms — tổng độ trễ? Song song?
3. Khả dụng của chuỗi 4 lời gọi bắt buộc, mỗi cái 99,9%?
4. Chỉ 1 trong 4 là bắt buộc, 3 cái kia có fallback — khả dụng?
5. Timeout không xảy ra nhưng phản hồi mất trên đường về — thao tác đã chạy chưa?
6. Service nội bộ không xác thực vì "nằm trong VPC", một service bị chiếm — hậu quả?
7. Hard-code IP của một pod, pod được lên lịch lại — chuyện gì xảy ra?
8. Connection pool giữ kết nối tới pod đã chết — request thế nào?
9. `JSON.stringify` một object 1 MB trong Node.js — nó ảnh hưởng gì?
10. Team khác đổi cấu hình mạng mà không báo — giả định nào bị vi phạm?
11. So sánh timestamp từ hai máy lệch 3 giây để quyết định thứ tự — kết quả?
12. `Date.now()` để đo khoảng thời gian, NTP điều chỉnh lùi giữa chừng — kết quả?
13. Trả về 10.000 dòng "phòng khi client cần" — chi phí ở đâu?
14. Client di động chuyển từ WiFi sang 4G — kết nối đang mở thế nào?

<details>
<summary>Đáp án</summary>

1. Mọi worker bị **giữ trong lời gọi chờ** → dịch vụ chết hoàn toàn.
2. Tuần tự **400ms**; song song **~100ms**.
3. `0,999⁴ ≈ 99,6%` — 3 giờ downtime/tháng.
4. **99,9%** — chỉ phụ thuộc một service.
5. **Đã chạy** — nhưng bạn không biết.
6. Nó **truy cập được mọi service khác** — không có lớp nào chặn.
7. IP trỏ tới **pod khác hoặc không tồn tại**.
8. **Timeout hoặc connection reset** — cần health check ở tầng kết nối.
9. Tốn hàng chục ms CPU và **chặn event loop**.
10. ⑥ "chỉ có một quản trị viên".
11. **Thứ tự sai** — có thể ghi đè dữ liệu mới bằng dữ liệu cũ.
12. `elapsed` có thể **âm**.
13. Băng thông, CPU serialize ở cả hai đầu, bộ nhớ, và **tiền** nếu qua region.
14. Kết nối **đứt** — IP nguồn đổi; cần reconnect có backoff.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm 5 giây độ trễ vào một dependency | Hệ thống thế nào sau 2 phút? |
| Ngắt mạng tới một service | Lỗi lan tới đâu? |
| Đếm lời gọi mạng tuần tự trong một request | Bao nhiêu cái độc lập? |
| Tính khả dụng tổng từ chuỗi phụ thuộc | Bao nhiêu? |
| Gọi service nội bộ mà không có credential | Có bị chặn không? |
| Xoá một pod và xem kết nối đang mở | Bao lâu để phát hiện? |
| Đo thời gian `JSON.stringify` payload lớn nhất | Bao nhiêu ms? |
| Đặt đồng hồ hai máy lệch 5 giây | Logic nào hỏng? |
| Chỉnh đồng hồ lùi trong lúc đo thời gian | `Date.now()` cho kết quả gì? |
| Đo băng thông giữa hai region và chi phí | Bao nhiêu? |
| Kiểm tra DNS TTL và thời gian cache thực tế | Có khớp không? |

## What Usually Goes Wrong

- **Không timeout** vì "mạng nội bộ nhanh".
- **Lời gọi tuần tự** khi chúng độc lập.
- **Chatty API** — nhiều lời gọi nhỏ thay vì một lời gọi đủ.
- **Không xác thực giữa các service nội bộ.**
- **Hard-code IP** hoặc không xử lý được việc IP đổi.
- **Kết nối lâu dài không có health check** ở tầng kết nối.
- **Payload lớn** trả về "phòng khi cần".
- **Serialize object lớn** chặn event loop.
- **So sánh timestamp giữa các máy** để quyết định thứ tự.
- **`Date.now()` để đo khoảng thời gian.**
- **Last-write-wins theo đồng hồ tường** → mất dữ liệu.
- **Không phân biệt dependency bắt buộc và không bắt buộc.**
- **Coi mạng nội bộ là vùng tin cậy.**
- **Không tính chi phí truyền dữ liệu giữa region.**

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Mạng nội bộ đáng tin cậy | Nó ít hỏng hơn, không phải không hỏng |
| Cùng datacenter nên độ trễ không đáng kể | 500 μs × N lời gọi tuần tự thì đáng kể |
| Sau firewall nên không cần xác thực | Một service bị chiếm là truy cập toàn hệ thống |
| Timeout nghĩa là thao tác thất bại | Nó nghĩa là bạn không biết |
| Retry an toàn với mọi thao tác | Chỉ với thao tác idempotent |
| Đồng hồ các máy khớp nhau | Chúng lệch, và có thể nhảy lùi |
| `Date.now()` luôn tăng | Nó có thể lùi khi NTP điều chỉnh |
| JSON là định dạng miễn phí | Serialize tốn CPU thật, và chặn event loop |
| Service discovery là chi tiết vận hành | Không có nó, mọi thay đổi IP là sự cố |
| Chỉ hệ thống lớn mới cần lo | Hai service đã là hệ thống phân tán |

## Debugging

1. **Khi một sự cố lan rộng bất thường**, hỏi: giả định nào trong tám cái vừa bị vi phạm?
2. **Liệt kê mọi lời gọi mạng** trong một request và kiểm tra: có timeout không? độc lập có song song không?
3. **Tính khả dụng tổng** từ chuỗi phụ thuộc bắt buộc — con số thường gây bất ngờ.
4. **Lỗi tinh vi liên quan tới thời gian** → nghi đồng hồ; kiểm tra NTP và độ lệch giữa các máy.
5. **Thứ tự sai** → có đang so sánh timestamp giữa các máy không?
6. **Kết nối hỏng sau khi deploy** → kết nối lâu dài giữ IP cũ; kiểm tra health check ở tầng kết nối.
7. **CPU cao bất thường** → đo thời gian serialize payload lớn nhất.
8. **Sau mỗi sự cố phân tán**, ghi vào postmortem: **giả định nào đã ngầm được đưa ra**, và làm nó hiện rõ ở đâu trong code.

## Production Considerations

- **Timeout ở mọi lời gọi mạng**, không có ngoại lệ cho "mạng nội bộ".
- **Adapter cho mọi lời gọi ra ngoài** — làm ranh giới mạng hiện rõ trong code.
- **Lời gọi độc lập chạy song song**; gộp N lời gọi nhỏ thành một.
- **Phân loại dependency bắt buộc/không bắt buộc**; fallback cho loại thứ hai.
- **Xác thực giữa các service** (mTLS hoặc token); NetworkPolicy mặc định từ chối.
- **Service discovery**, không hard-code IP; health check ở tầng kết nối.
- **Payload tối thiểu**; cân nhắc định dạng nhị phân cho lưu lượng cao.
- **Không so sánh timestamp giữa các máy** để quyết định thứ tự — dùng số thứ tự logic.
- **Đồng hồ đơn điệu để đo khoảng thời gian.**
- **NTP trên mọi máy**, và giám sát độ lệch đồng hồ.
- **Idempotency cho mọi thao tác có tác dụng phụ** đi qua mạng.
- **Tính chi phí băng thông giữa region** vào thiết kế.
- **Chaos test**: thêm độ trễ, mất gói, phân vùng — kiểm chứng giả định bằng thực nghiệm.
- **Viết giả định ra** trong tài liệu thiết kế; tám ngộ nhận là danh sách kiểm tra sẵn có.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Ẩn mạng sau abstraction | code đơn giản | giấu thất bại một phần và độ trễ |
| Làm mạng hiện rõ | xử lý đúng | code dài hơn, nhiều khái niệm hơn |
| Lời gọi thô (chatty) | API rõ ràng, linh hoạt | N × RTT |
| Lời gọi gộp | ít vòng khứ hồi | payload lớn, ít linh hoạt |
| mTLS nội bộ | mạng không còn là vùng tin cậy | quản lý cert, độ trễ bắt tay |
| Tin mạng nội bộ | đơn giản | một lỗ hổng = toàn hệ thống |
| Timeout ngắn | giải phóng tài nguyên | cắt request lẽ ra thành công |
| Timeout dài | ít cắt nhầm | giữ tài nguyên khi dependency chậm |
| Định dạng nhị phân | nhỏ và nhanh | khó debug, cần schema |
| JSON | dễ đọc, phổ biến | tốn CPU và băng thông |

## Explain Without Notes

1. Tám ngộ nhận, và với mỗi cái, một hệ quả cụ thể trong code.
2. Ngộ nhận thứ chín là gì và vì sao nó gây lỗi tinh vi nhất?
3. Vì sao cú pháp giống nhau giữa lời gọi hàm và lời gọi mạng là cái bẫy?
4. Ba khác biệt mà cú pháp che giấu?
5. Vì sao thiết kế API phân tán ngược với thiết kế API trong process?
6. Vì sao "nằm sau firewall" không phải lý do bỏ xác thực?
7. Vì sao không được so sánh timestamp giữa hai máy để quyết định thứ tự?
8. Tính khả dụng của chuỗi 4 phụ thuộc bắt buộc 99,9% — và cách cải thiện rẻ nhất?

## Related

- [Consistency & availability](04-consistency-availability.md) — hệ quả của mạng không tin cậy
- [Monolith to microservices](08-monolith-to-microservices.md) — khi bạn tự tạo ra mạng
- [Idempotency & retry](03-idempotency-retry.md) — hệ quả của ngộ nhận ①
- [Event-driven](07-event-driven.md) — thứ tự và thời gian trong hệ thống phân tán
- [Failure modes](../05-cross-cutting/reliability/01-failure-modes.md) — chậm nguy hiểm hơn chết
- [Timeout, retry & circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) — biện pháp cho ①②
- [Distributed locks](../05-cross-cutting/concurrency/03-distributed-locks.md) — hệ quả của đồng hồ lệch
- [TCP & UDP](../04-infrastructure/01-networking/02-tcp-udp.md) — mạng thực sự hoạt động thế nào
- [NAT, firewall & routing](../04-infrastructure/01-networking/04-nat-firewall-routing.md) — cấu trúc mạng thay đổi
- [Security basics](../05-cross-cutting/security/01-security-basics.md) — ranh giới tin cậy

## Version / Context

Tám ngộ nhận do Peter Deutsch nêu (1994) và James Gosling bổ sung mục thứ tám (1997) tại Sun Microsystems. Ngộ nhận thứ chín về đồng hồ là bổ sung phổ biến trong tài liệu hiện đại, được phân tích kỹ trong *Designing Data-Intensive Applications* (chương 8). Ví dụ dùng Node.js 20+ (`process.hrtime.bigint`, `Promise.allSettled`) và Kubernetes 1.29+ (NetworkPolicy, mTLS qua service mesh). Con số độ trễ theo bậc độ lớn cho phần cứng và hạ tầng hiện nay.
