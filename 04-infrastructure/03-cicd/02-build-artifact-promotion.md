---
level: intermediate
area: infra
prerequisites:
  - 01-pipeline.md
  - ../02-docker/07-production-image.md
related:
  - 03-deployment-strategies.md
  - ../../02-backend-api/04-architecture/05-configuration.md
---

# Build & artifact promotion

> Staging chạy tốt cả tuần. Deploy lên production, app crash sau 40 giây. Cùng một commit, cùng một Dockerfile, cùng một lệnh build. Nhưng CD build **lại** image cho từng môi trường, và giữa hai lần build đó, một dependency transitive đã phát hành bản vá — bản vá có một bug. Thứ được test ở staging chưa bao giờ tồn tại ở production.

## Position

```text
CI build MỘT LẦN → artifact (digest) → dev → staging → production
                     ↑ CÙNG một artifact đi qua mọi môi trường
```

## Problem

```text
❌ Build lại cho từng môi trường
   commit abc → build → image A → dev
   commit abc → build → image B → staging     ← A ≠ B
   commit abc → build → image C → production  ← A ≠ B ≠ C

   ⇒ "test ở staging" không chứng minh gì về production
```

Ba nguồn khác biệt giữa hai lần build cùng commit:

```text
① dependency transitive không ghim chặt → phiên bản khác
② base image tag di động (node:20)      → bản vá mới
③ thời điểm build khác nhau              → mirror, cache, network khác
```

Không cái nào là bug — chúng là hành vi bình thường. Vấn đề là **giả định rằng cùng commit cho cùng artifact.**

## Mental Model

### Build once, deploy many

```text
① BUILD một lần, ở CI, từ một commit
② Artifact BẤT BIẾN, định danh bằng DIGEST (không phải tag)
③ Cùng artifact đó đi qua mọi môi trường
④ Khác biệt giữa môi trường CHỈ nằm ở CẤU HÌNH
```

Từ đó ra một ràng buộc bắt buộc: **không có gì đặc thù môi trường trong image.** Không `.env`, không endpoint hardcode, không feature flag nướng sẵn.

Xem [Configuration](../../02-backend-api/04-architecture/05-configuration.md).

### Digest, không phải tag

```text
myapp:v1.4.2                          ← tag: CON TRỎ, di chuyển được
myapp@sha256:9f2a...                  ← digest: BẤT BIẾN, là chính nội dung
```

```text
Tag bị ghi đè:
  · vô ý (CI build lại cùng tag)
  · cố ý (hotfix push đè)
  · tấn công (registry bị chiếm)

⇒ "v1.4.2 ở production" không nói được gì chắc chắn
```

Deploy bằng digest làm câu hỏi "chính xác cái gì đang chạy" có một câu trả lời duy nhất.

```yaml
# thay vì
image: ghcr.io/org/app:v1.4.2
# dùng
image: ghcr.io/org/app@sha256:9f2a3b...
```

Tag vẫn hữu ích cho **người đọc**; digest là thứ **hệ thống** dùng.

### Promotion: di chuyển tham chiếu, không build lại

```text
① CI: build → push  ghcr.io/org/app@sha256:9f2a...
② Ghi digest vào một nơi (output của job, file manifest, git commit)
③ Deploy dev:        dùng digest đó
④ Test ở dev → OK
⑤ Deploy staging:    CÙNG digest
⑥ Test ở staging → OK
⑦ Deploy production: CÙNG digest
```

Bước ⑦ không build gì cả. Nó chỉ **thay đổi một tham chiếu**.

Với GitOps, "promotion" theo nghĩa đen là một commit đổi digest trong file YAML:

```yaml
# environments/production/kustomization.yaml
images:
  - name: ghcr.io/org/app
    digest: sha256:9f2a3b...      # ← promotion là commit đổi dòng này
```

Lợi ích: mọi thay đổi ở production có một commit, một tác giả, một thời điểm, và rollback là `git revert`.

