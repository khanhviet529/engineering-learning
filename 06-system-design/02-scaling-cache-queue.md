---
level: advanced
area: system-design
prerequisites:
  - 01-requirements-tradeoffs.md
related:
  - 05-data-partitioning-sharding.md
  - ../03-database/02-redis/01-cache-invalidation.md
---

# Scaling: cache, queue, replica

> Một API chậm ở giờ cao điểm. Team thêm Redis cache và thấy p99 giảm từ 1,8 giây xuống 200ms. Ba tuần sau, khách hàng báo giá sản phẩm hiển thị sai — giá đã đổi từ hai ngày trước. Cache không có TTL cho khoá đó và không ai nhớ nó tồn tại. **Cache đã giải quyết vấn đề hiệu năng và tạo ra một vấn đề đúng đắn — vốn tốn kém hơn nhiều.**

## Position

```text
Tải tăng → hệ thống chậm → bốn hướng, theo thứ tự chi phí:

  ① LÀM ÍT VIỆC HƠN     tối ưu query, xoá việc thừa, phân trang
  ② TRẢ LỜI TỪ CACHE     đọc nhiều lần một dữ liệu
  ③ HOÃN LẠI (QUEUE)     không phải mọi việc cần làm ngay
  ④ THÊM MÁY             replica đọc, thêm instance, cuối cùng là sharding
```

## Problem

```text
Mỗi cơ chế mở rộng giải quyết MỘT loại vấn đề và tạo ra MỘT loại vấn đề mới:

  cache   → nhanh hơn ↔ dữ liệu CŨ, invalidation, một tầng nữa để debug
  queue   → chịu đột biến ↔ ĐỘ TRỄ, thứ tự, xử lý trùng, DLQ
  replica → nhiều đọc hơn ↔ ĐỘ TRỄ REPLICA, đọc thấy dữ liệu cũ
  thêm pod→ nhiều xử lý hơn ↔ nhiều kết nối DB hơn, trạng thái dùng chung

⇒ Câu hỏi không phải "có nên dùng cache không"
  mà là "vấn đề mới nó tạo ra có rẻ hơn vấn đề nó giải quyết không".
```

## Mental Model

### Thứ tự áp dụng — và vì sao thứ tự đó

```text
① LÀM ÍT VIỆC HƠN     không thêm hệ thống nào; thường cho cải thiện lớn nhất
                       N+1 · index · phân trang · chọn cột · xoá lời gọi thừa
② CACHE                thêm một hệ thống, thêm bài toán invalidation
③ QUEUE                thêm một hệ thống, đổi mô hình đồng bộ → bất đồng bộ
④ REPLICA ĐỌC          thêm hạ tầng, thêm bài toán độ trễ replica
⑤ SHARDING             thay đổi kiến trúc dữ liệu, khó đảo ngược

Mỗi bậc xuống: thêm một hệ thống phải vận hành, debug, và onboard người mới.
```

Bỏ qua ① để nhảy sang ② là mẫu phổ biến nhất, và nó giấu vấn đề gốc: một truy vấn thiếu index vẫn thiếu index, chỉ là bây giờ nó chỉ chạy khi cache miss — tức là đúng lúc hệ thống đang chịu tải cao nhất.

### Bốn tầng cache và ai kiểm soát chúng

```text
① BROWSER        Cache-Control, ETag        → người dùng kiểm soát, khó xoá
② CDN            tài nguyên tĩnh, HTML SSG  → xoá được, nhưng có độ trễ lan
③ ỨNG DỤNG       Redis, in-process          → bạn kiểm soát hoàn toàn
④ DATABASE       shared_buffers, plan cache → tự động

Càng gần người dùng: nhanh hơn, nhưng KHÓ XOÁ hơn.
⇒ dữ liệu càng dễ đổi thì càng nên cache ở tầng SÂU.
```

### Ba mẫu cache

```text
CACHE-ASIDE (lazy)          phổ biến nhất
  đọc: cache miss → đọc DB → ghi cache
  ghi: ghi DB → XOÁ cache (không cập nhật)
  ✓ đơn giản, chỉ cache thứ được dùng
  ✗ lần đọc đầu chậm; có cửa sổ đọc dữ liệu cũ

WRITE-THROUGH
  ghi: ghi cache VÀ DB cùng lúc
  ✓ cache luôn mới
  ✗ ghi chậm hơn; cache chứa cả thứ không ai đọc

WRITE-BEHIND
  ghi: ghi cache, đẩy xuống DB sau
  ✓ ghi rất nhanh
  ✗ MẤT DỮ LIỆU nếu cache chết trước khi flush
```

