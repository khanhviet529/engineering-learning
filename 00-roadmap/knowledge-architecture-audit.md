# Knowledge Architecture Audit

Audit kiến trúc thư mục và độ phủ khái niệm, làm cơ sở cho đợt restructure.

Ngày: **2026-08-28** · Phạm vi: toàn repo trừ `07-projects/`

## Nguyên tắc áp dụng

```text
Fundamentals → Mechanism/Behavior → Failure/Debugging → Production/Trade-off
```

Nhưng **taxonomy phải phản ánh bản chất từng công nghệ**, không ép mọi folder thành `fundamentals/ + behavior/`.

Và một ràng buộc thực tế quyết định phần lớn các lựa chọn dưới đây:

```text
Chia N file thành K thư mục chỉ có ích khi N/K ≥ 3.

  16 file → 2 thư mục  → 8 file/thư mục   ✓ dễ quét hơn hẳn
   8 file → 4 thư mục  → 2 file/thư mục   ✗ tệ hơn danh sách phẳng

⇒ folder ≤ 8–9 note giữ phẳng, và đầu tư vào README (thứ tự đọc,
  bảng chẩn đoán) thay vì vào cây thư mục.
```

Đây là lý do một số taxonomy đề xuất trong yêu cầu **không** được áp dụng nguyên văn — chúng sẽ tạo ra thư mục chứa 1–2 file. Chỗ nào lệch, lý do được ghi ở cột "Quyết định".

## Bảng quyết định theo khu vực

| Khu vực | Số note | Cấu trúc hiện tại | Vấn đề | Quyết định |
|---|---|---|---|---|
| React | 16 | phẳng, 01–15 | trộn foundation và behavior; 16 file phẳng khó quét | **TÁCH** `fundamentals/` + `behavior/` |
| Next.js | 9 | phẳng | không có lớp foundation; baseline v15 đã cũ | **TÁCH** `fundamentals/` + `behavior/` |
| JavaScript/TypeScript | 9 | phẳng | bốn miền khác nhau trộn lẫn (ngôn ngữ, runtime, async, TS) | **TÁCH** 4 nhóm |
| Node.js | 6 | phẳng | thiếu foundation và bản đồ API | **TÁCH** 3 nhóm |
| NestJS | 9 | phẳng | **không có lớp từ vựng** — gap lớn nhất repo | **TÁCH** `fundamentals/` + `behavior/` |
| PostgreSQL | 9 | phẳng | bốn miền khác nhau (kết nối, giao dịch, index, vận hành) | **TÁCH** 4 nhóm |
| Kubernetes | 10 | phẳng | nhiều miền, thứ tự đọc không hiện ra từ tên file | **TÁCH** 4 nhóm |
| SQL | 4 | phẳng | thiếu DML vocabulary | **GIỮ PHẲNG** + thêm note nền |
| Redis | 6 | phẳng | thiếu key/value model và data structures | **GIỮ PHẲNG** + thêm note nền |
| Docker | 8 | phẳng | phủ tốt | **GIỮ PHẲNG** — 4 nhóm × 2 file là tệ hơn |
| Message queues | 6 | phẳng | phủ tốt, đã theo chủ đề | **GIỮ PHẲNG** |
| Linux | 7 | phẳng | phủ tốt | **GIỮ PHẲNG** |
| Networking | 6 | phẳng | phủ tốt | **GIỮ PHẲNG** — 6 nhóm cho 6 file là vô nghĩa |
| Security | 7 | phẳng | đã tổ chức theo lớp tấn công | **GIỮ PHẲNG** |
| Testing | 7 | phẳng | đã theo tầng test | **GIỮ PHẲNG** |
| Observability | 5 | phẳng | đã theo tín hiệu | **GIỮ PHẲNG** |
| Performance | 6 | phẳng | đã theo tầng | **GIỮ PHẲNG** |
| Reliability | 4 | phẳng | | **GIỮ PHẲNG** |
| Concurrency | 3 | phẳng | | **GIỮ PHẲNG** |
| System design | 10 | phẳng | đã sắp theo bài toán | **GIỮ PHẲNG** |
| AI-assisted | 5 | phẳng | | **GIỮ PHẲNG** |
| HTTP/API | 8 | phẳng | | **GIỮ PHẲNG** |
| Web foundations | 8 | phẳng | | **GIỮ PHẲNG** |
| Auth | 6 | phẳng | | **GIỮ PHẲNG** |
| Architecture (backend) | 5 | phẳng | trùng vai trò với `nestjs/architecture` đề xuất | **GIỮ NGUYÊN VỊ TRÍ**, NestJS link sang |

## Taxonomy mới cho các khu vực được tách

### React

```text
02-react/
├── fundamentals/
│   ├── 01-components-and-rendering-model.md   (mới)
│   ├── 02-hooks-core.md                       (mới)
│   └── 03-hooks-advanced-map.md               (mới)
└── behavior/            01–14, giữ nguyên nội dung, chỉ đổi vị trí
```

### Next.js

```text
03-nextjs/
├── fundamentals/
│   ├── 01-app-router-structure.md   (mới)
│   └── 02-nextjs-16-changes.md      (mới — baseline v15 đã cũ)
└── behavior/            01–08 hiện có
```

### JavaScript / TypeScript

```text
01-javascript-typescript/
├── fundamentals/        execution context, closure, modules, error handling
├── async-concurrency/   event loop, promise, race
├── runtime-behavior/    memory, GC
└── typescript/          runtime boundary, type system, advanced types
```

