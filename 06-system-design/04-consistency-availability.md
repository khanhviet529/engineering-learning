---
level: advanced
area: system-design
prerequisites:
  - 01-requirements-tradeoffs.md
related:
  - 09-distributed-systems-fallacies.md
  - ../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md
---

# Consistency & availability

> Một hệ thống đặt phòng khách sạn chạy hai region để "tăng khả dụng". Đường mạng giữa hai region đứt trong 12 phút. Cả hai region vẫn nhận đặt phòng — chúng không có cách nào biết region kia đang làm gì. Khi mạng nối lại, 340 phòng bị đặt trùng. Không region nào ngừng phục vụ; hệ thống đạt 100% uptime trong sự cố đó. **Nó chọn khả dụng thay vì nhất quán — chỉ là không ai từng đưa ra lựa chọn đó một cách có ý thức.**

## Position

```text
Một node:      nhất quán là mặc định, miễn phí
Nhiều node:    phải CHỌN — và mạng sẽ buộc bạn chọn
               ↑ note này: chọn cái gì, cho thao tác nào, và hệ quả là gì
```

## Problem

```text
Khi dữ liệu tồn tại ở nhiều nơi, ba thứ không thể có đủ cùng lúc
trong lúc mạng bị chia cắt:

  C  Consistency        mọi node thấy CÙNG dữ liệu
  A  Availability       mọi request đều được TRẢ LỜI
  P  Partition tolerance  hệ thống vẫn hoạt động khi mạng chia cắt

Phân vùng mạng KHÔNG PHẢI lựa chọn — nó xảy ra.
⇒ khi nó xảy ra, bạn chỉ còn chọn giữa C và A.
```

## Mental Model

### CAP: phát biểu chính xác và giới hạn của nó

```text
CAP KHÔNG nói "chọn 2 trong 3".
Nó nói: KHI CÓ PHÂN VÙNG, chọn giữa C và A.

  CP  từ chối request để giữ dữ liệu đúng
      → phía thiểu số ngừng phục vụ
      → etcd, ZooKeeper, PostgreSQL với đồng bộ

  AP  vẫn phục vụ, chấp nhận dữ liệu tạm khác nhau
      → hoà giải xung đột về sau
      → Cassandra, DynamoDB (mặc định), DNS

KHÔNG có phân vùng: bạn có cả C lẫn A. Đó là trạng thái bình thường 99,9% thời gian.
```

### PACELC: mô hình hữu ích hơn

```text
IF Partition:  chọn A hay C
ELSE:          chọn L (latency) hay C

Vế thứ hai quan trọng hơn trong vận hành hằng ngày:
  ngay cả khi mạng KHOẺ, nhất quán mạnh vẫn tốn ĐỘ TRỄ
  → ghi phải chờ đủ số node xác nhận
  → mỗi node thêm vào là thêm một vòng khứ hồi tiềm năng
```

```text
PostgreSQL với replica bất đồng bộ:  PA/EL — nhanh, chấp nhận trễ
PostgreSQL với synchronous_commit:   PC/EC — chậm hơn, dữ liệu chắc chắn
DynamoDB mặc định:                   PA/EL
DynamoDB strongly consistent read:   PA/EC — trả tiền độ trễ cho mỗi lần đọc
```

Vế `ELSE` giải thích vì sao "bật nhất quán mạnh" không miễn phí ngay cả khi hệ thống hoàn toàn khoẻ mạnh.

### Thang nhất quán

```text
MẠNH NHẤT ─────────────────────────────────────────► YẾU NHẤT

LINEARIZABLE     như thể có một bản duy nhất; mọi thao tác có thứ tự toàn cục
SEQUENTIAL       mọi node thấy CÙNG thứ tự, nhưng không nhất thiết theo thời gian thực
CAUSAL           thao tác có quan hệ nhân quả giữ đúng thứ tự
READ-YOUR-WRITES bạn luôn thấy thay đổi của CHÍNH MÌNH
MONOTONIC READS  không bao giờ thấy dữ liệu "lùi lại"
EVENTUAL         ngừng ghi đủ lâu thì mọi node hội tụ
```

