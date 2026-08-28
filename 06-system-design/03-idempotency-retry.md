---
level: advanced
area: system-design
prerequisites:
  - 01-requirements-tradeoffs.md
related:
  - ../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md
  - ../03-database/04-message-queues/02-delivery-semantics.md
---

# Idempotency & retry

> Một khách hàng bấm "Thanh toán", thấy vòng quay 30 giây, rồi thông báo "Có lỗi xảy ra". Họ bấm lại. Lần này thành công. Cuối tháng, sao kê thẻ hiển thị **hai giao dịch**. Lần thứ nhất đã thành công ở phía cổng thanh toán — chỉ có phản hồi là không kịp về. Hệ thống không sai ở chỗ nào cụ thể: nó chỉ chưa bao giờ trả lời câu hỏi *"nếu ta không biết thao tác đã chạy hay chưa thì sao?"*

## Position

```text
Mạng không đáng tin ⇒ retry là BẮT BUỘC
Retry ⇒ thao tác có thể chạy NHIỀU LẦN
⇒ mọi thao tác có tác dụng phụ PHẢI trả lời được:
     "chạy lần thứ hai thì sao?"
```

## Problem

```text
Timeout KHÔNG có nghĩa là thất bại.
Nó có nghĩa là bạn KHÔNG BIẾT.

  client → server nhận → XỬ LÝ XONG → phản hồi mất trên đường về → client timeout

Ba trạng thái, không phải hai:
  ① chắc chắn thành công    (nhận được 2xx)
  ② chắc chắn thất bại      (nhận được 4xx, hoặc kết nối bị từ chối)
  ③ KHÔNG BIẾT              (timeout, kết nối đứt giữa chừng)  ← vùng khó
```

Trạng thái ③ không thể loại bỏ — nó là hệ quả của việc mạng có thể mất gói ở bất kỳ hướng nào. Thiết kế phải làm cho nó **an toàn**, không phải làm cho nó biến mất.

## Mental Model

### Idempotent: chạy N lần = chạy 1 lần

```text
Định nghĩa dùng được: TRẠNG THÁI CUỐI CÙNG như nhau, và
                      TÁC DỤNG PHỤ RA NGOÀI xảy ra đúng một lần.

  SET balance = 100        idempotent  (gán)
  balance = balance + 10   KHÔNG       (tăng dần)
  DELETE user 5            idempotent  (xoá rồi vẫn là đã xoá)
  gửi email                KHÔNG       (mỗi lần là một email thật)
```

```text
HTTP theo chuẩn:
  GET · HEAD · PUT · DELETE   idempotent
  POST                         KHÔNG
  PATCH                        tuỳ nội dung

Nhưng chuẩn chỉ nói VỀ NGỮ NGHĨA. Cài đặt của bạn phải THỰC SỰ idempotent.
  → `PUT /users/5` mà bên trong gọi `INSERT` không kiểm tra thì không idempotent.
```

### Ba cách đạt idempotency

```text
① TỰ NHIÊN — thiết kế thao tác thành phép GÁN
   ✗ POST /counters/5/increment
   ✓ PUT /counters/5 { value: 42 }
   → không cần key, không cần state, không cần dọn dẹp
   → luôn ưu tiên cách này khi diễn đạt được

② IDEMPOTENCY KEY — client sinh khoá cho mỗi Ý ĐỊNH
   → server lưu (key → kết quả), thấy key cũ thì trả kết quả cũ
   → cần cho thao tác không diễn đạt được bằng phép gán

③ KHỬ TRÙNG LẶP THEO NGHIỆP VỤ
   ràng buộc UNIQUE trên (order_id, provider) hoặc (event_id)
   → dùng chính dữ liệu nghiệp vụ làm khoá
```

Cách ① là cách rẻ nhất và bền nhất: nó không cần bảng phụ, không cần TTL, không có gì để dọn dẹp.

### Idempotency key: bốn quy tắc

