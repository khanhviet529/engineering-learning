---
level: foundation
area: backend
prerequisites:
  - 00-api-vocabulary.md
  - 01-http-request-response.md
related:
  - 04-pagination-filtering-sorting.md
  - 06-api-versioning-evolution.md
---

# REST API contract

> API là một **hợp đồng bạn không thể lấy lại** sau khi có client dùng nó. Thiết kế nó như một interface công khai, không như một hàm nội bộ.

> **Chưa biết những từ này?** [Từ vựng API](00-api-vocabulary.md) — resource, endpoint, REST, contract

## Position

```text
Client (web, mobile, service khác) → [API contract] → Controller → Service → DB
                                          ↑ note này
```

## Problem

```text
GET  /getUserTasks?userId=1&includeDone=true&sort=1
POST /task/create
POST /task/update
POST /task/delete
GET  /api/v2/tasks_list_new
```

Mỗi endpoint có một quy ước riêng. Client phải học từng cái. Không cache được. `sort=1` nghĩa là gì thì phải đọc code. Và `tasks_list_new` nói cho bạn biết đã có một lần thiết kế lại thất bại.

Vấn đề thật không phải thẩm mỹ. Nó là: **mỗi lần một quyết định không nhất quán được đưa ra, mọi client phải biết về nó**, và bạn không thể sửa mà không phá client.

## Mental Model

REST là mô hình hoá hệ thống thành **resource** (danh từ) và dùng **method HTTP** (động từ) để tác động lên chúng.

```text
Không phải:  hành động  → POST /createTask, POST /completeTask
Mà là:       resource   → POST /tasks, PATCH /tasks/1 { status: 'done' }
```

Vì sao điều này quan trọng ngoài thẩm mỹ: khi động từ nằm trong method, hạ tầng hiểu được ý định. `GET /tasks` được cache; `POST /getTasks` thì không. `PUT` được retry; `POST` thì không.

```text
GET    /tasks              danh sách
POST   /tasks              tạo mới           → 201 + Location
GET    /tasks/42           một item
PUT    /tasks/42           thay thế toàn bộ  → idempotent
PATCH  /tasks/42           sửa một phần
DELETE /tasks/42           xoá               → 204, idempotent

GET    /projects/7/tasks   quan hệ (lồng 1 cấp)
```

### Quy tắc lồng: tối đa một cấp

```text
✅ GET /projects/7/tasks
❌ GET /orgs/1/projects/7/tasks/42/comments/9/replies
✅ GET /replies/9                  ← truy cập trực tiếp bằng ID
✅ GET /comments?taskId=42         ← lọc bằng query
```

URL lồng sâu buộc client biết cả cây quan hệ, và mọi thay đổi cấu trúc dữ liệu phá URL.

### Khi resource không đủ

Một số thao tác thật sự là hành động, không phải CRUD:

```text
POST /tasks/42/complete             ← chuyển trạng thái phức tạp
POST /orders/7/refund
POST /auth/login
POST /reports/generate              → 202 Accepted + Location tới job
```

Đây là ngoại lệ hợp lệ. Đừng ép mọi thứ thành CRUD — `PATCH /orders/7 { status: 'refunded' }` che mất việc refund có side effect (gọi payment gateway, gửi email, ghi ledger).

Quy tắc: nếu thao tác có **side effect ngoài việc đổi field**, làm nó thành một action endpoint tường minh.

## How It Works

### Nhất quán về đặt tên

```text
✅ Chọn MỘT quy ước và giữ:  /tasks, /task_items   hoặc   /tasks, /taskItems
✅ Danh từ số nhiều cho collection: /tasks, không /task
✅ kebab-case cho path:  /task-comments
✅ camelCase trong JSON body (khớp JS/TS)
❌ Trộn: /tasks, /Project, /user_profiles trong cùng API
```

Nhất quán quan trọng hơn lựa chọn cụ thể. Client có thể học một quy ước; không thể học ba.

### Hợp đồng response

```ts
// Một item
GET /tasks/42 → 200
{ "id": "42", "title": "Viết test", "status": "open", "createdAt": "2026-08-27T10:00:00Z" }

// Collection — bọc để có chỗ cho metadata
GET /tasks → 200
{
  "data": [ { "id": "42", ... } ],
  "pageInfo": { "nextCursor": "eyJpZCI6NDJ9", "hasMore": true }
}

// Tạo mới
POST /tasks → 201
Location: /tasks/43
{ "id": "43", ... }

// Xoá
DELETE /tasks/42 → 204   (không body)
```

Vì sao bọc collection trong `{ data: [...] }` thay vì trả array trần: thêm `pageInfo` sau này là **breaking change** nếu bạn trả array trần. Bọc từ đầu là quyết định một phút tiết kiệm một lần versioning.