```text
Bốn mức giữa là các đảm bảo THEO PHIÊN (session guarantees).
Chúng rẻ hơn nhất quán mạnh rất nhiều và giải quyết phần lớn
vấn đề trải nghiệm thực tế:

  read-your-writes  → người dùng không thấy thay đổi của mình biến mất
  monotonic reads   → không thấy bình luận xuất hiện rồi biến mất khi F5
```

Chọn một trong bốn mức giữa thường là câu trả lời đúng — không phải "eventual" (quá yếu để dùng được) cũng không phải "linearizable" (quá đắt).

### Nhất quán là quyết định THEO THAO TÁC

```text
Sai lầm phổ biến: chọn một mức cho cả hệ thống.

Trong cùng một ứng dụng thương mại điện tử:
  số dư ví            → LINEARIZABLE   (không được sai, dù chỉ tạm)
  trừ tồn kho lúc đặt → mạnh, hoặc chấp nhận oversell có bù trừ
  giỏ hàng            → read-your-writes
  đánh giá sản phẩm   → eventual (trễ 30 giây không ai để ý)
  số lượt xem         → eventual, thậm chí gần đúng

⇒ trả giá nhất quán mạnh CHỈ ở nơi cần.
```

Bài kiểm tra thực dụng: **"nếu hai người thấy hai giá trị khác nhau trong 5 giây, hậu quả là gì?"** Nếu câu trả lời là "không gì cả", đừng trả tiền cho nhất quán mạnh ở đó.

### Nguồn của dữ liệu cũ

```text
① REPLICA ĐỌC        replication bất đồng bộ → độ trễ từ ms tới nhiều giây
② CACHE              TTL, invalidation trễ hoặc thiếu
③ CDN                lan truyền xoá cache mất thời gian
④ CLIENT             state trong React, dữ liệu đã tải trước đó
⑤ EVENT             consumer xử lý sau producer

Mỗi tầng thêm một cửa sổ cũ. Chúng CỘNG DỒN.
  người dùng thấy dữ liệu cũ = (replica) + (cache) + (CDN) + (client state)
```

Khi điều tra "vì sao người dùng thấy dữ liệu cũ", phải đi từ ngoài vào trong — nguyên nhân thường không ở tầng bạn nghĩ tới đầu tiên.

### Xử lý xung đột trong hệ thống AP

```text
Hai bản ghi khác nhau cho cùng một khoá — chọn cái nào?

LAST WRITE WINS       theo timestamp
                      ✗ MẤT DỮ LIỆU âm thầm; và đồng hồ giữa các node lệch nhau
CRDT                  cấu trúc dữ liệu tự hội tụ, không cần hoà giải
                      ✓ đúng theo thiết kế · ✗ chỉ dùng được cho một số kiểu dữ liệu
HOÀ GIẢI THEO NGHIỆP VỤ  gộp hai giỏ hàng, giữ cả hai phiên bản
                      ✓ đúng nhất · ✗ phải viết logic cho từng loại
ĐẨY LÊN NGƯỜI DÙNG    "phiên bản này đã bị người khác sửa"
                      ✓ đơn giản và trung thực với tài liệu cộng tác
```

```text
Last-write-wins là mặc định phổ biến và là nguồn mất dữ liệu im lặng
phổ biến nhất trong hệ thống AP.
```

### Đồng thuận: khi bắt buộc phải có một câu trả lời

```text
Bầu leader · khoá phân tán · thay đổi cấu hình cụm · giao dịch phân tán
  → cần ĐỒNG THUẬN (Raft, Paxos)

Tính chất:
  · cần ĐA SỐ (quorum): 3 node chịu mất 1; 5 node chịu mất 2
  · phía thiểu số NGỪNG phục vụ ghi   → đây chính là "chọn C"
  · mỗi quyết định tốn ít nhất một vòng khứ hồi tới đa số
  · số node nhiều hơn = chịu lỗi tốt hơn nhưng CHẬM hơn
```

```text
Hệ quả thực dụng: đừng tự cài đặt đồng thuận.
Dùng hệ thống đã có (etcd, ZooKeeper, Postgres với đồng bộ),
và thiết kế để cần nó càng ít càng tốt.
```

### Giao dịch phân tán: hai lựa chọn

