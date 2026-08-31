# Engineering Learning

Kho kiến thức để học **Full-stack Engineering + Infrastructure** theo **behavior của hệ thống**, không học thuộc framework.

Nguyên tắc trung tâm:

> Đơn vị học là một **behavior / problem** của hệ thống.
> Framework, library và công cụ chỉ là phương tiện để quan sát behavior đó.

Vì vậy repo này không có note "Học Redis". Nó có note trả lời: *vì sao cần cache → cache hit/miss → stale data → TTL → invalidation → stampede → distributed cache → Redis*.

---

## Tôi nên bắt đầu ở đâu?

1. Đọc [Learning System](./00-roadmap/00-learning-system.md) — vòng học `MODEL → PREDICT → BREAK → EXPLAIN → RECALL`. Khoảng 5 phút.
2. Mở [Roadmap](./00-roadmap/02-roadmap.md) — 12 behavior theo thứ tự phụ thuộc. Bắt đầu ở **Behavior 01**.
3. Dựng [Fullstack Lab](./07-projects/fullstack-lab/README.md) — mọi experiment cần một nơi để chạy.
4. Mỗi buổi ghi một note từ [template](./templates/learning-log.md) vào [08-learning-log/](./08-learning-log/README.md). Chỉ ghi cái bạn **dự đoán sai**.

Nếu bạn chỉ có 30 phút đầu tiên: đọc Learning System, rồi đọc [Browser request → render](./01-web-frontend/00-web-foundations/01-browser-request-render.md) và trả lời phần *Prediction* của nó bằng bút.

## Tôi không biết những từ này nghĩa là gì

Repo này viết theo behavior: mỗi note mở đầu bằng một sự cố thật. Cách đó rất tốt **nếu bạn đã có từ vựng**, và vô dụng nếu chưa. Vì vậy có một lớp **foundation** riêng — nhẹ, không có failure mode, đọc 10–12 phút:

| Bạn chưa chắc | Đọc |
|---|---|
| URL, origin, header, status code, request/response | [Từ vựng Web](./01-web-frontend/00-web-foundations/00-web-vocabulary.md) |
| IP, port, socket, packet, TCP/UDP, DNS, TLS | [Từ vựng Network](./04-infrastructure/01-networking/00-network-vocabulary.md) |
| value vs reference, stack/heap, sync/async, Promise **là gì** | [Từ vựng JavaScript](./01-web-frontend/01-javascript-typescript/fundamentals/00-js-vocabulary.md) |
| endpoint, `401` vs `403`, `400` vs `422`, REST, DTO | [Từ vựng API](./02-backend-api/00-http-api/00-api-vocabulary.md) |
| bảng, dòng, khoá chính, transaction, ACID | [SQL basics](./03-database/00-sql/00-sql-basics.md) |
| PostgreSQL là gì ở mức process | [Architecture & ACID](./03-database/01-postgresql/fundamentals/01-architecture-and-acid.md) |
| component, props, state, render | [Components & rendering model](./01-web-frontend/02-react/fundamentals/01-components-and-rendering-model.md) |
| image vs container | [Image & container](./04-infrastructure/02-docker/01-image-container.md) |
| authentication vs authorization | [Authentication & authorization](./02-backend-api/03-auth/01-authentication-authorization.md) |

Tra một từ lẻ: [Glossary](./00-roadmap/glossary.md) — index, mỗi từ một dòng và một link.

Hai chế độ đọc, và repo phục vụ cả hai:

```text
"tôi không biết từ này"      → foundation note  → hiểu NÓ LÀ GÌ
"nó hoạt động và hỏng sao?"   → behavior note    → failure, debugging, production
```

## Tôi đang học X thì đọc gì?

| Bạn đang học | Vào đây |
|---|---|
| Web / browser fundamentals | [01-web-frontend/00-web-foundations/](./01-web-frontend/00-web-foundations/README.md) |
| JavaScript / TypeScript | [01-web-frontend/01-javascript-typescript/](./01-web-frontend/01-javascript-typescript/README.md) |
| React | [01-web-frontend/02-react/](./01-web-frontend/02-react/README.md) |
| Next.js | [01-web-frontend/03-nextjs/](./01-web-frontend/03-nextjs/README.md) |
| HTTP / API design | [02-backend-api/00-http-api/](./02-backend-api/00-http-api/README.md) |
| Node.js | [02-backend-api/01-nodejs/](./02-backend-api/01-nodejs/README.md) |
| NestJS | [02-backend-api/02-nestjs/](./02-backend-api/02-nestjs/README.md) |
| Authentication / Authorization | [02-backend-api/03-auth/](./02-backend-api/03-auth/README.md) |
| Email, webhook gửi ra, file storage | [02-backend-api/05-integrations/](./02-backend-api/05-integrations/README.md) |
| SQL | [03-database/00-sql/](./03-database/00-sql/README.md) |
| PostgreSQL | [03-database/01-postgresql/](./03-database/01-postgresql/README.md) |
| Prisma / ORM / data access | [03-database/05-data-access/](./03-database/05-data-access/README.md) |
| Redis / cache | [03-database/02-redis/](./03-database/02-redis/README.md) |
| Queue / messaging | [03-database/04-message-queues/](./03-database/04-message-queues/README.md) |
| MongoDB / NoSQL | [03-database/06-mongodb/](./03-database/06-mongodb/README.md) |
| Linux | [04-infrastructure/00-linux/](./04-infrastructure/00-linux/README.md) |
| Networking | [04-infrastructure/01-networking/](./04-infrastructure/01-networking/README.md) |
| Docker | [04-infrastructure/02-docker/](./04-infrastructure/02-docker/README.md) |
| CI/CD | [04-infrastructure/03-cicd/](./04-infrastructure/03-cicd/README.md) |
| Kubernetes | [04-infrastructure/04-kubernetes/](./04-infrastructure/04-kubernetes/README.md) |
| Deploy ở đâu (VPS/PaaS/Cloudflare/edge) | [04-infrastructure/05-platforms/](./04-infrastructure/05-platforms/README.md) |
| Security, testing, observability, performance, reliability, concurrency | [05-cross-cutting/](./05-cross-cutting/README.md) |
| System design | [06-system-design/](./06-system-design/README.md) |
| Làm việc với AI | [09-ai-assisted-development/](./09-ai-assisted-development/README.md) |