```text
Với cache-aside, quy tắc: XOÁ, đừng CẬP NHẬT cache khi ghi.
  cập nhật → hai request ghi đồng thời có thể để lại giá trị CŨ trong cache
  xoá      → lần đọc tiếp theo lấy giá trị đúng từ DB
```

Xem [Cache patterns](../03-database/02-redis/03-cache-patterns.md).

### Invalidation: hai vấn đề khó

```text
① BIẾT KHI NÀO PHẢI XOÁ
   TTL          đơn giản; chấp nhận cũ tối đa N giây
   xoá khi ghi  chính xác hơn; nhưng phải nhớ MỌI nơi ghi
   phiên bản    khoá chứa version → đổi version = mọi khoá cũ vô hiệu
                → không cần xoá gì, khoá cũ tự hết hạn

② XOÁ ĐÚNG THỨ
   một thay đổi có thể ảnh hưởng nhiều khoá:
   đổi tên sản phẩm → khoá chi tiết, khoá danh sách, khoá tìm kiếm, khoá giỏ hàng
   → nhóm khoá theo tag, hoặc dùng phiên bản, hoặc chấp nhận TTL ngắn
```

```text
Quy tắc thực dụng: LUÔN có TTL, kể cả khi đã xoá chủ động.
  TTL là lưới an toàn cho mọi đường ghi bạn quên.
  ← chính là thứ thiếu trong sự cố ở đầu note
```

### Ba vấn đề kinh điển của cache

```text
THUNDERING HERD   khoá phổ biến hết hạn → hàng nghìn request cùng tính lại
  → single-flight (chỉ một request tính, các request khác chờ)
  → jitter cho TTL
  → stale-while-revalidate: trả giá trị cũ, làm mới ở nền

CACHE PENETRATION khoá không tồn tại → mọi request đều xuống DB
  → cache cả kết quả "không tìm thấy" với TTL ngắn

CACHE STAMPEDE khi khởi động lại / cache trống
  → làm nóng dần, không mở 100% traffic ngay
```

### Cái gì nên cache và cái gì không

```text
✓ ĐÁNG CACHE
  đọc nhiều hơn ghi rất nhiều · tính toán đắt · dữ liệu chịu được cũ
  · kích thước hợp lý · khoá có cardinality vừa phải

✗ KHÔNG NÊN
  ghi nhiều như đọc          → tỉ lệ trúng thấp, invalidate liên tục
  dữ liệu không được cũ      → số dư, tồn kho lúc thanh toán, quyền
  dữ liệu riêng cho mỗi người dùng và chỉ đọc một lần
  → cache miss + chi phí quản lý > lợi ích
```

```text
Đo trước khi giữ: TỈ LỆ TRÚNG.
  < 80% thường nghĩa là cache không đáng — nó thêm một tầng mà không tiết kiệm mấy.
```

### Queue: đổi độ trễ lấy khả năng chịu tải

```text
Đồng bộ:      request → làm mọi việc → phản hồi
              đột biến 10x → 10x tải tức thì → sập

Bất đồng bộ:  request → ghi việc vào queue → phản hồi NGAY
              worker xử lý theo tốc độ của nó
              đột biến 10x → hàng đợi dài ra → độ trễ tăng, KHÔNG sập
```

```text
Queue là BỘ ĐỆM, không phải phép màu:
  · nó KHÔNG tăng throughput tổng — consumer vẫn là giới hạn
  · nó làm phẳng đột biến NGẮN
  · nếu tải trung bình > khả năng consumer, hàng đợi tăng VÔ HẠN
```

Đây là hiểu nhầm phổ biến nhất về queue: nó mua thời gian, không mua dung lượng.

### Việc nào nên đẩy sang queue

```text
✓ ĐẨY ĐƯỢC
  gửi email/SMS · xử lý ảnh/video · sinh báo cáo · đồng bộ với hệ thống ngoài
  · cập nhật chỉ mục tìm kiếm · webhook · fan-out thông báo

✗ KHÔNG ĐẨY ĐƯỢC
  thứ người dùng cần thấy kết quả NGAY
  thứ quyết định câu trả lời của request (kiểm tra tồn kho lúc đặt hàng)

~ TUỲ THIẾT KẾ UX
  thanh toán: xử lý bất đồng bộ được nếu UI hiển thị trạng thái "đang xử lý"
```