```text
2PC (two-phase commit)
  ✓ nhất quán mạnh xuyên nhiều hệ thống
  ✗ coordinator chết giữa chừng → participant BỊ KHOÁ, chờ vô hạn
  ✗ chặn, chậm, giảm khả dụng của TẤT CẢ các bên
  → hiếm khi phù hợp cho microservices

SAGA
  chuỗi giao dịch cục bộ + hành động BÙ TRỪ khi thất bại
  ✓ không khoá, mỗi service tự chủ
  ✗ không có isolation — trạng thái trung gian NHÌN THẤY ĐƯỢC
  ✗ hành động bù trừ phải thiết kế riêng, và có thể thất bại
```

```text
Saga đúng khi bù trừ có nghĩa về nghiệp vụ:
  đặt phòng → tính tiền → thất bại → HOÀN TIỀN và HUỶ phòng
  ← đây là quy trình nghiệp vụ thật, không phải rollback kỹ thuật

Saga sai khi trạng thái trung gian không chấp nhận được:
  tiền đã trừ nhưng phòng chưa đặt, trong 30 giây — khách hàng nhìn thấy điều đó
```

### Đọc-sau-ghi: vấn đề thực tế hay gặp nhất

```text
Người dùng sửa hồ sơ → chuyển trang → đọc từ replica → thấy dữ liệu CŨ
→ họ nghĩ hệ thống mất dữ liệu của họ

Bốn cách xử lý, theo chi phí:
  ① đọc từ PRIMARY trong N giây sau khi ghi, theo người dùng   ← rẻ và đủ
  ② dùng giá trị vừa gửi để render (optimistic update ở client)
  ③ chờ replica bắt kịp LSN của lần ghi
  ④ nhất quán mạnh cho mọi đọc                                  ← đắt nhất
```

## Example

Một hệ thống, năm thao tác, năm mức nhất quán khác nhau:

```ts
// ① SỐ DƯ VÍ — linearizable: đọc và ghi trên PRIMARY, trong transaction
async withdraw(walletId: string, amountCents: number) {
  return this.db.$transaction(async (tx) => {
    const rows = await tx.$executeRaw`
      UPDATE wallets SET balance_cents = balance_cents - ${amountCents}
       WHERE id = ${walletId} AND balance_cents >= ${amountCents}`;
    if (rows === 0) throw new ConflictException('số dư không đủ');

    await tx.walletTransaction.create({ data: { walletId, amountCents: -amountCents } });
  }, { isolationLevel: 'Serializable' });
}
```

```ts
// ② TỒN KHO — mạnh khi đặt hàng, nhưng chấp nhận hiển thị gần đúng
async reserveStock(sku: string, qty: number) {
  const rows = await this.db.$executeRaw`
    UPDATE inventory SET reserved = reserved + ${qty}
     WHERE sku = ${sku} AND available - reserved >= ${qty}`;
  if (rows === 0) throw new ConflictException('không đủ hàng');
}

// hiển thị trên trang danh sách: cache 60 giây, chấp nhận gần đúng
async getStockDisplay(sku: string) {
  return this.cache.getOrSet(`stock:${sku}`, 60, () => this.repo.available(sku));
}
```

```ts
// ③ GIỎ HÀNG — read-your-writes: đọc primary trong 10 giây sau khi ghi
async getCart(userId: string) {
  const recentlyWrote = await this.redis.exists(`wrote:cart:${userId}`);
  const db = recentlyWrote ? this.primary : this.replica;
  return db.cart.findUnique({ where: { userId } });
}

async updateCart(userId: string, dto: UpdateCartDto) {
  const cart = await this.primary.cart.update({ where: { userId }, data: dto });
  await this.redis.set(`wrote:cart:${userId}`, '1', 'EX', 10);   // ← đánh dấu
  return cart;
}
```

```ts
// ④ ĐÁNH GIÁ — eventual: replica, cache, không ai để ý trễ 30 giây
async getReviews(productId: string) {
  return this.cache.getOrSet(`reviews:${productId}`, 30,
    () => this.replica.review.findMany({ where: { productId }, take: 20 }));
}

// ⑤ LƯỢT XEM — eventual và GẦN ĐÚNG: gom rồi ghi theo lô
async trackView(productId: string) {
  await this.redis.incr(`views:${productId}`);      // ghi Redis, flush xuống DB mỗi phút
}
```

```text
Kết quả: chỉ thao tác ① và ② trả giá nhất quán mạnh.
Ba thao tác còn lại — chiếm phần lớn lưu lượng — đọc từ replica và cache.
```