```text
① KHOÁ GẮN VỚI Ý ĐỊNH, KHÔNG GẮN VỚI LẦN THỬ
   client sinh MỘT key và dùng lại cho MỌI lần retry của cùng ý định
   → sinh key mới mỗi lần retry = key vô dụng

② RÀNG BUỘC UNIQUE LÀM VIỆC CHẶN, KHÔNG PHẢI CÂU `if`
   hai retry chạy ĐỒNG THỜI đều vượt qua `if (đã xử lý)`
   → chỉ INSERT với unique index mới chặn được

③ LƯU CẢ KẾT QUẢ, KHÔNG CHỈ LƯU "ĐÃ XỬ LÝ"
   lần thứ hai phải trả về ĐÚNG phản hồi của lần đầu
   → nếu chỉ trả 200 rỗng, client không lấy được orderId

④ GẮN KEY VỚI NGƯỜI GỬI VÀ VỚI NỘI DUNG
   phạm vi (userId, key) → key của người này không đụng người khác
   lưu hash của request body → cùng key với body KHÁC = lỗi, không phải trả kết quả cũ
```

Quy tắc ④ chống một lớp lỗi tinh vi: client tái sử dụng key cho một request khác (do bug hoặc do cố ý) và nhận về kết quả của thao tác trước.

### Vòng đời của một idempotency key

```text
① nhận request có key
② INSERT (key, userId, requestHash, status='in_progress')
   ├─ unique violation → key đã tồn tại
   │    ├─ status = 'completed'   → trả kết quả đã lưu
   │    ├─ status = 'in_progress' → 409 "đang xử lý, thử lại sau"
   │    └─ requestHash KHÁC       → 422 "key đã dùng cho request khác"
   └─ thành công → tiếp tục
③ thực hiện thao tác
④ lưu kết quả, đặt status='completed'
⑤ trả kết quả
```

```text
Bước ② với `in_progress` là phần hay bị bỏ:
  không có nó, hai retry đồng thời đều chạy thao tác
  (cái thứ hai chỉ thất bại ở bước ④ — sau khi đã tính tiền)
```

```text
Và một chi tiết quyết định: bước ② và ③–④ phải trong CÙNG transaction,
hoặc key phải được ghi TRƯỚC khi gọi ra ngoài.
  → nếu process chết giữa ③ và ④, key ở trạng thái `in_progress`
  → cần cơ chế phục hồi: TTL cho `in_progress` + job đối soát
```

### Retry: chỉ lỗi tạm thời, có ngân sách

```text
✓ RETRY  timeout · connection reset · 502/503/504 · 429 (theo Retry-After) · deadlock
✗ KHÔNG  400 · 401 · 403 · 404 · 422 · 409
~ 500    tối đa MỘT lần, và chỉ khi idempotent

Bắt buộc đi kèm:
  · exponential backoff + JITTER
  · ngân sách retry toàn hệ thống (~10% tổng request)
  · circuit breaker
  · deadline: không retry nếu đã hết thời gian client còn chờ
```

Xem [Timeout, retry & circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).

### At-least-once là mặc định của hệ thống phân tán

```text
Ba mức giao nhận:
  at-most-once   có thể MẤT     → hiếm khi chấp nhận được
  at-least-once  có thể TRÙNG   → mặc định thực tế
  exactly-once   ← KHÔNG tồn tại ở tầng giao nhận qua mạng

"Exactly-once" trong thực tế = at-least-once + XỬ LÝ IDEMPOTENT ở phía nhận.
  → gánh nặng nằm ở CONSUMER, không ở hệ thống truyền tin
```

Đây là lý do mọi consumer message queue phải idempotent: không có cấu hình nào của broker thay thế được điều đó.

### Idempotency cho consumer message queue

```text
Message có ID duy nhất (do producer sinh, ổn định qua các lần gửi lại).

Consumer:
  ① INSERT vào bảng processed_events (event_id UNIQUE)
  ② unique violation → đã xử lý → ack và bỏ qua
  ③ thành công → xử lý, trong CÙNG transaction với bước ①
```