## Tôi biết công nghệ rồi — xây application thật thì sao?

Đây là câu hỏi khác hẳn, và nó có view riêng:

> **[Application Engineering Map](./00-roadmap/application-engineering-map.md)**

Nó nhóm note theo **problem** thay vì theo công nghệ: data fetching · hệ thống chậm · data access · architecture · database choice · reliability. Dùng nó khi câu hỏi của bạn bắt đầu bằng *"làm sao"* thay vì *"cái gì"*:

```text
"Redis là gì?"                         → Topic Index
"Màn hình gọi 8 API thì tổ chức sao?"  → Application Engineering Map
```

Và khi muốn luyện chẩn đoán: [5 scenario thật](./05-cross-cutting/scenarios/01-scenario-walkthroughs.md) — tự trả lời trước khi xem phân tích.

## Tôi đang debug, tìm ở đâu?

Đi từ **triệu chứng** chứ không từ công nghệ: [Behavior Index](./00-roadmap/behavior-index.md).

Ví dụ có sẵn trong đó: *"dữ liệu nhảy về giá trị cũ"*, *"nhanh với 1k dòng, chết với 1M dòng"*, *"chạy trên máy nhưng chết trong container"*, *"pod CrashLoopBackOff"*, *"user A đọc được dữ liệu của user B"*.

Nếu bạn biết vấn đề nằm ở tầng nào rồi thì dùng [Knowledge Map](./00-roadmap/knowledge-map.md) (tra theo tầng hệ thống).

## Tôi muốn học Docker / Kubernetes, cần biết gì trước?

Đây là chỗ hay bị nhảy bậc nhất, nên trả lời thẳng:

**Trước Docker**, cần hiểu ở mức có thể tự debug:

- process là gì, PID 1 là gì, signal làm gì → [Process, file, env](./04-infrastructure/00-linux/01-process-files-env.md), [Signals & lifecycle](./04-infrastructure/00-linux/04-signals-lifecycle.md)
- port và socket: ai listen ở đâu, bind `127.0.0.1` khác `0.0.0.0` thế nào → [Ports & sockets](./04-infrastructure/00-linux/05-ports-sockets.md)
- filesystem và permission: UID, ownership → [Filesystem & permissions](./04-infrastructure/00-linux/03-filesystem-permissions.md)
- environment variable và cách app đọc config → [Configuration](./02-backend-api/04-architecture/05-configuration.md)
- DNS và IP cơ bản → [IP, port, DNS](./04-infrastructure/01-networking/01-ip-port-dns.md)

Không có 5 thứ trên, `docker run` sẽ là phép thuật và mọi lỗi sẽ là bí ẩn.

**Và trước Kubernetes, hãy deploy thật một lần.** Đây là khoảng trống mà [05-platforms/](./04-infrastructure/05-platforms/README.md) lấp: giữa `docker-compose` trên laptop và một K8s cluster có VPS, PaaS, serverless, edge — nơi phần lớn dự án thật sống. Quan trọng hơn: bạn **không kiểm chứng được** graceful shutdown, readiness probe, cache per-instance hay pool sizing cho tới khi có **hai instance sau một load balancer**. Tăng lên 2 replica là bài tập có giá trị học tập cao nhất và rẻ nhất trong repo này.

**Trước Kubernetes**, cần thêm:

- Docker: image vs container, layer, volume, network → [02-docker/](./04-infrastructure/02-docker/README.md)
- Docker Compose ở mức đã tự dựng được multi-service → [Compose](./04-infrastructure/02-docker/06-compose.md)
- Networking: reverse proxy, load balancer, TLS termination → [Reverse proxy & load balancer](./04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md)
- Health check và graceful shutdown trong app của bạn → [Graceful shutdown](./02-backend-api/01-nodejs/production/02-graceful-shutdown.md)
- Và quan trọng nhất: **đã tự gặp giới hạn của Compose** → [Vì sao cần Kubernetes](./04-infrastructure/04-kubernetes/fundamentals/01-why-kubernetes.md)