Và với sự cố ở đầu note, quyết định phải được đưa ra một cách tường minh:

```text
ĐẶT PHÒNG KHÁCH SẠN — chọn CP, có ý thức

  Khi mạng giữa hai region đứt:
    · region có QUORUM tiếp tục nhận đặt phòng
    · region thiểu số CHỈ ĐỌC, hiển thị "tạm thời không đặt được"

  Vì sao: đặt trùng một phòng là lỗi nghiệp vụ KHÔNG bù trừ được rẻ
          (phải xin lỗi, nâng hạng, hoặc huỷ của một khách)
          → 12 phút không đặt được rẻ hơn 340 phòng đặt trùng

  Nếu chọn AP thay vào đó, PHẢI có:
    · phát hiện xung đột khi hoà giải
    · quy trình bù trừ (nâng hạng, hoàn tiền, thông báo)
    · ngân sách cho chi phí đó
```

Điểm quan trọng không phải CP hay AP là đúng — mà là **quyết định phải được đưa ra trước, kèm quy trình cho hệ quả của nó**.

## Prediction

1. Hai region, mạng đứt, cả hai vẫn nhận ghi — hệ thống chọn C hay A?
2. Hệ thống đó có uptime bao nhiêu trong sự cố? Nó có "hoạt động đúng" không?
3. CAP nói gì khi KHÔNG có phân vùng?
4. Nhất quán mạnh khi mạng hoàn toàn khoẻ — có tốn gì không?
5. Người dùng sửa hồ sơ rồi đọc từ replica ngay — họ thấy gì?
6. Thêm cờ "vừa ghi" và đọc từ primary trong 10 giây — thấy gì?
7. Replica trễ 200ms + cache TTL 60s + client state — tổng cửa sổ cũ tối đa?
8. Last-write-wins với đồng hồ hai node lệch 3 giây — hậu quả?
9. Cụm 3 node đồng thuận, mất 1 node — còn ghi được không?
10. Mất 2 node — còn ghi được không?
11. 2PC, coordinator chết sau khi participant đã "prepare" — participant thế nào?
12. Saga đặt phòng: tính tiền xong, đặt phòng thất bại — cần gì?
13. Saga, trong 30 giây giữa hai bước — người dùng có thấy trạng thái trung gian không?
14. Chọn eventual consistency cho số dư ví — hậu quả?

<details>
<summary>Đáp án</summary>

1. **A** — nó ưu tiên trả lời request.
2. **100% uptime**, và **340 phòng đặt trùng** — uptime không đo tính đúng đắn.
3. Bạn có **cả C lẫn A** — đó là trạng thái bình thường.
4. **Có** — độ trễ; đó là vế ELSE của PACELC.
5. **Dữ liệu cũ** — họ tưởng thay đổi bị mất.
6. **Dữ liệu mới** — read-your-writes.
7. **Cộng dồn** — có thể hơn một phút.
8. **Mất dữ liệu im lặng** — ghi đến sau bị ghi đè bởi ghi có timestamp lớn hơn.
9. **Còn** — 2/3 là đa số.
10. **Không** — mất quorum.
11. **Bị khoá**, chờ vô hạn cho tới khi coordinator trở lại.
12. **Hành động bù trừ**: hoàn tiền.
13. **Có** — saga không có isolation.
14. Người dùng có thể **chi tiêu tiền không có** — đây là nơi phải trả giá nhất quán mạnh.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Ngắt mạng giữa hai node và tiếp tục ghi cả hai bên | Hệ thống chọn C hay A? |
| Nối lại mạng | Xung đột được xử lý thế nào? |
| Đo độ trễ replica khi có tải ghi cao | Bao nhiêu giây? |
| Ghi rồi đọc ngay từ replica | Thấy dữ liệu cũ không? |
| Bật `synchronous_commit = on` và đo độ trễ ghi | Chậm hơn bao nhiêu? |
| Cộng mọi cửa sổ cũ (replica + cache + CDN + client) | Tổng bao nhiêu? |
| Đặt đồng hồ hai node lệch nhau rồi ghi đồng thời | Last-write-wins chọn cái nào? |
| Giết đa số node trong cụm đồng thuận | Còn ghi được không? |
| Giết coordinator giữa 2PC | Participant thế nào? |
| Làm bước thứ hai của saga thất bại | Bù trừ có chạy không? Nó có thể thất bại không? |
| Liệt kê mọi thao tác và mức nhất quán của nó | Có ai từng viết ra chưa? |