```text
Nếu tác dụng phụ nằm NGOÀI database (gọi API, gửi email):
  không có transaction chung → phải chọn:
    · ghi 'đã xử lý' TRƯỚC khi gọi  → rủi ro MẤT (chết giữa chừng)
    · ghi SAU khi gọi                → rủi ro TRÙNG
  ⇒ chọn "trùng" và làm cho phía nhận idempotent (gửi idempotency key sang họ)
```

### Đối soát: lưới an toàn cuối

```text
Idempotency ngăn phần lớn trùng lặp. Nó không ngăn được tất cả:
  · bug trong logic key
  · thao tác ngoài phạm vi key
  · sự cố vận hành

⇒ Job ĐỐI SOÁT định kỳ cho dữ liệu quan trọng:
  · so tổng số tiền trong hệ thống với sao kê của cổng thanh toán
  · tìm đơn hàng có nhiều hơn một giao dịch thành công
  · tìm event đã publish mà không có bản ghi xử lý

Nó phát hiện thứ đã sai — idempotency chỉ ngăn thứ sắp sai.
```

## Example

Endpoint thanh toán an toàn với retry:

```ts
@Post('payments')
async createPayment(
  @Body() dto: CreatePaymentDto,
  @Headers('idempotency-key') key: string,
  @CurrentUser() user: User,
) {
  if (!key || key.length < 16) throw new BadRequestException('thiếu Idempotency-Key');
  const requestHash = sha256(JSON.stringify({ ...dto, userId: user.id }));

  // ① cố gắng CHIẾM key — unique index (user_id, key) làm việc chặn
  try {
    await this.db.idempotencyKey.create({
      data: { key, userId: user.id, requestHash, status: 'in_progress',
              expiresAt: addHours(new Date(), 24) },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return this.handleExisting(key, user.id, requestHash);        // ② key đã tồn tại
  }

  // ③ thực hiện — key đã được ghi TRƯỚC khi gọi ra ngoài
  try {
    const result = await this.gateway.charge({
      amountCents: dto.amountCents,
      idempotencyKey: key,                    // ④ TRUYỀN TIẾP xuống cổng thanh toán
    });

    await this.db.idempotencyKey.update({
      where: { userId_key: { userId: user.id, key } },
      data: { status: 'completed', result },
    });
    return result;
  } catch (err) {
    // ⑤ lỗi VĨNH VIỄN → giải phóng key để client sửa và thử lại
    //    lỗi TẠM THỜI  → giữ key ở in_progress để retry dùng lại cùng key
    if (isPermanentError(err)) {
      await this.db.idempotencyKey.delete({
        where: { userId_key: { userId: user.id, key } },
      });
    }
    throw err;
  }
}

private async handleExisting(key: string, userId: string, requestHash: string) {
  const record = await this.db.idempotencyKey.findUniqueOrThrow({
    where: { userId_key: { userId, key } },
  });

  if (record.requestHash !== requestHash) {
    throw new UnprocessableEntityException('Idempotency-Key đã dùng cho request khác');
  }
  if (record.status === 'in_progress') {
    throw new ConflictException('đang xử lý, thử lại sau');       // client backoff
  }
  return record.result;                                            // trả kết quả CŨ
}
```

Bốn điểm đáng chú ý:

```text
④ TRUYỀN key xuống cổng thanh toán
   → idempotency phải đi HẾT chuỗi, không dừng ở biên hệ thống bạn
   → nếu không, bạn chặn được trùng ở tầng mình nhưng cổng vẫn tính hai lần
     khi CHÍNH BẠN retry lời gọi đó

⑤ phân biệt lỗi vĩnh viễn và tạm thời khi dọn key
   thẻ bị từ chối (vĩnh viễn) → xoá key, client sửa thông tin và thử lại
   timeout (tạm thời)         → giữ key, retry dùng lại cùng key
```

Và phía client — key sinh một lần, dùng cho cả chuỗi thử:

```ts
async function pay(order: Order) {
  const key = order.idempotencyKey ?? crypto.randomUUID();
  await saveKeyLocally(order.id, key);              // sống sót qua reload trang

  return retryWithBackoff(
    () => fetch('/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id, amountCents: order.totalCents }),
    }),
    { maxAttempts: 3, retryOn: [408, 429, 500, 502, 503, 504] },
  );
}
```

`saveKeyLocally` là chi tiết dễ bỏ: nếu người dùng tải lại trang và bấm "Thanh toán" lần nữa, họ phải gửi **cùng key** — nếu không, đó là một ý định mới và hệ thống sẽ tính tiền thật.

Và job đối soát:

```ts
@Cron('0 3 * * *')
async reconcilePayments() {
  const yesterday = subDays(new Date(), 1);
  const ours = await this.db.payment.findMany({ where: { createdAt: { gte: yesterday } } });
  const theirs = await this.gateway.listCharges({ since: yesterday });

  // giao dịch ở cổng mà hệ thống ta không có bản ghi → nghi trùng lặp hoặc mất đồng bộ
  const ourIds = new Set(ours.map(p => p.gatewayChargeId));
  const orphans = theirs.filter(c => !ourIds.has(c.id));
  if (orphans.length) {
    reconciliationMismatch.inc(orphans.length);
    this.logger.error({ count: orphans.length, ids: orphans.map(o => o.id) },
      'giao dịch ở cổng không khớp với hệ thống');
  }
}
```

## Prediction

1. Client timeout sau khi server đã xử lý xong — thao tác đã chạy hay chưa?
2. Client retry, không có idempotency key — chuyện gì xảy ra?
3. Client sinh key MỚI cho mỗi lần retry — key có tác dụng gì?
4. Chỉ kiểm tra `if (đã xử lý) return`, hai retry chạy đồng thời — có chặn được không?
5. Có ràng buộc UNIQUE — có chặn được không?
6. Lưu "đã xử lý" nhưng không lưu kết quả — lần thứ hai client nhận gì?
7. Không kiểm tra `requestHash`, client tái dùng key cho request khác — hậu quả?
8. Không có trạng thái `in_progress`, hai retry đồng thời — bao nhiêu lần tính tiền?
9. Hệ thống bạn có idempotency nhưng không truyền key xuống cổng thanh toán, và bạn retry lời gọi đó — hậu quả?
10. `PUT /counters/5 { value: 42 }` gọi ba lần — kết quả?
11. `POST /counters/5/increment` gọi ba lần — kết quả?
12. Broker quảng cáo "exactly-once" — consumer có cần idempotent không?
13. Ghi "đã xử lý" trước khi gửi email, process chết giữa chừng — hậu quả?
14. Ghi sau khi gửi email, process chết giữa chừng — hậu quả?

<details>
<summary>Đáp án</summary>

1. **Không biết được** — đó là trạng thái thứ ba.
2. Thao tác **chạy hai lần** — tính tiền hai lần.
3. **Không tác dụng gì** — mỗi lần thử là một ý định mới với server.
4. **Không** — cả hai vượt qua `if` trước khi cái nào ghi.
5. **Có** — chỉ một `INSERT` thành công.
6. Trả 200 nhưng **không có `orderId`** — client không dùng được.
7. Client nhận **kết quả của thao tác trước**, không phải của request vừa gửi.
8. **Hai** — cái thứ hai chỉ thất bại sau khi đã gọi cổng.
9. Cổng **tính tiền hai lần** — idempotency dừng ở biên hệ thống bạn.
10. Giá trị là **42** — idempotent.
11. Giá trị tăng **3** — không idempotent.
12. **Có** — "exactly-once" ở tầng giao nhận không loại bỏ trùng lặp ở tầng xử lý.
13. **Email không được gửi** và không ai biết — mất.
14. **Email gửi hai lần** — trùng.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Gửi cùng request hai lần với cùng key | Chạy mấy lần? |
| Gửi cùng key hai lần ĐỒNG THỜI | Có chặn được không? |
| Gửi cùng key với body khác | Nhận kết quả cũ hay lỗi? |
| Sinh key mới cho mỗi retry | Còn tác dụng gì không? |
| Ngắt mạng ngay sau khi server nhận request | Client thấy gì? Dữ liệu thế nào? |
| Tải lại trang giữa chừng rồi bấm lại | Có dùng lại key không? |
| Giết process giữa lúc gọi cổng thanh toán | Key ở trạng thái nào? Có phục hồi được không? |
| Retry một lỗi 400 | Có ích gì không? |
| Đếm số bản ghi trong bảng idempotency | Có job dọn không? |
| Chạy job đối soát với dữ liệu cố tình lệch | Nó có phát hiện không? |
| Gửi cùng message hai lần vào queue | Consumer xử lý mấy lần? |

