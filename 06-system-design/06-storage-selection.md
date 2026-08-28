---
level: advanced
area: system-design
prerequisites:
  - 01-requirements-tradeoffs.md
related:
  - 05-data-partitioning-sharding.md
  - ../03-database/03-data-modeling/02-normalization.md
---

# Chọn kho dữ liệu

> Một team chọn MongoDB cho sản phẩm mới vì "schema linh hoạt, dễ thay đổi lúc đầu". Mười tám tháng sau, họ có bảy loại document với năm phiên bản schema khác nhau cùng tồn tại, mỗi truy vấn phải xử lý mọi biến thể, và một báo cáo doanh thu cần join ba collection ở tầng ứng dụng. Họ chuyển sang PostgreSQL trong sáu tháng. **Schema linh hoạt không loại bỏ schema — nó chỉ chuyển schema từ database vào trong code, nơi không có gì thực thi nó.**

## Position

```text
Yêu cầu → mô hình truy cập → CHỌN KHO DỮ LIỆU → mô hình hoá
                                    ↑ note này
```

## Problem

```text
Câu hỏi "dùng database nào" thường được trả lời bằng:
  · thói quen        · công nghệ đang thịnh hành
  · một bài blog     · "cái này mở rộng tốt hơn"

Câu hỏi đúng là:
  ① dữ liệu có QUAN HỆ không, và bạn có cần truy vấn theo quan hệ đó không?
  ② MÔ HÌNH TRUY CẬP là gì — tra theo khoá, quét theo khoảng, tìm toàn văn, tổng hợp?
  ③ cần ràng buộc và TRANSACTION tới mức nào?
  ④ quy mô THẬT là bao nhiêu?
  ⑤ đội bạn VẬN HÀNH được cái nào?
```

Câu ⑤ thường quyết định nhiều hơn bốn câu đầu, và hầu như không bao giờ được đưa vào thảo luận.

## Mental Model

### Mặc định đúng: một cơ sở dữ liệu quan hệ

```text
PostgreSQL (hoặc tương đương) xử lý được, ở mức tốt:

  quan hệ · transaction ACID · ràng buộc · JSON (jsonb + GIN index)
  · tìm kiếm toàn văn · dữ liệu địa lý (PostGIS) · time-series (partition + BRIN)
  · hàng đợi (FOR UPDATE SKIP LOCKED) · pub/sub (LISTEN/NOTIFY)
  · vector (pgvector)

⇒ Bắt đầu ở đây. Thêm kho chuyên biệt khi có BẰNG CHỨNG rằng
  giải pháp quan hệ không đáp ứng được — không phải khi bạn nghĩ nó sẽ không.
```

```text
Vì sao mặc định này mạnh:
  · một hệ thống để vận hành, backup, giám sát, onboard
  · transaction bao trọn mọi dữ liệu → không có dual-write
  · ràng buộc thực thi bất biến → lớp phòng thủ không thể quên
  · SQL: một ngôn ngữ truy vấn cho mọi câu hỏi chưa dự đoán được
```

Điểm cuối đáng chú ý: bạn không biết trước sẽ cần trả lời câu hỏi nào. SQL cho phép trả lời câu hỏi mới **mà không cần đổi cách lưu trữ**.

### Bảng chọn theo mô hình truy cập

```text
QUAN HỆ (SQL)             quan hệ · transaction · truy vấn tuỳ ý · ràng buộc
  PostgreSQL, MySQL       → mặc định cho dữ liệu nghiệp vụ

KEY-VALUE                 tra theo khoá, độ trễ rất thấp, TTL
  Redis, DynamoDB         → cache, session, rate limit, khoá, hàng đợi nhẹ

DOCUMENT                  document lồng nhau, đọc/ghi theo cả document
  MongoDB                 → khi document là đơn vị truy cập tự nhiên
                            và không cần join

CỘT RỘNG                  ghi rất nhiều, truy vấn theo partition key
  Cassandra, ScyllaDB     → time-series quy mô lớn, ghi > đọc, chấp nhận eventual

TÌM KIẾM                  tìm toàn văn, xếp hạng, facet, gợi ý
  Elasticsearch, OpenSearch, Meilisearch
                          → khi tìm kiếm là tính năng, không phải LIKE '%x%'

TIME-SERIES               chuỗi thời gian, tổng hợp theo cửa sổ, downsampling
  TimescaleDB, ClickHouse, Prometheus
                          → metric, telemetry, sự kiện IoT

PHÂN TÍCH (OLAP)          quét hàng tỉ dòng, tổng hợp, lưu theo cột
  ClickHouse, BigQuery, Snowflake
                          → báo cáo, dashboard, data warehouse

ĐỒ THỊ                    duyệt quan hệ nhiều bậc
  Neo4j                   → mạng xã hội sâu, phát hiện gian lận, phả hệ

BLOB                      file lớn, không truy vấn nội dung
  S3 và tương đương       → ảnh, video, backup, tài liệu
```

