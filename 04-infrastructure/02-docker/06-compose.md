---
level: intermediate
area: infra
prerequisites:
  - 02-container-networking.md
  - 03-volumes-state.md
related:
  - 07-production-image.md
  - ../04-kubernetes/fundamentals/01-why-kubernetes.md
---

# Docker Compose

> Người mới vào team mất một ngày rưỡi để dựng môi trường dev: cài Node đúng version, cài PostgreSQL, cài Redis, tạo database, chạy migration, tìm ra rằng cần thêm một biến môi trường không có trong tài liệu. Với Compose, quy trình đó là `git clone && docker compose up`.

## Position

```text
Compose      dev, test cục bộ, hệ thống nhỏ trên MỘT máy
                ↓ khi cần: nhiều máy, tự phục hồi, rolling update
Kubernetes   điều phối trên nhiều node
```

Compose là công cụ **một máy**. Biết giới hạn đó là điều kiện để biết khi nào cần Kubernetes — và cũng để không dùng Kubernetes quá sớm.

## Problem

Chạy một hệ thống nhiều service bằng tay:

```text
docker network create appnet
docker run -d --name db --network appnet -e POSTGRES_PASSWORD=... -v pgdata:/var/lib/... postgres:16
docker run -d --name redis --network appnet redis:7
docker run -d --name api --network appnet -e DATABASE_URL=... -p 8080:3000 myapi
```

Bốn lệnh dài, phải nhớ đúng thứ tự, và không ai gõ lại đúng lần thứ hai. Compose biến chúng thành một file được version control.

Nhưng nó cũng tạo ba vấn đề mới nếu dùng sai:

```text
① depends_on không đợi service SẴN SÀNG   → app crash lúc khởi động
② dùng Compose ở production                → không tự phục hồi, không rolling update
③ file dev và file production khác nhau     → "chạy máy tôi thì được"
```

## Mental Model

### Compose là mô tả trạng thái mong muốn cho một máy

```text
docker compose up      → tạo network, volume, container theo file
docker compose down    → xoá container + network (GIỮ volume)
docker compose down -v → xoá LUÔN volume  ← mất dữ liệu, không hỏi lại
docker compose ps      → trạng thái hiện tại
docker compose logs -f api
```

Mọi thứ Compose tạo đều có prefix theo tên project (thư mục), nên hai project không đụng nhau.

### File dev đầy đủ

```yaml
services:
  api:
    build:
      context: .
      target: dev                      # multi-stage: stage dev
    ports: ["8080:3000"]               # chỉ để truy cập TỪ HOST
    volumes:
      - .:/app                         # hot reload
      - /app/node_modules              # GIỮ node_modules từ image
    environment:
      NODE_ENV: development
      DATABASE_URL: postgres://app:secret@db:5432/app   # tên SERVICE, port TRONG container
      REDIS_URL: redis://cache:6379
    depends_on:
      db:    { condition: service_healthy }
      cache: { condition: service_started }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 20s

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/seed:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      retries: 10
    ports: ["5432:5432"]               # để công cụ GUI trên host kết nối

  cache:
    image: redis:7-alpine
    command: ["redis-server", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]

volumes:
  pgdata:
    name: myproject_pgdata             # tên tường minh → khó xoá nhầm
```

### `depends_on`: hai nghĩa rất khác nhau

```yaml
depends_on: [db]                                    # chỉ đợi container KHỞI ĐỘNG
depends_on: { db: { condition: service_healthy } }  # đợi HEALTHCHECK pass
```

Không có `condition`, Compose khởi động `api` ngay khi container `db` **bắt đầu chạy** — nhưng PostgreSQL cần vài giây để sẵn sàng nhận kết nối. Kết quả là app crash lúc khởi động.

Và ngay cả với `service_healthy`, **app vẫn phải retry**:

```text
db có thể restart bất cứ lúc nào sau đó
⇒ app phải chịu được việc dependency biến mất tạm thời
⇒ depends_on chỉ giải quyết thứ tự KHỞI ĐỘNG, không giải quyết độ tin cậy
```

Đây là bài học chuyển thẳng sang Kubernetes, nơi **không có `depends_on` gì cả**.

### `start_period`: tránh restart loop

```yaml
healthcheck:
  start_period: 30s      # trong 30 giây đầu, healthcheck fail KHÔNG tính
```

Không có nó, một app khởi động chậm (chạy migration, warm cache) bị đánh dấu unhealthy ngay và có thể bị restart liên tục.

### Override cho từng môi trường

```text
docker-compose.yml           base — dùng chung
docker-compose.override.yml  TỰ ĐỘNG áp dụng khi chạy `up`  (dev)
docker-compose.prod.yml      phải chỉ định tường minh
```

```bash
docker compose up                                    # base + override (dev)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up   # base + prod
```