### Tag nào nên gắn

```text
:sha-abc1234       ← BẮT BUỘC: truy vết chính xác về commit
:v1.4.2            ← version ngữ nghĩa cho con người
:main              ← con trỏ nhánh, tiện cho dev
:latest            ← tránh; nó không nói gì cả
```

Deploy dùng digest; tag chỉ để đọc.

### Không có gì đặc thù môi trường trong image

```text
❌ COPY .env.production .
❌ RUN if [ "$ENV" = "prod" ]; then ... fi
❌ const API = 'https://api.prod.example.com'

✅ mọi khác biệt qua biến môi trường / ConfigMap / Secret lúc CHẠY
```

Bài kiểm tra: **cùng một image có chạy được ở cả bốn môi trường chỉ bằng cách đổi biến môi trường không?** Nếu không, bạn chưa có "build once".

### Provenance: chứng minh artifact đến từ đâu

```text
Câu hỏi khi có sự cố hoặc audit:
  · image này build từ commit nào?
  · ai/cái gì đã build nó?
  · nó có bị sửa sau khi build không?
  · nó chứa những gì?
```

Bốn công cụ trả lời bốn câu:

```dockerfile
# ① OCI label — commit nào
LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/org/repo"
```

```bash
# ② SBOM — chứa những gì (cần khi có CVE mới công bố)
syft ghcr.io/org/app@sha256:9f2a... -o spdx-json > sbom.json

# ③ Ký — chứng minh nguồn gốc và toàn vẹn
cosign sign --yes ghcr.io/org/app@sha256:9f2a...
cosign verify --certificate-identity-regexp '.*' ghcr.io/org/app@sha256:9f2a...

# ④ Attestation — build từ đâu, bằng cách nào (SLSA provenance)
cosign attest --predicate provenance.json ghcr.io/org/app@sha256:9f2a...
```

SBOM đáng đầu tư nhất trong bốn cái: khi một CVE nghiêm trọng được công bố, câu hỏi "chúng ta có bị ảnh hưởng không" phải trả lời được trong vài phút, không phải vài ngày.

### Cấu hình theo môi trường

```text
Image (bất biến)
   +
Cấu hình (theo môi trường)
   ├─ ConfigMap    giá trị không nhạy cảm
   ├─ Secret       giá trị nhạy cảm
   └─ env var      từ hai cái trên
   =
Ứng dụng đang chạy
```

Và cấu hình phải được **validate lúc khởi động** — nếu thiếu biến, pod không được vào Service, rollout dừng, phiên bản cũ tiếp tục phục vụ. Xem [Configuration](../../02-backend-api/04-architecture/05-configuration.md).

### Rollback = trỏ về digest cũ

```bash
kubectl set image deploy/api api=ghcr.io/org/app@sha256:<digest-cũ>
# hoặc GitOps: git revert
```

Ba điều làm rollback đáng tin:

```text
① Digest cũ vẫn còn trong registry  → chính sách retention phải giữ đủ lâu
② Migration tương thích ngược       → code cũ chạy được với schema mới
③ Đã diễn tập                       → rollback lần đầu không nên là lúc có sự cố
```

Điểm ② là ràng buộc thật: nếu migration không tương thích ngược, **rollback code không khả thi** — và bạn chỉ còn fix-forward dưới áp lực. Xem [Migrations](../../03-database/03-data-modeling/04-migrations.md).

## Example

Pipeline promotion đầy đủ:

```yaml
# ── CI: build MỘT LẦN ──
build:
  steps:
    - uses: docker/build-push-action@v5
      id: push
      with:
        push: true
        tags: |
          ghcr.io/${{ github.repository }}:sha-${{ github.sha }}
          ghcr.io/${{ github.repository }}:main
        build-args: |
          GIT_SHA=${{ github.sha }}
          BUILD_DATE=${{ github.event.repository.updated_at }}
    - run: |
        echo "IMAGE=ghcr.io/${{ github.repository }}@${{ steps.push.outputs.digest }}" >> $GITHUB_ENV
        echo "${{ steps.push.outputs.digest }}" > digest.txt
    - uses: actions/upload-artifact@v4
      with: { name: digest, path: digest.txt }
```

