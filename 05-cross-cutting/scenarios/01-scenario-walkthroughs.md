---
level: intermediate
area: cross-cutting
prerequisites:
  - ../performance/07-full-stack-triage.md
related:
  - ../../00-roadmap/application-engineering-map.md
---

# Scenario walkthroughs

> Năm tình huống thật. Đây là **bài tập**, không phải note khái niệm — mục đích là buộc bạn nối kiến thức từ nhiều tầng lại với nhau.

Cách dùng: đọc scenario, **tự trả lời trước** khi mở phần phân tích. Nếu câu trả lời của bạn khác, đó là chỗ mental model đang lệch — và đó là thứ đáng ghi vào [learning log](../../08-learning-log/README.md).

---

## Scenario A — Dashboard gọi 8 API

```text
Màn hình dashboard cần: user, permissions, statistics, recent orders,
notifications, activity feed, billing status, team members.
Trên mobile 4G (RTT ~150ms), người dùng chờ 3,5 giây thấy trang trắng.
```

**Tự trả lời trước:**

1. Request nào chạy song song, request nào buộc tuần tự?
2. Một API fail có nên làm cả trang fail?
3. Cache ở đâu — client, BFF, hay Redis?
4. Có cần BFF không? Dựa vào con số nào?
5. Người dùng thấy gì trong 3,5 giây đó?

<details>
<summary>Phân tích</summary>

**Bước 1 — vẽ dependency graph.** Không làm bước này thì mọi tối ưu là đoán.

```text
user ──┬─→ permissions(user.orgId)     phụ thuộc
       ├─→ billing(user.orgId)          phụ thuộc
       └─→ team(user.orgId)             phụ thuộc
orders, notifications, activity, stats  độc lập
```

Hai tầng → thời gian tối thiểu = 2 × 150ms = 300ms, **không phải** 8 × 150ms.
3,5 giây nghĩa là đang gọi gần như tuần tự. Đây là nguyên nhân chính.

**Bước 2 — phân loại criticality.** Đây là quyết định *sản phẩm*; không quyết định nghĩa là mặc định "tất cả critical".

```text
critical   user, permissions      → không có thì không render được gì
important  orders, stats          → nội dung chính
optional   notifications, activity, billing, team → ẩn hoặc placeholder
```

**Bước 3 — boundary theo vùng.** Loading gộp làm người dùng chờ cái chậm nhất; error gộp làm một widget lỗi mất cả trang.

**Bước 4 — BFF?** Đo trước:

```text
round-trip tuần tự × RTT = 2 × 150 = 300ms  → chưa phải nút thắt lớn
over-fetching: 8 × 80KB = 640KB, UI dùng 40KB → 16×  → ĐÂY là vấn đề
```

Kết luận: BFF đáng làm, nhưng lý do là **payload**, không phải round-trip. Nếu chỉ sửa round-trip (song song hoá) mà giữ payload, mobile vẫn tải 640KB.

**Bước 5 — UX:** shell + skeleton ngay; mỗi widget hiện khi xong; `degraded[]` để phân biệt "rỗng" và "lỗi".

**Note:** [Một màn hình nhiều API](../../01-web-frontend/04-application-engineering/01-multi-api-screen.md) · [BFF & aggregation](../../02-backend-api/04-architecture/09-bff-and-aggregation.md) · [Frontend resilience](../../01-web-frontend/04-application-engineering/04-frontend-resilience.md)
</details>

---

## Scenario B — API mất 5 giây

```text
GET /api/reports/monthly → 5.200ms.
Người dùng gọi nó ~200 lần/ngày. Không ai phàn nàn về độ chính xác,
nhưng ai cũng phàn nàn về tốc độ.
```

**Tự trả lời trước:**

1. Đo gì đầu tiên?
2. Nếu nút thắt là một aggregate query trên 50 triệu dòng — tối ưu thế nào?
3. UX trong lúc chờ?
4. Có nên thành background job?
5. Câu hỏi **nghiệp vụ** nào nên hỏi trước câu hỏi kỹ thuật?

<details>
<summary>Phân tích</summary>

**Câu 5 là câu quan trọng nhất, và hay bị bỏ:**

> **"Báo cáo này cũ 5 phút có được không?"**

Nếu được — và với báo cáo tháng thì gần như luôn được — thì **precompute** giải quyết toàn bộ vấn đề:

```text
Job mỗi 5 phút → ghi vào bảng report_monthly_summary
API đọc bảng đó → 5.200ms → 3ms
```