## What Usually Goes Wrong

- **Không có idempotency cho thao tác có tác dụng phụ.**
- **Sinh key mới cho mỗi lần retry.**
- **Chỉ kiểm tra bằng câu `if`**, không có ràng buộc unique.
- **Không lưu kết quả**, chỉ lưu cờ "đã xử lý".
- **Không kiểm tra request hash** → key tái dùng cho request khác.
- **Không có trạng thái `in_progress`** → hai retry đồng thời cùng chạy.
- **Không truyền key xuống dịch vụ bên dưới.**
- **Không phân biệt lỗi vĩnh viễn và tạm thời** khi dọn key.
- **Không có TTL và job dọn** cho bảng idempotency → bảng tăng vô hạn.
- **Tin vào "exactly-once" của broker.**
- **Consumer message queue không idempotent.**
- **Không có job đối soát** cho dữ liệu tài chính.
- **Retry lỗi vĩnh viễn** → lãng phí và làm chậm phản hồi lỗi cho người dùng.
- **Client không lưu key** → tải lại trang tạo ý định mới.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Timeout nghĩa là thao tác thất bại | Nó nghĩa là bạn không biết |
| POST không thể idempotent | Nó có thể, với idempotency key |
| PUT tự động idempotent | Chỉ khi cài đặt thực sự là phép gán |
| Kiểm tra trước khi ghi là đủ | Chỉ ràng buộc unique chặn được đồng thời |
| Exactly-once tồn tại | Chỉ có at-least-once + xử lý idempotent |
| Broker lo việc khử trùng lặp | Consumer phải tự lo |
| Idempotency chỉ cần cho thanh toán | Mọi thao tác có tác dụng phụ đều cần |
| Một key cho toàn hệ thống là đủ | Nó phải đi hết chuỗi dịch vụ |
| Có idempotency thì không cần đối soát | Đối soát phát hiện thứ idempotency bỏ lọt |
| Lưu cờ "đã xử lý" là đủ | Phải lưu cả kết quả để trả lại |

## Debugging

1. **Phát hiện trùng lặp**: đếm bản ghi theo `(user_id, amount, created_at::date)` hoặc theo `order_id` — nhiều hơn một là dấu hiệu.
2. **Truy nguồn**: có key không? Key có giống nhau giữa hai lần không? Nếu khác nhau, client đang sinh key mới mỗi lần thử.
3. **Kiểm tra ràng buộc**: `\d idempotency_keys` — có unique index trên `(user_id, key)` không?
4. **Key kẹt ở `in_progress`** → process chết giữa chừng; kiểm tra có TTL và job phục hồi không.
5. **Cùng key trả kết quả sai** → thiếu kiểm tra `requestHash`.
6. **Trùng lặp ở tầng dưới** → key có được truyền xuống dịch vụ bên dưới không?
7. **Consumer xử lý trùng** → có bảng `processed_events` với unique index không? Nó có nằm cùng transaction với tác dụng phụ không?
8. **Sau sự cố**: chạy đối soát với hệ thống bên ngoài — nó là nguồn sự thật duy nhất về việc thao tác đã xảy ra mấy lần.

## Production Considerations