```yaml
# ── CD: promotion, KHÔNG build ──
deploy-staging:
  needs: [build]
  environment: staging
  steps:
    - uses: actions/download-artifact@v4
      with: { name: digest }
    - run: |
        DIGEST=$(cat digest.txt)
        kubectl set image deploy/api api=ghcr.io/${{ github.repository }}@$DIGEST -n staging
        kubectl rollout status deploy/api -n staging --timeout=5m
    - run: ./scripts/smoke-test.sh https://staging.example.com

deploy-production:
  needs: [deploy-staging]
  environment: production        # yêu cầu phê duyệt thủ công
  steps:
    - uses: actions/download-artifact@v4
      with: { name: digest }
    - run: |
        DIGEST=$(cat digest.txt)
        kubectl set image deploy/api api=ghcr.io/${{ github.repository }}@$DIGEST -n prod
        kubectl rollout status deploy/api -n prod --timeout=5m
    - run: ./scripts/smoke-test.sh https://example.com
```

Ba tính chất:

```text
· không có bước build nào trong CD
· cùng digest đi từ staging sang production
· smoke test sau mỗi lần deploy — bắt lỗi cấu hình mà CI không bắt được
```

Và xác minh cái gì đang chạy:

```bash
kubectl get deploy api -o jsonpath='{.spec.template.spec.containers[0].image}'
# ghcr.io/org/app@sha256:9f2a3b...
docker inspect ghcr.io/org/app@sha256:9f2a3b... | jq '.[0].Config.Labels'
# → commit nào, build lúc nào
```

## Prediction

1. CD build lại image cho từng môi trường, cùng commit — ba image có giống nhau không?
2. Ba nguồn khác biệt là gì?
3. Deploy bằng tag `v1.4.2`, ai đó push đè tag đó — pod mới chạy code nào?
4. Deploy bằng digest, cùng tình huống — pod mới chạy code nào?
5. Image có `COPY .env.production` — deploy lên staging thế nào?
6. Rollback bằng cách trỏ về digest cũ, nhưng registry đã xoá image đó — kết quả?
7. Rollback code nhưng migration đã `DROP COLUMN` — code cũ chạy được không?
8. CVE nghiêm trọng được công bố cho một thư viện — không có SBOM, mất bao lâu để biết có bị ảnh hưởng?
9. Có SBOM — mất bao lâu?
10. Không có OCI label, sự cố lúc 3 giờ sáng — làm sao biết commit nào?
11. Image chạy được ở dev nhưng thiếu một biến ở production, không validate config — phát hiện khi nào?
12. Có validate config — phát hiện khi nào?
13. Tag `:latest` với `imagePullPolicy: IfNotPresent` — node đã có image cũ chạy gì?

<details>
<summary>Đáp án</summary>