```text
Chi phí của bất đồng bộ (thường bị đánh giá thấp):
  · UI phải xử lý trạng thái "đang chờ"
  · cần theo dõi job: thành công? thất bại? thử lại mấy lần?
  · cần DLQ và quy trình xử lý DLQ
  · at-least-once → consumer phải IDEMPOTENT
  · debug khó hơn: lỗi không xuất hiện trong request nào cả
```

### Replica đọc: dịch chuyển tải, không xoá tải

```text
primary  ← mọi thao tác GHI
   ↓ replication (BẤT ĐỒNG BỘ, có ĐỘ TRỄ)
replica  ← thao tác ĐỌC

Vấn đề trung tâm: read-after-write
  người dùng cập nhật hồ sơ → chuyển trang → đọc từ replica → thấy dữ liệu CŨ
```

```text
Bốn cách xử lý:
  ① đọc từ PRIMARY sau khi ghi (trong N giây, theo người dùng)
  ② đọc từ primary cho thao tác nhạy cảm, replica cho phần còn lại
  ③ chờ replica bắt kịp LSN của lần ghi (nếu DB hỗ trợ)
  ④ thiết kế UI để dữ liệu cũ không gây khó hiểu (hiển thị giá trị vừa nhập)

Cách ① đơn giản nhất và đủ cho hầu hết trường hợp.
```

Và một giới hạn quan trọng: **replica không giúp gì cho tải GHI**. Nếu nút thắt là ghi, thêm replica không cải thiện — thậm chí làm chậm primary một chút.

### Khi nào mỗi cơ chế KHÔNG giúp

```text
Cache   không giúp khi: ghi nhiều, dữ liệu không được cũ, tỉ lệ trúng thấp
Queue   không giúp khi: người dùng cần kết quả ngay, hoặc tải TRUNG BÌNH vượt consumer
Replica không giúp khi: nút thắt là GHI, hoặc mọi đọc đều cần dữ liệu mới nhất
Thêm pod không giúp khi: nút thắt là tài nguyên DÙNG CHUNG (database, lock, API ngoài)
```

Dòng cuối là dấu hiệu chẩn đoán mạnh nhất: **thêm instance mà throughput không tăng** thu hẹp ngay xuống nhóm tài nguyên dùng chung.

## Example

Hệ thống thương mại điện tử, ba giai đoạn mở rộng theo tải thật:

```text
── GIAI ĐOẠN 1: 50 rps, p99 = 1,8s ──────────────────────
Đo trước: trang danh sách sản phẩm chạy 47 truy vấn (N+1 trên category và giá).

Sửa: eager load + một index tổ hợp
  p99: 1,8s → 180ms
  ⇒ không thêm hệ thống nào. Đây là bước ① và nó đủ cho giai đoạn này.
```

```text
── GIAI ĐOẠN 2: 400 rps, p99 = 900ms ────────────────────
Đo: 80% request là chi tiết sản phẩm; dữ liệu đổi vài lần mỗi ngày.
    Tỉ lệ đọc:ghi ≈ 200:1.

⇒ đây là ứng viên cache LÝ TƯỞNG.
```

```ts
// cache-aside với TTL làm lưới an toàn + xoá chủ động khi ghi
async getProduct(id: string): Promise<Product> {
  const key = `product:v3:${id}`;                    // v3 = phiên bản schema cache
  const cached = await this.redis.get(key);
  if (cached) { cacheHits.inc({ key: 'product' }); return JSON.parse(cached); }

  cacheMisses.inc({ key: 'product' });
  const product = await this.repo.findOneOrFail({ where: { id } });

  // TTL với JITTER — chống thundering herd
  const ttl = 300 + Math.floor(Math.random() * 60);
  await this.redis.set(key, JSON.stringify(product), 'EX', ttl);
  return product;
}

async updateProduct(id: string, dto: UpdateProductDto) {
  const product = await this.repo.save({ id, ...dto });
  // XOÁ, không cập nhật — tránh ghi đè bằng giá trị cũ khi có hai ghi đồng thời
  await this.redis.del(`product:v3:${id}`);
  await this.redis.del(`product:v3:list:${product.categoryId}`);   // khoá phái sinh
  return product;
}
```

