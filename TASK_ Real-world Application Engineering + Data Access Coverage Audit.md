# TASK: Real-world Application Engineering + Data Access Coverage Audit

Bạn đang tiếp tục làm việc trên repository:

`engineering-learning`

Repository hiện đã có nền tảng khá tốt về:

- React
- Next.js
- Node.js
- NestJS
- SQL
- PostgreSQL
- Redis
- Docker
- Kubernetes
- Security
- Testing
- Observability
- Performance
- Reliability
- Concurrency
- System Design
- AI-assisted development

Knowledge architecture và foundation coverage đã được restructure ở phiên trước.

Trong phiên này:

> KHÔNG restructure taxonomy lớn thêm lần nữa.

Nhiệm vụ chính là audit và bổ sung lớp kiến thức:

# REAL-WORLD APPLICATION ENGINEERING

Tức là lớp kiến thức trả lời câu hỏi:

> “Biết React/NestJS/PostgreSQL rồi thì khi xây một application thật, developer xử lý data flow, API, caching, performance, architecture, error, concurrency và UX như thế nào?”

Ngoài ra phải bổ sung coverage còn thiếu về:

- Prisma ORM
- ORM patterns
- MongoDB / NoSQL fundamentals
- PostgreSQL vs MongoDB
- SQL vs NoSQL
- ORM vs Query Builder vs Raw SQL

---

# IMPORTANT — EXISTING CONTENT

Một số vùng repository đã có khá tốt.

KHÔNG viết lại hoặc duplicate nếu không cần.

## Đã có coverage tốt

### Pagination / Cursor / Filtering / Sorting

Repository đã có:

- offset pagination
- cursor/keyset pagination
- filtering
- sorting
- stable ordering
- tie-breaker
- composite index
- COUNT(*)
- EXPLAIN ANALYZE
- pagination performance

Nếu nội dung hiện tại đã tốt:

> giữ nguyên và chỉ bổ sung cross-link nếu cần.

Không tạo một bài pagination mới chỉ để nói lại cùng nội dung.

---

### PostgreSQL Index / Query Planning

Đã có:

- index
- query planning
- EXPLAIN
- EXPLAIN ANALYZE

Không duplicate.

Chỉ bổ sung nếu audit phát hiện gap thực sự.

---

### SQL vs NoSQL / Storage Selection

Repository đã có conceptual coverage về:

- relational
- document
- key-value
- wide-column
- search
- OLAP
- PostgreSQL
- MongoDB
- Redis
- các specialized stores

Không tạo lại một bài storage-selection giống hệt.

Có thể bổ sung bài comparison cụ thể hơn:

```text
PostgreSQL vs MongoDB
```

nếu nó tạo thêm giá trị thực tế.

---

# CORE PRINCIPLE

Toàn bộ phiên này phải học theo:

```text
Problem
   ↓
Mental Model
   ↓
Available Patterns
   ↓
Implementation
   ↓
Failure Modes
   ↓
Debugging
   ↓
Trade-offs
   ↓
Production Implications
```

Không viết kiểu:

```text
TanStack Query có API A, B, C
Prisma có function A, B, C
```

Mà phải trả lời:

```text
Vấn đề gì khiến công cụ/pattern này tồn tại?
Nó giải quyết phần nào?
Nó không giải quyết phần nào?
Khi nào không nên dùng?
```

---

# PART 1 — FRONTEND APPLICATION ENGINEERING

Audit React/Next.js hiện tại và bổ sung các kiến thức thực chiến còn thiếu.

## 1. Multi-API Screen

Một màn hình thực tế có thể cần:

```text
Dashboard
├── user
├── permissions
├── statistics
├── notifications
├── orders
├── activities
└── recommendations
```

Phải giải thích:

- gọi API song song
- gọi API tuần tự
- dependency giữa request
- request waterfall
- Promise.all
- Promise.allSettled
- partial failure
- partial rendering
- error isolation
- loading boundary
- retry từng resource
- cancellation
- deduplication
- stale request
- race condition

Trả lời:

> Một API lỗi có nên làm cả màn hình lỗi không?

> Khi nào nên để các widget độc lập?

> Khi nào nên aggregate API ở backend?

---

## 2. Frontend Data Fetching Architecture

Phủ:

- client state
- server state
- derived state
- URL state
- local component state
- global state

Phân biệt rõ:

```text
useState
Context
TanStack Query
SWR
Zustand/Redux nếu phù hợp
Next.js server fetching
```

Không biến thành so sánh library marketing.

Phải giải thích problem boundaries.

Ví dụ:

```text
useState
→ local UI state

TanStack Query
→ remote/server state

URL
→ shareable navigation state
```