1. **Không đảm bảo giống nhau.**
2. Dependency transitive, base image tag di động, thời điểm build (mirror/cache/network khác).
3. **Code mới** (của tag bị ghi đè) — không phải cái bạn đã test.
4. **Đúng code đã test** — digest là nội dung.
5. Sai cấu hình, hoặc phải build image riêng cho staging → phá vỡ "build once".
6. **Rollback thất bại** — không kéo được image. Retention phải giữ đủ lâu.
7. **Không** — cột không còn tồn tại. Đây là lý do migration phải tương thích ngược.
8. Nhiều giờ tới nhiều ngày: phải quét lại từng image hoặc đọc lock file của từng service.
9. **Vài phút** — truy vấn SBOM đã lưu.
10. Phải lần theo tag và hy vọng nó chưa bị ghi đè — không đáng tin.
11. Khi có người dùng chạm vào tính năng cần biến đó — có thể hàng giờ sau.
12. **Lúc khởi động** — pod không vào Service, rollout dừng, phiên bản cũ tiếp tục phục vụ.
13. **Image cũ** — node đã có tag đó nên không pull lại.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Build cùng commit hai lần cách nhau vài ngày, so digest | Có thể khác nhau |
| So `docker history` của hai image đó | Tìm layer khác nhau |
| Push đè một tag, deploy lại | Chạy code khác |
| Đổi sang digest, lặp lại | Chạy đúng code |
| Xoá image cũ khỏi registry rồi thử rollback | Thất bại |
| Rollback code sau migration `DROP COLUMN` | Code cũ lỗi |
| `COPY .env.production` rồi deploy lên staging | Cấu hình sai |
| Bỏ biến bắt buộc, không validate config | App start rồi lỗi muộn |
| Thêm validate | Crash lúc boot, rollout dừng |
| Tạo SBOM rồi tra một thư viện cụ thể | Vài giây |
| Không có SBOM, tìm cùng thư viện trong 20 image | Rất lâu |
| Xem `docker inspect` labels của image production | Có/không biết commit |

## What Usually Goes Wrong

- **Build lại cho từng môi trường** → thứ test được không phải thứ chạy.
- **Deploy bằng tag** → tag di chuyển được, không biết chắc cái gì đang chạy.
- **Không ghim base image** → hai lần build cho hai kết quả.
- **Cấu hình đặc thù môi trường trong image** → phá vỡ "build once".
- **Không validate config lúc khởi động** → lỗi lộ muộn ở production.
- **Registry retention quá ngắn** → không rollback được.
- **Migration không tương thích ngược** → rollback code bất khả thi.
- **Không có OCI label** → không truy vết được commit.
- **Không có SBOM** → không trả lời được câu hỏi CVE trong thời gian hợp lý.
- **`:latest` + `IfNotPresent`** → node chạy image cũ.
- **Chưa bao giờ diễn tập rollback** → lần đầu là lúc có sự cố.
- **Không có smoke test sau deploy** → lỗi cấu hình chỉ lộ khi người dùng gặp.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Cùng commit → cùng image | Dependency và base image thay đổi theo thời gian |
| Tag định danh image | Tag là con trỏ; digest mới là định danh |
| Build lại cho production là cẩn thận | Nó phá vỡ đảm bảo của việc test ở staging |
| `:latest` là bản mới nhất | Nó chỉ là một cái tên |
| Rollback luôn khả thi | Chỉ khi image còn và migration tương thích ngược |
| SBOM là thủ tục tuân thủ | Nó là công cụ trả lời câu hỏi CVE trong vài phút |
| Ký image là thừa với repo nội bộ | Nó chống được cả sai sót lẫn tấn công registry |
| Cấu hình trong image thì tiện | Nó buộc bạn build nhiều image cho một commit |
| Promotion là deploy lại | Promotion là **di chuyển một tham chiếu** |
| Smoke test sau deploy là thừa vì đã có CI | CI không test được cấu hình của môi trường thật |

## Debugging

1. **Cái gì đang chạy?**
   ```bash
   kubectl get deploy api -o jsonpath='{..image}'
   docker inspect <image> | jq '.[0].Config.Labels'
   ```
2. **Nó từ commit nào?** OCI label `revision`.
3. **Staging và production có cùng artifact không?** So digest — đây là câu hỏi đầu tiên khi "staging OK, production hỏng".
4. **Nếu khác nhau** → CD đang build lại, hoặc deploy bằng tag.
5. **Nếu giống nhau** → khác biệt nằm ở **cấu hình**. So biến môi trường giữa hai môi trường.
6. **Image chứa gì?** SBOM, hoặc `dive`.
7. **Rollback được không?** Digest cũ còn trong registry chứ? Migration có tương thích ngược không?

Bước 3 chia đôi không gian tìm kiếm cho lớp lỗi "chỉ có ở production".

