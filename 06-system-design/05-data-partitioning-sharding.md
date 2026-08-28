---
level: advanced
area: system-design
prerequisites:
  - 02-scaling-cache-queue.md
related:
  - 06-storage-selection.md
  - ../03-database/01-postgresql/operations/02-replication-scaling.md
---

# Data partitioning & sharding

> Một SaaS chia dữ liệu thành 8 shard theo `hash(tenant_id)` khi database chính đạt giới hạn ghi. Ba tháng sau, một khách hàng doanh nghiệp chiếm 60% toàn bộ lưu lượng — và toàn bộ dữ liệu của họ nằm trên **một** shard. Shard đó quá tải; bảy shard còn lại chạy ở 15%. Không thể chia nhỏ khách hàng đó vì mọi truy vấn của họ đều cần join xuyên bảng. **Sharding đã giải quyết bài toán dung lượng và tạo ra bài toán phân bố — vốn khó hơn nhiều.**

## Position

```text
Một database chạm giới hạn GHI → bốn hướng, theo thứ tự chi phí:

  ① máy to hơn (scale dọc)      → rẻ nhất, có trần, thường bị bỏ qua quá sớm
  ② tách theo CHỨC NĂNG          → mỗi nhóm bảng một database
  ③ PHÂN VÙNG trong một DB       → một database, nhiều bảng con
  ④ SHARDING                      → nhiều database, khó đảo ngược
```

## Problem

```text
Replica đọc giải quyết tải ĐỌC. Nó không giúp gì cho GHI.

Khi ghi vượt khả năng một node:
  · thêm replica → không cải thiện
  · cache        → không cải thiện
  · queue        → làm phẳng đột biến, nhưng tải trung bình vẫn vượt

⇒ phải chia DỮ LIỆU. Và mọi cách chia đều mất một thứ:
     JOIN xuyên phần · TRANSACTION xuyên phần · truy vấn không theo khoá chia
```

## Mental Model

### Trước khi shard: ba việc rẻ hơn nhiều

```text
① SCALE DỌC
   một instance PostgreSQL hiện đại xử lý được rất nhiều:
   hàng chục nghìn ghi/giây, hàng TB dữ liệu
   → tăng CPU/RAM/IOPS rẻ hơn nhiều so với sharding về mọi mặt

② TÁCH THEO CHỨC NĂNG (vertical split)
   bảng analytics/log/audit → database riêng
   → thường lấy lại 50–80% dung lượng ghi mà không đụng logic nghiệp vụ

③ GIẢM TẢI GHI
   batch nhiều ghi nhỏ thành một · bỏ cột không dùng · bỏ index thừa
   · chuyển đếm/thống kê sang Redis rồi flush theo lô
   · giảm write amplification (mỗi index là một lần ghi thêm)
```

Sharding là lựa chọn cuối vì nó **khó đảo ngược**: một khi dữ liệu đã chia, gộp lại đòi hỏi một dự án di trú tương đương.

### Phân vùng (partitioning) khác sharding

```text
PHÂN VÙNG   một database, bảng chia thành nhiều bảng con
            → PostgreSQL declarative partitioning
            ✓ vẫn JOIN được, vẫn transaction được, ứng dụng gần như không đổi
            ✓ xoá dữ liệu cũ bằng DROP PARTITION (tức thì, không bloat)
            ✗ KHÔNG tăng dung lượng ghi tổng — vẫn một máy

SHARDING    nhiều database độc lập
            ✓ tăng dung lượng ghi thật
            ✗ mất join, mất transaction xuyên shard, ứng dụng phải biết về shard
```

```text
Phân vùng giải quyết: bảng quá lớn, truy vấn theo khoảng, xoá dữ liệu cũ
Sharding giải quyết:  một máy không đủ

Chúng KHÔNG thay thế nhau — nhiều hệ thống dùng cả hai.
```

### Chọn khoá chia: quyết định khó đảo ngược nhất

```text
Khoá chia tốt phải thoả BA điều kiện cùng lúc:

① PHÂN BỐ ĐỀU        không có giá trị nào chiếm phần lớn dữ liệu
② KHỚP VỚI TRUY VẤN  phần lớn truy vấn lọc theo khoá này
③ ỔN ĐỊNH            giá trị không đổi sau khi bản ghi được tạo
```

