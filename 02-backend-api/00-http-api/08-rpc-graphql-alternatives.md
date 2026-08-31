---
level: intermediate
area: backend
prerequisites:
  - 00-api-vocabulary.md
  - 02-rest-api-contract.md
related:
  - ../../06-system-design/07-event-driven.md
---

# RPC, GraphQL & alternatives

> REST không phải lựa chọn duy nhất và không phải lựa chọn đúng cho mọi tình huống. Nhưng mỗi lựa chọn khác đổi một tập vấn đề lấy một tập vấn đề khác — và cái bạn mất thường là hạ tầng HTTP miễn phí.

> **Chưa biết những từ này?** [Từ vựng API](00-api-vocabulary.md) — REST, RESTful, endpoint

## Position

```text
Client ──[REST | GraphQL | gRPC | tRPC | WebSocket | Event]── Server
              ↑ note này: chọn theo ràng buộc, không theo mốt
```

## Problem

Bốn tình huống, và REST không tối ưu cho tất cả:

1. **Mobile app cần 8 loại dữ liệu cho một màn hình** → 8 round-trip trên mạng 4G.
2. **Hai service nội bộ gọi nhau 10.000 lần/giây** → overhead JSON + HTTP header đáng kể.
3. **Frontend và backend cùng monorepo, cùng team** → viết type hai lần, hoặc chạy codegen.
4. **Client cần biết ngay khi dữ liệu đổi** → polling.

Nhưng đổi sang một giao thức khác không miễn phí. Câu hỏi đúng không phải "cái nào tốt nhất" mà **"ràng buộc của tôi là gì, và tôi chấp nhận mất gì?"**

## Mental Model

```text
                Client biết trước gì?   Ai định nghĩa response?   Cache HTTP?
REST            URL + shape             SERVER                    ✅
GraphQL         schema                  CLIENT (query)            ❌ (POST)
gRPC            .proto                  server (message)          ❌
tRPC            type TypeScript         server                    ❌ (POST)
Event/queue     event schema            producer                  n/a
```

Cột cuối là cái giá thường bị bỏ qua: **mọi lựa chọn ngoài REST đều mất cache HTTP**, vì chúng dùng `POST` (GraphQL, tRPC) hoặc không dùng HTTP semantics (gRPC). Bạn phải tự dựng lại caching ở tầng application.

Cách chọn theo ràng buộc:

| Ràng buộc | Chọn |
|---|---|
| API công khai cho bên thứ ba | **REST** — dễ học nhất, hạ tầng chuẩn |
| Cần cache HTTP/CDN | **REST** |
| Client đa dạng, nhu cầu dữ liệu khác nhau, nhiều nested data | **GraphQL** |
| Service-to-service nội bộ, throughput cao | **gRPC** |
| Full-stack TypeScript, một team, monorepo | **tRPC** |
| Server đẩy dữ liệu | **SSE / WebSocket** |
| Xử lý bất đồng bộ, tách rời tạm thời | **Queue / event** |

## How It Works

### GraphQL

```graphql
query TaskScreen($id: ID!) {
  task(id: $id) {
    id title status
    assignee { id name avatarUrl }
    comments(first: 10) { edges { node { id body author { name } } } }
  }
}
```

Một request thay cho bốn. Client quyết định lấy field nào.

Cái bạn mất, và mỗi cái là công việc thật:

| Mất gì | Vì sao | Phải làm gì |
|---|---|---|
| Cache HTTP | mọi query là `POST /graphql` | tự cache ở tầng resolver / persisted query |
| Bảo vệ khỏi query đắt | client tự chọn độ sâu | depth limit, complexity limit, timeout |
| N+1 tự nhiên | mỗi field là một resolver | **DataLoader** (batch + cache trong request) |
| Status code có ngữ nghĩa | GraphQL trả 200 với `errors` | tự định nghĩa error convention |
| Rate limit đơn giản | không đếm được "request" | tính theo complexity điểm |