```text
Kết quả: tỉ lệ trúng 94%, p99 = 120ms, tải DB giảm 90%.

Ba chi tiết chống lại sự cố ở đầu note:
  · TTL LUÔN CÓ — kể cả khi đã xoá chủ động
  · `v3` trong khoá — đổi cấu trúc dữ liệu chỉ cần tăng version
  · xoá cả khoá phái sinh — danh sách theo category
```

```text
── GIAI ĐOẠN 3: 1.500 rps, ghi chậm vào giờ cao điểm ────
Đo: mỗi đơn hàng đồng bộ gọi: gửi email · cập nhật chỉ mục tìm kiếm
    · đẩy sang hệ thống kho · sinh hoá đơn PDF
    → 2,4 giây mỗi đơn, và đột biến làm timeout.
```

```ts
// chỉ giữ lại thứ quyết định câu trả lời; phần còn lại đẩy sang queue
async createOrder(dto: CreateOrderDto, user: User) {
  const order = await this.db.$transaction(async (tx) => {
    const created = await tx.order.create({ data: { ...dto, userId: user.id } });

    // OUTBOX trong CÙNG transaction — không mất event nếu process chết sau commit
    await tx.outbox.create({
      data: { topic: 'order.created', payload: { orderId: created.id } },
    });
    return created;
  });

  return order;                                        // phản hồi ngay: 2,4s → 180ms
}
```

```text
Kết quả: p99 ghi 2,4s → 180ms; đột biến không còn gây timeout.

Chi phí đã chấp nhận có ý thức:
  · email tới sau 2–10 giây (UI báo "đang gửi xác nhận")
  · cần theo dõi: độ sâu hàng đợi, tuổi job cũ nhất, tỉ lệ vào DLQ
  · mọi consumer phải IDEMPOTENT (at-least-once)
  · outbox cần một worker riêng đọc và publish
```

Việc dùng outbox thay vì publish trực tiếp sau commit là điểm đáng chú ý: publish trực tiếp tạo **dual-write** — nếu process chết giữa commit và publish, đơn hàng tồn tại nhưng không email nào được gửi, và không có gì phát hiện điều đó.

## Prediction

1. Thêm cache mà không sửa N+1 — vấn đề gốc thế nào khi cache miss?
2. Cache không có TTL, một đường ghi quên xoá — dữ liệu cũ tồn tại bao lâu?
3. Có TTL 300 giây — bao lâu?
4. Cập nhật cache thay vì xoá, hai ghi đồng thời — cache có thể chứa gì?
5. 10.000 khoá cùng TTL 300s, set cùng lúc — chuyện gì sau 5 phút?
6. Thêm jitter ±60s — thế nào?
7. Tỉ lệ trúng cache 45% — cache có đáng giữ không?
8. Tải trung bình vượt khả năng consumer, có queue — hàng đợi thế nào?
9. Đột biến 10x trong 2 phút, tải trung bình dưới khả năng — hàng đợi thế nào?
10. Người dùng cập nhật hồ sơ rồi đọc từ replica ngay — họ thấy gì?
11. Nút thắt là tải GHI, thêm 3 replica đọc — cải thiện bao nhiêu?
12. Publish event sau khi commit, process chết giữa hai bước — hậu quả?
13. Dùng outbox — hậu quả?
14. Thêm instance mà throughput không tăng — nút thắt ở đâu?

<details>
<summary>Đáp án</summary>