```text
Ví dụ đánh giá:

  user_id       ① tốt (nếu người dùng đồng đều)  ② tốt cho app hướng người dùng
                ③ tốt                            → thường là lựa chọn đúng

  tenant_id     ① RỦI RO — tenant lớn gây lệch   ② rất tốt cho SaaS
                ③ tốt                            → tốt, nhưng phải xử lý tenant lớn

  created_at    ① tệ — mọi ghi vào shard mới nhất (hotspot)
                ② tốt cho truy vấn theo khoảng
                → dùng cho PHÂN VÙNG, KHÔNG dùng cho sharding

  order_id      ① tốt (hash đều)                 ② TỆ — "đơn hàng của tôi" phải hỏi MỌI shard
                → sai với hầu hết truy vấn thực tế
```

Điều kiện ② là điều kiện hay bị bỏ qua, và nó quyết định hiệu năng thực tế: khoá phân bố đều nhưng không khớp truy vấn biến mọi truy vấn thành **scatter-gather** trên tất cả shard.

### Ba chiến lược ánh xạ

```text
HASH                shard = hash(key) % N
                    ✓ phân bố đều
                    ✗ đổi N = di chuyển GẦN NHƯ TOÀN BỘ dữ liệu
                    ✗ không truy vấn theo khoảng được

RANGE               shard theo khoảng giá trị
                    ✓ truy vấn theo khoảng hiệu quả
                    ✗ dễ hotspot (dữ liệu mới dồn vào một shard)

DIRECTORY (lookup)  bảng ánh xạ key → shard
                    ✓ LINH HOẠT nhất: di chuyển từng tenant, cân bằng thủ công
                    ✓ xử lý được tenant lớn: cho nó shard riêng
                    ✗ thêm một lần tra cứu (cache được) và một điểm phụ thuộc
```

```text
CONSISTENT HASHING — cải tiến của hash
  thêm/bớt node chỉ di chuyển ~1/N dữ liệu thay vì gần như toàn bộ
  → dùng virtual node để phân bố đều hơn
```

Với SaaS nhiều tenant, **directory** thường là lựa chọn đúng dù nó có vẻ "kém thanh lịch" hơn hash: nó là cách duy nhất xử lý được tenant lớn mà không phải sharding lại.

### Cái mất khi shard

```text
① JOIN XUYÊN SHARD
   không làm được ở tầng database
   → gọi nhiều shard rồi gộp ở ứng dụng, hoặc DENORMALIZE

② TRANSACTION XUYÊN SHARD
   không có ACID
   → saga, hoặc thiết kế để mọi transaction nằm TRONG một shard

③ TRUY VẤN KHÔNG THEO KHOÁ CHIA
   phải hỏi MỌI shard (scatter-gather)
   → chậm bằng shard chậm nhất, và tải nhân lên N lần
   → giải pháp: bảng chỉ mục thứ cấp, hoặc hệ thống tìm kiếm riêng

④ KHOÁ TỰ TĂNG
   không dùng được — hai shard sinh cùng ID
   → UUID, ULID, hoặc Snowflake ID (có thời gian, sắp xếp được)

⑤ VẬN HÀNH NHÂN LÊN
   N database để backup, nâng cấp, giám sát, migration
   → migration phải chạy trên N shard và có thể thất bại một phần
```

Mục ⑤ là chi phí thường bị đánh giá thấp nhất: nó không giảm đi theo thời gian và nó ảnh hưởng tới mọi thay đổi schema về sau.

### Hotspot: vấn đề trung tâm

```text
Nguồn hotspot:
  · một tenant/người dùng chiếm phần lớn lưu lượng   ← sự cố ở đầu note
  · khoá theo thời gian → mọi ghi vào shard mới nhất
  · dữ liệu "nổi tiếng" (một bài viết viral)
  · giá trị mặc định (`tenant_id = NULL` hoặc `'default'`)

Xử lý:
  · directory mapping → cho tenant lớn shard riêng
  · khoá tổng hợp     → hash(tenant_id, bucket) với tenant lớn có nhiều bucket
  · tách riêng        → khách hàng doanh nghiệp có database riêng
  · cache mạnh        → cho dữ liệu nổi tiếng đọc nhiều
```

```text
Đo trước khi shard: phân bố dữ liệu và lưu lượng theo khoá dự định.
  SELECT tenant_id, count(*) FROM orders
   GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
Nếu top 1 chiếm > 10%, hash sharding sẽ tạo hotspot.
```

