---
level: meta
area: roadmap
---

# Foundation Coverage Report

Kết quả sau khi thực thi [Foundation gap audit](./foundation-gap-audit.md).

## Điều đã thay đổi

Trước phiên này, repo chỉ phục vụ **một** chế độ đọc. Giờ nó phục vụ hai:

```text
"tôi không biết từ này là gì"     → foundation note  →  ~10–12 phút, không có failure mode
"nó hoạt động và hỏng thế nào?"   → behavior note    →  failure, debugging, production
```

Cách vào lớp foundation: bảng ở [README gốc](../README.md), khối *"Vào đây từ đâu"* trong README của từng vùng, hoặc [Glossary](./glossary.md) để tra một từ lẻ.

## Số liệu

| | Trước | Sau |
|---|---|---|
| Tổng số note | 292 | 299 |
| Note foundation/vocabulary | 19 (dạng `fundamentals/`, không được gọi tên) | 23 (+ 4 note từ vựng tường minh) |
| Vùng có lớp từ vựng | 18/24 | **24/24** |
| Broken link | 11 (baseline) | 11 (**không tăng**) |

## Note mới (6 file)

| File | Bao khái niệm | Kích thước |
|---|---|---|
| [Từ vựng Web](../01-web-frontend/00-web-foundations/00-web-vocabulary.md) | client/server, URL anatomy, scheme, host vs domain vs hostname, **origin**, HTTP message, method, status code theo lớp, header, stateless | 14 KB |
| [Từ vựng Network](../04-infrastructure/01-networking/00-network-vocabulary.md) | IP (public/private/loopback), port, **socket**, packet/MTU, TCP vs UDP, DNS (record/resolver/TTL), TLS/certificate/CA, proxy vs reverse proxy vs LB | 16 KB |
| [Từ vựng JavaScript](../01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) | primitive vs object, **value vs reference**, copy nông/sâu, stack vs heap, call stack, GC, sync vs async, callback, **Promise là gì**, task vs microtask, scope/closure/hoisting/TDZ | 15 KB |
| [Từ vựng API](../02-backend-api/00-http-api/00-api-vocabulary.md) | API/endpoint/resource, contract, **từng status code** và 4 cặp dễ nhầm, REST vs RESTful, stateless, DTO/serialization/validation, payload/envelope, error response | 19 KB |
| [Glossary](./glossary.md) | ~145 từ, **index thuần** — một câu nhắc + link tới canonical owner | 30 KB |
| [Foundation gap audit](./foundation-gap-audit.md) | audit 24 vùng, 6 tiêu chí tạo concept note, canonical concept rule, kế hoạch | 25 KB |

## Note được mở rộng (5 chỗ)

Chèn định nghĩa ngắn vào note có sẵn. **Không** viết lại behavior note nào.

| Note | Đã thêm |
|---|---|
| [DI & provider](../02-backend-api/02-nestjs/fundamentals/02-di-providers.md) | *"dependency là gì"* trước khi nói injection — cùng 3 điểm: dependency là **quan hệ**, injection chỉ nói **ai tạo**, nên DI **đổi chỗ** một quyết định chứ không thêm khả năng |
| [Cache patterns](../03-database/02-redis/03-cache-patterns.md) | cache hit / miss / **hit ratio**, và vì sao hit ratio là con số duy nhất nói cache có tác dụng |
| [Vì sao cần queue](../03-database/04-message-queues/01-why-queue.md) | job / producer / consumer / broker — kèm điểm quyết định: **consumer là một process khác**, và nếu bạn quên chạy nó thì API vẫn trả `200` |
| [Context engineering](../09-ai-assisted-development/02-context-engineering.md) | **context window** và token; ba hệ quả: mô hình không có bộ nhớ giữa các lần gọi, nhiều ngữ cảnh không tự động tốt hơn, đây là ràng buộc vật lý |
| [Server/client boundary](../01-web-frontend/03-nextjs/behavior/01-server-client-boundary.md) | định nghĩa 2 dòng cho server component vs client component, và vì sao **mặc định** là chỗ khó, không phải định nghĩa |

## Cross-link (23 note)

Mỗi note nhận link ở đúng **ba** vị trí — không phải mọi lần xuất hiện của khái niệm:

1. frontmatter `prerequisites`
2. một dòng `> **Chưa biết những từ này?** …` ngay sau blockquote mở đầu
3. một bullet trong `## Related`

```text
Web foundations   01, 02, 03, 05, 06, 08                       → Web / Network vocab
Networking        01, 02, 03, 05, 06 + linux/05-ports-sockets  → Network vocab
JavaScript        fundamentals/01, 03 + async-concurrency/01,02 → JS vocab
HTTP API          01, 02, 04, 05, 07, 08 + auth/01             → API vocab
```

## Điều hướng đã cập nhật

| File | Thêm gì |
|---|---|
| [README gốc](../README.md) | mục *"Tôi không biết những từ này nghĩa là gì"* — 9 dòng bảng trỏ tới canonical owner, kèm hai chế độ đọc |
| [Web foundations README](../01-web-frontend/00-web-foundations/README.md) | khối *"Vào đây từ đâu"* + note 0 trong bảng thứ tự đọc |
| [Networking README](../04-infrastructure/01-networking/README.md) | như trên, kèm gợi ý cho người sắp học Docker |
| [HTTP API README](../02-backend-api/00-http-api/README.md) | như trên, kèm đường đi khi cần **chọn mã lỗi** |
| [JS/TS README](../01-web-frontend/01-javascript-typescript/README.md) | như trên, kèm đường đi khi có bug *"state không đổi"* |

## Kết luận đáng chú ý nhất của audit

**18 trong 24 vùng đã có foundation đủ dùng từ trước.**

Lần restructure trước đã tạo ra `fundamentals/` + `behavior/`, và phần lớn `fundamentals/01-*` **đã là** foundation note — chỉ không được gọi tên như vậy và không được điều hướng tới. Ví dụ đã kiểm chứng bằng cách đọc, không chỉ đếm heading:

| Note | Tự nó nói gì |
|---|---|
| [Components & rendering model](../01-web-frontend/02-react/fundamentals/01-components-and-rendering-model.md) | tự nhận là *"TỪ ĐIỂN + MÔ HÌNH NỀN"* |
| [Architecture & ACID](../03-database/01-postgresql/fundamentals/01-architecture-and-acid.md) | *"note này giải thích PostgreSQL là CÁI GÌ ở mức process"* |
| [SQL basics](../03-database/00-sql/00-sql-basics.md) | có heading *"Cấu trúc: bảng, dòng, cột"*, *"Ràng buộc"*, *"ACID trong một câu lệnh"* |
| [Image & container](../04-infrastructure/02-docker/01-image-container.md) | *"Image là chồng layer chỉ-đọc"*, *"Container là process, không phải máy ảo"* |
| [Authn & authz](../02-backend-api/03-auth/01-authentication-authorization.md) | phân biệt thẳng *"anh là AI?"* → `401` với *"được làm gì?"* → `403` |
| [Mocking & test doubles](../05-cross-cutting/testing/04-mocking-test-doubles.md) | *"Năm loại double — chúng không tương đương nhau"* |
| [Logs, metrics, traces](../05-cross-cutting/observability/01-logs-metrics-traces.md) | phân biệt monitoring / observability bằng *"câu hỏi biết trước vs không"* |
| [Process, file, env](../04-infrastructure/00-linux/01-process-files-env.md) | nói thẳng *"nếu bạn không biết fd là gì, lỗi này là một bí ẩn"* |

Nghĩa là: **repo không thiếu chiều sâu, nó thiếu cửa vào.** Bốn note mới đều nằm ở bốn vùng nền nhất — đúng những vùng người mới gặp đầu tiên, và cũng là những vùng mà tác giả note dễ giả định nhiều nhất.

## Điều **không** làm, và vì sao

Đây là phần quan trọng của báo cáo. Danh sách này là kết quả của việc áp 6 tiêu chí trong audit, không phải của việc hết thời gian.