Quy ước dữ liệu nên cố định từ đầu:

```text
ID          → string (kể cả khi DB dùng số). Lý do: đổi sang UUID không phá client,
              và JavaScript mất chính xác với số > 2^53
Thời gian   → ISO 8601 UTC có timezone: "2026-08-27T10:00:00Z"
Tiền        → số nguyên đơn vị nhỏ nhất (xu) HOẶC string thập phân. KHÔNG dùng float
Enum        → string ("open"), không phải số (1)
Null        → phân biệt rõ "không có field" và "field = null"
```

`ID là string` và `tiền không phải float` là hai quyết định mà hầu như mọi API đều hối tiếc nếu làm sai.

### Field selection và expansion

```text
GET /tasks?fields=id,title              ← giảm payload
GET /tasks?expand=assignee              ← nhúng resource liên quan, tránh N+1 ở client
```

Không có `expand`, client phải gọi `/tasks` rồi N lần `/users/:id` — N+1 ở tầng network, tệ hơn N+1 ở tầng database. Xem [Database performance](../../05-cross-cutting/performance/04-database-performance.md).

### Partial update: `PUT` vs `PATCH`

```text
PUT /tasks/42  { "title": "X" }
   → thay thế TOÀN BỘ. Các field không gửi bị xoá/reset.
   → Client A và B cùng PUT: A ghi mất thay đổi của B ở field A không biết tới.

PATCH /tasks/42  { "title": "X" }
   → chỉ đổi title. An toàn hơn cho client không biết hết schema.
```

Với API có nhiều client và schema tiến hoá, `PATCH` gần như luôn là lựa chọn đúng. `PUT` chỉ hợp lý khi client thật sự sở hữu toàn bộ resource.

## Example

```ts
// NestJS controller — hợp đồng rõ ràng, không có business logic
@Controller('projects/:projectId/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @Query() query: ListTasksQuery,           // validate + default ở DTO
  ): Promise<Paginated<TaskDto>> {
    return this.tasks.list(projectId, query);
  }

  @Post()
  @HttpCode(201)
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskDto> {
    return this.tasks.create(projectId, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto): Promise<TaskDto> {
    return this.tasks.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.tasks.remove(id);
  }

  @Post(':id/complete')                        // action: có side effect thật
  complete(@Param('id') id: string): Promise<TaskDto> {
    return this.tasks.complete(id);            // ghi activity log, gửi thông báo
  }
}
```

## Prediction

1. `POST /getTasks` — CDN cache không? Client library retry không?
2. Bạn trả array trần `[...]` cho `GET /tasks`, rồi cần thêm `total`. Có phá client không?
3. ID là number trong JSON, giá trị `9007199254740993` — JavaScript client đọc được đúng?
4. `PUT /tasks/42 { title: 'X' }` khi resource có 10 field — 9 field kia thế nào?
5. Client gọi `GET /tasks` rồi 50 lần `GET /users/:id` — bao nhiêu round-trip? Với `expand=assignee`?
6. Tiền lưu dạng float `0.1 + 0.2` — kết quả?
7. `DELETE /tasks/42` hai lần — lần hai nên trả gì?

<details>
<summary>Đáp án chọn lọc</summary>

2. Có — đổi từ array sang object là breaking change.
3. Không — vượt `Number.MAX_SAFE_INTEGER`, mất chính xác im lặng.
4. Bị xoá/reset theo ngữ nghĩa `PUT`.
5. 51 round-trip vs 1.
6. `0.30000000000000004` — lý do không dùng float cho tiền.
7. `204` hoặc `404`; cả hai hợp lệ vì `DELETE` idempotent.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đổi `GET /tasks` từ array sang `{data}` | Mọi client hỏng |
| ID number với giá trị > 2^53 | `JSON.parse` mất chính xác im lặng |
| Tiền dạng float, cộng 1000 giao dịch | Sai số tích luỹ |
| Bỏ timezone trong timestamp | Client ở múi giờ khác hiểu sai |
| Đổi enum từ string sang number | Client so sánh `=== 'open'` hỏng |
| `PUT` một phần từ hai client đồng thời | Lost update ở field không liên quan |
| Thêm field bắt buộc vào request DTO | Client cũ nhận 400 |
| Đổi tên field trong response | Client cũ đọc `undefined` |
| Không có `expand`, list 50 item trên mạng 4G | Đo tổng thời gian với 51 round-trip |

## What Usually Goes Wrong