### Bốn dấu hiệu thật sự cần kho chuyên biệt

```text
① TÌM KIẾM
   `LIKE '%từ khoá%'` quét toàn bảng và không xếp hạng
   → cần: xếp hạng theo độ liên quan, gõ sai vẫn ra, facet, gợi ý
   → PostgreSQL full-text đủ cho quy mô vừa; Elasticsearch khi tìm kiếm là tính năng chính

② PHÂN TÍCH TRÊN HÀNG TRĂM TRIỆU DÒNG
   `SELECT date, sum(amount) ... GROUP BY 1` trên 500 triệu dòng
   → lưu theo hàng đọc mọi cột; lưu theo CỘT chỉ đọc cột cần
   → ClickHouse/BigQuery nhanh hơn hàng chục tới hàng trăm lần cho loại truy vấn này

③ GHI RẤT NHIỀU, ĐỌC THEO KHOÁ
   > 50.000 ghi/giây, đọc luôn theo partition key, chấp nhận eventual
   → Cassandra/ScyllaDB thiết kế cho đúng mô hình này

④ ĐỘ TRỄ DƯỚI MILI-GIÂY
   cache, session, rate limit, leaderboard
   → Redis; nhưng nhớ nó là bộ nhớ, và bộ nhớ có giới hạn và có thể mất
```

Ngoài bốn trường hợp này, câu trả lời gần như luôn là "PostgreSQL làm được".

### Mỗi kho thêm vào là một hệ thống phải vận hành

```text
Chi phí thật của một kho dữ liệu mới:
  · backup và kiểm chứng khôi phục     · nâng cấp phiên bản
  · giám sát và cảnh báo                · điều chỉnh hiệu năng
  · một mô hình nhất quán nữa để hiểu   · onboard người mới
  · MỘT NGUỒN SỰ THẬT NỮA phải đồng bộ  ← đắt nhất

Đồng bộ giữa hai kho:
  · dual-write → có thể lệch    → cần outbox hoặc CDC
  · cần đối soát định kỳ
  · cần xử lý khi một bên hỏng
```

Đây là lý do "dùng công cụ tốt nhất cho từng việc" thường là lời khuyên tệ với đội nhỏ: bốn công cụ tối ưu cộng lại thường tệ hơn một công cụ đủ tốt.

### Đồng bộ giữa hai kho: CDC hay outbox

```text
Khi dữ liệu phải tồn tại ở hai nơi (ví dụ PostgreSQL + Elasticsearch):

DUAL-WRITE     ghi cả hai trong code
               ✗ process chết giữa hai lần ghi → LỆCH VĨNH VIỄN
               ✗ không có transaction chung

OUTBOX         ghi bảng outbox trong CÙNG transaction, worker đọc và đồng bộ
               ✓ không mất; thứ tự giữ được
               ✗ thêm một worker và một bảng

CDC            đọc WAL/binlog của database, phát ra thay đổi
               ✓ không đụng code ứng dụng; bắt được cả thay đổi thủ công
               ✗ hạ tầng phức tạp hơn (Debezium + Kafka)
```

```text
Và trong mọi trường hợp: JOB ĐỐI SOÁT.
Đồng bộ sẽ lệch — câu hỏi là bạn có phát hiện được không.
```

### JSON trong database quan hệ: lựa chọn bị đánh giá thấp