N+1 trong GraphQL là vấn đề **mặc định**, không phải ngoại lệ:

```ts
// Không có DataLoader: 1 query tasks + N query users
const resolvers = {
  Task: { assignee: (task) => db.user.findUnique({ where: { id: task.assigneeId } }) },
};

// Với DataLoader: 1 query tasks + 1 query users (batch)
const userLoader = new DataLoader<string, User>(async (ids) => {
  const users = await db.user.findMany({ where: { id: { in: [...ids] } } });
  const map = new Map(users.map(u => [u.id, u]));
  return ids.map(id => map.get(id)!);       // PHẢI giữ đúng thứ tự
});

const resolvers = {
  Task: { assignee: (task, _, ctx) => ctx.userLoader.load(task.assigneeId) },
};
```

DataLoader phải được tạo **mỗi request**, không dùng chung — nếu không, cache của nó giữ dữ liệu cũ và rò rỉ giữa các user.

Và bảo vệ khỏi query đắt là bắt buộc cho API công khai:

```ts
// Không có giới hạn, một query như này làm sập server
query { task { comments { author { tasks { comments { author { tasks { ... } } } } } } } }
```

### gRPC

```protobuf
service TaskService {
  rpc GetTask(GetTaskRequest) returns (Task);
  rpc StreamTasks(StreamRequest) returns (stream Task);   // streaming là first-class
}

message Task {
  string id = 1;                 // số field là hợp đồng — KHÔNG BAO GIỜ đổi
  string title = 2;
  TaskStatus status = 3;
}
```

Được: binary (nhỏ và nhanh hơn JSON), HTTP/2 multiplexing, streaming hai chiều, codegen cho nhiều ngôn ngữ, hợp đồng cứng.

Mất: browser không gọi trực tiếp được (cần grpc-web + proxy), khó debug (không `curl` được như REST), không cache HTTP.

Quy tắc quan trọng của protobuf: **số field là hợp đồng.** Đổi `title = 2` thành `title = 3` là breaking change im lặng — dữ liệu cũ sẽ được đọc vào field sai. Chỉ thêm field mới với số mới; đánh dấu field cũ là `reserved` khi xoá.

### tRPC

```ts
// server
export const appRouter = router({
  tasks: router({
    byId: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(({ input }) => db.task.findUnique({ where: { id: input.id } })),

    create: protectedProcedure
      .input(CreateTask)
      .mutation(({ input, ctx }) => db.task.create({ data: { ...input, ownerId: ctx.user.id } })),
  }),
});

export type AppRouter = typeof appRouter;
```

```ts
// client — type an toàn hoàn toàn, không codegen, không schema riêng
const task = await trpc.tasks.byId.query({ id: '42' });
//    ^? Task | null — suy ra trực tiếp từ server
```

Được: type safety end-to-end không cần bước build, refactor an toàn (đổi tên field là lỗi compile ở cả hai phía), rất ít boilerplate.

Mất: **chỉ dùng được với TypeScript client**, ràng buộc chặt FE-BE (không phải hợp đồng công khai), không cache HTTP, không dùng được cho bên thứ ba hoặc mobile native.

tRPC là lựa chọn tốt cho một điều kiện cụ thể: **một team, một monorepo, chỉ có TypeScript client**. Ngoài điều kiện đó, nó trở thành nợ.

### Kết hợp — thường là câu trả lời đúng

```text
Web app (Next.js)  ──tRPC/Server Actions──→  BFF/API
Mobile app         ──REST─────────────────→  BFF/API
Bên thứ ba         ──REST + OpenAPI───────→  Public API
Service nội bộ     ──gRPC────────────────→  Service khác
Realtime           ──SSE─────────────────→  Client
Việc nặng          ──Queue───────────────→  Worker
```

Không có quy tắc "một giao thức cho toàn hệ thống". Mỗi ranh giới có ràng buộc riêng.