Không cần tối ưu query, không cần index mới, không cần đổi UX. Đây là lý do câu hỏi nghiệp vụ đi trước câu hỏi kỹ thuật.

**Nếu buộc phải luôn mới**, đo theo thứ tự:

```text
1. Server-Timing → thời gian ở đâu?
2. Đếm query → N+1?
3. EXPLAIN ANALYZE → seq scan? sort on disk?
4. Index / materialized view / pre-aggregate
```

**UX** (làm song song, không chờ tối ưu xong):

```text
Actual:    precompute → 3ms
Perceived: stale-while-revalidate → lần 2 cảm giác 0ms
           streaming → shell hiện ngay
           skeleton khớp hình dạng → không CLS
```

**Background job?** Với 5 giây thì precompute tốt hơn. Job phù hợp khi > 10 giây, hoặc khi người dùng chủ động yêu cầu export.

**Chốt:** thứ tự đúng là **hỏi nghiệp vụ → precompute → đo → tối ưu → UX**, không phải nhảy vào `EXPLAIN` ngay.

**Note:** [Slow API UX](../../01-web-frontend/04-application-engineering/03-slow-api-ux.md) · [Full-stack triage](../performance/07-full-stack-triage.md) · [Vì sao cần queue](../../03-database/04-message-queues/01-why-queue.md)
</details>

---

## Scenario C — List 5 triệu bản ghi

```text
GET /api/transactions?page=1     → 120ms
GET /api/transactions?page=5000  → 8.400ms
UI cần: filter theo status + khoảng ngày, sort theo ngày, hiện tổng số kết quả.
```

**Tự trả lời trước:**

1. Vì sao trang 5000 chậm hơn trang 1?
2. Cursor pagination giải quyết được gì, và **không** giải quyết được gì?
3. Index nào?
4. `COUNT(*)` xử lý thế nào?
5. Có nên cache?

<details>
<summary>Phân tích</summary>