### Resharding: phần khó nhất

```text
Khi N shard không đủ, phải chia lại — và hệ thống vẫn phải chạy:

  ① ghi kép (dual write) vào cả bố cục cũ và mới
  ② sao chép dữ liệu lịch sử ở nền
  ③ đối soát hai bên
  ④ chuyển đọc sang bố cục mới, từng phần
  ⑤ ngừng ghi vào bố cục cũ
  ⑥ dọn dẹp

Mất hàng tuần tới hàng tháng, và mỗi bước có thể phải quay lại.
```

```text
Giảm đau bằng cách thiết kế TRƯỚC:
  · chia thành NHIỀU shard LOGIC hơn số shard vật lý
    (ví dụ 1024 shard logic trên 8 máy)
  · mở rộng = di chuyển shard logic sang máy mới, KHÔNG cần hash lại
  ← đây là quyết định tốn ít công lúc đầu và tiết kiệm rất nhiều về sau
```

### Phân vùng trong PostgreSQL: thường là đủ

```sql
-- phân vùng theo thời gian: truy vấn theo khoảng nhanh, xoá dữ liệu cũ tức thì
CREATE TABLE events (
  id bigserial, tenant_id uuid NOT NULL,
  created_at timestamptz NOT NULL, payload jsonb
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2026_08 PARTITION OF events
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- xoá dữ liệu tháng cũ: tức thì, không bloat, không vacuum
DROP TABLE events_2026_05;
```

```text
Ba lợi ích thực tế của phân vùng theo thời gian:
  · partition pruning: truy vấn theo khoảng chỉ đọc partition liên quan
  · DROP PARTITION thay cho DELETE hàng triệu dòng (không bloat, không vacuum)
  · index nhỏ hơn cho mỗi partition → vừa bộ nhớ đệm hơn

Lưu ý: khoá phân vùng PHẢI nằm trong mọi ràng buộc UNIQUE và PRIMARY KEY.
  → `PRIMARY KEY (id, created_at)` thay vì `PRIMARY KEY (id)`
```

## Example

Đường đi thực tế của một SaaS, bốn giai đoạn:

```text
── GIAI ĐOẠN 1: một database, 200 GB, 800 ghi/giây ──────
Đo: CPU 45%, IOPS 40%. Bảng `events` chiếm 140 GB trong 200 GB.

Hành động: KHÔNG shard. Tách `events` sang database riêng (tách chức năng).
  → database chính còn 60 GB, ghi giảm 60%
  → chi phí: một database nữa; không đụng logic nghiệp vụ
```

```text
── GIAI ĐOẠN 2: 900 GB, bảng orders 400 triệu dòng ──────
Vấn đề: truy vấn theo khoảng thời gian chậm; xoá dữ liệu cũ gây bloat.

Hành động: PHÂN VÙNG `orders` theo tháng. Vẫn MỘT database.
  → truy vấn 30 ngày gần nhất chỉ đọc 1–2 partition
  → xoá dữ liệu > 24 tháng bằng DROP PARTITION
  → chi phí: phải đưa `created_at` vào primary key
```

```text
── GIAI ĐOẠN 3: 6.000 ghi/giây, một máy không đủ ────────
Đo phân bố trước:
  SELECT tenant_id, count(*) FROM orders GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
  → top 1 tenant chiếm 34% dữ liệu   ← HASH SHARDING SẼ TẠO HOTSPOT

Hành động: DIRECTORY sharding, không phải hash.
```

```ts
// bảng ánh xạ: tenant → shard. Cache trong process, TTL ngắn.
interface ShardMap { tenantId: string; shardId: number; }

@Injectable()
export class ShardRouter {
  private cache = new Map<string, number>();

  async getShard(tenantId: string): Promise<number> {
    const cached = this.cache.get(tenantId);
    if (cached !== undefined) return cached;

    const row = await this.directory.findUniqueOrThrow({ where: { tenantId } });
    this.cache.set(tenantId, row.shardId);
    return row.shardId;
  }

  async getClient(tenantId: string): Promise<PrismaClient> {
    return this.clients[await this.getShard(tenantId)];
  }
}
```