```yaml
# docker-compose.override.yml — chỉ dev
services:
  api:
    build: { target: dev }
    volumes: [".:/app", "/app/node_modules"]
    command: ["npm", "run", "dev"]
    environment: { LOG_LEVEL: debug }
```

Điểm quan trọng: **override tự động áp dụng** khi chạy `docker compose up`. Nhiều người không biết điều này và ngạc nhiên vì sao cấu hình dev "tự có".

### Profile: bật/tắt nhóm service

```yaml
services:
  api: {}
  db: {}
  mailhog:
    image: mailhog/mailhog
    profiles: ["tools"]
  jaeger:
    image: jaegertracing/all-in-one
    profiles: ["tools", "tracing"]
```

```bash
docker compose up                        # chỉ api, db
docker compose --profile tools up        # + mailhog, jaeger
```

Hữu ích để giữ `up` mặc định nhẹ mà vẫn có sẵn công cụ khi cần.

### Biến môi trường và secret

```yaml
services:
  api:
    env_file: [.env]                    # nạp từ file
    environment:
      DATABASE_URL: ${DATABASE_URL:?bắt buộc}   # BẮT BUỘC, fail nếu thiếu
      LOG_LEVEL: ${LOG_LEVEL:-info}             # mặc định
```

Cú pháp `${VAR:?message}` biến biến thiếu thành lỗi rõ ràng lúc `up`, thay vì `undefined` phát hiện sau.

Với secret thật ở production, dùng Docker secret (mount thành file) thay vì env var:

```yaml
services:
  api:
    secrets: [db_password]
    environment:
      DATABASE_PASSWORD_FILE: /run/secrets/db_password
secrets:
  db_password:
    file: ./secrets/db_password.txt
```

Và `.env` phải nằm trong `.gitignore`; commit `.env.example` chỉ có tên biến.

### Giới hạn: vì sao Compose không dùng cho production nghiêm túc

```text
✗ MỘT máy — không scale ngang được thật sự
✗ `restart: always` chỉ restart, KHÔNG tự phục hồi khi node chết
✗ Không rolling update — `up` dừng container cũ rồi tạo mới → DOWNTIME
✗ Không health-based routing — traffic vẫn tới container chưa sẵn sàng
✗ Không quản lý secret theo RBAC
✗ Không autoscale
✗ `deploy.replicas` chỉ có tác dụng với Swarm
```

Compose **hợp lý** cho: môi trường dev, CI, ứng dụng nội bộ nhỏ trên một VPS mà downtime vài giây khi deploy là chấp nhận được.

Nó **không hợp lý** khi bạn cần: không downtime khi deploy, tự phục hồi khi node chết, hoặc nhiều hơn một máy.

Đó chính là ranh giới dẫn tới Kubernetes. Xem [Vì sao cần Kubernetes](../04-kubernetes/fundamentals/01-why-kubernetes.md).

### Compose trong CI

```bash
docker compose -f docker-compose.test.yml up \
  --abort-on-container-exit --exit-code-from test
docker compose -f docker-compose.test.yml down -v
```

`--exit-code-from test` làm exit code của lệnh bằng exit code của container `test` — điều kiện để CI biết test pass hay fail.

Nhưng với test tích hợp cần database, **Testcontainers thường tốt hơn**: nó quản lý vòng đời trong chính test code, cô lập giữa các test suite, và không cần file Compose riêng. Xem [Testcontainers](../../05-cross-cutting/testing/05-testcontainers.md).

## Example

Từ "một ngày rưỡi" xuống "một lệnh":

```bash
git clone repo && cd repo
cp .env.example .env
docker compose up
# → network, volume, postgres (chờ healthy), redis, api với hot reload
```

Và một `Makefile` mỏng để mọi người dùng cùng lệnh:

```makefile
up:      ; docker compose up -d
down:    ; docker compose down
logs:    ; docker compose logs -f
psql:    ; docker compose exec db psql -U app -d app
migrate: ; docker compose exec api npm run migrate
test:    ; docker compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from test
reset:   ; docker compose down -v && docker compose up -d
```

`make reset` là lệnh đáng có: nó biến "môi trường của tôi bị hỏng" thành 30 giây thay vì một buổi chiều.

## Prediction