### Node.js

```text
01-nodejs/
├── fundamentals/        runtime & concurrency, module system, core API map (mới)
├── runtime-io/          streams/buffers, worker threads, process & memory
└── production/          graceful shutdown
```

### NestJS

```text
02-nestjs/
├── fundamentals/        building blocks + decorator map + DI (mới)
└── behavior/            01–09 hiện có
```

Kiến trúc (module boundaries, modular monolith, god service) **không** chuyển vào đây — nó đã có ở `02-backend-api/04-architecture/` và áp dụng cho backend nói chung, không riêng NestJS.

### PostgreSQL

```text
01-postgresql/
├── fundamentals/                architecture & connection pool + note nền (mới)
├── transactions-concurrency/    isolation, MVCC, locking
├── indexes-query-planning/      index & plan, index types, EXPLAIN workflow
└── operations/                  WAL/backup, replication
```

### Kubernetes

```text
04-kubernetes/
├── fundamentals/              why k8s, object map (mới)
├── workloads-networking/      pod/deployment/service, ingress, rollout, storage
├── scheduling-reliability/    probes, scheduling, autoscaling
└── operations/                config/secrets, debugging
```

## Foundation gap tìm được

Kiểm tra bằng cách grep từng khái niệm trong nội dung file, không chỉ trong tên file.

| Khu vực | Khái niệm thiếu | Mức | Hành động |
|---|---|---|---|
| React | `useReducer` | **MISSING** | note riêng (behavior) |
| React | `useSyncExternalStore`, `useId`, `useDebugValue`, `useImperativeHandle`, `useInsertionEffect`, `useEffectEvent`, `useActionState`, `useOptimistic` | **MISSING** | hooks-advanced-map |
| React | `createPortal` | **MISSING** | hooks-advanced-map |
| React | component / element / instance / JSX / children — từ vựng | **PARTIAL** | components-and-rendering-model |
| React | `useTransition`, `useDeferredValue` | **PARTIAL** (chỉ trong performance) | hooks-advanced-map |
| Next.js | parallel routes, catch-all, optional catch-all, `default.tsx`, `template.tsx` | **MISSING** | app-router-structure |
| Next.js | Next 16: `proxy.ts`, Cache Components, `use cache`, `updateTag`, `refresh`, async `params` | **OUTDATED** | nextjs-16-changes |
| Node.js | bản đồ core API (`path`, `events`, `timers`, `AbortController`, `crypto`) | **MISSING** | core-apis-map |
| Node.js | `package.json`, npm scripts, loại dependency | **PARTIAL** | core-apis-map |
| NestJS | `main.ts` → AppModule → Controller → Service, decorator map, `useExisting`, scopes | **MISSING** | building-blocks + di-providers |
| SQL | DML vocabulary (`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`WHERE`/`ORDER BY`/`LIMIT`), ACID | **MISSING** | sql-basics |
| Redis | key/value model, data structures, expiration | **PARTIAL** (rải rác) | redis-data-model |
| Redis | cache penetration | **MISSING** | thêm vào cache-patterns |
| Kubernetes | bản đồ object + control plane | **PARTIAL** | object-map |
| PostgreSQL | ACID, kiến trúc client/server | **MISSING** | postgresql-architecture |

Không tìm thấy gap đáng kể ở: Docker, Linux, Networking, Message queues, Security, Testing, Observability, Performance, Reliability, Concurrency, System design, HTTP/API, Auth.

## Version-sensitive: đã kiểm tra với docs chính thức

| Công nghệ | Bản hiện tại | Ảnh hưởng tới repo |
|---|---|---|
| React | **19.2** (10/2025) | `useEffectEvent` đã ổn định; `Activity`, View Transitions mới |
| Next.js | **16.3.3** | `middleware.ts` → `proxy.ts`; Cache Components/`use cache`; PPR mặc định; `revalidateTag` đổi chữ ký; `default.tsx` bắt buộc; async `params`/`cookies()`; Turbopack mặc định — **repo đang baseline v15** |
| Node.js | **24 LTS**, 26 Current | repo ghi "Node 20+"; Node 20 đã EOL 04/2026 |
| NestJS | **11** | khớp; yêu cầu Node 20.19+ |
| PostgreSQL | 16 dùng trong ví dụ | khớp |
| Kubernetes | 1.29+ dùng trong ví dụ | khớp |

## Rủi ro khi move và cách xử lý

```text
3.523 liên kết nội bộ + 624 tham chiếu frontmatter đều là ĐƯỜNG DẪN TƯƠNG ĐỐI.
Move một file làm hỏng cả hai chiều: link TỚI nó, và link TỪ nó ra ngoài.

⇒ không move bằng tay.
⇒ dùng script: với mỗi file, phân giải mọi tham chiếu theo thư mục CŨ,
  ánh xạ qua bảng đổi tên, rồi tính lại tương đối theo thư mục MỚI.
⇒ `git mv` để giữ lịch sử.
⇒ chạy link checker trước và sau, so số liệu.
```

## Related

- [Knowledge audit](knowledge-audit.md) — audit nội dung ban đầu
- [Final coverage report](final-coverage-report.md) — trạng thái trước đợt này
- [Knowledge architecture final report](knowledge-architecture-final-report.md) — kết quả sau đợt này
- [Knowledge map](knowledge-map.md) · [Topic index](04-topic-index.md) · [Behavior index](behavior-index.md)
