# Knowledge Architecture — Final Report

Kết quả đợt restructure kiến trúc và bổ sung foundation coverage.

Ngày: **2026-08-28** · Audit tương ứng: [knowledge-architecture-audit.md](knowledge-architecture-audit.md)

## Tổng quan

```text
                    TRƯỚC        SAU
note                  227         241   (+14)
liên kết nội bộ     3.523       3.704
liên kết hỏng          12          12   (không đổi — xem "Còn lại")
tham chiếu frontmatter 624         659   (0 hỏng)
file di chuyển                      68
thư mục mới                         21
orphan note                          0
```

## Nguyên tắc đã áp dụng cho taxonomy

```text
Chia N file thành K thư mục chỉ có ích khi N/K ≥ 3.

  16 file → 2 thư mục  = 8 file/thư mục   ✓
   8 file → 4 thư mục  = 2 file/thư mục   ✗ tệ hơn danh sách phẳng
```

Bảy khu vực được tách; mười tám khu vực giữ phẳng vì tách sẽ tạo ra thư mục chứa 1–2 file. Với nhóm giữ phẳng, đầu tư đi vào **README** (thứ tự đọc, bảng chẩn đoán) thay vì cây thư mục.

## Cấu trúc trước và sau

### Đã tách

```text
01-web-frontend/02-react/            16 file phẳng
  → fundamentals/  (3)   behavior/  (14)

01-web-frontend/03-nextjs/           9 file phẳng
  → fundamentals/  (2)   behavior/  (8)

01-web-frontend/01-javascript-typescript/   9 file phẳng
  → fundamentals/ (3)  async-concurrency/ (2)
    runtime-behavior/ (1)  typescript/ (3)

02-backend-api/01-nodejs/            6 file phẳng
  → fundamentals/ (3)  runtime-io/ (2)  production/ (2)

02-backend-api/02-nestjs/            9 file phẳng
  → fundamentals/ (2)   behavior/ (9)

03-database/01-postgresql/           9 file phẳng
  → fundamentals/ (2)  transactions-concurrency/ (3)
    indexes-query-planning/ (3)  operations/ (2)

04-infrastructure/04-kubernetes/     10 file phẳng
  → fundamentals/ (2)  workloads-networking/ (4)
    scheduling-reliability/ (3)  operations/ (2)
```

### Giữ phẳng, có lý do

| Khu vực | Note | Lý do |
|---|---|---|
| Docker | 8 | 4 nhóm × 2 file là tệ hơn; README đã có thứ tự đọc |
| Networking | 6 | taxonomy đề xuất có 6 nhóm cho 6 file |
| Linux, Message queues, Security, Testing, Observability, Performance, Reliability, Concurrency | 3–7 mỗi khu vực | đã sắp theo chủ đề bằng số thứ tự |
| System design | 10 | đã tổ chức theo bài toán, không theo tầng |
| SQL, Redis, Data modeling, Auth, HTTP/API, Web foundations, AI-assisted | 5–8 | như trên |
| `02-backend-api/04-architecture/` | 5 | **không** gộp vào `nestjs/architecture/` — nội dung áp dụng cho backend nói chung |

## Files moved

68 file, toàn bộ bằng `git mv` (giữ lịch sử). Ví dụ đại diện:

```text
02-react/00-react-foundations.md      → 02-react/fundamentals/01-components-and-rendering-model.md
02-react/15-hooks-reference-map.md    → 02-react/fundamentals/03-hooks-advanced-map.md
02-react/01..14-*.md                  → 02-react/behavior/
03-nextjs/00-nextjs-foundations.md    → 03-nextjs/fundamentals/01-app-router-structure.md
03-nextjs/01..08-*.md                 → 03-nextjs/behavior/
01-javascript-typescript/02-typescript-runtime-boundary.md → typescript/01-runtime-boundary.md
01-nodejs/01-node-runtime-concurrency.md → 01-nodejs/fundamentals/01-runtime-concurrency.md
01-postgresql/01-transaction-isolation.md → transactions-concurrency/01-transaction-isolation.md
04-kubernetes/04-why-kubernetes.md    → 04-kubernetes/fundamentals/01-why-kubernetes.md
```