## What Usually Goes Wrong

- **Không chọn một cách có ý thức** → hệ thống chọn hộ, thường là AP.
- **Chọn một mức cho cả hệ thống** thay vì theo thao tác.
- **Nhất quán mạnh cho mọi thứ** → chậm và đắt không cần thiết.
- **Eventual cho thứ không được sai** (số dư, tồn kho lúc thanh toán).
- **Last-write-wins** làm mặc định → mất dữ liệu im lặng.
- **Không xử lý đọc-sau-ghi** → người dùng tưởng mất dữ liệu.
- **Quên cửa sổ cũ cộng dồn** qua nhiều tầng.
- **2PC giữa microservices** → khoá dây chuyền.
- **Saga không có hành động bù trừ đầy đủ**, hoặc bù trừ có thể thất bại mà không ai xử lý.
- **Không tính trạng thái trung gian của saga vào UX.**
- **Tự cài đặt đồng thuận.**
- **Multi-region "để tăng khả dụng"** mà không quyết định hành vi khi phân vùng.
- **Đo uptime nhưng không đo tính đúng đắn** — hệ thống 100% uptime vẫn có thể sai.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| CAP nói chọn 2 trong 3 | Nó nói: khi có phân vùng, chọn C hay A |
| Phân vùng là trường hợp hiếm | Nó gồm cả node chậm, GC dài, mạng nghẽn |
| Nhất quán mạnh chỉ tốn khi có sự cố | Nó tốn độ trễ mọi lúc (PACELC) |
| Eventual consistency nghĩa là "sẽ đúng sớm thôi" | Không có đảm bảo về thời gian |
| Multi-region tăng khả dụng | Nó tăng cả xác suất phân vùng |
| Uptime cao nghĩa là hệ thống đúng | Hệ thống có thể sai mà vẫn 100% uptime |
| Last-write-wins là hoà giải hợp lý | Nó mất dữ liệu, và đồng hồ thì lệch |
| 2PC giải quyết giao dịch phân tán | Nó chặn và giảm khả dụng của mọi bên |
| Saga là rollback tự động | Bù trừ là quy trình nghiệp vụ phải thiết kế |
| ACID và nhất quán phân tán là một | "C" trong ACID là ràng buộc, khác "C" trong CAP |

## Debugging

1. **"Người dùng thấy dữ liệu cũ"** → đi từ ngoài vào trong: client state → CDN → cache ứng dụng → replica.
2. **Đo độ trễ replica**: `SELECT now() - pg_last_xact_replay_timestamp();` — so với cửa sổ bạn giả định.
3. **Đọc-sau-ghi** → thao tác này có đọc từ replica không? Có cơ chế đánh dấu "vừa ghi" không?
4. **Dữ liệu không nhất quán giữa hai nơi** → nguồn sự thật là đâu? Có job đối soát không?
5. **Sau phân vùng mạng** → có bao nhiêu xung đột? Chúng được hoà giải thế nào? Có mất dữ liệu không?
6. **Saga kẹt giữa chừng** → bước nào thất bại? Bù trừ có chạy không? Có bản ghi trạng thái saga không?
7. **Kiểm tra quorum**: cụm còn đủ đa số không? Node nào đang là leader?
8. **Liệt kê mọi thao tác và mức nhất quán thực tế** của nó — thường có thao tác đang ở mức thấp hơn mọi người nghĩ.

## Production Considerations

