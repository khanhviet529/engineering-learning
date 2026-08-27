---
level: intermediate
area: backend
prerequisites:
  - 02-rest-api-contract.md
related:
  - ../../03-database/01-postgresql/02-index-query-plan.md
  - ../../05-cross-cutting/performance/04-database-performance.md
---

# Pagination, filtering, sorting

> `OFFSET 100000` không "bỏ qua" 100.000 dòng — database vẫn phải đọc và loại bỏ từng dòng một. Đây là lý do trang cuối của một list dài luôn chậm hơn trang đầu.

## Position

```text
Client (?page=2&limit=20) → API → SQL (LIMIT/OFFSET hoặc WHERE cursor) → index
                                             ↑ note này
```

## Problem

Ba bug mà mọi API list đều có nếu không thiết kế cẩn thận:

**1. Trang cuối chậm dần theo dữ liệu.**

```sql
SELECT * FROM tasks ORDER BY created_at DESC LIMIT 20 OFFSET 100000;
-- Database đọc 100.020 dòng, trả 20. Thời gian tăng tuyến tính theo OFFSET.
```

**2. Item bị lặp hoặc bị bỏ khi dữ liệu thay đổi giữa hai trang.**

```text
t=0  Client đọc trang 1 (item 1–20)
t=1  Ai đó tạo item mới → nó vào đầu danh sách, mọi item dịch xuống 1
t=2  Client đọc trang 2 (OFFSET 20) → item 20 xuất hiện LẠI, và một item bị bỏ qua
```

**3. Sắp xếp không ổn định.**

```sql
ORDER BY created_at DESC      -- nếu 5 item cùng created_at, thứ tự giữa chúng
                              -- KHÔNG xác định và có thể khác nhau mỗi query
```

Bug 3 làm bug 2 xảy ra kể cả khi không có dữ liệu mới.

## Mental Model

Hai chiến lược, và chúng giải quyết hai bài toán khác nhau:

```text
OFFSET pagination                    CURSOR (keyset) pagination
?page=3&limit=20                     ?cursor=eyJpZCI6NDJ9&limit=20
SQL: LIMIT 20 OFFSET 40              SQL: WHERE (created_at, id) < (...) LIMIT 20

✅ nhảy tới trang bất kỳ             ❌ chỉ tiếp/lùi tuần tự
✅ biết tổng số trang                ❌ không biết tổng (hoặc phải query riêng)
❌ chậm dần theo OFFSET              ✅ luôn nhanh — mọi trang như nhau
❌ lặp/bỏ item khi dữ liệu đổi       ✅ ổn định
```

Quy tắc chọn:

| Tình huống | Dùng |
|---|---|
| Bảng admin, cần nhảy tới trang N, dữ liệu ít | **OFFSET** |
| Feed, infinite scroll, dữ liệu thay đổi liên tục | **CURSOR** |
| Dữ liệu > ~10.000 dòng | **CURSOR** |
| API công khai cho bên thứ ba | **CURSOR** (bảo vệ database của bạn) |

Vì sao cursor luôn nhanh: nó biến "bỏ qua N dòng" thành "tìm một vị trí trong index rồi đọc tiếp 20 dòng". Với B-tree index, tìm vị trí là O(log n) và đọc 20 dòng tiếp là tuần tự.

## How It Works

### Cursor pagination — chi tiết quan trọng