Việc di chuyển được thực hiện bằng script: với mỗi file, mọi tham chiếu tương đối được phân giải theo thư mục **cũ**, ánh xạ qua bảng đổi tên, rồi tính lại tương đối theo thư mục **mới**. **1.632 tham chiếu trong 191 file** được viết lại; số liên kết hỏng trước và sau bằng nhau.

## Files renamed

Đổi tên khi chuyển vào thư mục con, để đánh số lại từ `01` trong từng nhóm và bỏ tiền tố thừa:

```text
02-typescript-runtime-boundary.md  → typescript/01-runtime-boundary.md
07-typescript-type-system.md       → typescript/02-type-system.md
08-typescript-advanced-types.md    → typescript/03-advanced-types.md
06-module-system-node.md           → fundamentals/02-module-system.md
02-health-readiness-liveness.md    → scheduling-reliability/01-health-readiness-liveness.md
```

## Files created (14)

| File | Lấp gap |
|---|---|
| `react/fundamentals/01-components-and-rendering-model.md` | component/element/instance/JSX/props/children; render vs commit |
| `react/fundamentals/02-hooks-core.md` | `useState`/`useReducer`/`useRef`/`useContext`/`useEffect` — khi nào và khi nào KHÔNG |
| `react/fundamentals/03-hooks-advanced-map.md` | 13 hook còn lại + `createPortal` + Rules of Hooks |
| `react/behavior/14-usereducer-state-machines.md` | `useReducer`, discriminated union, state machine |
| `nextjs/fundamentals/01-app-router-structure.md` | quy ước file, parallel/intercepting/catch-all, `default.tsx` |
| `nextjs/fundamentals/02-nextjs-16-changes.md` | Cache Components, `use cache`, `proxy.ts`, `updateTag`, async `params` |
| `nodejs/fundamentals/03-core-apis-map.md` | `package.json`, `fs`/`path`/`events`/`timers`/`crypto`/`AbortController` |
| `nestjs/fundamentals/01-building-blocks.md` | `main.ts` → Module → Controller → Service; decorator map; pipeline |
| `nestjs/fundamentals/02-di-providers.md` | token, `useClass`/`useValue`/`useFactory`/`useExisting`, scope, circular |
| `postgresql/fundamentals/01-architecture-and-acid.md` | mô hình process, database/schema/table, kiểu dữ liệu, ACID, WAL, MVCC |
| `sql/00-sql-basics.md` | DML, ràng buộc, thứ tự thực thi, cạm bẫy NULL |
| `redis/00-redis-data-model.md` | key/value model, sáu cấu trúc, TTL, nguyên tử |
| `kubernetes/fundamentals/02-object-map.md` | control plane, cây sở hữu, bảng đối tượng, label/selector |
| `00-roadmap/knowledge-architecture-audit.md` | audit và quyết định taxonomy |

## Files split / merged

```text
split:  0
merged: 0
```

Không tách hay gộp file nào. Các note behavior hiện có đã có độ cohesion tốt; can thiệp vào chúng sẽ phá vỡ nội dung đang dùng được mà không có lợi ích tương xứng. Toàn bộ nội dung sâu được **giữ nguyên và chuyển vị trí**.

## Foundation gaps đã lấp

| Khu vực | Trước | Sau |
|---|---|---|
| React | thiếu từ vựng; `useReducer`, `useSyncExternalStore`, `useId`, `useEffectEvent`, `createPortal` không xuất hiện | đủ 18 hook + từ vựng + portal |
| Next.js | không có lớp foundation; parallel route và catch-all thiếu; baseline v15 | quy ước file đầy đủ + note thay đổi v16 |
| Node.js | thiếu bản đồ core API, `package.json`, loại dependency | có |
| NestJS | **không có lớp từ vựng nào** | building blocks + DI/provider |
| SQL | thiếu DML vocabulary và ACID | có |
| PostgreSQL | thiếu kiến trúc process và ACID | có |
| Redis | data structures rải rác trong note behavior | có note data model |
| Kubernetes | bản đồ đối tượng rải rác | có object map |

## Version-sensitive: đã kiểm tra với docs chính thức

| Công nghệ | Bản xác nhận | Hành động |
|---|---|---|
| React | **19.2** | ghi trong note mới; `useEffectEvent` đã stable |
| Next.js | **16.3.3** | note riêng cho thay đổi v15 → v16; README đổi baseline |
| Node.js | **24 LTS** (26 Current; 20 EOL 04/2026) | ghi trong core API map |
| NestJS | **11** | khớp nội dung hiện có |
| PostgreSQL / Kubernetes / Redis | 16 / 1.29+ / 7.x | khớp |