| Không làm | Vì sao |
|---|---|
| Folder `concepts/` ở root | vi phạm nguyên tắc *canonical owner*: khái niệm phải nằm ở folder sở hữu nó, để đọc xong là đi tiếp được ngay |
| Tách thành ~30 note nhỏ (mỗi khái niệm một file) | sẽ tạo ra file 300–500 byte; và `origin` không đọc được nếu tách khỏi `scheme/host/port` |
| Concept note cho `fixture` (0 hit), `saturation` (3 hit), `telemetry` | không phải prerequisite của bất kỳ note nào — thêm vào là biến repo thành encyclopedia |
| CSS layout, HTML semantics, data structure & algorithm | không note nào trong repo giả định chúng |
| Định nghĩa lại khái niệm trong Glossary | vi phạm canonical rule; hai bản định nghĩa lệch nhau tệ hơn một bản |
| Viết lại behavior note để chèn định nghĩa | mở đầu bằng sự cố thật là điểm mạnh của repo — chỉ thêm **một dòng** trỏ đường ở đầu |
| Dùng template behavior 14 mục cho foundation note | *foundation phải rẻ để đọc*; Break It và Production thuộc behavior |
| Cross-link mọi lần khái niệm xuất hiện | note sẽ không đọc được — chỉ 3 vị trí: lần đầu, `prerequisites`, `Related` |
| `V8/libuv` (P2), `eventual consistency` (P2) | đã có mô tả trong note behavior tương ứng; ưu tiên thấp, ghi lại trong audit để làm sau nếu cần |

## Template foundation note (7 mục)

Bốn note mới dùng chung khung này. Nó cố tình nhẹ hơn [topic-note.md](../templates/topic-note.md) (14 mục):

```text
1. Note này trả lời gì   — 1 câu + "bỏ qua nếu bạn đã biết X"
2. Vị trí                — sơ đồ 3–6 dòng
3. Định nghĩa            — mỗi khái niệm ≤ 5 dòng, kèm ví dụ cụ thể
4. Hiểu sai thường gặp   — bảng: hiểu sai | thực tế | HẬU QUẢ
5. Kiểm tra bản thân     — 5–10 câu tự trả lời
6. Đọc gì tiếp           — sơ đồ trỏ sang behavior note
7. Related
```

Mục 4 là mục làm foundation note **không** thành từ điển: mỗi hiểu sai đi kèm hậu quả thật, nên người đọc có lý do để nhớ.

## Kiểm tra chất lượng

| Kiểm tra | Kết quả |
|---|---|
| Broken link | 11 — **bằng baseline**, không tăng |
| Broken link còn lại | 10 × `07-projects/fullstack-lab/phases/` (labs chưa dựng) + 1 × placeholder trong `templates/topic-note.md` |
| Code fence lệch | 0 |
| Frontmatter `prerequisites` / `related` không giải được | 0 |
| Note mồ côi (không được link từ đâu) | 0 |
| Stub < 1 KB | 0 — validate phát hiện **1 stub có sẵn** (`00-roadmap/03-ai-assisted-learning.md`, 615 byte) được link từ README gốc; đã viết đầy đủ trong phiên này |
| Khái niệm có 2 canonical owner | 0 |
| `00-roadmap/04-topic-index.md` | sinh lại từ đĩa: 294 note, 62 nhóm |

## Bước tiếp theo

Lớp foundation xong. Việc còn lại của repo là thứ mà **không note nào thay thế được**:

> [07-projects/fullstack-lab/](../07-projects/fullstack-lab/README.md) — 10 phase, hiện chỉ có README.

Lý do nó là bước tiếp theo, không phải "thêm chủ đề": mọi note trong repo có mục **Prediction** và **Break It**, và hai mục đó **cần một môi trường đang chạy**. Đọc phân tích mà không dự đoán trước tạo ra cảm giác hiểu nhưng không tạo ra khả năng chẩn đoán lần sau.

Cụ thể hơn, bài tập có tỉ lệ (giá trị học tập)/(chi phí) cao nhất trong repo vẫn chưa được làm: **tăng từ 1 lên 2 instance sau một load balancer** → [05-platforms/](../04-infrastructure/05-platforms/README.md). Một dòng config, và sáu khái niệm trừu tượng trở thành thật.

## Related

- [Foundation gap audit](./foundation-gap-audit.md) — audit đầy đủ 24 vùng, và 6 tiêu chí
- [Glossary](./glossary.md) — index tra từ
- [Knowledge audit](./knowledge-audit.md) — audit lần đầu (coverage theo chủ đề)
- [Application engineering coverage report](./application-engineering-coverage-report.md) — báo cáo phiên trước
- [Learning system](./00-learning-system.md) — vòng MODEL → PREDICT → BREAK → EXPLAIN → RECALL