## Example

```ts
// Cùng một nhu cầu, ba cách
// REST: 2 round-trip, cache được
GET /tasks/42
GET /users/7

// REST với expand: 1 round-trip, vẫn cache được
GET /tasks/42?expand=assignee

// GraphQL: 1 round-trip, client chọn field, không cache HTTP
POST /graphql  { query: "{ task(id:42){ title assignee{ name } } }" }
```

Hàng giữa đáng chú ý: `expand` giải quyết phần lớn vấn đề "quá nhiều round-trip" của REST **mà không mất cache**. Trước khi chuyển sang GraphQL vì lý do round-trip, hãy thử `expand` và `fields`.

## Prediction

1. GraphQL query lấy 50 task, mỗi task có `assignee` — bao nhiêu query DB không có DataLoader? Có DataLoader?
2. GraphQL qua `POST /graphql` — CDN cache được không?
3. Query GraphQL lồng 20 tầng, không có depth limit — điều gì xảy ra?
4. DataLoader tạo một lần lúc khởi động (không phải mỗi request) — rủi ro gì?
5. Đổi số field trong `.proto` từ 2 sang 3 — client cũ đọc được gì?
6. tRPC với một mobile app viết bằng Swift — dùng được không?
7. GraphQL trả lỗi — status code là gì?

<details>
<summary>Đáp án</summary>

1. 51 vs 2.
2. Không — `POST` không cache được.
3. Query rất đắt, có thể làm sập server hoặc timeout.
4. Cache giữ dữ liệu cũ và **rò rỉ dữ liệu giữa các user** — lỗi bảo mật.
5. Field sai hoặc rỗng — breaking change im lặng.
6. Không — tRPC cần TypeScript client.
7. 200, với lỗi trong body `errors` — nên monitoring theo status code không thấy gì.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| GraphQL không DataLoader, query 100 item có nested | Đếm query trong log DB: 101 |
| Thêm DataLoader | 2 query |
| DataLoader dùng chung giữa request, đăng nhập hai user | User B thấy dữ liệu user A |
| GraphQL không depth limit, gửi query lồng sâu | CPU/memory tăng vọt |
| Đổi số field protobuf | Client cũ đọc sai field |
| Monitoring theo 5xx với GraphQL | 0% lỗi trong khi resolver đang throw |
| tRPC rồi cần thêm mobile native client | Phải viết REST API song song |
| REST không có `expand`, mobile trên 4G | Đo tổng thời gian với N+1 round-trip |

## What Usually Goes Wrong

- **GraphQL không có DataLoader** → N+1 mặc định.
- **DataLoader không per-request** → rò rỉ dữ liệu giữa user.
- **GraphQL không giới hạn depth/complexity** → dễ bị DoS bằng một query.
- **Chọn tRPC rồi cần client không phải TypeScript** → phải viết API thứ hai.
- **Đổi số field protobuf** → breaking change không ai thấy.
- **Chuyển sang GraphQL vì mốt** → mất cache HTTP, thêm phức tạp, không giải quyết vấn đề thật.
- **Monitoring theo HTTP status với GraphQL** → không thấy lỗi.
- **Không có persisted query** cho GraphQL công khai → không cache, không giới hạn được query.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| GraphQL luôn ít round-trip hơn REST | REST với `expand` thường tương đương |
| GraphQL giải quyết over-fetching | Nó chuyển vấn đề sang server (query đắt, N+1) |
| gRPC dùng được từ browser | Cần grpc-web + proxy |
| tRPC là "REST tốt hơn" | Nó là RPC cho TypeScript; không phải hợp đồng công khai |
| Chọn một giao thức cho toàn hệ thống | Mỗi ranh giới có ràng buộc riêng |
| GraphQL không cần versioning | Vẫn cần deprecation cho field |
| Binary luôn nhanh hơn đáng kể | Với payload nhỏ, gzip JSON gần bằng; lợi ích rõ ở throughput cao |