---

## 3. Frontend Caching

Phủ:

- cache key
- stale time
- cache time / garbage collection concepts
- stale-while-revalidate
- background refetch
- request deduplication
- cache invalidation
- optimistic update
- mutation invalidation
- prefetch
- pagination cache
- infinite query
- dependent queries

So sánh conceptual:

```text
Browser cache
Next.js cache
TanStack Query cache
Redis cache
CDN cache
Database buffer/cache
```

Phải chỉ rõ:

> Đây là các cache ở tầng khác nhau, không thay thế trực tiếp cho nhau.

---

## 4. Slow API UX

Tạo hoặc bổ sung topic dạng behavior:

```text
API mất 5 giây thì làm gì?
```

Không chỉ trả lời:

> Optimize backend.

Phải chia:

### Backend

- profiling
- DB query
- index
- parallel I/O
- cache
- background job
- pagination
- precomputation

### Frontend

- skeleton
- cached data
- stale-while-revalidate
- optimistic UI
- progressive rendering
- Suspense
- streaming
- partial UI
- prefetch
- previous data
- loading feedback

Mental model:

```text
Actual latency
!=
Perceived latency
```

Ví dụ:

```text
API = 5 seconds

cached UI = 50 ms
background refetch = 5 s

→ perceived UX vẫn tốt
```

---

## 5. Request Waterfall

Phủ ví dụ:

```ts
const user = await getUser();
const orders = await getOrders();
const products = await getProducts();
```

Nếu độc lập:

```text
5s + 5s + 5s
```

so với:

```ts
await Promise.all(...)
```

Phải giải thích:

- sequential
- parallel
- dependent calls
- concurrency limit
- API fan-out

---

## 6. UX Resilience

Phủ:

- loading state
- empty state
- error state
- partial error
- timeout
- retry
- offline
- stale data
- disabled action
- optimistic state
- rollback
- retry button

---

# PART 2 — ASYNC / CONCURRENCY

Audit JS/Node/NestJS hiện tại.

Bổ sung nếu chưa đủ:

- Promise
- async function
- await
- event loop relation
- microtasks
- sequential async
- parallel async
- Promise.all
- Promise.allSettled
- Promise.race
- Promise.any
- race conditions
- cancellation
- AbortController
- timeout
- concurrency limiting
- error propagation

Phải giải thích rõ:

```text
async != parallel
```

và:

```text
await không block OS thread theo nghĩa truyền thống,
nhưng nó có thể serialize application flow.
```

---

# PART 3 — API DESIGN / RESTFUL

Audit HTTP/API hiện tại.

Bảo đảm người học hiểu:

## REST Fundamentals

- resource
- representation
- URI
- HTTP method
- status code
- statelessness
- idempotency
- cacheability
- safe methods

Ví dụ:

```text
GET    /users/:id
POST   /users
PATCH  /users/:id
DELETE /users/:id
```

Nhưng không dạy REST bằng URI convention đơn thuần.

---

## RESTful API Design

Phủ:

- naming
- resource boundaries
- nested resources
- pagination
- filtering
- sorting
- versioning
- error contract
- status codes
- idempotency keys
- rate limiting
- bulk operations
- partial update
- validation
- API compatibility

---

## REST vs Alternatives

Phân biệt:

- REST
- RPC
- GraphQL
- gRPC

Theo:

```text
use case
trade-off
operational complexity
client needs
```

---

# PART 4 — MANY APIs / BACKEND AGGREGATION

Phủ:

- frontend orchestration
- backend orchestration
- API aggregation
- BFF — Backend for Frontend
- API Gateway
- fan-out
- fan-in
- parallel service calls
- timeout budget
- partial response
- degraded response

Ví dụ:

```text
Frontend
   ↓
BFF
 ├── User Service
 ├── Order Service
 ├── Permission Service
 └── Notification Service
```

Phải trả lời:

> Khi nào frontend tự gọi 5 API?

> Khi nào backend nên aggregate thành 1 API?

---

# PART 5 — DEPENDENCY INJECTION / LIFETIME

Audit NestJS foundation hiện tại.

Bảo đảm coverage:

- Dependency Injection
- IoC
- provider
- dependency graph
- injection token
- constructor injection

## Provider Lifetime / Scope

- Singleton/default
- Request scope
- Transient

Mental model:

```text
Singleton
→ một instance dùng lại

Request scoped
→ một instance / request

Transient
→ instance mới cho consumer
```

Phải giải thích trade-offs:

- memory
- performance
- shared mutable state
- testability
- request context

Không chỉ giải thích decorator.

---

