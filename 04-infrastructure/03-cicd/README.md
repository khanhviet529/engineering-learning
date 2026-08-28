---
level: intermediate
area: infra
---

# CI/CD

Ba câu hỏi, ba note:

```text
① Code mới có tích hợp được không?     → CI: kiểm tra, tạo artifact
② Artifact nào đi tới môi trường nào?  → promotion: một artifact, nhiều môi trường
③ Nó vào production thế nào?           → chiến lược: rủi ro bao nhiêu, trong bao lâu
```

## Thứ tự đọc

| # | Note | Trả lời câu hỏi |
|---|---|---|
| 1 | [CI/CD pipeline](01-pipeline.md) | Vì sao pipeline 28 phút làm team viết code tệ hơn? |
| 2 | [Build & artifact promotion](02-build-artifact-promotion.md) | Vì sao staging OK mà production crash với cùng commit? |
| 3 | [Deployment strategies](03-deployment-strategies.md) | 19 phút với 100% người dùng, hay 3 phút với 5%? |

## Ba nguyên tắc

```text
① BUILD ONCE, DEPLOY MANY
   Một artifact, định danh bằng DIGEST, đi qua mọi môi trường.
   Khác biệt giữa môi trường CHỈ ở cấu hình.
   ⇒ nếu CD build lại, "test ở staging" không chứng minh gì.

② MỌI THAY ĐỔI PHẢI TƯƠNG THÍCH NGƯỢC
   Trong cửa sổ rollout có hai phiên bản code, một schema.
   Áp dụng cho: API, schema DB, payload job, cache key.
   ⇒ đây cũng là điều kiện để ROLLBACK khả thi.

③ ROLLBACK PHẢI NHANH HƠN FIX-FORWARD
   Rollback ~1–2 phút; fix-forward ~15–30 phút.
   Khi có sự cố: rollback trước, điều tra sau.
   ⇒ và nó phải được DIỄN TẬP, không phải giả định.
```

## Bảng chẩn đoán

| Triệu chứng | Nghi ngờ | Note |
|---|---|---|
| Pipeline chậm, người ta né chạy | không cache; job tuần tự | [1](01-pipeline.md) |
| CI chậm nhưng local nhanh | runner ephemeral không có cache | [1](01-pipeline.md) |
| Test đỏ ngẫu nhiên, ai cũng re-run | flaky: thời gian / thứ tự / tài nguyên chung | [1](01-pipeline.md) |
| Staging OK, production crash cùng commit | CD build lại → khác artifact | [2](02-build-artifact-promotion.md) |
| Không biết chắc code nào đang chạy | deploy bằng tag, không phải digest | [2](02-build-artifact-promotion.md) |
| Rollback thất bại | image cũ đã bị xoá khỏi registry | [2](02-build-artifact-promotion.md) |
| Rollback code nhưng app vẫn lỗi | migration đã phá vỡ tương thích | [2](02-build-artifact-promotion.md) |
| Lỗi trong cửa sổ rollout, hết sau đó | hai phiên bản không tương thích | [3](03-deployment-strategies.md) |
| Phát hiện lỗi sau 10 phút | thiếu alert tự động; thiếu label `version` | [3](03-deployment-strategies.md) |
| Canary không giúp được gì | không có metric tự động quyết định | [3](03-deployment-strategies.md) |
| Lỗi cấu hình chỉ lộ qua người dùng | không có smoke test sau deploy | [3](03-deployment-strategies.md) |
| Secret trong image | `--build-arg` thay vì secret mount | [1](01-pipeline.md) |

## Pipeline tham chiếu

```text
push
 ├─ lint + typecheck        ~30s  ┐
 ├─ unit test               ~60s  ├─ SONG SONG
 └─ build image + cache     ~2m   ┘
      ↓
 integration test (DB thật)  ~3m
      ↓
 quét bảo mật + SBOM         ~1m
      ↓
 push image :sha-<commit>  →  DIGEST
      ↓
 [CD] migration (job riêng, MỘT lần, tương thích ngược)
      ↓
 [CD] deploy staging bằng DIGEST  →  smoke test
      ↓
 [CD] deploy production bằng CÙNG DIGEST  →  smoke test
      ↓
 theo dõi error rate + latency, rollback tự động nếu vượt ngưỡng
```

**Ngân sách:** phản hồi đầu tiên < 2 phút; toàn bộ CI < 10 phút.

## Mười quyết định

```text
 1. Job độc lập chạy SONG SONG
 2. Cache: package manager + Docker layer (registry/gha cache)
 3. Tag image bằng SHA; DEPLOY bằng digest
 4. CD KHÔNG BUILD — chỉ di chuyển tham chiếu
 5. Không có gì đặc thù môi trường trong image
 6. Migration là bước RIÊNG, TRƯỚC rollout, tương thích ngược
 7. Smoke test sau mỗi deploy, gồm một thao tác GHI
 8. Secret qua OIDC / secret mount — không qua --build-arg
 9. Quyền workflow tối thiểu; ghim action theo SHA
10. Metric có label `version`; alert tự động sau deploy
```

## Bốn chỉ số đánh giá

```text
DORA metrics — chúng nói pipeline đang giúp hay đang cản:

  tần suất deploy              cao = quy trình nhẹ, tin cậy
  thời gian commit → prod      thấp = feedback nhanh
  tỉ lệ deploy gây lỗi         thấp = chất lượng cổng kiểm tra
  thời gian phục hồi           thấp = rollback đáng tin
```

Chỉ số thứ tư quan trọng hơn chỉ số thứ ba: **sự cố sẽ xảy ra; điều bạn kiểm soát được là phục hồi nhanh hay chậm.**

## Position

```text
Code → CI (kiểm tra, build) → Registry (artifact) → CD (promotion) → Production
        ↑ folder này
```

## Related

- [02-docker/](../02-docker/README.md) — artifact là image
- [04-kubernetes/](../04-kubernetes/README.md) — nơi artifact chạy
- [Rollout & rollback](../04-kubernetes/07-rollout-rollback.md) — cơ chế deploy trong K8s
- [Migrations](../../03-database/03-data-modeling/04-migrations.md) — điều kiện của tương thích ngược
- [Configuration](../../02-backend-api/04-architecture/05-configuration.md) — khác biệt môi trường
- [Testing](../../05-cross-cutting/testing/README.md) — cái gì chạy trong pipeline
- [Observability](../../05-cross-cutting/observability/README.md) — phát hiện sau deploy
- [Secrets management](../../05-cross-cutting/security/06-secrets-management.md)

## Version / Context

Ví dụ dùng GitHub Actions; GitLab CI, CircleCI, Buildkite có khái niệm tương đương. Công cụ: `cosign` (ký), `syft` (SBOM), `trivy` (quét), Argo Rollouts / Flagger (canary), Argo CD / Flux (GitOps).