```text
Bố cục:
  shard 0  → tenant lớn nhất, MỘT MÌNH        (34% tải, máy riêng lớn hơn)
  shard 1  → tenant lớn thứ hai
  shard 2–7 → phần còn lại, phân bố theo dung lượng thực tế

⇒ directory cho phép làm điều mà hash không làm được:
  đặt một tenant lên máy riêng, và di chuyển từng tenant khi phân bố lệch.
```

```ts
// mọi truy vấn phải đi qua router — và có tenantId
async findOrders(tenantId: string, filter: OrderFilter) {
  const db = await this.shards.getClient(tenantId);
  return db.order.findMany({ where: { tenantId, ...filter } });
  //                                ↑ vẫn giữ tenantId trong WHERE:
  //                                  lưới an toàn nếu router định tuyến sai
}

// truy vấn KHÔNG theo tenant → scatter-gather, và nó đắt
async findOrderByGlobalId(orderId: string) {
  // ✗ hỏi mọi shard — chậm bằng shard chậm nhất, tải × N
  // ✓ nhúng shard vào ID: `ord_3_01H...` → biết ngay shard nào
  const shardId = parseShardFromId(orderId);
  return this.clients[shardId].order.findUnique({ where: { id: orderId } });
}
```

Việc nhúng shard id vào định danh công khai là kỹ thuật đơn giản loại bỏ phần lớn scatter-gather — và nó phải quyết định **trước** khi phát hành ID ra ngoài.

```text
── GIAI ĐOẠN 4: cần thêm shard ──────────────────────────
Với directory: thêm shard 8, di chuyển vài tenant sang đó.
  · mỗi tenant di chuyển độc lập, có thể lùi lại
  · không cần hash lại, không cần dừng hệ thống
  · thời gian: vài giờ mỗi tenant lớn

Với hash % 8 → % 9: gần như TOÀN BỘ dữ liệu phải di chuyển.
```

## Prediction

1. Ghi vượt khả năng một database, thêm 3 replica đọc — cải thiện bao nhiêu?
2. Tách bảng `events` (70% dung lượng ghi) sang DB riêng — cải thiện bao nhiêu?
3. Phân vùng bảng trong một PostgreSQL — dung lượng ghi tổng có tăng không?
4. Sharding — có tăng không?
5. Shard theo `created_at` — ghi phân bố thế nào?
6. Shard theo `hash(order_id)`, truy vấn "đơn hàng của tôi" — phải hỏi bao nhiêu shard?
7. Shard theo `hash(tenant_id)`, một tenant chiếm 34% dữ liệu — shard đó thế nào?
8. Dùng directory mapping cho cùng tình huống — xử lý thế nào?
9. `hash % 8` đổi sang `hash % 9` — bao nhiêu dữ liệu phải di chuyển?
10. Consistent hashing, thêm một node vào 8 node — bao nhiêu?
11. 1024 shard logic trên 8 máy, thêm máy thứ 9 — cần hash lại không?
12. Khoá tự tăng trên 8 shard — chuyện gì xảy ra?
13. Migration schema trên 8 shard, shard thứ 5 thất bại — trạng thái hệ thống?
14. Phân vùng theo tháng, xoá dữ liệu 2 năm trước bằng `DELETE` so với `DROP PARTITION`?

<details>
<summary>Đáp án</summary>

1. **Không cải thiện** — replica không giúp cho ghi.
2. Khoảng **70%** dung lượng ghi được giải phóng — rẻ hơn sharding rất nhiều.
3. **Không** — vẫn một máy.
4. **Có** — đó là mục đích duy nhất của nó.
5. **Dồn vào shard mới nhất** — hotspot.
6. **Tất cả** — scatter-gather; khoá không khớp truy vấn.
7. **Quá tải** trong khi các shard khác nhàn rỗi.
8. Cho tenant đó **shard riêng**, máy lớn hơn.
9. **Gần như toàn bộ** — chỉ ~1/9 khoá giữ nguyên vị trí.
10. Khoảng **1/9** dữ liệu.
11. **Không** — chỉ di chuyển shard logic.
12. **Trùng ID** giữa các shard.
13. **Không nhất quán một phần** — bốn shard mới, bốn shard cũ; cần cơ chế xử lý.
14. `DELETE`: hàng triệu dòng, bloat, vacuum lâu. `DROP PARTITION`: **tức thì**.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đo phân bố dữ liệu theo khoá chia dự định | Top 1 chiếm bao nhiêu phần trăm? |
| Đo phân bố LƯU LƯỢNG (không chỉ dung lượng) | Có khác phân bố dữ liệu không? |
| Liệt kê 20 truy vấn phổ biến nhất | Bao nhiêu cái lọc theo khoá chia? |
| Thử một truy vấn không theo khoá chia | Phải hỏi bao nhiêu shard? |
| Tính lượng dữ liệu di chuyển khi đổi N | Bao nhiêu phần trăm? |
| Chạy migration trên nhiều shard, làm một cái thất bại | Hệ thống ở trạng thái nào? |
| Tách bảng lớn nhất sang DB riêng | Tải ghi giảm bao nhiêu? |
| Đo giới hạn thật của một instance lớn hơn | Còn cách trần bao xa? |
| `DELETE` 10 triệu dòng vs `DROP PARTITION` | Thời gian và bloat? |
| Thêm ràng buộc UNIQUE không chứa khoá phân vùng | PostgreSQL báo gì? |

