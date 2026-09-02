# ADR-0004: Drizzle ORM và Drizzle Kit cho data access

- Status: Accepted
- Date: 2026-09-02
- Related docs: [backend conventions](../engineering/backend-conventions.md), [database design](../data/database-design.md), [query and index policy](../data/query-and-index-policy.md), [local development](../operations/local-development.md) (migration là artifact versioned, không `schema push`)

## Context

`decisions/README.md` liệt kê lựa chọn ORM là quyết định bắt buộc có ADR; stack đã chốt Drizzle ở backend conventions nhưng chưa có bản ghi lý do. Data contract của Flowboard đặc biệt "SQL-explicit" so với một CRUD app thông thường, và chính các đặc điểm đó quyết định trục so sánh:

- **Composite foreign key** dùng dày đặc: `(project_id, column_id) → board_columns(project_id, id)`, `(project_id, assignee_id) → project_members(project_id, user_id)`, `(project_id, task_id) → tasks(project_id, id)` — same-project được bảo vệ ngay tại database.
- **Advisory transaction lock** cho invariant cross-row (tổng 1.440 phút/ngày của WorkLog) — là câu SQL `pg_advisory_xact_lock` tường minh.
- **Expression index** GIN full-text trên `title || ' ' || description` — không biểu diễn được trong schema DSL của mọi ORM.
- **Explain-plan verification rule**: mọi query policy phải đo được bằng `EXPLAIN (ANALYZE, BUFFERS)` — SQL sinh ra phải đọc được và dự đoán được.
- **Migration là artifact SQL versioned, được review**, không auto-sync (`local-development.md`).
- Constraint đặc thù: `numeric(20,10)` cho fractional ordering, unique DEFERRABLE cho rebalance (ADR-0006).

Một điểm phải nói rõ: kho kiến thức của repository này (`03-database/05-data-access/`) dạy **Prisma** làm mặc định cho data access. Project này cố ý chọn khác, và người học đọc cả hai cần câu trả lời.

## Decision

`apps/api` dùng **Drizzle ORM** cho schema/query và **Drizzle Kit** cho migration. Migration là SQL artifact versioned được review cùng thay đổi schema/invariant; không `schema push`, không auto-sync khi boot. Use case không import raw table; mọi truy cập đi qua repository port theo backend conventions.

Vì sao lệch với mặc định Prisma của kho kiến thức: Prisma là mặc định tốt cho product CRUD điển hình — schema DSL, client an toàn, quy ước mạnh. Flowboard chọn Drizzle vì (1) data contract ở trên được viết **bằng SQL semantics** — composite FK tùy biến, advisory lock, expression index, DEFERRABLE constraint, numeric precision — và với Drizzle chúng nằm thẳng trong schema TS/migration SQL thay vì trở thành chuỗi escape hatch (`Unsupported`, raw SQL trong migration bị drift-check kêu ca); (2) đây là **lab học behavior**: SQL nhìn thấy được, map 1:1 với `EXPLAIN`, không có query engine trung gian tự quyết định join strategy; (3) repository port hẹp của backend conventions khớp với query builder mỏng hơn là model-centric client. Hai tài liệu không mâu thuẫn: kho kiến thức dạy mặc định cho số đông; ADR này ghi lý do một project cụ thể rời mặc định đó.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| Drizzle ORM + Drizzle Kit (chọn) | Schema TS mirror SQL; migration là SQL thuần review được; composite FK/expression index/advisory lock/DEFERRABLE biểu diễn trực tiếp; `sql` operator có kiểm soát; SQL output dự đoán được cho EXPLAIN. | Ecosystem trẻ hơn Prisma; ít "guard rail" hơn (không auto relation loading) — đội phải viết query tường minh, đúng với chủ đích của lab. |
| Prisma | DX tốt, client type-safe, tài liệu dày, đúng mặc định của kho kiến thức. | Expression/partial index và DEFERRABLE không biểu diễn trong schema DSL — phải sửa tay migration và sống chung với drift; advisory lock/`EXPLAIN` đi qua `$queryRaw`; query engine sinh SQL kém dự đoán hơn cho explain-plan rule; model API khuyến khích truy cập theo model thay vì use-case port. Khối lượng escape hatch với schema này đủ lớn để mặc định mất giá trị. |
| Kysely (query builder thuần) | Type-safe SQL gần Drizzle, kiểm soát tối đa câu query. | Không có schema/migration toolkit chính chủ — phải ghép codegen + migrator riêng; nhiều lắp ráp hơn cho cùng kết quả mà Drizzle Kit đã có. |
| Raw SQL + node-postgres | Kiểm soát tuyệt đối, không phụ thuộc. | Không type safety, boilerplate lớn cho 16+ bảng, mapping tay dễ sai; chi phí không tương xứng khi Drizzle vẫn cho viết raw SQL chỗ cần. |

## Consequences

- Được: schema/migration/query đọc như SQL của chính database design; mọi cơ chế đặc thù của contract (composite FK, advisory lock, GIN expression index, DEFERRABLE) không cần vòng tránh.
- Chi phí: người vào project từ kho kiến thức Prisma phải học API Drizzle; bù lại các khái niệm (relation, N+1, transaction, migration) chuyển thẳng được.
- Ràng buộc giữ nguyên: Zod vẫn là boundary parser; repository vẫn nhận scope context, không nhận bare ID; không generic table API.
- Tài liệu: backend conventions và local development đã phản ánh quyết định này; không cần sửa thêm.

## Revisit When

- Drizzle có breaking change lớn hoặc ngừng bảo trì làm chi phí nâng cấp vượt chi phí chuyển.
- Schema tiến hóa tới mức cần các tính năng Prisma-only thực sự (không phải DX preference) và số escape hatch của Drizzle vượt số của Prisma.
- Đổi database engine khỏi PostgreSQL (không có kế hoạch; sẽ là ADR riêng lớn hơn).