1. `depends_on: [db]` không có condition, PostgreSQL mất 8 giây khởi động — api thế nào?
2. Thêm `condition: service_healthy` — api thế nào?
3. Ngay cả với `service_healthy`, db restart giữa chừng — api thế nào?
4. api gọi `postgres://db:8080/app` khi db có `ports: ["8080:5432"]` — đúng không?
5. Không có `ports:` cho db, api gọi `db:5432` — được không?
6. `docker compose down` — dữ liệu trong volume thế nào?
7. `docker compose down -v` — thế nào? Có xác nhận không?
8. `docker-compose.override.yml` tồn tại, chạy `docker compose up` — file nào được áp dụng?
9. `${DATABASE_URL:?required}` mà biến không được set — chuyện gì xảy ra?
10. `deploy.replicas: 3` trong Compose (không Swarm) — có 3 container không?
11. `docker compose up` khi service đang chạy và image mới hơn — có downtime không?
12. Mount `.:/app` mà không có `/app/node_modules` — `node_modules` từ image thế nào?
13. `restart: always`, máy chủ chết hoàn toàn — container thế nào?

<details>
<summary>Đáp án</summary>

1. api khởi động ngay khi container db **bắt đầu**, trước khi Postgres nhận kết nối → **crash** hoặc lỗi kết nối.
2. Compose đợi healthcheck của db pass → api khởi động khi db đã sẵn sàng.
3. api **vẫn có thể lỗi** — `depends_on` chỉ áp dụng lúc khởi động. App phải retry.
4. **Sai** — giữa container dùng port **trong** container: `db:5432`.
5. **Được** — `ports:` chỉ để truy cập từ host.
6. **Giữ nguyên.**
7. **Bị xoá**, không có xác nhận nào.
8. **Cả hai** — base + override, override tự động áp dụng.
9. Compose **fail ngay** với thông báo "required" — đây là hành vi mong muốn.
10. **Không** — `deploy` chỉ có tác dụng với Docker Swarm; Compose thường bỏ qua.
11. **Có** — Compose dừng container cũ rồi tạo mới. Không có rolling update.
12. Bị **che** bởi thư mục host — có thể trống hoặc sai kiến trúc.
13. Container **không chạy** — `restart: always` chỉ hoạt động khi Docker daemon còn sống. Không có tự phục hồi trên node khác.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `depends_on` không condition với DB chậm | api crash lúc start |
| Thêm `condition: service_healthy` | Ổn |
| Restart db khi api đang chạy | api có retry không? |
| Dùng port đã map để container gọi nhau | Refused |
| Bỏ `ports:` nhưng giữ gọi giữa container | Vẫn hoạt động |
| `docker compose down -v` | Mất dữ liệu, không cảnh báo |
| Mount `.:/app` không có anonymous volume cho `node_modules` | Bị che |
| `docker compose up` với image mới, đo downtime | Có gián đoạn |
| Bỏ `start_period` với app khởi động 30 giây | Bị đánh dấu unhealthy |
| `${VAR:?}` với biến thiếu | Fail rõ ràng lúc `up` |
| `deploy.replicas: 3` không có Swarm | Chỉ 1 container |
| Đo thời gian `docker compose up` từ đầu trên máy sạch | Thời gian onboarding thật |
| So hiệu năng bind mount trên macOS và Linux | Chênh lệch lớn |

## What Usually Goes Wrong

- **`depends_on` không có condition** → app crash lúc khởi động; lỗi phổ biến nhất.
- **App không retry kết nối** → dependency restart làm app chết.
- **Dùng port đã map để container gọi nhau** → refused.
- **`docker compose down -v` vô ý** → mất dữ liệu.
- **Mount `.` che `node_modules`** → module sai kiến trúc hoặc thiếu.
- **File dev khác xa production** → "chạy máy tôi thì được".
- **Dùng Compose ở production nghiêm túc** → downtime mỗi lần deploy, không tự phục hồi.
- **Không có `start_period`** → app khởi động chậm bị đánh dấu unhealthy.
- **`.env` bị commit** → secret trong git.
- **`deploy.replicas` tưởng có tác dụng** → chỉ Swarm mới dùng.
- **Không ghim version image** (`postgres:latest`) → môi trường dev khác nhau giữa các máy.
- **Không có lệnh reset** → mỗi lần môi trường hỏng là một buổi chiều.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `depends_on` đợi service sẵn sàng | Chỉ đợi container khởi động, trừ khi có `condition` |
| `condition: service_healthy` là đủ | App vẫn phải retry khi dependency restart |
| Cần `ports:` để container gọi nhau | Không — chỉ để truy cập từ host |
| `docker compose down` xoá dữ liệu | Không, trừ khi có `-v` |
| Compose dùng được cho production | Chỉ cho hệ thống nhỏ chấp nhận downtime |
| `restart: always` = tự phục hồi | Chỉ khi daemon còn sống; node chết thì không |
| `deploy.replicas` scale được | Chỉ với Swarm |
| Override file phải chỉ định tường minh | `docker-compose.override.yml` tự động áp dụng |
| Compose và Kubernetes cùng loại công cụ | Một cái cho một máy, một cái cho cụm |
| Bind mount nhanh như nhau ở mọi OS | Trên macOS/Windows chậm hơn nhiều |