- **Quyết định C hay A cho từng thao tác**, viết ra, và ghi lý do.
- **Bài kiểm tra**: "hai người thấy hai giá trị khác nhau trong 5 giây — hậu quả gì?"
- **Session guarantees** (read-your-writes, monotonic reads) cho phần lớn trải nghiệm người dùng.
- **Nhất quán mạnh chỉ ở nơi cần** — thường dưới 10% thao tác.
- **Đo và theo dõi độ trễ replica**, có alert.
- **Cộng mọi cửa sổ cũ** và kiểm tra tổng có chấp nhận được không.
- **Không dùng last-write-wins** cho dữ liệu quan trọng; chọn CRDT hoặc hoà giải nghiệp vụ.
- **Saga thay vì 2PC** cho quy trình xuyên service, với bù trừ được thiết kế và test.
- **Trạng thái saga lưu bền**, có theo dõi và có cách can thiệp thủ công.
- **Thiết kế UX cho trạng thái trung gian** ("đang xử lý", "đang chờ xác nhận").
- **Quyết định hành vi khi phân vùng TRƯỚC khi triển khai multi-region.**
- **Job đối soát** cho dữ liệu tồn tại ở nhiều nơi.
- **Đo tính đúng đắn, không chỉ đo uptime** — số bản ghi xung đột, số lệch khi đối soát.
- **Không tự cài đặt đồng thuận** — dùng hệ thống đã kiểm chứng.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| CP | dữ liệu luôn đúng | ngừng phục vụ khi phân vùng |
| AP | luôn phục vụ | xung đột, cần hoà giải |
| Linearizable | dễ suy luận nhất | độ trễ cao, khả dụng thấp hơn |
| Eventual | nhanh, mở rộng tốt | logic phức tạp, dữ liệu cũ |
| Session guarantees | giải quyết phần lớn UX | không đủ cho bất biến toàn cục |
| Ghi đồng bộ | không mất dữ liệu khi mất node | ghi chậm hơn |
| Ghi bất đồng bộ | ghi nhanh | có thể mất khi mất primary |
| 2PC | nhất quán mạnh xuyên hệ thống | chặn, giảm khả dụng của mọi bên |
| Saga | không chặn, tự chủ | trạng thái trung gian nhìn thấy được |
| Multi-region | độ trễ thấp, chịu mất region | nhất quán rất khó, chi phí cao |
| Một region | đơn giản, nhất quán dễ | mất region = mất dịch vụ |

## Explain Without Notes

1. Phát biểu chính xác của CAP, và vì sao "chọn 2 trong 3" là cách hiểu sai?
2. PACELC thêm gì so với CAP, và vì sao vế thứ hai quan trọng hơn hằng ngày?
3. Bốn session guarantee, và vì sao chúng thường là câu trả lời đúng?
4. Vì sao nhất quán là quyết định theo thao tác? Cho năm ví dụ với năm mức.
5. Năm nguồn dữ liệu cũ và vì sao chúng cộng dồn?
6. Vì sao last-write-wins nguy hiểm?
7. 2PC và saga khác nhau ở đâu? Khi nào saga sai?
8. Đọc-sau-ghi là gì và bốn cách xử lý theo chi phí?

## Related

- [Requirements & trade-offs](01-requirements-tradeoffs.md) — nhất quán là một yêu cầu phi chức năng
- [Scaling: cache & queue](02-scaling-cache-queue.md) — nguồn của dữ liệu cũ
- [Idempotency & retry](03-idempotency-retry.md) — "không biết" là trạng thái bình thường
- [Data partitioning & sharding](05-data-partitioning-sharding.md) — nhất quán xuyên shard
- [Distributed systems fallacies](09-distributed-systems-fallacies.md) — giả định sai về mạng
- [Event-driven](07-event-driven.md) — nhất quán cuối cùng trong thực tế
- [Transaction isolation](../03-database/01-postgresql/transactions-concurrency/01-transaction-isolation.md) — nhất quán trong một database
- [Replication & scaling](../03-database/01-postgresql/operations/02-replication-scaling.md) — độ trễ replica
- [Shared state & races](../05-cross-cutting/concurrency/02-shared-state-races.md) — bất biến dưới đồng thời
- [Graceful degradation](../05-cross-cutting/reliability/03-graceful-degradation.md) — hành vi khi chọn C

## Version / Context

CAP theorem: Eric Brewer (2000), chứng minh hình thức bởi Gilbert và Lynch (2002); phát biểu lại của Brewer (2012) làm rõ rằng nó chỉ áp dụng trong lúc phân vùng. PACELC: Daniel Abadi (2012). Session guarantees theo Terry và cộng sự (1994). Ví dụ dùng PostgreSQL 16 (`synchronous_commit`, `pg_last_xact_replay_timestamp`), Redis 7, NestJS 10/11. Saga pattern theo Garcia-Molina và Salem (1987), được áp dụng lại cho microservices.