```sql
-- jsonb cho phần thật sự linh hoạt, cột thường cho phần có cấu trúc
CREATE TABLE products (
  id uuid PRIMARY KEY,
  sku text NOT NULL UNIQUE,              -- có cấu trúc → cột, có ràng buộc
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  attributes jsonb NOT NULL DEFAULT '{}' -- linh hoạt theo loại sản phẩm
);

CREATE INDEX ON products USING gin (attributes);        -- truy vấn trong jsonb
CREATE INDEX ON products ((attributes->>'brand'));      -- index cho một khoá cụ thể
```

```text
Bạn có: transaction, ràng buộc, join cho phần có cấu trúc
       + linh hoạt cho phần thật sự thay đổi
       + một hệ thống để vận hành

⇒ "cần schema linh hoạt" hiếm khi là lý do đủ để rời khỏi database quan hệ.
```

### Đọc kỹ tuyên bố về hiệu năng

```text
"X nhanh hơn Y 10 lần" luôn kèm điều kiện ngầm:

  · mô hình truy cập nào?     ghi theo khoá khác hoàn toàn join phức tạp
  · mức nhất quán nào?        eventual read nhanh hơn strong read
  · độ bền nào?               ghi vào bộ nhớ nhanh hơn ghi có fsync
  · kích thước dữ liệu?       kết quả ở 1 GB khác ở 1 TB

Benchmark của nhà cung cấp được thiết kế cho điểm mạnh của họ.
Benchmark duy nhất có nghĩa: DỮ LIỆU CỦA BẠN, TRUY VẤN CỦA BẠN.
```

### Khoá nhà cung cấp và đường thoát

```text
Trước khi chọn dịch vụ quản lý, hỏi:
  · xuất dữ liệu ra được không, mất bao lâu?
  · có bản mã nguồn mở tương thích không?
  · truy vấn có dùng cú pháp riêng của họ không?
  · chi phí ở quy mô gấp 10 là bao nhiêu?

Khoá không tự nó xấu — khoá KHÔNG NHÌN THẤY mới xấu.
Chọn có ý thức, và biết chi phí thoát ra.
```

## Example

Một hệ thống thương mại điện tử — quyết định từng phần dữ liệu:

```text
DỮ LIỆU              MÔ HÌNH TRUY CẬP                      KHO           LÝ DO
──────────────────────────────────────────────────────────────────────────────────
đơn hàng, sản phẩm   quan hệ, transaction, ràng buộc       PostgreSQL    mặc định
người dùng, quyền    quan hệ, nhất quán mạnh               PostgreSQL    cùng transaction
thuộc tính sản phẩm  linh hoạt theo danh mục               PG jsonb      không cần kho mới
session, rate limit  tra theo khoá, TTL, dưới ms           Redis         PG không hợp
cache                tra theo khoá, TTL                    Redis         cùng lý do
tìm kiếm sản phẩm    toàn văn, xếp hạng, facet, gõ sai      Elasticsearch tính năng chính
ảnh sản phẩm         blob, phục vụ qua CDN                 S3            không phải việc của DB
log truy cập         ghi rất nhiều, tổng hợp, giữ 30 ngày  ClickHouse    PG không kham nổi
báo cáo doanh thu    quét hàng trăm triệu dòng             ClickHouse    dùng lại kho trên
sự kiện nghiệp vụ    append-only, phát lại được            PG partition  đủ ở quy mô này
```

```text
Kết quả: 4 hệ thống (PostgreSQL, Redis, Elasticsearch, ClickHouse) + S3.

Mỗi cái có LÝ DO CỤ THỂ, không phải "công cụ tốt nhất cho việc đó".
Với đội nhỏ hơn, Elasticsearch và ClickHouse đều thay được bằng PostgreSQL
(full-text + partition) cho tới khi có bằng chứng cần thay.
```

Và cơ chế đồng bộ PostgreSQL → Elasticsearch:

```ts
// ✗ dual-write: process chết giữa hai lần ghi → lệch vĩnh viễn
async updateProduct(id: string, dto: UpdateProductDto) {
  const product = await this.db.product.update({ where: { id }, data: dto });
  await this.elastic.index({ index: 'products', id, document: product });  // có thể không chạy
  return product;
}
```

