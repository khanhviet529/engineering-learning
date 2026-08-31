# HTTP & API Design

HTTP như một **hợp đồng chung** giữa client, proxy, CDN, load balancer và monitoring — không như một quy ước nội bộ của team bạn. Tôn trọng hợp đồng đó là cách bạn được cache, retry và observability hoạt động đúng mà không viết thêm code.

## Vào đây từ đâu

```text
Chưa chắc 401 khác 403 ở đâu, 400 khác 422 ở đâu, DTO là gì?
        └──▶ 00-api-vocabulary.md        ← từ vựng, ~12 phút

Đã có từ vựng, muốn thiết kế API dùng được lâu dài?
        └──▶ 01-http-request-response.md ← bắt đầu chuỗi bên dưới

Đang phải chọn mã lỗi cho một tình huống cụ thể?
        └──▶ 00-api-vocabulary.md (bảng 4xx) rồi 05-error-model.md
```

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 0 | [Từ vựng API](00-api-vocabulary.md) | endpoint, status code từng mã, REST, stateless, DTO — **là gì?** |
| 1 | [HTTP request & response](01-http-request-response.md) | Method và status code có ngữ nghĩa gì, và ai dựa vào chúng? |
| 2 | [REST API contract](02-rest-api-contract.md) | Thiết kế API mà không phải version lại? |
| 3 | [HTTP semantics & idempotency](03-http-semantics-idempotency.md) | Vì sao người dùng bị charge hai lần khi không ai bấm hai lần? |
| 4 | [Pagination, filtering, sorting](04-pagination-filtering-sorting.md) | Vì sao trang cuối luôn chậm hơn trang đầu? |
| 5 | [Error model](05-error-model.md) | Client cần biết gì khi có lỗi? |
| 6 | [Versioning & evolution](06-api-versioning-evolution.md) | Đổi API mà không phá client cũ? |
| 7 | [Rate limiting](07-rate-limiting.md) | Ai bị từ chối khi hệ thống quá tải? |
| 8 | [RPC, GraphQL & alternatives](08-rpc-graphql-alternatives.md) | REST có phải lựa chọn đúng? |

Note 1 và 3 là nền. Note 5 và 6 là hai thứ đắt nhất để sửa sau khi có client.

## Bốn quyết định không lấy lại được

Sau khi có client dùng API, bốn thứ này rất khó đổi. Quyết định đúng từ đầu:

1. **ID là string, không phải number.** JavaScript mất chính xác với số > 2⁵³, và bạn không đổi được sang UUID sau này. → [2](02-rest-api-contract.md)
2. **Tiền là số nguyên đơn vị nhỏ nhất hoặc string thập phân, không phải float.** → [2](02-rest-api-contract.md)
3. **Collection bọc trong `{ data, pageInfo }`, không phải array trần.** Thêm metadata sau là breaking change. → [2](02-rest-api-contract.md)
4. **Lỗi có `code` máy đọc được, không chỉ `message`.** Client sẽ branch trên message nếu bạn không cho nó `code`. → [5](05-error-model.md)

## Năm hiểu nhầm đắt nhất

| Hiểu nhầm | Thực tế | Note |
|---|---|---|
| Method chỉ là quy ước | Nó quyết định cache, retry, và hành vi proxy | [1](01-http-request-response.md) |
| Trả 200 với error body thì tiện cho client | Nó phá monitoring, cache và retry logic | [1](01-http-request-response.md) |
| `OFFSET 100000` bỏ qua dòng mà không đọc | Nó đọc và loại bỏ 100.000 dòng | [4](04-pagination-filtering-sorting.md) |
| Disable nút chống được duplicate | Không chống retry của mạng — cần idempotency ở server | [3](03-http-semantics-idempotency.md) |
| Version giải quyết vấn đề thay đổi | Nó hoãn vấn đề và thêm chi phí bảo trì vĩnh viễn | [6](06-api-versioning-evolution.md) |

## Bảng chẩn đoán nhanh

| Triệu chứng | Nghi ngờ |
|---|---|
| Dashboard 5xx = 0% nhưng user gặp lỗi | trả 200 cho lỗi → [1](01-http-request-response.md) |
| Client retry mãi một request không bao giờ thành công | trả 5xx cho lỗi client → [1](01-http-request-response.md) |
| Record trùng, `createdAt` cách nhau vài giây | retry + thiếu idempotency → [3](03-http-semantics-idempotency.md) |
| List API chậm dần theo trang | OFFSET pagination → [4](04-pagination-filtering-sorting.md) |
| Item lặp giữa các trang | thiếu tiebreaker trong `ORDER BY` → [4](04-pagination-filtering-sorting.md) |
| Form không hiện lỗi theo field | thiếu `details` trong error body → [5](05-error-model.md) |
| Client hỏng sau deploy | breaking change → [6](06-api-versioning-evolution.md) |
| Một client làm chậm cả hệ thống | thiếu rate limit → [7](07-rate-limiting.md) |
| Rate limit vượt gấp N lần | counter in-memory với N instance → [7](07-rate-limiting.md) |
| GraphQL gọi DB 101 lần | thiếu DataLoader → [8](08-rpc-graphql-alternatives.md) |

## Bất kể giao thức nào

Những việc này không thay đổi khi bạn đổi từ REST sang GraphQL hay gRPC — chúng là công việc thật, giao thức chỉ là cách đóng gói:

```text
authentication → authorization → validation → rate limit
→ timeout → idempotency → error model → observability
```

## Position

```text
Browser/Mobile → [HTTP API] → Node.js → NestJS → Domain → DB
                     ↑ folder này
```

## Related

- [00-web-foundations/](../../01-web-frontend/00-web-foundations/README.md) — phía client của cùng giao thức
- [01-nodejs/](../01-nodejs/README.md) — runtime xử lý request
- [02-nestjs/](../02-nestjs/README.md) — request đi đâu sau khi vào app
- [04-architecture/](../04-architecture/README.md) — controller chỉ giữ hợp đồng
- [Reliability](../../05-cross-cutting/reliability/README.md) — timeout, retry, circuit breaker
- [Contract testing](../../05-cross-cutting/testing/07-contract-testing.md)