Học K8s trước khi gặp vấn đề mà nó giải quyết là cách nhanh nhất để thuộc YAML mà không hiểu gì.

## Xương sống

Mọi note đều định vị được trên đường đi của một request:

```text
Browser → React/Next.js → HTTP → Reverse proxy → NestJS → Domain logic
   → Cache/Queue → PostgreSQL → OS → Container → Network → Kubernetes
```

Chi tiết từng tầng: [Knowledge Map](./00-roadmap/knowledge-map.md).
Các chủ đề chạy xuyên tất cả các tầng: [05-cross-cutting/](./05-cross-cutting/README.md).

## Cách học mặc định

```text
MODEL      → hiểu problem trước khi hiểu API
PREDICT    → viết dự đoán ra giấy TRƯỚC khi chạy
BUILD      → ví dụ nhỏ nhất kiểm chứng được
BREAK      → cố tình làm hỏng, quan sát failure mode
EXPLAIN    → giải thích lại, không nhìn tài liệu
RECALL     → buổi sau, 5 phút nhắc lại
```

Bước dễ bị bỏ nhất là **PREDICT**, và đó cũng là bước duy nhất tạo ra học tập thật: nếu bạn không dự đoán thì bạn không thể sai, và nếu không sai thì mental model không được sửa.

Cấu trúc một note đầy đủ: [templates/topic-note.md](./templates/topic-note.md).

## Nguyên tắc dùng AI

AI có thể scaffold, sinh boilerplate, viết test mẫu và review code. Nhưng:

> AI có thể làm hộ implementation, nhưng không được lấy mất **feedback** cần thiết để bạn hình thành mental model.

Cụ thể: đừng để AI làm hộ *prediction*, *thiết kế experiment*, *kết luận nguyên nhân bug*, *explanation bằng lời của bạn*, *quyết định trade-off*.

- Dùng AI để **học**: [AI-Assisted Learning](./00-roadmap/03-ai-assisted-learning.md)
- Dùng AI để **làm việc**: [09-ai-assisted-development/](./09-ai-assisted-development/README.md)

## Tiêu chuẩn của repo này

Một note được coi là xong khi nó trả lời được:

1. **Position** — nằm ở đâu trên xương sống?
2. **Problem** — vấn đề nào khiến nó tồn tại?
3. **Mental model** — hình dung lại được từ đầu?
4. **Failure mode** — hỏng thế nào trong thực tế?
5. **Debugging** — kiểm tra theo thứ tự nào?
6. **Trade-off** — đổi gì lấy gì, khi nào **không** dùng?

Mục tiêu cuối không phải nói được *"tôi đã học React, NestJS, PostgreSQL, Docker, Kubernetes"*, mà là khi một behavior xảy ra thì hỏi được:

```text
Điều gì đang xảy ra?
Nó xảy ra ở tầng nào?
Giả định nào của tôi có thể sai?
Experiment nào kiểm chứng được?
Failure mode là gì?
Tôi debug từ đâu?
Trade-off của giải pháp này là gì?
```

## Bản đồ điều hướng

| File | Dùng khi |
|---|---|
| [00-roadmap/02-roadmap.md](./00-roadmap/02-roadmap.md) | Muốn biết học gì tiếp theo |
| [00-roadmap/behavior-index.md](./00-roadmap/behavior-index.md) | Đang gặp một triệu chứng cụ thể |
| [00-roadmap/knowledge-map.md](./00-roadmap/knowledge-map.md) | Biết tầng nào đang có vấn đề |
| [00-roadmap/04-topic-index.md](./00-roadmap/04-topic-index.md) | Muốn tra theo tên công nghệ |
| [00-roadmap/project-roadmap.md](./00-roadmap/project-roadmap.md) | Muốn biết phase nào build cái gì |
| [00-roadmap/knowledge-audit.md](./00-roadmap/knowledge-audit.md) | Muốn biết repo này thiếu gì |
| [00-roadmap/final-coverage-report.md](./00-roadmap/final-coverage-report.md) | Muốn biết vùng nào cố tình chưa đào sâu |
| [00-roadmap/glossary.md](./00-roadmap/glossary.md) | Muốn tra nghĩa một từ lẻ |
| [00-roadmap/foundation-gap-audit.md](./00-roadmap/foundation-gap-audit.md) | Muốn biết note nào giả định bạn đã biết gì |
| [00-roadmap/foundation-coverage-report.md](./00-roadmap/foundation-coverage-report.md) | Muốn biết lớp foundation gồm những gì |
| [00-roadmap/foundation-accuracy-report.md](./00-roadmap/foundation-accuracy-report.md) | Muốn biết chỗ nào cố tình đơn giản hoá, và đơn giản hoá tới đâu |