- **Động từ trong URL** → mất cache và retry semantics.
- **Array trần cho collection** → không thêm được metadata mà không phá client.
- **ID dạng number** → mất chính xác, và không đổi được sang UUID.
- **Tiền dạng float** → sai số.
- **Timestamp không có timezone** → bug theo múi giờ.
- **Không nhất quán** giữa các endpoint (số ít/số nhiều, snake/camel).
- **Lồng URL sâu** → client phải biết cả cây quan hệ.
- **`PUT` khi nên là `PATCH`** → lost update.
- **Không có pagination** trên collection → endpoint chết khi dữ liệu lớn. Xem [Pagination](04-pagination-filtering-sorting.md).
- **Trả toàn bộ entity của DB** kể cả field nội bộ (`passwordHash`, `internalNotes`) → lộ dữ liệu.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| REST là quy tắc URL | Là mô hình resource + ngữ nghĩa HTTP |
| Mọi thứ phải là CRUD | Action endpoint hợp lệ khi có side effect thật |
| REST cần nhiều round-trip hơn GraphQL | Với `expand`/`fields` thì không nhất thiết |
| URL lồng sâu thể hiện quan hệ tốt | Nó tạo coupling; dùng ID trực tiếp |
| Trả entity của ORM là tiện | Nó lộ schema nội bộ và field nhạy cảm |
| Thêm field vào response là breaking | Thêm thì không; xoá/đổi tên thì có |
| Versioning giải quyết mọi thay đổi | Version là chi phí; thiết kế mở rộng được trước |

## Debugging

1. **Client báo lỗi lạ** → `curl -i` chính request đó. So sánh response thật với hợp đồng đã tài liệu hoá.
2. **Không rõ hợp đồng** → nếu không có OpenAPI spec, đó là vấn đề gốc. Sinh nó từ code (`@nestjs/swagger`) để spec không lệch.
3. **Client cũ hỏng sau deploy** → so sánh response schema trước/sau; tìm field bị xoá hoặc đổi tên.
4. **Số bị sai** → kiểm tra có phải ID/tiền dạng number vượt an toàn của JS.
5. **Thời gian sai** → kiểm tra timezone trong chuỗi và cách client parse.
6. **API chậm với list** → đếm số query (N+1) và số round-trip client cần.

## Production Considerations

- **OpenAPI sinh từ code**, không viết tay — spec viết tay luôn lệch.
- **Chia sẻ type giữa FE và BE** (từ schema Zod hoặc từ OpenAPI codegen).
- **DTO tách khỏi entity DB.** Không bao giờ trả entity trực tiếp — nó lộ field nội bộ và ràng buộc API vào schema DB.
- **Pagination bắt buộc** cho mọi collection từ đầu.
- **Contract test** để phát hiện breaking change trong CI. Xem [Contract testing](../../05-cross-cutting/testing/07-contract-testing.md).
- **Thiết kế mở rộng được**: bọc collection, dùng enum string, ID string, thêm field thay vì đổi field.
- **Rate limit và giới hạn kích thước** cho mọi endpoint công khai.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| REST chuẩn | hạ tầng HTTP hoạt động đúng, dễ hiểu | nhiều round-trip nếu không có `expand` |
| Action endpoint | rõ ràng về side effect | lệch khỏi CRUD thuần |
| Bọc `{ data }` | mở rộng được | verbose hơn một chút |
| ID string | đổi kiểu ID không phá client | phải cast khi query DB |
| `expand`/`fields` | ít round-trip, payload nhỏ | phức tạp ở server, dễ tạo query nặng |
| GraphQL thay REST | client tự chọn dữ liệu | mất cache HTTP, phức tạp hơn, dễ tạo query đắt |

## Explain Without Notes

1. Vì sao động từ nên nằm trong method HTTP, không trong URL — lợi ích kỹ thuật cụ thể?
2. Khi nào một action endpoint là hợp lệ?
3. Vì sao bọc collection trong `{ data }` từ đầu?
4. Ba quy ước dữ liệu nên cố định sớm và lý do mỗi cái?
5. `PUT` vs `PATCH` — cái nào gây lost update và vì sao?

## Related

- [Từ vựng API](00-api-vocabulary.md) — foundation: resource, endpoint, REST, contract
- [HTTP request/response](01-http-request-response.md) — ngữ nghĩa method và status
- [HTTP semantics & idempotency](03-http-semantics-idempotency.md)
- [Pagination, filtering, sorting](04-pagination-filtering-sorting.md)
- [Error model](05-error-model.md) — hợp đồng lỗi
- [Versioning & evolution](06-api-versioning-evolution.md) — đổi hợp đồng an toàn
- [RPC, GraphQL & alternatives](08-rpc-graphql-alternatives.md)
- [Controller–Service–Repository](../04-architecture/01-controller-service-repository.md) — controller chỉ giữ hợp đồng