```ts
// ✓ outbox: một transaction, không mất
async updateProduct(id: string, dto: UpdateProductDto) {
  return this.db.$transaction(async (tx) => {
    const product = await tx.product.update({ where: { id }, data: dto });
    await tx.outbox.create({
      data: { topic: 'product.updated', entityId: id, payload: product },
    });
    return product;
  });
}

// worker riêng: đọc outbox, đẩy sang Elasticsearch, đánh dấu đã xử lý
@Cron('*/5 * * * * *')
async drainOutbox() {
  const events = await this.db.$queryRaw<OutboxEvent[]>`
    SELECT * FROM outbox WHERE processed_at IS NULL
     ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100`;

  for (const e of events) {
    await this.elastic.index({ index: 'products', id: e.entityId, document: e.payload });
    await this.db.outbox.update({ where: { id: e.id }, data: { processedAt: new Date() } });
  }
}
```

```ts
// và đối soát — vì đồng bộ SẼ lệch
@Cron('0 4 * * *')
async reconcileSearchIndex() {
  const pgCount = await this.db.product.count({ where: { deletedAt: null } });
  const esCount = (await this.elastic.count({ index: 'products' })).count;

  if (Math.abs(pgCount - esCount) > pgCount * 0.001) {
    searchIndexDrift.set(Math.abs(pgCount - esCount));
    this.logger.error({ pgCount, esCount }, 'chỉ mục tìm kiếm lệch — cần reindex');
  }
}
```

Job đối soát này là phần biến kiến trúc nhiều kho từ "hy vọng nó đồng bộ" thành "biết khi nào nó không".

## Prediction

1. Chọn document store vì "schema linh hoạt" — schema biến mất hay chuyển đi đâu?
2. Bảy loại document, năm phiên bản schema cùng tồn tại — ai xử lý sự khác biệt?
3. `LIKE '%từ khoá%'` trên bảng 5 triệu dòng — nó dùng index nào?
4. `SELECT date, sum(amount) GROUP BY 1` trên 500 triệu dòng, lưu theo hàng — đọc bao nhiêu cột?
5. Cùng truy vấn với kho lưu theo cột — đọc bao nhiêu?
6. Thêm một kho dữ liệu mới — bao nhiêu việc vận hành thêm?
7. Dual-write vào PostgreSQL và Elasticsearch, process chết giữa hai lần — hậu quả?
8. Dùng outbox — hậu quả?
9. Không có job đối soát, chỉ mục lệch dần — bao giờ ai biết?
10. `jsonb` với GIN index trong PostgreSQL — truy vấn trong JSON được không?
11. Đội 4 người vận hành 5 kho dữ liệu — ràng buộc nào chặt nhất?
12. Benchmark của nhà cung cấp cho thấy nhanh gấp 10 — điều kiện ngầm nào?
13. Redis làm nguồn sự thật duy nhất cho dữ liệu nghiệp vụ — rủi ro gì?
14. Chọn dịch vụ quản lý có cú pháp truy vấn riêng — chi phí thoát ra?

<details>
<summary>Đáp án</summary>

1. Nó **chuyển vào code**, nơi không có gì thực thi nó.
2. **Mọi truy vấn** phải xử lý mọi biến thể — mãi mãi.
3. **Không index nào** — quét toàn bảng.
4. **Mọi cột** của mọi dòng được đọc.
5. **Hai cột** — nhanh hơn hàng chục tới hàng trăm lần.
6. Backup, khôi phục, nâng cấp, giám sát, tuning, onboard, **và đồng bộ**.
7. **Lệch vĩnh viễn** — không có gì phát hiện.
8. Event nằm trong transaction → **không mất**, worker xử lý sau.
9. **Không ai** — cho tới khi người dùng báo tìm không ra sản phẩm.
10. **Được** — GIN index hỗ trợ truy vấn trong jsonb.
11. **Năng lực vận hành** — chặt hơn mọi giới hạn kỹ thuật.
12. Mô hình truy cập, mức nhất quán, độ bền, kích thước dữ liệu.
13. Redis là **bộ nhớ**: giới hạn dung lượng, và có thể mất dữ liệu khi mất node.
14. Viết lại mọi truy vấn — thường là dự án hàng tháng.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Liệt kê mọi kho dữ liệu và lý do chọn từng cái | Cái nào không có lý do cụ thể? |
| Hỏi "PostgreSQL có làm được việc này không" cho từng kho | Bao nhiêu cái bỏ được? |
| Đếm số người trong đội hiểu sâu mỗi kho | Có kho nào chỉ một người biết? |
| Thử khôi phục backup của mỗi kho | Có làm được không? Mất bao lâu? |
| Tìm chỗ dual-write | Có bao nhiêu? |
| So số bản ghi giữa hai kho | Có lệch không? |
| Chạy truy vấn tổng hợp trên bảng lớn nhất | Bao lâu? |
| `LIKE '%x%'` trên bảng lớn và xem EXPLAIN | Seq scan? |
| Thử full-text search của PostgreSQL cho cùng nhu cầu | Có đủ không? |
| Ước tính chi phí thoát khỏi dịch vụ quản lý | Bao lâu, bao nhiêu tiền? |