# PART 6 — SOLID + CLEAN CODE + DESIGN PRINCIPLES

Tạo hoặc mở rộng knowledge area phù hợp.

Không học thuộc:

```text
S O L I D
```

mà học thông qua code smells.

Phủ:

- SRP
- OCP
- LSP
- ISP
- DIP

Ngoài ra:

- DRY
- KISS
- YAGNI
- Separation of Concerns
- High Cohesion
- Low Coupling
- Composition over Inheritance
- Encapsulation
- Dependency inversion

---

## Example-driven

Ví dụ:

```text
Controller 1000 dòng
→ responsibility problem

Service inject 15 dependencies
→ cohesion/boundary problem

Thêm payment provider phải sửa nhiều switch/case
→ extensibility problem
```

Phải nói rõ:

> SOLID không phải luật tuyệt đối.

> Abstraction quá sớm cũng là technical debt.

---

# PART 7 — CLEAN / APPLICATION ARCHITECTURE

Audit architecture hiện tại.

Bổ sung nếu thiếu:

- Layered Architecture
- Clean Architecture
- Hexagonal Architecture
- Ports and Adapters
- Modular Monolith
- Repository Pattern
- Service Layer
- Application/Use Case Layer
- Domain Layer
- Infrastructure Layer
- DTO
- mapper
- dependency direction

Phải giải thích:

```text
When to use
When not to use
Cost
Trade-off
```

Không biến todo app thành Clean Architecture 20 lớp.

---

# PART 8 — ERROR HANDLING

Phủ xuyên FE/BE.

## Frontend

- network error
- timeout
- validation error
- auth error
- partial failure
- stale data
- retry

## Backend

- validation error
- domain/business error
- database error
- external API error
- timeout
- unexpected error

Phân biệt:

```text
retryable
vs
non-retryable
```

Ví dụ:

```text
400 validation
→ không retry

503 dependency unavailable
→ có thể retry

timeout
→ tùy operation và idempotency
```

---

# PART 9 — RESILIENCE

Audit reliability và bổ sung practical application patterns:

- timeout
- retry
- exponential backoff
- jitter
- circuit breaker
- fallback
- graceful degradation
- bulkhead
- idempotency
- deadline propagation
- retry storm
- thundering herd

---

# PART 10 — PRISMA ORM

Đây là gap quan trọng.

Hiện repository có thể đã nhắc Prisma trong example/code, nhưng chưa có knowledge track đủ để học Prisma bài bản.

Tạo vùng hợp lý, ví dụ:

```text
03-database/04-prisma/
```

hoặc vị trí tốt hơn theo taxonomy hiện tại.

Không bắt buộc đúng path này.

Coverage:

## Fundamentals

- Prisma schema
- datasource
- generator
- model
- field
- relation
- enum

## Prisma Client

- CRUD
- select
- include
- where
- orderBy
- relation queries

## Relations

- one-to-one
- one-to-many
- many-to-many
- relation ownership

## Migrations

- migrate dev
- migration files
- schema evolution
- production migration mindset
- migration vs db push

Không viết CLI cheatsheet.

---

## Transactions

- interactive transaction
- batch transaction
- transaction boundaries
- timeout
- retry consideration

---

## Pagination

Liên kết sang pagination note hiện có.

Phủ Prisma-specific:

- skip/take
- cursor
- cursor pagination
- stable ordering

Không duplicate lý thuyết pagination.

---

## Performance

- N+1
- excessive include
- over-fetching
- select
- relation loading
- query count
- batching
- connection pooling

---

## Raw SQL

- `$queryRaw`
- `$executeRaw`
- parameterization
- when ORM abstraction breaks down

---

## Production

- connection pooling
- serverless connection behavior nếu phù hợp
- migrations
- observability/query logging
- long transactions
- generated client

---

# PART 11 — ORM MENTAL MODEL

Tạo bài hoặc area riêng nếu phù hợp:

```text
ORM vs Query Builder vs Raw SQL
```

Phải so sánh:

## ORM

Ví dụ:

- Prisma
- TypeORM

Ưu:

- productivity
- type safety
- abstraction
- migrations/integration

Nhược:

- abstraction leak
- inefficient query
- hidden N+1
- complex SQL becomes awkward

---

## Query Builder

Ví dụ conceptual:

- Knex
- Kysely

Trade-offs.

---

## Raw SQL

Ưu:

- full control
- database-specific features
- performance visibility

Nhược:

- verbosity
- mapping
- maintainability
- type safety nếu tooling yếu

---

## Decision Rule

Không đưa ra:

> ORM luôn tốt.

hoặc:

> Raw SQL luôn tốt.

Phải giải thích theo:

```text
query complexity
team experience
performance needs
DB-specific features
maintenance cost
```

---

# PART 12 — PRISMA VS TYPEORM VS RAW SQL

Tạo comparison nếu tạo giá trị.

Phủ conceptual:

```text
Prisma
TypeORM
Query Builder
Raw SQL
```

Theo:

- type safety
- data mapper / active record concepts
- migrations
- relation handling
- query transparency
- learning curve
- PostgreSQL feature access
- performance tuning
- production ergonomics

Không biến thành framework war.

---

# PART 13 — MONGODB / NOSQL FUNDAMENTALS

Repository hiện đã có conceptual comparison về NoSQL nhưng chưa có MongoDB track sâu.

Tạo vùng knowledge hợp lý.

Coverage:

## Fundamentals

- database
- collection
- document
- BSON
- ObjectId

Mental model:

```text
row/table
không ánh xạ hoàn toàn 1:1
với
document/collection
```

---

## Document Modeling

- embedding
- referencing
- duplication
- denormalization
- document boundary

Câu hỏi trung tâm:

> Dữ liệu nào được đọc/ghi cùng nhau?

---

## Schema

- schema flexibility
- schema validation
- application schema
- schema evolution
- versioned documents

Phải phá misconception:

> MongoDB không có schema.

Đúng hơn:

> Schema vẫn tồn tại; câu hỏi là ai enforce nó.

---

## Indexes

- single field
- compound
- unique
- multikey
- index order
- query pattern relation

Không cần quá sâu DB internals nếu scope không cần.

---

## Aggregation Pipeline

- match
- project
- group
- sort
- lookup

Mental model về pipeline.

---

## Transactions / Consistency

- atomic document update
- multi-document transaction
- consistency considerations

---

## Operations

Conceptual coverage:

- replication
- replica set
- sharding
- failover

Không cần biến thành MongoDB administrator course.

---

# PART 14 — POSTGRESQL VS MONGODB

Tạo một bài comparison rõ nếu hiện chưa đủ.

Không so sánh kiểu:

```text
SQL = structured
Mongo = flexible
```

Phải so:

- data relationship
- transaction
- constraints
- schema evolution
- access patterns
- joins
- aggregation
- indexing
- operational complexity
- scaling
- reporting
- team knowledge

Ví dụ:

```text
Orders / payments / permissions
→ PostgreSQL rất tự nhiên

Content document độc lập, shape biến động và đọc nguyên document
→ MongoDB có thể phù hợp
```

Nhưng phải chỉ ra:

```text
PostgreSQL JSONB
```

có thể giải quyết nhiều use case thường bị gán mặc định cho MongoDB.

---

# PART 15 — SQL VS NOSQL

Nếu existing storage-selection đã tốt:

- KHÔNG duplicate.

Có thể tạo một beginner/intermediate comparison nhỏ hơn nếu cần navigation.

Phải giải thích:

> SQL / NoSQL không phải một trục “old vs modern”.

Phải dựa trên:

```text
data model
query pattern
consistency
constraints
scale
operations
```

---

# PART 16 — DATABASE APPLICATION PATTERNS

Audit và bổ sung:

- Repository Pattern
- Data Mapper
- Active Record
- Unit of Work
- transaction boundary
- connection pool
- N+1
- batching
- eager loading
- lazy loading
- query batching
- bulk insert/update
- optimistic concurrency
- pessimistic locking

Không phải mọi pattern đều phải có file riêng.

---

# PART 17 — PERFORMANCE ACROSS FULL STACK

Tạo hoặc cross-link một flow:

```text
User thấy màn hình chậm
       ↓
Frontend render?
       ↓
Network?
       ↓
API?
       ↓
External API?
       ↓
Database?
       ↓
Cache?
       ↓
CPU / memory?
```

Phải hướng người học:

> đo trước khi optimize.

Phủ:

- browser devtools
- network timing
- server timing
- tracing
- query timing
- EXPLAIN ANALYZE
- profiler
- metrics

---

# PART 18 — REAL-WORLD SCENARIOS

Nên có các scenario notes hoặc sections.

Ví dụ:

## Scenario A

```text
Một màn hình gọi 8 API
```

Hỏi:

- parallel hay sequential?
- loading thế nào?
- một API fail thì sao?
- BFF có cần không?
- cache ở đâu?

---

## Scenario B

```text
API mất 5 giây
```

Hỏi:

- backend bottleneck ở đâu?
- có thể cache không?
- UI phản hồi thế nào?
- background job có phù hợp không?

---

## Scenario C

```text
List 5 triệu records
```

Hỏi:

- cursor?
- index?
- count?
- filter?
- caching?

Liên kết sang note pagination hiện có.

---

## Scenario D

```text
NestJS service có 15 dependencies
```

Hỏi:

- service đang có quá nhiều responsibility?
- module boundary sai?
- abstraction nào cần?
- hay chỉ đang over-engineering?

---

## Scenario E

```text
Prisma query chậm
```

Hỏi:

- generated SQL?
- N+1?
- index?
- include quá nhiều?
- transaction?
- raw SQL có hợp lý?

---

# INFORMATION ARCHITECTURE

KHÔNG restructure lớn.

Ưu tiên:

1. đặt note mới vào folder hiện có nếu tự nhiên;
2. tạo folder mới chỉ khi có đủ cohesive knowledge;
3. update README/index;
4. update related/prerequisites;
5. không orphan note.

Có thể tạo một navigation concept:

```text
Real-world Application Engineering
```

trong roadmap/index mà không nhất thiết tạo một root folder mới.

---

# DO NOT

Không:

- rewrite các bài pagination/index đã tốt;
- duplicate storage-selection;
- restructure toàn repo;
- làm project/labs;
- tạo library comparison vô nghĩa;
- tạo file cho từng method Prisma;
- tạo cheatsheet command;
- copy docs;
- tạo abstraction-heavy Clean Architecture examples không thực tế.

---

# SOURCE VERIFICATION

Với:

- Prisma
- MongoDB
- TanStack Query
- Next.js
- React
- NestJS
- Node.js

kiểm tra documentation chính thức hiện tại nếu có behavior/version-sensitive.

Không dựa vào API cũ nếu documentation đã thay đổi.

---

# EXECUTION ORDER

Thực hiện:

```text
1. Audit existing application-engineering coverage
2. Frontend multi-API/data orchestration
3. Frontend caching + slow API UX
4. Async/concurrency
5. REST/API design
6. Backend aggregation/BFF
7. DI/lifetime
8. SOLID/design principles
9. Clean/application architecture
10. Error handling
11. Resilience
12. Prisma
13. ORM patterns/trade-offs
14. MongoDB fundamentals
15. PostgreSQL vs MongoDB
16. SQL vs NoSQL navigation improvements
17. Database application patterns
18. Full-stack performance troubleshooting
19. Real-world scenarios
20. Update indexes/cross-links
21. Validate links
22. Final gap audit
```

Không dừng hỏi giữa các bước nếu không có blocker thật.

---

# VALIDATION

Cuối phiên kiểm tra:

- broken Markdown links
- frontmatter refs
- orphan notes
- duplicate concepts
- stale README/index
- stub files
- unbalanced code fences

Không được tạo broken links mới.

---

# FINAL REPORT

Tạo hoặc cập nhật:

```text
00-roadmap/application-engineering-coverage-report.md
```

bao gồm:

```text
Areas audited
Existing coverage reused
Missing concepts found
New notes created
Existing notes expanded
Duplicate content avoided
Prisma coverage added
MongoDB coverage added
Architecture/design coverage added
Frontend real-world coverage added
Backend real-world coverage added
Remaining gaps
Advanced topics intentionally deferred
Recommended next step
```

---

# DEFINITION OF DONE

Phiên này hoàn thành khi repository không chỉ trả lời:

```text
React là gì?
NestJS hoạt động thế nào?
PostgreSQL dùng index ra sao?
```

mà còn trả lời tốt các câu hỏi thực tế:

```text
Một màn hình gọi 8 API thì tổ chức thế nào?

Một API mất 5 giây thì cải thiện UX ra sao?

Request nào nên chạy song song?

Cache ở frontend khác Redis thế nào?

Khi nào dùng TanStack Query?

RESTful API thực sự nghĩa là gì?

Khi nào cần BFF?

Dependency Injection giúp gì?

Singleton / Request / Transient khác nhau thế nào?

Service quá lớn thì clean thế nào?

SOLID áp dụng tới đâu là đủ?

Khi nào dùng Prisma?

Khi nào bypass Prisma bằng raw SQL?

N+1 xảy ra thế nào?

PostgreSQL và MongoDB chọn theo tiêu chí gì?

SQL và NoSQL khác nhau ở problem domain nào?

ORM, Query Builder và Raw SQL trade-off ra sao?

Một hệ thống chậm thì debug từ frontend xuống database thế nào?
```

---

# NEXT STEP

Sau phiên này:

> Không audit kiến thức thêm theo kiểu mở rộng vô hạn.

Bước tiếp theo là:

```text
07-projects/fullstack-lab/
```

để biến các knowledge notes thành runnable experiments và real-world scenarios.