## What Usually Goes Wrong

- **Shard quá sớm** — trước khi thử scale dọc và tách chức năng.
- **Không đo phân bố** trước khi chọn khoá.
- **Khoá chia không khớp truy vấn** → scatter-gather khắp nơi.
- **Khoá theo thời gian cho sharding** → hotspot ở shard mới nhất.
- **Hash sharding với tenant lệch** → không sửa được mà không sharding lại.
- **Không có shard logic** → mở rộng đòi hỏi hash lại toàn bộ.
- **Khoá tự tăng** → trùng ID giữa shard.
- **Không nhúng shard vào ID công khai** → scatter-gather cho mọi tra cứu theo ID.
- **Quên `tenant_id` trong `WHERE`** sau khi đã định tuyến → rò rỉ nếu router sai.
- **Migration không nguyên tử trên N shard** → trạng thái không nhất quán một phần.
- **Không đối soát giữa các shard** → lệch âm thầm.
- **Đánh giá thấp chi phí vận hành** N database.
- **Nhầm phân vùng với sharding** → tưởng đã tăng dung lượng ghi.
- **Ràng buộc UNIQUE không chứa khoá phân vùng** → PostgreSQL từ chối.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Sharding là bước tự nhiên khi lớn | Nó là lựa chọn cuối, sau ba bước rẻ hơn |
| Phân vùng và sharding như nhau | Phân vùng không tăng dung lượng ghi |
| Hash sharding luôn phân bố đều | Chỉ khi dữ liệu đầu vào đều |
| Chọn khoá chia có thể sửa sau | Nó là quyết định khó đảo ngược nhất |
| Replica giúp khi ghi quá tải | Nó chỉ giúp cho đọc |
| Một PostgreSQL không xử lý nổi quy mô lớn | Nó xử lý được nhiều hơn hầu hết người nghĩ |
| Sharding chỉ là vấn đề kỹ thuật lưu trữ | Nó thay đổi cách viết mọi truy vấn |
| Scatter-gather chấp nhận được | Nó nhân tải lên N và chậm bằng shard chậm nhất |
| Resharding là thao tác vận hành | Nó là dự án hàng tuần tới hàng tháng |
| Nhiều shard = tin cậy hơn | Nhiều thành phần hơn = nhiều thứ hỏng hơn |

## Debugging

1. **Trước khi shard: đo giới hạn thật** — CPU, IOPS, kết nối, và bảng nào chiếm phần lớn ghi.
2. **Thử scale dọc và tách chức năng trước**; ghi lại con số trước/sau.
3. **Đo phân bố theo khoá dự định** — cả dung lượng lẫn lưu lượng, chúng có thể khác nhau.
4. **Kiểm kê truy vấn**: bao nhiêu phần trăm lọc theo khoá chia?
5. **Shard nóng** → xem phân bố hiện tại; directory cho phép di chuyển từng tenant.
6. **Truy vấn chậm sau khi shard** → nó có scatter-gather không? Có nhúng shard vào ID được không?
7. **Dữ liệu lệch giữa shard** → job đối soát; kiểm tra router có định tuyến đúng không.
8. **Migration thất bại một phần** → cần bảng theo dõi trạng thái migration theo shard và khả năng chạy lại.

## Production Considerations