## What Usually Goes Wrong

- **Chọn theo xu hướng** thay vì theo mô hình truy cập.
- **"Schema linh hoạt"** làm lý do → schema chuyển vào code, không ai thực thi.
- **Thêm kho chuyên biệt quá sớm**, trước khi database quan hệ chạm giới hạn.
- **Không tính chi phí vận hành** của kho mới.
- **Dual-write** thay vì outbox/CDC.
- **Không có job đối soát** → lệch âm thầm.
- **Redis làm nguồn sự thật** cho dữ liệu không được mất.
- **Dùng database quan hệ cho tìm kiếm toàn văn quy mô lớn** (hoặc ngược lại).
- **Chạy truy vấn phân tích trên database giao dịch** → làm chậm cả hệ thống.
- **Tin benchmark của nhà cung cấp.**
- **Chọn kho mà chỉ một người trong đội hiểu.**
- **Không kiểm chứng khôi phục backup** cho kho phụ.
- **Khoá nhà cung cấp không nhìn thấy** — phát hiện khi muốn đổi.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| NoSQL mở rộng tốt hơn SQL | Phụ thuộc mô hình truy cập; PostgreSQL đi rất xa |
| Schema linh hoạt = phát triển nhanh hơn | Nó nhanh hơn ở tháng đầu, chậm hơn từ tháng sáu |
| Dùng công cụ tốt nhất cho từng việc | Với đội nhỏ, một công cụ đủ tốt thắng |
| Document store không cần schema | Nó có schema, chỉ là không được thực thi |
| PostgreSQL không làm được JSON | `jsonb` + GIN index rất mạnh |
| Cần Elasticsearch để tìm kiếm | PostgreSQL full-text đủ cho quy mô vừa |
| Cần Kafka để có event | Bảng outbox + worker đủ cho hầu hết trường hợp |
| Redis là database | Nó là kho trong bộ nhớ, có giới hạn và có thể mất |
| Nhiều kho = kiến trúc hiện đại | Nhiều kho = nhiều nguồn sự thật phải đồng bộ |
| Dịch vụ quản lý loại bỏ vận hành | Nó giảm, không loại bỏ — và thêm khoá |

## Debugging

1. **Trước khi thêm kho mới**: viết ra truy vấn cụ thể mà kho hiện tại không đáp ứng, kèm số đo.
2. **Thử giải pháp trong database hiện tại trước** — index, partition, materialized view, full-text.
3. **Truy vấn phân tích làm chậm hệ thống** → tách sang replica hoặc kho OLAP, không tối ưu mãi trên OLTP.
4. **Dữ liệu lệch giữa hai kho** → tìm dual-write; kiểm tra outbox có worker chạy không.
5. **Chỉ mục tìm kiếm thiếu dữ liệu** → so số bản ghi, kiểm tra outbox tồn đọng, xem log worker.
6. **Kho phụ chậm** → nó có được thiết kế cho mô hình truy cập này không? Có đang dùng sai công cụ không?
7. **Không ai biết vận hành kho X** → đó là rủi ro cao hơn mọi vấn đề hiệu năng.
8. **Chi phí tăng bất thường** → kho nào? Có phải đang lưu thứ nên ở S3 không?

## Production Considerations