- **Ưu tiên idempotency tự nhiên** (phép gán) trước khi dùng key.
- **`Idempotency-Key` bắt buộc** cho mọi endpoint có tác dụng phụ không thể đảo ngược.
- **Unique index trên `(user_id, key)`** — cơ chế chặn thật.
- **Lưu `requestHash`** và từ chối khi key tái dùng cho request khác.
- **Trạng thái `in_progress`** với TTL và job phục hồi.
- **Lưu kết quả đầy đủ** để trả lại cho lần thử sau.
- **Truyền key xuống mọi dịch vụ bên dưới.**
- **Phân biệt lỗi vĩnh viễn và tạm thời** khi quyết định giữ hay xoá key.
- **TTL 24–72 giờ** cho key, đủ phủ mọi cửa sổ retry; job dọn định kỳ.
- **Consumer idempotent** với bảng `processed_events` trong cùng transaction.
- **Client lưu key cục bộ** để sống sót qua reload.
- **Job đối soát hằng ngày** cho dữ liệu tài chính và trạng thái quan trọng, có alert.
- **Đo**: tỉ lệ request có key, số lần trả kết quả cũ, số key kẹt `in_progress`, số lệch khi đối soát.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Idempotency tự nhiên | không state, không dọn dẹp | không diễn đạt được mọi thao tác |
| Idempotency key | phổ quát | thêm bảng, TTL, dọn dẹp, phức tạp |
| Khử trùng theo nghiệp vụ | dùng dữ liệu có sẵn | chỉ đúng khi có khoá nghiệp vụ tự nhiên |
| `in_progress` + 409 | chặn đồng thời | client phải xử lý 409 và backoff |
| Không có `in_progress` | đơn giản | hai retry đồng thời cùng chạy |
| Ghi 'đã xử lý' trước tác dụng phụ | không trùng | có thể MẤT |
| Ghi sau | không mất | có thể TRÙNG |
| TTL key ngắn | bảng nhỏ | retry muộn tạo thao tác mới |
| TTL dài | an toàn hơn | bảng lớn, cần dọn |
| Job đối soát | phát hiện sai sót còn sót | thêm hệ thống, chạy sau khi đã sai |

## Explain Without Notes

1. Ba trạng thái của một lời gọi mạng, và vì sao trạng thái thứ ba không loại bỏ được?
2. Định nghĩa idempotent theo hai vế nào?
3. Ba cách đạt idempotency, và vì sao cách đầu tốt nhất?
4. Bốn quy tắc của idempotency key?
5. Vòng đời của một key, và vì sao cần trạng thái `in_progress`?
6. Vì sao "exactly-once" không tồn tại ở tầng giao nhận?
7. Với tác dụng phụ ngoài database, chọn "mất" hay "trùng"? Vì sao?
8. Vì sao vẫn cần job đối soát khi đã có idempotency?

## Related

- [Timeout, retry & circuit breaker](../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) — nguồn của retry
- [Delivery semantics](../03-database/04-message-queues/02-delivery-semantics.md) — at-least-once
- [Retry & DLQ](../03-database/04-message-queues/03-retry-dlq.md) — retry trong hệ thống bất đồng bộ
- [Outbox pattern](../03-database/04-message-queues/06-outbox-pattern.md) — chống mất event
- [Shared state & races](../05-cross-cutting/concurrency/02-shared-state-races.md) — hai retry đồng thời
- [HTTP semantics & idempotency](../02-backend-api/00-http-api/03-http-semantics-idempotency.md) — ngữ nghĩa method
- [Constraints & invariants](../03-database/03-data-modeling/01-constraints-invariants.md) — ràng buộc làm cơ chế chặn
- [Consistency & availability](04-consistency-availability.md) — vì sao không biết là trạng thái bình thường

## Version / Context

Ví dụ dùng NestJS 10/11, Prisma, PostgreSQL 16. Header `Idempotency-Key` đang được chuẩn hoá qua IETF draft (`draft-ietf-httpapi-idempotency-key-header`) và đã là thực hành phổ biến ở API thanh toán (Stripe, Adyen). Ngữ nghĩa idempotent của HTTP method theo RFC 9110. Mã lỗi PostgreSQL 23505 là unique violation.