## Debugging

1. **Service không khởi động** → `docker compose logs <svc>`; `docker compose ps` xem trạng thái và exit code.
2. **Không gọi được nhau** → cùng network không? Dùng tên service chưa? Port trong container hay port đã map?
3. **Healthcheck fail** → chạy lệnh healthcheck bằng tay: `docker compose exec db pg_isready -U app`.
4. **Biến môi trường sai** → `docker compose config` in ra file đã resolve mọi biến. Đây là lệnh hay bị bỏ qua và rất hữu ích.
5. **Volume/quyền** → `docker compose exec <svc> ls -ld <path>` và `id`.
6. **Hot reload không hoạt động** → mount đúng chưa? Trên macOS/Windows, file watcher có thể cần polling.
7. **Môi trường "hỏng"** → `docker compose down -v && docker compose up --build` (nếu chấp nhận mất dữ liệu dev).

## Production Considerations

- **Compose cho dev và CI**; cân nhắc kỹ trước khi dùng ở production.
- **Nếu dùng ở production trên một VPS**: ghim version image, có backup volume, có monitoring, và chấp nhận downtime khi deploy.
- **Ghim version mọi image** (`postgres:16.2-alpine`) — dev nhất quán giữa các máy.
- **Healthcheck cho mọi service**, với `start_period` phù hợp.
- **`${VAR:?}` cho biến bắt buộc** — fail sớm và rõ ràng.
- **`.env` trong `.gitignore`; `.env.example` trong git.**
- **Một lệnh để dựng, một lệnh để reset** — ghi trong README.
- **Giữ file Compose gần production nhất có thể** (cùng image, cùng biến, chỉ khác giá trị) — nó giảm lớp bug "chỉ có ở production".
- **App phải retry kết nối dependency** — đây là điều kiện để chạy được ở bất kỳ đâu, không riêng Compose.
- **Chuyển sang Kubernetes khi** bạn cần: không downtime khi deploy, tự phục hồi khi node chết, hoặc nhiều hơn một máy. Không sớm hơn.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Compose cho dev | onboarding một lệnh, môi trường nhất quán | thêm một lớp; chậm hơn chạy native |
| Chạy native | nhanh nhất, IDE tích hợp tốt | "chạy máy tôi thì được" |
| Bind mount code | hot reload | chậm trên macOS/Windows |
| Copy code vào image | nhanh | phải rebuild mỗi lần đổi |
| `depends_on` + healthcheck | thứ tự khởi động đúng | vẫn cần retry ở app |
| Không `depends_on` | đơn giản | app phải chịu mọi thứ tự |
| Compose ở production | rất đơn giản, rẻ | downtime khi deploy, không tự phục hồi |
| Kubernetes | rolling update, tự phục hồi, scale | phức tạp lớn, cần người vận hành |
| Compose trong CI | giống dev | chậm hơn; Testcontainers thường tốt hơn |
| Testcontainers | cô lập theo test, quản lý trong code | chỉ cho test, không cho dev |

## Explain Without Notes

1. `depends_on` với và không có `condition` khác nhau thế nào? Cả hai vẫn thiếu gì?
2. Giữa hai container, dùng port nào — port đã map hay port trong container?
3. `docker compose down` và `down -v` khác nhau thế nào?
4. File override hoạt động thế nào? Cái nào tự động áp dụng?
5. Vì sao Compose không dùng cho production nghiêm túc? Kể bốn giới hạn.
6. Vì sao app vẫn phải retry dù đã có healthcheck?
7. `docker compose config` dùng để làm gì?
8. Ranh giới nào cho biết đã đến lúc chuyển sang Kubernetes?

## Related

- [Container networking](02-container-networking.md) — DNS theo tên service
- [Volumes & state](03-volumes-state.md) — named volume, anonymous volume
- [Dockerfile & build cache](05-dockerfile-build-cache.md) — `target` cho multi-stage
- [Production image](07-production-image.md) — image dùng ở production
- [Vì sao cần Kubernetes](../04-kubernetes/fundamentals/01-why-kubernetes.md) — giới hạn của Compose
- [Common failures](08-common-failures.md) — lỗi kinh điển
- [Testcontainers](../../05-cross-cutting/testing/05-testcontainers.md) — thay Compose trong test
- [Configuration](../../02-backend-api/04-architecture/05-configuration.md) — biến môi trường
- [Fullstack Lab](../../07-projects/fullstack-lab/README.md) — nơi dựng môi trường này

## Version / Context

Docker Compose v2 (lệnh `docker compose`, không phải `docker-compose`). Trường `version:` trong file đã lỗi thời và không cần nữa. `depends_on` với `condition` cần Compose v2. `profiles` từ Compose 1.28+. `deploy` chỉ có tác dụng với Docker Swarm.