1. Nó **vẫn ở đó**, và chỉ lộ ra khi cache miss — tức là lúc tải cao nhất.
2. **Vô hạn** — cho tới khi ai đó phát hiện.
3. Tối đa **300 giây**.
4. **Giá trị cũ** — request chậm hơn ghi đè lên request nhanh hơn.
5. **Thundering herd** — hàng nghìn request cùng tính lại.
6. Hết hạn **trải đều** trong 60 giây.
7. **Không** — thêm một tầng mà tiết kiệm ít; xem lại khoá và TTL.
8. **Tăng vô hạn** — queue không tăng dung lượng xử lý.
9. **Phình rồi tiêu** — đúng công dụng của nó.
10. **Dữ liệu cũ** — read-after-write.
11. **Không cải thiện** — replica không giúp cho ghi.
12. Đơn hàng tồn tại nhưng **event không bao giờ được publish** — dual-write.
13. Event nằm trong cùng transaction → **không mất**.
14. **Tài nguyên dùng chung**: database, lock, hoặc API ngoài.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Xoá toàn bộ cache khi đang có tải | Tải DB tăng bao nhiêu? Có sập không? |
| Đo tỉ lệ trúng cache theo từng khoá | Khoá nào không đáng cache? |
| Tìm khoá cache không có TTL | Có cái nào không? |
| Đặt TTL giống hệt nhau cho 10.000 khoá | Có đợt tăng sau khi hết hạn? |
| Cập nhật cache thay vì xoá, gửi hai ghi đồng thời | Cache chứa giá trị nào? |
| Dừng consumer 10 phút | Hàng đợi dài bao nhiêu? Bao lâu để tiêu? |
| Gửi tải trung bình vượt khả năng consumer | Hàng đợi có ổn định không? |
| Cập nhật rồi đọc ngay từ replica | Thấy dữ liệu cũ không? |
| Đo độ trễ replica khi có tải ghi cao | Bao nhiêu giây? |
| Giết process giữa commit và publish | Event có mất không? |
| Thêm một instance và đo throughput | Có tăng không? |

## What Usually Goes Wrong

- **Thêm cache trước khi sửa vấn đề gốc.**
- **Cache không có TTL** → dữ liệu cũ vĩnh viễn khi quên một đường ghi.
- **Cập nhật cache thay vì xoá** → ghi đè bằng giá trị cũ.
- **Quên khoá phái sinh** (danh sách, tìm kiếm, tổng hợp).
- **Không có jitter cho TTL** → thundering herd.
- **Không đo tỉ lệ trúng** → giữ cache không đáng giữ.
- **Cache dữ liệu không được cũ** (số dư, tồn kho, quyền).
- **Coi queue là cách tăng throughput** — nó chỉ làm phẳng đột biến.
- **Consumer không idempotent** với at-least-once.
- **Không có DLQ hoặc không ai xem DLQ.**
- **Dual-write** thay vì outbox.
- **Đọc từ replica cho thao tác cần dữ liệu mới nhất.**
- **Thêm pod khi nút thắt là database** → làm database tệ hơn.
- **Không theo dõi tuổi job cũ nhất** → consumer chết mà không ai biết.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Cache luôn cải thiện | Tỉ lệ trúng thấp + chi phí quản lý có thể tệ hơn |
| Cache là tối ưu hiệu năng | Nó cũng là quyết định về tính đúng đắn |
| Queue tăng throughput | Nó làm phẳng đột biến; consumer vẫn là giới hạn |
| Bất đồng bộ luôn tốt hơn | Nó đổi độ trễ và độ phức tạp lấy khả năng chịu tải |
| Replica giúp mọi loại tải | Nó không giúp gì cho ghi |
| Độ trễ replica là mili-giây | Dưới tải ghi cao, nó có thể là nhiều giây |
| Thêm pod luôn tăng dung lượng | Không, nếu nút thắt dùng chung |
| Xoá cache khi ghi là đủ | Bạn sẽ quên một đường ghi; TTL là lưới an toàn |
| Publish event sau commit là an toàn | Đó là dual-write, event có thể mất |
| Nhiều tầng cache là kiến trúc tốt | Mỗi tầng là một chỗ dữ liệu cũ có thể trốn |

## Debugging

1. **Trước khi thêm bất cứ gì: đo** — nút thắt ở đâu, chiếm bao nhiêu phần trăm?
2. **Tỉ lệ trúng cache theo khoá** — khoá nào dưới 80% thì xem lại.
3. **Dữ liệu cũ hiển thị** → tầng nào? Browser, CDN, Redis, hay in-process? Kiểm tra từ ngoài vào trong.
4. **Tìm khoá không có TTL**: `redis-cli --scan | head -1000 | xargs -I{} redis-cli ttl {}` — giá trị `-1` là khoá không hết hạn.
5. **Hàng đợi tăng đều** → tải trung bình vượt consumer; thêm consumer hoặc giảm việc.
6. **Hàng đợi phình rồi tiêu** → đột biến, bình thường.
7. **Đọc thấy dữ liệu cũ** → độ trễ replica: `SELECT now() - pg_last_xact_replay_timestamp();`
8. **Thêm instance không cải thiện** → tìm tài nguyên dùng chung; kiểm tra kết nối DB, lock, rate limit của API ngoài.