```ts
// Cursor mã hoá GIÁ TRỊ SẮP XẾP + tiebreaker duy nhất
type Cursor = { createdAt: string; id: string };

const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
const decode = (s: string): Cursor => JSON.parse(Buffer.from(s, 'base64url').toString());

async function listTasks(projectId: string, cursor?: string, limit = 20) {
  const after = cursor ? decode(cursor) : null;

  const rows = await db.$queryRaw<Task[]>`
    SELECT * FROM tasks
    WHERE project_id = ${projectId}
      ${after ? Prisma.sql`AND (created_at, id) < (${after.createdAt}::timestamptz, ${after.id})` : Prisma.empty}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);

  return {
    data,
    pageInfo: {
      hasMore,
      nextCursor: hasMore && last
        ? encode({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
    },
  };
}
```

Bốn chi tiết quyết định tính đúng đắn:

1. **Tiebreaker duy nhất trong `ORDER BY`.** `ORDER BY created_at DESC` một mình không ổn định — thêm `, id DESC`. Không có nó, cursor pagination vẫn lặp/bỏ item.
2. **So sánh tuple** `(created_at, id) < (?, ?)`. PostgreSQL hỗ trợ row comparison và nó dùng được index composite. Viết thành `created_at < ? OR (created_at = ? AND id < ?)` cũng đúng nhưng planner xử lý kém hơn.
3. **`LIMIT limit + 1`** để biết `hasMore` mà không cần `COUNT`.
4. **Index phải khớp `ORDER BY`**:
   ```sql
   CREATE INDEX idx_tasks_project_created ON tasks (project_id, created_at DESC, id DESC);
   ```
   Không có index này, mọi query phải sort toàn bộ bảng. Xem [Index & query plan](../../03-database/01-postgresql/02-index-query-plan.md).

### `COUNT(*)` là bẫy hiệu năng

```sql
SELECT COUNT(*) FROM tasks WHERE project_id = 1;   -- đọc TOÀN BỘ dòng khớp
```

Với 5 triệu dòng, `COUNT` đắt hơn cả query lấy dữ liệu. Ba lựa chọn:

```text
1. Không trả total    → dùng hasMore. Đủ cho infinite scroll
2. Trả total gần đúng → pg_class.reltuples (rất nhanh, sai vài %)
3. Trả total chính xác → chỉ khi bộ lọc đã thu hẹp mạnh, và có index
```

Với UI cần "khoảng 1.200 kết quả", lựa chọn 2 là đúng. Với UI cần số chính xác trên bảng lớn, cân nhắc lại yêu cầu UI.

### Filtering — allowlist, không dynamic

```ts
// ❌ SQL injection + query không dùng được index
const where = `${req.query.field} = '${req.query.value}'`;

// ✅ Allowlist tường minh
const FILTERS = {
  status: (v: string) => TaskStatus.parse(v),
  assigneeId: (v: string) => z.string().uuid().parse(v),
  projectId: (v: string) => z.string().uuid().parse(v),
} as const;

// ✅ Sort cũng phải allowlist
const SORTS = {
  createdAt: 'created_at',
  dueDate: 'due_date',
  title: 'title',
} as const;

const column = SORTS[query.sortBy ?? 'createdAt'];   // không bao giờ nhận string tuỳ ý
const dir = query.order === 'asc' ? 'ASC' : 'DESC';
```

Allowlist cho sort giải quyết **hai** vấn đề: SQL injection (`ORDER BY` không nhận parameter binding trong nhiều driver) và hiệu năng (chỉ cho sort theo cột có index).

### DTO với default và giới hạn

```ts
export const ListTasksQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),   // TRẦN bắt buộc
  status: TaskStatus.optional(),
  assigneeId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'dueDate', 'title']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
