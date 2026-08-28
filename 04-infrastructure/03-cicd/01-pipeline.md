---
level: intermediate
area: infra
prerequisites:
  - ../02-docker/05-dockerfile-build-cache.md
related:
  - 02-build-artifact-promotion.md
  - 03-deployment-strategies.md
  - ../../05-cross-cutting/testing/01-testing-pyramid-behavior.md
---

# CI/CD pipeline

> Pipeline mất 28 phút. Người ta ngừng chạy nó trước khi mở PR. Rồi họ gộp ba thay đổi vào một commit để chỉ phải chờ một lần. Khi có lỗi, không ai biết thay đổi nào gây ra. Pipeline chậm không chỉ tốn thời gian — nó **thay đổi cách người ta viết code**, và luôn theo hướng xấu hơn.

## Position

```text
push → CI: kiểm tra + build artifact → CD: deploy artifact đó qua các môi trường
          ↑ note này                      ↑ note 02 và 03
```

## Problem

Không có pipeline, mỗi lần deploy là một nghi thức thủ công:

```text
· "nhớ chạy test trước nhé"
· "build trên máy ai?"
· "phiên bản nào đang chạy ở staging?"
· "ai đã deploy lúc 2 giờ chiều?"
```

Nhưng pipeline **cũng tạo ra vấn đề mới** nếu thiết kế sai:

```text
① CHẬM         → người ta né tránh, gộp commit, giảm tần suất deploy
② GIÒN         → test flaky làm mất niềm tin; "cứ re-run là được"
③ KHÔNG NHẤT QUÁN → build khác nhau giữa các môi trường
④ KHÔNG AN TOÀN → secret trong log, quyền quá rộng
```

Vấn đề ② nguy hiểm nhất về lâu dài: một pipeline mà mọi người re-run khi đỏ là một pipeline không còn tác dụng bảo vệ.

## Mental Model

### CI và CD là hai thứ khác nhau

```text
CI (Continuous Integration)
   "code mới có tích hợp được không?"
   → lint, type check, test, build, quét bảo mật
   → OUTPUT: một ARTIFACT đã được kiểm chứng

CD (Continuous Delivery / Deployment)
   "artifact đó đi tới môi trường thế nào?"
   → deploy, migration, smoke test, rollback
   → Delivery: sẵn sàng deploy, có nút bấm
   → Deployment: tự động lên production
```

Ranh giới quan trọng: **CI tạo artifact; CD di chuyển nó.** Nếu CD build lại, bạn không còn đảm bảo thứ test được là thứ chạy. Xem [Build & artifact promotion](02-build-artifact-promotion.md).

### Nguyên tắc: nhanh trước, chậm sau

```text
① lint + type check    ~30s   fail nhanh nhất, rẻ nhất
② unit test            ~1m    song song với ①
③ build image          ~2m    có cache
④ integration test     ~3m    cần DB thật (Testcontainers)
⑤ quét bảo mật         ~1m    song song với ④
⑥ e2e (chọn lọc)       ~5m    chỉ luồng quan trọng
```

Mục tiêu: **phản hồi đầu tiên dưới 2 phút, toàn bộ dưới 10 phút.**

Lý do không phải sự tiện lợi mà là hành vi: pipeline 10 phút được chạy trước mỗi PR; pipeline 30 phút thì không.

### Song song hoá

```yaml
jobs:
  lint:  { runs-on: ubuntu-latest, steps: [...] }
  test:  { runs-on: ubuntu-latest, steps: [...] }
  build: { runs-on: ubuntu-latest, steps: [...] }
  integration:
    needs: [build]                  # chỉ cái này cần build
    steps: [...]
```

`lint`, `test`, `build` không phụ thuộc nhau → chạy song song. Tổng thời gian = job dài nhất, không phải tổng các job.

Và với test suite lớn, chia theo shard:

```yaml
strategy:
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: npm test -- --shard=${{ matrix.shard }}/4
```