Các note behavior của Next.js vẫn ở baseline v15 — chúng **vẫn đúng** khi không bật `cacheComponents`, và note `02-nextjs-16-changes.md` nêu rõ điều gì đổi khi bật.

## Broken links fixed

```text
Trước restructure   12 hỏng
Sau restructure     12 hỏng   ← không phát sinh liên kết hỏng mới

Đã sửa trong đợt này:
  · 1 forward-reference tới `09-nextjs-16-caching-model.md` (file được tạo ở vị trí khác)
  · 1 dương tính giả trong `final-coverage-report.md` (chuỗi `](*.md)` trong code fence)
  · 3 đường dẫn sai từ đợt trước (`01-event-loop.md`, `03-streams-buffers.md`,
    `01-rendering-strategies.md`) đã được sửa trước khi restructure
```

## Kết quả validation

```text
✓ 3.704 liên kết markdown nội bộ — 12 hỏng (đều là file chưa viết, xem dưới)
✓ 659 tham chiếu frontmatter — 0 hỏng
✓ 0 orphan note (mọi file được liên kết từ ít nhất một nơi)
✓ 0 code fence lệch, 0 thẻ <details> lệch
✓ 0 file dưới 1 KB
✓ mọi README của khu vực được tách có mục "Cấu trúc" và thứ tự đọc
```

## Còn lại

### 12 liên kết hỏng — tất cả đều có chủ đích

```text
11  07-projects/fullstack-lab/phases/phase-01..10 + 1 tham chiếu lặp
 1  templates/topic-note.md → `path/to/note.md` (placeholder của template)
```

Đây là công việc của phiên tiếp theo, không phải lỗi.

### Advanced topics cố tình hoãn

| Chủ đề | Lý do hoãn |
|---|---|
| `useImperativeHandle`, `useInsertionEffect`, `useDebugValue` | chỉ nêu trong hooks map — cần khi viết thư viện, không phải khi dùng React |
| React Compiler cấu hình chi tiết | mới stable; nêu tác động (thay `useMemo`/`useCallback`) là đủ ở mức này |
| Next.js `use cache: private` / `use cache: remote` | đã nêu tồn tại và khi nào cần; chi tiết chỉ có nghĩa khi đã chạy Cache Components thật |
| Kubernetes operator / CRD | vượt phạm vi "vận hành ứng dụng" |
| PostgreSQL partitioning nâng cao, logical replication | đã có ở system design và operations ở mức quyết định |
| RabbitMQ/Kafka chi tiết vận hành | đã có so sánh conceptual ở `04-message-queues/05-broker-comparison.md` |

### Không làm trong phiên này

```text
07-projects/fullstack-lab/  — không đụng tới, theo yêu cầu.
Chỉ các cross-link tới nó được cập nhật tự động khi file khác di chuyển.
```

## Recommended next step

```text
07-projects/fullstack-lab/
```

Knowledge base giờ có đủ bốn lớp cho mọi khu vực chính:

```text
Fundamentals → Behavior → Failure/Debugging → Production/Trade-off
```

Bước còn thiếu là biến chúng thành **runnable experiments**. Mười file phase đang được liên kết từ `fullstack-lab/README.md` nhưng chưa tồn tại:

```text
phase-01-ui-state       phase-06-concurrency
phase-02-async-ui       phase-07-performance
phase-03-api-crud       phase-08-cache-queue
phase-04-database       phase-09-docker
phase-05-auth           phase-10-production
```

Mỗi phase nên là một lab chạy được: mục tiêu · điều kiện đầu vào · các bước dựng · và **thí nghiệm phá vỡ** liên kết ngược về đúng note lý thuyết — đó là chỗ mục `Break It` trong mỗi note trở thành việc làm thật thay vì mô tả.

## Related

- [Knowledge architecture audit](knowledge-architecture-audit.md) — quyết định taxonomy và lý do
- [Final coverage report](final-coverage-report.md) — độ phủ nội dung
- [Knowledge audit](knowledge-audit.md) — audit ban đầu
- [Knowledge map](knowledge-map.md) · [Topic index](04-topic-index.md) · [Behavior index](behavior-index.md)
- [Learning system](00-learning-system.md) — chu trình học của repo