## Production Considerations

- **Build một lần trong CI; CD không bao giờ build.**
- **Deploy bằng digest**; dùng tag chỉ để con người đọc.
- **OCI label với `revision`, `created`, `source`** trên mọi image.
- **SBOM cho mọi image production**, lưu cùng artifact.
- **Ký image và verify lúc admit** (cosign + policy controller) nếu chuỗi cung ứng là mối lo.
- **Registry retention đủ dài** để rollback về vài phiên bản trước — và kiểm tra chính sách này thật sự giữ chúng.
- **Validate config lúc khởi động** — nó biến lỗi cấu hình thành rollout dừng thay vì sự cố.
- **Smoke test sau mỗi lần deploy**, ở mọi môi trường.
- **Diễn tập rollback theo lịch**, có bấm giờ.
- **Ghi lại promotion**: ai, digest nào, lúc nào, môi trường nào. Với GitOps, git log làm việc này miễn phí.
- **Rebuild định kỳ** (hằng tuần) để lấy bản vá base image, rồi promote qua các môi trường như bình thường — không vá thẳng ở production.
- **Bài kiểm tra "build once"**: cùng image có chạy được ở cả bốn môi trường chỉ bằng đổi biến môi trường không?

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Build once, deploy many | staging chứng minh được điều gì đó | phải đưa mọi khác biệt ra cấu hình |
| Build mỗi môi trường | linh hoạt nhồi cấu hình vào image | không còn đảm bảo nào |
| Deploy bằng digest | chính xác tuyệt đối | dài, phải tự động hoá |
| Deploy bằng tag | dễ đọc | tag di chuyển được |
| Retention dài | rollback xa được | tốn dung lượng registry |
| Retention ngắn | rẻ | không rollback được xa |
| Ký + verify | chống tấn công chuỗi cung ứng | thêm hạ tầng, thêm bước |
| Không ký | đơn giản | tin registry vô điều kiện |
| SBOM | trả lời CVE nhanh | thêm bước, thêm lưu trữ |
| GitOps promotion | có lịch sử, revert dễ | thêm một hệ thống |
| Promotion bằng lệnh | đơn giản | ít lịch sử, khó audit |
| Phê duyệt thủ công cho production | kiểm soát | chậm hơn |

## Explain Without Notes

1. Vì sao cùng commit không đảm bảo cùng image? Ba nguồn khác biệt?
2. "Build once, deploy many" gồm bốn điều gì?
3. Tag và digest khác nhau thế nào? Cái nào để deploy?
4. Promotion là gì? Nó có build không?
5. Ba điều kiện để rollback thật sự khả thi?
6. SBOM giải quyết câu hỏi gì, và trong bao lâu?
7. Bài kiểm tra để biết bạn đã có "build once" chưa?
8. Câu hỏi đầu tiên khi "staging OK, production hỏng"?

## Related

- [CI/CD pipeline](01-pipeline.md) — nơi artifact được tạo
- [Deployment strategies](03-deployment-strategies.md) — cách đưa artifact vào production
- [Production image](../02-docker/07-production-image.md) — nội dung của artifact
- [Image & container](../02-docker/01-image-container.md) — tag vs digest
- [Configuration](../../02-backend-api/04-architecture/05-configuration.md) — khác biệt môi trường
- [Migrations](../../03-database/03-data-modeling/04-migrations.md) — điều kiện để rollback được
- [Rollout & rollback](../04-kubernetes/07-rollout-rollback.md) — phía Kubernetes
- [Config & lifecycle (NestJS)](../../02-backend-api/02-nestjs/05-config-lifecycle.md) — validate config

## Version / Context

OCI image spec cho label và digest. Công cụ: `cosign` (ký, attestation), `syft` (SBOM), `grype`/`trivy` (quét). SLSA framework cho mức độ đảm bảo chuỗi cung ứng. GitOps: Argo CD, Flux.