### Cache: nơi tiết kiệm nhiều nhất

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 20, cache: npm }      # cache ~/.npm

- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max               # cache LAYER, kể cả stage trung gian
```

Runner của CI là **ephemeral** — sạch mỗi lần. Không cấu hình cache, mọi build là build từ đầu. Đây là khác biệt lớn nhất giữa "12 giây ở local" và "11 phút ở CI". Xem [Dockerfile & build cache](../02-docker/05-dockerfile-build-cache.md).

### Test flaky: xử lý như bug, không như phiền toái

```text
Test flaky → người ta re-run → mất niềm tin → bỏ qua cả test thật đỏ
```

Ba nguồn chính, và tất cả đều sửa được:

```text
· phụ thuộc thời gian     → tiêm đồng hồ; tránh sleep cố định
· phụ thuộc thứ tự        → mỗi test tự dọn dẹp; chạy random order để phát hiện
· dùng chung tài nguyên   → mỗi worker một schema/database riêng
```

Chính sách thực dụng: **quarantine test flaky ngay** (đánh dấu skip, tạo issue) thay vì để nó làm nhiễu. Một test bị skip có ghi chép tốt hơn một test đỏ ngẫu nhiên. Xem [Deterministic tests](../../05-cross-cutting/testing/06-deterministic-tests.md).

### Secret trong CI

```yaml
- run: ./deploy.sh
  env:
    DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

Bốn quy tắc:

```text
① KHÔNG BAO GIỜ echo secret — CI thường mask, nhưng đừng dựa vào đó
② KHÔNG truyền secret qua `docker build --build-arg` (vào docker history)
   → dùng --mount=type=secret
③ Secret cho PR từ fork phải bị CHẶN — nếu không, ai cũng đọc được
④ Ưu tiên OIDC federation thay vì long-lived token
```

Điểm ③ là lỗ hổng phổ biến: một PR từ fork chạy workflow có quyền truy cập secret nghĩa là bất kỳ ai cũng có thể lấy chúng bằng một dòng code.

Điểm ④ đáng đầu tư: OIDC cấp credential ngắn hạn theo từng job, không có token dài hạn để rò rỉ.

```yaml
permissions:
  contents: read
  id-token: write          # OIDC
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123:role/ci-deploy
```

### Quyền tối thiểu

```yaml
permissions:
  contents: read            # mặc định cho mọi workflow
```

Rồi cấp thêm đúng chỗ cần. Mặc định của nhiều hệ thống CI là quyền rộng — và một action bên thứ ba bị chiếm quyền sẽ dùng đúng quyền đó.

Ghim action theo SHA, không theo tag:

```yaml
- uses: actions/checkout@8e5e7e5ab8b370d6c329ec480221332ada57f0ab   # v3.5.2
```

Tag di chuyển được; một tag bị ghi đè là một cuộc tấn công chuỗi cung ứng.

### Migration trong pipeline

```text
build image → chạy MIGRATION (job riêng, MỘT lần) → rollout app
```

Ba điều bắt buộc:

```text
① Migration là BƯỚC RIÊNG, không phải onModuleInit của app
② Chạy TRƯỚC rollout (code mới có thể cần cột mới)
③ Tương thích ngược — trong rollout có hai phiên bản code, một schema
```

Xem [Migrations](../../03-database/03-data-modeling/04-migrations.md).

### Cổng chất lượng thực dụng

```text
CHẶN merge:
  · lint, type check
  · unit + integration test
  · build thành công
  · lỗ hổng CRITICAL trong dependency mới

CẢNH BÁO, không chặn:
  · coverage giảm
  · kích thước bundle tăng
  · CVE không có bản vá
```

Chặn quá nhiều thứ làm người ta tìm cách vòng qua. Coverage threshold đặc biệt đáng cân nhắc: nó khuyến khích viết test dễ nhất, không phải test giá trị nhất.

## Example