## Production Considerations

- **Đo và sửa vấn đề gốc trước khi thêm hệ thống.**
- **Mọi khoá cache có TTL**, kể cả khi có xoá chủ động.
- **Jitter cho TTL**; single-flight cho khoá phổ biến.
- **Phiên bản trong khoá cache** để đổi cấu trúc không cần xoá thủ công.
- **Xoá, không cập nhật** trong cache-aside.
- **Khoá cache gồm danh tính** khi dữ liệu riêng theo người dùng/tenant.
- **Đo tỉ lệ trúng theo khoá** và bỏ cache không đáng.
- **Outbox thay vì publish trực tiếp** sau commit.
- **Consumer idempotent**; DLQ có người xem và quy trình xử lý.
- **Theo dõi**: độ sâu hàng đợi, **tuổi job cũ nhất**, tỉ lệ DLQ, độ trễ replica.
- **Đọc từ primary sau khi ghi** trong cửa sổ ngắn theo người dùng.
- **Kiểm tra `N pod × pool < max_connections`** trước mỗi lần scale.
- **Ghi ADR cho mỗi hệ thống thêm vào**, kèm điều kiện bỏ đi.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Tối ưu query | không thêm hệ thống | có giới hạn |
| Cache | đọc rất nhanh, giảm tải DB | dữ liệu cũ, invalidation, một tầng debug |
| TTL ngắn | ít cũ | tỉ lệ trúng thấp hơn |
| TTL dài | tỉ lệ trúng cao | dữ liệu cũ lâu hơn |
| Cache-aside | đơn giản, chỉ cache thứ dùng | lần đọc đầu chậm |
| Write-through | cache luôn mới | ghi chậm, cache chứa thứ không dùng |
| Queue | chịu đột biến, phản hồi nhanh | độ trễ, phức tạp, cần idempotency |
| Đồng bộ | đơn giản, lỗi thấy ngay | đột biến gây timeout |
| Replica đọc | mở rộng đọc | độ trễ replica, phức tạp routing |
| Thêm pod | mở rộng xử lý | nhiều kết nối DB hơn |

## Explain Without Notes

1. Bốn hướng mở rộng theo thứ tự chi phí, và vì sao thứ tự đó?
2. Bốn tầng cache và vì sao dữ liệu dễ đổi nên cache ở tầng sâu?
3. Vì sao cache-aside phải XOÁ chứ không CẬP NHẬT?
4. Ba vấn đề kinh điển của cache và cách xử lý từng cái?
5. Vì sao queue không tăng throughput? Nó mua cái gì?
6. Bốn cách xử lý read-after-write với replica?
7. Bốn trường hợp mỗi cơ chế mở rộng **không** giúp gì?
8. Dual-write là gì và outbox giải quyết nó thế nào?

## Related

- [Requirements & trade-offs](01-requirements-tradeoffs.md) — có số trước khi mở rộng
- [Data partitioning & sharding](05-data-partitioning-sharding.md) — bước sau replica
- [Consistency & availability](04-consistency-availability.md) — cái giá của dữ liệu cũ
- [Event-driven](07-event-driven.md) — khi queue thành kiến trúc
- [Cache invalidation](../03-database/02-redis/01-cache-invalidation.md) — chi tiết invalidation
- [Cache patterns](../03-database/02-redis/03-cache-patterns.md) — ba mẫu cache
- [Why queue](../03-database/04-message-queues/01-why-queue.md) — khi nào cần hàng đợi
- [Outbox pattern](../03-database/04-message-queues/06-outbox-pattern.md) — chống dual-write
- [Replication & scaling](../03-database/01-postgresql/09-replication-scaling.md) — replica đọc
- [Latency & bottleneck](../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) — đo trước khi tối ưu

## Version / Context

Ví dụ dùng Redis 7, PostgreSQL 16, NestJS 10/11, BullMQ. `stale-while-revalidate` theo RFC 5861. Độ trễ replica trong PostgreSQL đo bằng `pg_last_xact_replay_timestamp()`; PostgreSQL cũng hỗ trợ `synchronous_commit = remote_apply` cho đọc-sau-ghi mạnh, đổi lại độ trễ ghi cao hơn.