- **Thử scale dọc, tách chức năng, giảm tải ghi trước khi shard.**
- **Đo phân bố dữ liệu VÀ lưu lượng** trước khi chọn khoá.
- **Khoá chia thoả cả ba điều kiện**: đều, khớp truy vấn, ổn định.
- **Directory mapping cho SaaS nhiều tenant** — nó xử lý được tenant lớn.
- **Nhiều shard logic hơn shard vật lý** (256–1024) ngay từ đầu.
- **Nhúng shard id vào định danh công khai** trước khi phát hành ID.
- **ID toàn cục**: UUIDv7, ULID, hoặc Snowflake — không dùng tự tăng.
- **Giữ khoá chia trong `WHERE`** kể cả sau khi đã định tuyến.
- **Phân vùng theo thời gian cho bảng chỉ tăng** (event, log, audit) — `DROP PARTITION` để dọn.
- **Migration có theo dõi trạng thái theo shard**, chạy lại được, và tương thích ngược.
- **Job đối soát giữa các shard** và với directory.
- **Theo dõi phân bố liên tục** — lệch xuất hiện dần theo thời gian.
- **Tự động hoá vận hành N shard**: backup, nâng cấp, giám sát, dựng môi trường.
- **Ghi ADR** cho quyết định khoá chia — đây là quyết định đắt nhất để đổi.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Scale dọc | đơn giản, không đổi code | có trần, chi phí phi tuyến |
| Tách chức năng | rẻ, hiệu quả cao | nhiều database hơn, không join được |
| Phân vùng | truy vấn nhanh, dọn dữ liệu dễ | không tăng dung lượng ghi |
| Sharding | tăng dung lượng ghi thật | mất join, transaction; vận hành nhân lên |
| Hash | phân bố đều, đơn giản | resharding rất đắt, không range query |
| Range | range query hiệu quả | dễ hotspot |
| Directory | linh hoạt nhất, xử lý được lệch | thêm tra cứu và một phụ thuộc |
| Consistent hashing | mở rộng rẻ hơn hash | phức tạp hơn, vẫn không xử lý lệch |
| Nhiều shard logic | mở rộng không hash lại | thêm một lớp gián tiếp |
| Nhúng shard vào ID | tra cứu trực tiếp | ID dài hơn, khó đổi bố cục |

## Explain Without Notes

1. Bốn hướng khi database chạm giới hạn ghi, theo thứ tự chi phí?
2. Phân vùng và sharding khác nhau ở điểm nào quyết định?
3. Ba điều kiện của một khoá chia tốt, và điều kiện nào hay bị bỏ?
4. Ba chiến lược ánh xạ và đánh đổi của từng cái?
5. Năm thứ mất đi khi shard?
6. Bốn nguồn hotspot và cách xử lý?
7. Vì sao shard logic nhiều hơn shard vật lý là quyết định đáng làm sớm?
8. Vì sao `DROP PARTITION` tốt hơn `DELETE` cho dữ liệu cũ?

## Related

- [Scaling: cache & queue](02-scaling-cache-queue.md) — các bước trước sharding
- [Storage selection](06-storage-selection.md) — một số kho dữ liệu tự shard
- [Consistency & availability](04-consistency-availability.md) — nhất quán xuyên shard
- [Requirements & trade-offs](01-requirements-tradeoffs.md) — có số trước khi quyết định
- [Replication & scaling](../03-database/01-postgresql/operations/02-replication-scaling.md) — replica và giới hạn của nó
- [Index & query plan](../03-database/01-postgresql/indexes-query-planning/01-index-query-plan.md) — partition pruning
- [Migrations](../03-database/03-data-modeling/04-migrations.md) — migration trên nhiều shard
- [Ordering & partitioning](../03-database/04-message-queues/04-ordering-partitioning.md) — cùng ý tưởng ở tầng message
- [Capacity & limits](../05-cross-cutting/reliability/04-capacity-and-limits.md) — biết trần trước khi chạm

## Version / Context

Ví dụ dùng PostgreSQL 16 (declarative partitioning; khoá phân vùng bắt buộc nằm trong mọi UNIQUE/PRIMARY KEY; partition pruning ở cả thời điểm lập kế hoạch và thực thi). UUIDv7 (RFC 9562) sắp xếp được theo thời gian, phù hợp làm khoá chính phân tán. Citus là extension cho PostgreSQL hỗ trợ sharding; Vitess cho MySQL. Consistent hashing theo Karger và cộng sự (1997).