Pipeline hoàn chỉnh, dưới 10 phút:

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true          # huỷ run cũ khi push mới — tiết kiệm runner

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --coverage

  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_PASSWORD: test }
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-retries 10
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run migrate
        env: { DATABASE_URL: postgres://postgres:test@localhost:5432/postgres }
      - run: npm run test:integration
        env: { DATABASE_URL: postgres://postgres:test@localhost:5432/postgres }

  build:
    needs: [check, integration]
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        id: push
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            GIT_SHA=${{ github.sha }}
      - uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/${{ github.repository }}:${{ github.sha }}
          severity: HIGH,CRITICAL
          exit-code: '1'
      - run: echo "digest=${{ steps.push.outputs.digest }}" >> $GITHUB_STEP_SUMMARY
```

Bốn chi tiết đáng chú ý:

```text
concurrency + cancel-in-progress   không tốn runner cho commit đã lỗi thời
tag = SHA                          bất biến, truy vết được về commit
digest ghi ra summary              CD dùng digest, không dùng tag
services + healthcheck             DB thật cho integration test, chờ sẵn sàng
```

## Prediction

1. Pipeline 28 phút — nó ảnh hưởng hành vi của team thế nào?
2. `lint`, `test`, `build` chạy tuần tự vs song song — tổng thời gian?
3. Không cấu hình cache Docker trên runner ephemeral — bao nhiêu layer được dùng lại?
4. Test flaky 5%, chạy 20 lần/ngày — bao nhiêu lần đỏ giả mỗi tuần?
5. Hệ quả với niềm tin vào pipeline?
6. Secret truyền qua `--build-arg`, image được push — ai đọc được?
7. Workflow chạy trên PR từ fork và có quyền truy cập secret — rủi ro gì?
8. Action ghim theo tag `@v3`, tag bị ghi đè bởi kẻ tấn công — hậu quả?
9. Migration chạy trong `onModuleInit` với 3 replica — chuyện gì xảy ra?
10. Migration chạy **sau** rollout, code mới cần cột mới — kết quả?
11. CD build lại image từ source thay vì dùng artifact của CI — mất gì?
12. Không có `concurrency: cancel-in-progress`, push 5 commit liên tiếp — bao nhiêu run chạy?
13. Coverage threshold 80% chặn merge — hành vi nào được khuyến khích?

<details>
<summary>Đáp án</summary>

1. Người ta né chạy nó, gộp nhiều thay đổi vào một commit, deploy ít hơn — và khi lỗi thì khó xác định nguyên nhân.
2. Tuần tự = tổng; song song = job dài nhất. Với 30s + 60s + 120s: 3,5 phút vs 2 phút.
3. **Không layer nào** — runner sạch mỗi lần.
4. 20 × 5 ngày × 5% = **5 lần đỏ giả/tuần**.
5. Người ta re-run theo phản xạ → và rồi re-run qua cả lỗi thật.
6. Bất kỳ ai pull được image — `--build-arg` hiện trong `docker history`.
7. Bất kỳ ai mở PR đều có thể in secret ra (hoặc gửi đi nơi khác). Phải chặn secret cho PR từ fork.
8. Code của kẻ tấn công chạy với quyền của workflow — bao gồm mọi secret nó truy cập được.
9. Ba migration chạy song song; tuỳ công cụ mà lỗi khoá hoặc chạy trùng một phần.
10. Code mới lỗi cho mọi request cần cột đó, từ lúc rollout tới lúc migration xong.
11. Mất đảm bảo "thứ test được là thứ chạy" — build có thể khác nhau.
12. **5 run song song**, 4 trong số đó cho commit đã lỗi thời.
13. Viết test **dễ nhất** để lấp số, không phải test giá trị nhất.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Đo thời gian pipeline hiện tại, chia theo job | Job nào chiếm phần lớn |
| Chuyển job độc lập sang song song | So tổng thời gian |
| Bỏ cache Docker, build lại | Thời gian tăng mạnh |
| Thêm `cache-to: type=gha,mode=max` | Giảm |
| Chạy test suite 20 lần liên tiếp | Đếm số lần đỏ ngẫu nhiên |
| Chạy test với thứ tự ngẫu nhiên | Phát hiện phụ thuộc thứ tự |
| Truyền secret qua `--build-arg`, `docker history` | Thấy secret |
| Đổi sang `--mount=type=secret` | Không thấy |
| Bỏ `concurrency`, push 5 commit | 5 run song song |
| Thêm `cancel-in-progress` | 1 run |
| Chạy migration sau rollout với thay đổi phá vỡ | Lỗi trong cửa sổ rollout |
| Đo thời gian từ push tới phản hồi đầu tiên | Chỉ số quan trọng nhất |

## What Usually Goes Wrong

- **Pipeline chậm** → thay đổi hành vi của team theo hướng xấu.
- **Không cache trong CI** → mọi build từ đầu.
- **Test flaky không xử lý** → mất niềm tin, re-run qua cả lỗi thật.
- **Job tuần tự không cần thiết** → thời gian bằng tổng thay vì bằng job dài nhất.
- **CD build lại thay vì dùng artifact của CI** → thứ test được không phải thứ chạy.
- **Secret qua `--build-arg`** → nằm trong image.
- **Secret cho PR từ fork** → ai cũng lấy được.
- **Action ghim theo tag** → rủi ro chuỗi cung ứng.
- **Quyền workflow quá rộng** → một action bị chiếm quyền có toàn quyền.
- **Migration trong app** hoặc chạy sau rollout → downtime.
- **Chặn merge vì coverage** → khuyến khích test rỗng.
- **Không có `cancel-in-progress`** → lãng phí runner cho commit lỗi thời.
- **Không đo thời gian pipeline** → không biết mình đang mất bao nhiêu.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| CI và CD là một | CI tạo artifact; CD di chuyển nó |
| Pipeline chậm chỉ tốn thời gian | Nó thay đổi cách người ta viết code |
| Test flaky là phiền toái nhỏ | Nó phá huỷ giá trị của toàn bộ suite |
| Re-run là cách xử lý hợp lý | Nó dạy team bỏ qua tín hiệu đỏ |
| CI mặc định có cache | Runner ephemeral sạch mỗi lần |
| Secret được CI mask nên an toàn | Mask không hoàn hảo; đừng echo secret |
| `--build-arg` phù hợp cho token | Nó vào `docker history` |
| Coverage cao = chất lượng cao | Nó đo dòng chạy, không đo khẳng định |
| Nhiều cổng chất lượng thì tốt hơn | Chặn quá nhiều làm người ta tìm đường vòng |
| Deploy tự động lên production luôn đúng | Delivery (có nút bấm) là lựa chọn hợp lý cho nhiều đội |

## Debugging

1. **Pipeline chậm** → chia theo job và step; tìm bước chiếm phần lớn.
2. **Job nào chờ job nào?** Vẽ đồ thị phụ thuộc; tìm phụ thuộc không cần thiết.
3. **Cache có hoạt động không?** Đọc log build — không có dòng `CACHED` nghĩa là không.
4. **Test flaky** → chạy nhiều lần, chạy random order, chạy song song. Ghi lại test nào đỏ và tần suất.
5. **Xanh ở CI, đỏ ở local (hoặc ngược lại)** → so biến môi trường, múi giờ (`TZ`), phiên bản Node, và dữ liệu test.
6. **Deploy fail** → artifact nào? Digest gì? Migration đã chạy chưa?
7. **Đo bốn chỉ số DORA**: tần suất deploy, thời gian từ commit tới production, tỉ lệ deploy gây lỗi, thời gian phục hồi. Chúng cho biết pipeline đang giúp hay đang cản.

## Production Considerations

- **Đặt ngân sách thời gian**: phản hồi đầu tiên < 2 phút, toàn bộ < 10 phút. Vượt ngân sách là một bug cần sửa.
- **Song song hoá tối đa**; chỉ giữ phụ thuộc thật sự.
- **Cache mọi thứ cache được**: package manager, Docker layer, build output.
- **Xử lý test flaky như bug P1** — quarantine ngay, sửa trong sprint.
- **Quyền tối thiểu; ghim action theo SHA; ưu tiên OIDC** thay vì token dài hạn.
- **Chặn secret cho PR từ fork.**
- **Migration là bước riêng, chạy trước rollout, tương thích ngược.**
- **Tag image bằng SHA; deploy bằng digest.**
- **Smoke test sau deploy** — nó bắt được vấn đề cấu hình mà không test nào ở CI bắt được.
- **Rollback phải nhanh hơn fix-forward** và phải được diễn tập. Nếu rollback mất 20 phút, nó không phải phương án khi đang có sự cố.
- **Đo DORA metrics** — chúng là thước đo khách quan cho việc pipeline đang giúp hay cản.
- **Ghi lại ai deploy gì lúc nào** — câu hỏi đầu tiên của mọi sự cố.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Pipeline nhanh | chạy thường xuyên, feedback sớm | ít kiểm tra hơn |
| Pipeline kỹ | bắt nhiều lỗi | chậm, người ta né |
| Song song hoá | nhanh | tốn runner, phức tạp hơn |
| Tuần tự | đơn giản, dễ đọc | chậm |
| Chặn merge nhiều điều kiện | chất lượng ổn định | người ta tìm đường vòng |
| Cảnh báo thay vì chặn | linh hoạt | có thể bị bỏ qua |
| Deploy tự động lên production | nhanh, ít việc tay | rủi ro cao hơn, cần rollback tốt |
| Delivery (có nút bấm) | kiểm soát | chậm hơn, phụ thuộc con người |
| Self-hosted runner | nhanh (cache bền), rẻ hơn ở quy mô lớn | phải vận hành, rủi ro bảo mật |
| Runner của nhà cung cấp | không vận hành | không có cache bền, giới hạn tài nguyên |
| E2E đầy đủ trong CI | tự tin cao | rất chậm, dễ flaky |
| E2E chọn lọc + smoke test sau deploy | nhanh, vẫn an toàn | có thể bỏ sót |

## Explain Without Notes

1. CI và CD khác nhau ở điểm nào? Output của mỗi cái?
2. Vì sao pipeline chậm thay đổi hành vi của team?
3. Nguyên tắc thứ tự các bước trong pipeline?
4. Vì sao CI không có cache theo mặc định, và cách khắc phục?
5. Vì sao test flaky nguy hiểm hơn test thiếu?
6. Bốn quy tắc về secret trong CI?
7. Vì sao migration phải là bước riêng và chạy trước rollout?
8. Vì sao chặn merge vì coverage có thể phản tác dụng?

## Related

- [Build & artifact promotion](02-build-artifact-promotion.md) — một artifact, nhiều môi trường
- [Deployment strategies](03-deployment-strategies.md) — rolling, blue-green, canary
- [Dockerfile & build cache](../02-docker/05-dockerfile-build-cache.md) — cache trong CI
- [Production image](../02-docker/07-production-image.md) — quét, ký, SBOM
- [Migrations](../../03-database/03-data-modeling/04-migrations.md) — migration trong pipeline
- [Testing pyramid & behavior](../../05-cross-cutting/testing/01-testing-pyramid-behavior.md) — test gì ở tầng nào
- [Deterministic tests](../../05-cross-cutting/testing/06-deterministic-tests.md) — chống flaky
- [Testcontainers](../../05-cross-cutting/testing/05-testcontainers.md) — DB thật trong CI
- [Rollout & rollback](../04-kubernetes/workloads-networking/03-rollout-rollback.md) — phía Kubernetes
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md)

## Version / Context

Ví dụ dùng GitHub Actions; GitLab CI, CircleCI, Buildkite có khái niệm tương đương. OIDC federation được hỗ trợ bởi AWS, GCP, Azure và HashiCorp Vault. DORA metrics: deployment frequency, lead time for changes, change failure rate, time to restore service.