Repo đã có đáp án đầy đủ ở [Pagination, filtering, sorting](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — đây chỉ là cách áp dụng, **không lặp lại lý thuyết**.

**Câu 1:** `OFFSET 100000` đọc và loại bỏ 100.000 dòng. Thời gian tăng tuyến tính theo offset.

**Câu 2 — điểm dễ nhầm:** cursor pagination làm mọi trang nhanh **đều**, và ổn định khi dữ liệu đổi. Nhưng nó **không** cho phép nhảy tới trang N, và **không** cho tổng số trang. Nếu UI yêu cầu "trang 5000", cursor không đáp ứng — phải đổi UI (infinite scroll) hoặc chấp nhận OFFSET chậm.

Đây là chỗ ràng buộc kỹ thuật nên đổi thiết kế UI, không phải ngược lại.

**Câu 3 — index phải khớp cả filter, sort, và chiều:**

```sql
CREATE INDEX idx_tx_status_created
  ON transactions (status, created_at DESC, id DESC);
```

Và `ORDER BY created_at DESC, id DESC` — tie-breaker `id` là bắt buộc, nếu không cursor vẫn lặp/bỏ item.

**Câu 4 — `COUNT(*)`:** trên 5 triệu dòng nó đắt hơn cả query lấy dữ liệu. Ba lựa chọn: không trả total (dùng `hasMore`), trả gần đúng (`pg_class.reltuples`), hoặc trả chính xác chỉ khi filter đã thu hẹp mạnh.

**Câu 5 — cache:** dữ liệu giao dịch thay đổi liên tục và mỗi người dùng thấy tập khác nhau → cache hiệu quả thấp. Nếu cache, cache theo `(userId, filter, cursor)` với TTL ngắn, và cẩn thận: cache dữ liệu per-user ở lớp dùng chung là lỗ hổng bảo mật.

**Note:** [Pagination](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) · [Index types](../../03-database/01-postgresql/indexes-query-planning/02-index-types.md) · [Prisma relations & N+1](../../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md)
</details>

---

## Scenario D — NestJS service có 15 dependency

```text
OrdersService: 2.400 dòng, 15 dependency injected, 21 method.
Mỗi PR trong 3 tháng qua đều sửa file này.
Test cần mock 15 thứ và mất 40 giây.
```

**Tự trả lời trước:**

1. 15 dependency nói lên điều gì? Có phải luôn là vi phạm SRP?
2. Chẩn đoán trước khi tách — làm thế nào?
3. Bước sửa nào rẻ nhất và hiệu quả nhất?
4. Tách theo method có ổn không?
5. Khi nào **không** nên tách?

<details>
<summary>Phân tích</summary>

**Câu 1 — 15 dependency là triệu chứng của bốn bệnh khác nhau**, và mỗi bệnh cần một cách sửa khác. Tách bừa là chuyển vấn đề sang chỗ khác.

**Câu 2 — chẩn đoán bằng cách phân loại từng dependency:**

```text
prisma, inventory, pricing, tax, coupon    → quy tắc nghiệp vụ, ĐỒNG BỘ  (5)
mailer, slack, analytics, audit, pdf, s3   → side effect, ASYNC được    (6)
stripe, shipping                            → gateway ngoài              (2)
redis, queue                                → hạ tầng                    (2)
```

6/15 là side effect. Câu hỏi phân loại: **"nếu việc này thất bại, hành động chính có nên rollback không?"** Gửi email thất bại không nên rollback order.

**Câu 3 — bước rẻ nhất: event cho side effect.**

```text
6 side effect + redis → event listener  →  15 dependency còn 8
```

Không tách một service nghiệp vụ nào. Đây là lý do nó phải làm trước.

**Câu 4 — tách theo method là sai.** `OrderCreationService` sẽ cần gọi `OrderRefundService` → circular dependency → `forwardRef` → cấu trúc khó hiểu hơn ban đầu.

Tách theo **nghiệp vụ** và **lý do thay đổi**:

```text
createOrder/cancelOrder/refundOrder  → cùng lifecycle order → GIỮ chung
generateInvoice/exportOrders          → nghiệp vụ báo cáo    → TÁCH
```

**Câu 5 — không tách khi:** service làm đúng một nghiệp vụ (dù 400 dòng), hoặc nó là orchestration service (nhiều dependency là đúng vai), hoặc tách gây circular dependency.

**Bằng chứng khách quan** cho "mọi PR đều sửa file này":

```bash
git log --format= --name-only --since="3 months ago" | sort | uniq -c | sort -rn | head
```

File đầu danh sách có quá nhiều lý do thay đổi — đó là SRP violation *thật*, không phải suy đoán.

**Kết quả:** 15 → 4 dependency, tách **một** service, không circular dependency. Quy tắc nghiệp vụ thành hàm thuần → test không cần mock, chạy 0ms thay vì 40 giây.

**Note:** [Service decomposition](../../02-backend-api/04-architecture/08-service-decomposition.md) · [SOLID trong thực tế](../../02-backend-api/04-architecture/06-solid-in-practice.md) · [Clean architecture pragmatic](../../02-backend-api/04-architecture/07-clean-architecture-pragmatic.md)
</details>

---

## Scenario E — Prisma query chậm

```text
GET /api/projects/:id/tasks → 4.800ms với 200 task.
Với 20 task: 380ms. Với 500 task: 12.000ms.
Code: prisma.task.findMany({ where: { projectId }, include: { assignee: true, comments: true } })
```

**Tự trả lời trước:**

1. Thời gian tăng tuyến tính theo số dòng — nói lên điều gì?
2. `include` có gây N+1 không?
3. Đo gì để xác nhận?
4. Index nào cần?
5. Khi nào nên bỏ Prisma và dùng raw SQL?

<details>
<summary>Phân tích</summary>

**Câu 1:** tăng tuyến tính theo số **dòng** (không theo kích thước dữ liệu) là dấu hiệu của N+1 hoặc thiếu index. Cần đo để phân biệt.

**Câu 2 — điểm dễ nhầm:** `include` **không** gây N+1. Prisma tự batch:

```sql
SELECT * FROM tasks WHERE project_id = $1;
SELECT * FROM users WHERE id IN ($1, ..., $n);      -- MỘT query
SELECT * FROM comments WHERE task_id IN ($1, ..., $n); -- MỘT query
```

3 query, không phải 401. Nên nếu chậm, nguyên nhân **không** phải N+1 ở đây.

**Câu 3 — đo:**

```ts
let n = 0;
prisma.$on('query', (e) => { n++; console.log(e.query, e.duration); });
```

Hai khả năng:

```text
n = 3, một query mất 4.500ms   → THIẾU INDEX hoặc payload lớn
n = 401                         → có vòng lặp await ở đâu đó trong code
```

Với `include` như trên, gần như chắc là trường hợp đầu.

**Câu 4 — index:**

```sql
CREATE INDEX ON tasks (project_id, created_at DESC);   -- cho query chính
CREATE INDEX ON comments (task_id);                     -- cho include comments
```

Chú ý: **PostgreSQL không tự tạo index cho khoá ngoại.** `comments.task_id` cần index thủ công — và đây là nguyên nhân rất phổ biến khi `include` chậm.

**Nguyên nhân thứ hai có thể:** `include: { comments: true }` lấy **toàn bộ** comment của 200 task. Nếu mỗi task có 50 comment với `body TEXT`, đó là 10.000 dòng và nhiều MB. Sửa bằng `select` chỉ field cần, hoặc `take` giới hạn số comment, hoặc chỉ trả `_count`:

```ts
prisma.task.findMany({
  where: { projectId },
  select: {
    id: true, title: true, status: true,
    assignee: { select: { id: true, name: true } },
    _count: { select: { comments: true } },        // chỉ đếm, không tải
  },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: 50,
});
```

**Câu 5 — raw SQL khi:** cần window function, recursive CTE, `DISTINCT ON`, `FOR UPDATE`, bulk operation, hoặc cần kiểm soát chính xác query plan. Với trường hợp này thì **không cần** — `select` + index đủ.

**Chốt:** chẩn đoán là "over-fetching + thiếu index trên khoá ngoại", **không** phải N+1. Đây là lý do phải đếm query trước khi kết luận.

**Note:** [Prisma relations & N+1](../../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md) · [Raw SQL escape hatches](../../03-database/05-data-access/06-raw-sql-escape-hatches.md) · [EXPLAIN ANALYZE workflow](../../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md)
</details>

---

## Điểm chung của cả năm

Nếu chỉ rút ra một điều từ note này:

```text
1. ĐO TRƯỚC KHI SỬA
   A: đo round-trip và payload  → phát hiện payload mới là vấn đề
   B: hỏi nghiệp vụ trước       → precompute thắng mọi tối ưu query
   C: biết OFFSET đọc rồi loại  → mới hiểu vì sao cursor giúp
   D: phân loại dependency      → event giải quyết 7/15
   E: đếm query                 → phát hiện KHÔNG phải N+1

2. TRIỆU CHỨNG ≠ NGUYÊN NHÂN
   "8 API chậm"        → thật ra là payload
   "query chậm"        → thật ra là dữ liệu cũ chấp nhận được
   "15 dependency"     → thật ra là side effect coupling
   "Prisma chậm"       → thật ra là thiếu index trên khoá ngoại

3. CÂU HỎI NGHIỆP VỤ ĐI TRƯỚC CÂU HỎI KỸ THUẬT
   "dữ liệu cũ 5 phút có được không?" rẻ hơn mọi tối ưu
   "widget này thiếu thì trang còn dùng được không?" quyết định kiến trúc

4. RÀNG BUỘC KỸ THUẬT CÓ THỂ ĐỔI THIẾT KẾ
   Cursor không nhảy trang được → đổi UI sang infinite scroll
   Đây là đánh đổi hợp lệ, không phải thất bại
```

## Cách dùng lại

Với mỗi vấn đề hiệu năng hoặc kiến trúc thật bạn gặp:

```text
1. Viết scenario ra (triệu chứng + số liệu)
2. Tự trả lời 5 câu hỏi TRƯỚC khi đo
3. Đo
4. So dự đoán với thực tế → ghi chỗ lệch vào learning log
5. Sửa MỘT thứ, đo lại
```

Bước 4 là bước tạo ra học tập. Xem [Learning System](../../00-roadmap/00-learning-system.md).

## Related

- **[Application Engineering Map](../../00-roadmap/application-engineering-map.md)** — tra note theo problem
- [Full-stack triage](../performance/07-full-stack-triage.md) — playbook đo lường
- [Một màn hình nhiều API](../../01-web-frontend/04-application-engineering/01-multi-api-screen.md) — Scenario A
- [Slow API UX](../../01-web-frontend/04-application-engineering/03-slow-api-ux.md) — Scenario B
- [Pagination, filtering, sorting](../../02-backend-api/00-http-api/04-pagination-filtering-sorting.md) — Scenario C
- [Service decomposition](../../02-backend-api/04-architecture/08-service-decomposition.md) — Scenario D
- [Prisma relations & N+1](../../03-database/05-data-access/03-prisma-relations-and-n-plus-1.md) — Scenario E
- [Learning System](../../00-roadmap/00-learning-system.md) — vòng PREDICT → BUILD → EXPLAIN