```

`max(100)` không phải chi tiết nhỏ: không có nó, `?limit=1000000` là một DoS một dòng.

## Example

```ts
// Hợp đồng response — thêm được metadata mà không phá client
{
  "data": [ { "id": "42", "title": "..." } ],
  "pageInfo": {
    "hasMore": true,
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTI3VDEwOjAwOjAwWiIsImlkIjoiNDIifQ"
  }
}
```

Cursor là **opaque** với client — nó không nên parse hoặc tự tạo cursor. Base64 hoá là cách nói "đây là chi tiết implementation của server".

## Prediction

1. `LIMIT 20 OFFSET 0` vs `OFFSET 100000` trên bảng 1M dòng — chênh bao nhiêu?
2. `ORDER BY created_at DESC` với 100 item cùng `created_at`, phân trang — item có lặp không?
3. Thêm `, id DESC` — còn lặp không?
4. Cursor pagination trang 1 vs trang 5000 — chênh bao nhiêu?
5. `COUNT(*)` trên 5M dòng có index vs không index — bao lâu?
6. Không có `max(limit)`, client gửi `?limit=1000000` — điều gì xảy ra?
7. `ORDER BY` nhận tên cột trực tiếp từ query param — rủi ro gì?
8. Cursor pagination nhưng thiếu index khớp `ORDER BY` — nhanh không?

<details>
<summary>Đáp án chọn lọc</summary>

1. Hàng chục tới hàng trăm lần — `OFFSET` đọc rồi loại bỏ.
2. Có — thứ tự giữa các item cùng giá trị không xác định.
4. Gần như không chênh — đó là điểm của cursor.
6. Server đọc 1M dòng, serialize, hết memory hoặc timeout — DoS một dòng.
7. SQL injection, và sort theo cột không index.
8. Không — vẫn phải sort toàn bộ; cursor chỉ nhanh khi index khớp.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Seed 1M dòng, đo `OFFSET 0` vs `OFFSET 500000` | `EXPLAIN ANALYZE` cho thấy số dòng đọc |
| Bỏ tiebreaker, phân trang qua item cùng timestamp | Item lặp/bỏ |
| Bỏ index khớp `ORDER BY`, xem `EXPLAIN` | Thấy `Sort` node với `external merge Disk` |
| Thêm index composite, làm lại | `Index Scan`, nhanh hơn nhiều |
| `COUNT(*)` mỗi request trên bảng lớn | Nó chiếm phần lớn thời gian response |
| Bỏ `max(limit)`, gửi `?limit=999999` | Đo memory và thời gian |
| Sort theo cột không index | `EXPLAIN` cho thấy sort toàn bảng |
| `ORDER BY ${userInput}` với input `id; DROP TABLE` | Kiểm tra driver có chặn không (đừng chạy trên DB thật) |
| Thêm item mới liên tục trong lúc phân trang OFFSET | Đếm item lặp |

## What Usually Goes Wrong

- **OFFSET trên bảng lớn** → chậm dần, và trang cuối là timeout.
- **Thiếu tiebreaker** → thứ tự không ổn định, item lặp/bỏ.
- **Không có index khớp `ORDER BY`** → sort toàn bảng, cursor cũng không giúp.
- **`COUNT(*)` mặc định** → phần lớn thời gian response.
- **Không giới hạn `limit`** → DoS.
- **Sort/filter nhận cột tuỳ ý** → injection và query nặng.
- **Không có pagination** trên collection → endpoint chết khi dữ liệu lớn.
- **Cursor không opaque** → client tự tạo cursor, bạn không đổi được implementation.
- **Đổi từ OFFSET sang cursor sau khi có client** → breaking change.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `OFFSET` bỏ qua dòng mà không đọc | Nó đọc và loại bỏ từng dòng |
| Cursor pagination luôn nhanh | Chỉ khi có index khớp `ORDER BY` |
| `ORDER BY` một cột là đủ | Cần tiebreaker duy nhất để ổn định |
| `COUNT(*)` nhanh vì có index | Vẫn phải đếm mọi dòng khớp |
| Cursor phải là ID | Là giá trị sắp xếp + tiebreaker |
| Client cần biết tổng số trang | Phần lớn UI chỉ cần "còn nữa không" |
| Có thể đổi chiến lược pagination sau | Đổi hợp đồng phân trang là breaking change |

## Debugging

1. **List API chậm** → `EXPLAIN ANALYZE` query thật với tham số thật. Xem `Rows Removed by Filter` và có `Sort` node hay không.
2. **Chậm chỉ ở trang sau** → dấu hiệu chắc chắn của OFFSET. Đo với OFFSET tăng dần.
3. **Item lặp** → kiểm tra `ORDER BY` có tiebreaker duy nhất.
4. **Đo phần nào chậm** → tách `COUNT` ra khỏi query dữ liệu và đo riêng. Thường `COUNT` là thủ phạm.
5. **Index không được dùng** → so `ORDER BY` với định nghĩa index, kể cả **chiều** (`DESC` vs `ASC`). Xem [Index types](../../03-database/01-postgresql/07-index-types.md).
6. **Timeout với limit lớn** → kiểm tra có trần limit chưa.

## Production Considerations

- **Cursor pagination làm mặc định** cho mọi collection có thể lớn. Đổi về sau là breaking change.
- **Trần `limit`** (thường 100) và default hợp lý (20).
- **Index composite khớp chính xác `ORDER BY`**, gồm cả chiều.
- **Không trả `total`** trừ khi UI thật sự cần; dùng `hasMore`.
- **Allowlist cho sort và filter**.
- **Statement timeout** ở database để một query xấu không giữ connection mãi.
- **Rate limit** cho endpoint list — nó là endpoint đắt nhất và dễ bị abuse nhất.
- Tài liệu hoá cursor là **opaque**; đừng tiết lộ cấu trúc.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| OFFSET | nhảy trang, biết tổng | chậm dần, không ổn định |
| Cursor | nhanh đều, ổn định | không nhảy trang, không có tổng |
| Trả `total` chính xác | UI đầy đủ | `COUNT` đắt |
| Trả `total` gần đúng | rất nhanh | sai vài % |
| Chỉ `hasMore` | rẻ nhất | không có tổng |
| Limit cao | ít round-trip | payload lớn, query nặng |
| Allowlist sort | an toàn, nhanh | client không sort tuỳ ý |

## Explain Without Notes

1. Vì sao `OFFSET 100000` chậm? Database thật sự làm gì?
2. Cursor pagination hoạt động thế nào, và điều kiện để nó nhanh?
3. Vì sao cần tiebreaker trong `ORDER BY`?
4. Vì sao `COUNT(*)` đắt kể cả khi có index?
5. Hai lý do phải allowlist cột sort?

## Related

- [REST API contract](02-rest-api-contract.md) — hình dạng response
- [Index & query plan](../../03-database/01-postgresql/02-index-query-plan.md) — index cho pagination
- [Index types](../../03-database/01-postgresql/07-index-types.md) — composite index và chiều sort
- [EXPLAIN ANALYZE workflow](../../03-database/01-postgresql/08-explain-analyze-workflow.md)
- [Database performance](../../05-cross-cutting/performance/04-database-performance.md) — N+1 và query nặng
- [Rate limiting](07-rate-limiting.md)
- [SQL injection](../../05-cross-cutting/security/02-injection.md)