- **Mặc định PostgreSQL** cho dữ liệu nghiệp vụ; thêm kho khác khi có bằng chứng.
- **Viết ra lý do cụ thể** (ADR) cho mỗi kho, kèm điều kiện bỏ đi.
- **`jsonb` cho phần thật sự linh hoạt**, cột có ràng buộc cho phần có cấu trúc.
- **Outbox hoặc CDC** cho mọi đồng bộ giữa các kho; không dual-write.
- **Job đối soát** cho mọi cặp kho đồng bộ, có alert khi lệch.
- **Nguồn sự thật rõ ràng** cho mỗi loại dữ liệu — viết vào tài liệu.
- **Kiểm chứng khôi phục backup** cho **mọi** kho, không chỉ database chính.
- **Ít nhất hai người hiểu sâu** mỗi kho được đưa vào.
- **Tách tải phân tích khỏi OLTP** — replica hoặc kho riêng.
- **Blob ở object storage**, không ở database.
- **Benchmark trên dữ liệu và truy vấn của bạn**, không tin số của nhà cung cấp.
- **Biết chi phí thoát** trước khi chọn dịch vụ quản lý.
- **Xem lại danh sách kho hằng năm** — có cái nào bỏ được không?

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Một database quan hệ | đơn giản, transaction, ràng buộc | không tối ưu cho mọi mô hình |
| Nhiều kho chuyên biệt | mỗi việc dùng công cụ hợp | vận hành nhân lên, phải đồng bộ |
| jsonb trong PG | linh hoạt + transaction | truy vấn phức tạp hơn cột thường |
| Document store | mô hình khớp với document | mất join, mất ràng buộc |
| Kho lưu theo cột | phân tích rất nhanh | không hợp cho OLTP |
| Redis | độ trễ rất thấp | trong bộ nhớ, có thể mất, giới hạn dung lượng |
| Elasticsearch | tìm kiếm mạnh | một nguồn sự thật nữa, vận hành nặng |
| Dịch vụ quản lý | ít vận hành | chi phí, khoá nhà cung cấp |
| Tự vận hành | kiểm soát, rẻ hơn | tốn người, rủi ro |
| Outbox | không mất dữ liệu | thêm bảng và worker |
| CDC | không đụng code ứng dụng | hạ tầng phức tạp |

## Explain Without Notes

1. Năm câu hỏi trước khi chọn kho dữ liệu, và câu nào hay bị bỏ nhất?
2. Vì sao database quan hệ là mặc định đúng? Bốn lý do.
3. Bốn dấu hiệu thật sự cần kho chuyên biệt?
4. "Schema linh hoạt" thực sự làm gì với schema?
5. Chi phí thật của việc thêm một kho dữ liệu — sáu mục.
6. Dual-write, outbox, CDC khác nhau thế nào?
7. Vì sao job đối soát là bắt buộc khi có nhiều kho?
8. Bốn điều kiện ngầm sau mỗi tuyên bố "nhanh hơn 10 lần"?

## Related

- [Requirements & trade-offs](01-requirements-tradeoffs.md) — yêu cầu quyết định lựa chọn
- [Data partitioning & sharding](05-data-partitioning-sharding.md) — khi một kho không đủ
- [Scaling: cache & queue](02-scaling-cache-queue.md) — Redis đúng chỗ
- [Consistency & availability](04-consistency-availability.md) — mô hình nhất quán của mỗi kho
- [Event-driven](07-event-driven.md) — CDC và event làm cầu nối
- [Normalization](../03-database/03-data-modeling/02-normalization.md) — mô hình hoá quan hệ
- [Index types](../03-database/01-postgresql/indexes-query-planning/02-index-types.md) — GIN, GiST, BRIN cho jsonb và time-series
- [Outbox pattern](../03-database/04-message-queues/06-outbox-pattern.md) — chống dual-write
- [Cache patterns](../03-database/02-redis/03-cache-patterns.md) — Redis đúng vai trò
- [Persistence & failure](../03-database/02-redis/05-persistence-failure.md) — vì sao Redis không phải nguồn sự thật

## Version / Context

Ví dụ dùng PostgreSQL 16 (`jsonb`, GIN, full-text `tsvector`, declarative partitioning, `FOR UPDATE SKIP LOCKED`), Redis 7, Elasticsearch 8, ClickHouse. `pgvector` cho tìm kiếm vector; PostGIS cho dữ liệu địa lý; TimescaleDB cho time-series — cả ba là extension của PostgreSQL, cho phép mở rộng khả năng mà không thêm hệ thống mới. Debezium cho CDC.