## Debugging

1. **N+1 trong GraphQL** → log mọi query DB kèm request ID; đếm số query cho một request. Đây là bước đầu tiên với mọi GraphQL server.
2. **Query đắt** → bật tracing của Apollo/Yoga; nó cho biết resolver nào tốn thời gian.
3. **Lỗi GraphQL không hiện trong monitoring** → thêm metric riêng cho `errors` trong body, không dựa vào status code.
4. **gRPC khó debug** → dùng `grpcurl`, và bật reflection ở môi trường dev.
5. **tRPC lỗi type sau refactor** → đó là tính năng; compiler chỉ đúng chỗ cần sửa.
6. **So sánh trước khi chuyển giao thức** → đo số round-trip và payload thật của REST hiện tại. Thường vấn đề là thiếu `expand`, không phải thiếu GraphQL.

## Production Considerations

- **REST + OpenAPI cho API công khai.** Nó có rào cản học thấp nhất và hạ tầng đầy đủ nhất.
- **GraphQL**: DataLoader per-request, depth limit, complexity limit, timeout, persisted query cho client công khai.
- **gRPC**: chỉ nội bộ; giữ `.proto` trong một repo dùng chung; không bao giờ đổi số field.
- **tRPC**: chỉ khi chắc chắn mọi client là TypeScript và cùng monorepo.
- **Đừng chuyển giao thức để sửa một vấn đề chưa được đo.** Chi phí chuyển đổi rất cao và thường vấn đề thật là thiết kế endpoint.
- Bất kể giao thức, những thứ sau **không** thay đổi: authentication, authorization, validation, rate limit, timeout, idempotency, observability. Chúng là công việc thật; giao thức chỉ là cách đóng gói.

## Trade-offs

| Giao thức | Được | Mất |
|---|---|---|
| REST | cache HTTP, dễ học, hạ tầng chuẩn, dễ debug | có thể nhiều round-trip nếu thiết kế kém |
| GraphQL | client chọn dữ liệu, một endpoint, schema tự tài liệu | mất cache HTTP, N+1 mặc định, cần bảo vệ query |
| gRPC | nhanh, streaming, codegen đa ngôn ngữ | không dùng từ browser, khó debug |
| tRPC | type safety end-to-end, ít boilerplate | chỉ TypeScript, coupling chặt |
| SSE/WebSocket | realtime | quản lý kết nối, scale phức tạp |
| Queue | tách rời, chịu tải đột biến | eventual consistency, cần idempotency |

## Explain Without Notes

1. Cái gì **mọi** lựa chọn ngoài REST đều mất, và hệ quả?
2. Vì sao N+1 là mặc định trong GraphQL, và DataLoader giải quyết thế nào?
3. Vì sao DataLoader phải per-request?
4. Điều kiện cụ thể nào làm tRPC là lựa chọn đúng?
5. Vì sao không được đổi số field trong protobuf?
6. Trước khi chuyển từ REST sang GraphQL vì round-trip, nên thử gì?

## Related

- [Từ vựng API](00-api-vocabulary.md) — foundation: REST, RESTful, endpoint
- [REST API contract](02-rest-api-contract.md) — `expand`, `fields` giải quyết over-fetching
- [Pagination](04-pagination-filtering-sorting.md) — cursor pagination là chuẩn của GraphQL Connection
- [Database performance](../../05-cross-cutting/performance/04-database-performance.md) — N+1
- [WebSocket & SSE](../../01-web-frontend/00-web-foundations/08-websocket-sse.md)
- [Vì sao cần queue](../../03-database/04-message-queues/01-why-queue.md)
- [Event-driven systems](../../06-system-design/07-event-driven.md)
- [Monolith → microservices](../../06-system-design/08-monolith-to-microservices.md) — gRPC giữa service
