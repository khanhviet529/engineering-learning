---
level: intermediate
area: infra
prerequisites:
  - 02-build-artifact-promotion.md
related:
  - ../04-kubernetes/workloads-networking/03-rollout-rollback.md
  - ../../05-cross-cutting/observability/05-alerting-dashboards.md
---

# Deployment strategies

> Deploy lúc 14:00. Lúc 14:03 lỗi bắt đầu tăng. Lúc 14:11 có người nhận ra. Lúc 14:14 quyết định rollback. Lúc 14:22 rollback xong. Tổng: **19 phút với 100% người dùng bị ảnh hưởng.** Với canary 5% và rollback tự động, con số đó là 3 phút với 5% người dùng.

## Position

```text
Artifact (digest) ──▶ CHIẾN LƯỢC deploy ──▶ production
                        ↑ note này: bao nhiêu người dùng chịu rủi ro, trong bao lâu
```

## Problem

Mọi deploy đều có rủi ro. Chiến lược deploy quyết định **ba con số**:

```text
① BAO NHIÊU người dùng bị ảnh hưởng nếu phiên bản mới có lỗi?
② BAO LÂU cho tới khi bạn phát hiện?
③ BAO LÂU để quay lại trạng thái tốt?
```

Recreate: 100%, tuỳ monitoring, tuỳ tốc độ rollback.
Canary với rollback tự động: 5%, vài phút, vài giây.

Khác biệt không nằm ở chất lượng code — nó nằm ở **thiết kế quy trình deploy**.

## Mental Model

### Năm chiến lược

```text
RECREATE      dừng hết cũ → khởi động mới
              → DOWNTIME; đơn giản nhất; chỉ khi không thể chạy song song

ROLLING       thay dần từng phần
              → không downtime; hai phiên bản CHẠY SONG SONG   ← mặc định K8s

BLUE-GREEN    dựng môi trường mới song song → chuyển traffic một lần
              → chuyển tức thì, rollback tức thì; tốn gấp đôi tài nguyên

CANARY        cho 1–5% traffic vào phiên bản mới → tăng dần
              → giới hạn thiệt hại; cần routing theo tỉ lệ và metric tốt

FEATURE FLAG  deploy code TẮT → bật dần theo % hoặc theo người dùng
              → TÁCH deploy khỏi release; kiểm soát tinh nhất
```

Và một nhận xét quan trọng: **chúng kết hợp được.** Thực tế phổ biến nhất là rolling deploy + feature flag — deploy an toàn ở tầng hạ tầng, kiểm soát tính năng ở tầng ứng dụng.

### Rolling: hai phiên bản chạy song song

```text
maxUnavailable: 0   không giảm capacity
maxSurge: 1         thêm tối đa 1 pod trong lúc rollout

[v1][v1][v1] → [v1][v1][v1][v2] → [v1][v1][v2] → ... → [v2][v2][v2]
```

Ràng buộc mà rolling áp đặt lên **mọi thứ khác**:

```text
· API phải tương thích ngược      (client cũ gọi server mới)
· Schema phải tương thích ngược   (code cũ chạy với schema mới)
· Message/job payload phải version hoá
· Cache key phải version hoá nếu hình dạng dữ liệu đổi
```

Đây không phải chi tiết vận hành — nó là ràng buộc thiết kế cho mọi thay đổi. Xem [Migrations](../../03-database/03-data-modeling/04-migrations.md).

### Blue-green: chuyển một lần

```text
BLUE (v1) ← 100% traffic        GREEN (v2) đang khởi động, đang test
                    ↓ chuyển router
BLUE (v1) giữ nguyên            GREEN (v2) ← 100% traffic
                    ↓ rollback = chuyển ngược, TỨC THÌ
```

```text
+ chuyển tức thì, rollback tức thì
+ test đầy đủ trên môi trường thật trước khi chuyển
- tốn GẤP ĐÔI tài nguyên trong lúc chuyển
- database DÙNG CHUNG → schema vẫn phải tương thích cả hai phiên bản
- kết nối dài (WebSocket) vẫn bị ngắt khi chuyển
```

Điểm về database đáng nhấn: blue-green **không** giải quyết được vấn đề schema. Cả blue và green dùng chung một database, nên schema phải hoạt động với cả hai phiên bản — đúng như rolling.

### Canary: giới hạn thiệt hại

```text
5% traffic → v2, theo dõi 10 phút
   metric OK  → 25% → 50% → 100%
   metric XẤU → rollback tự động
```

Canary chỉ có giá trị khi có **metric tự động quyết định**:

```text
· error rate của v2 so với v1
· latency p95/p99 của v2 so với v1
· metric nghiệp vụ (tỉ lệ chuyển đổi, số đơn hàng)
```

Không có metric so sánh, canary chỉ là rolling chậm hơn — bạn vẫn phát hiện bằng mắt và vẫn rollback bằng tay.

Hai cách chia traffic:

```text
Theo tỉ lệ pod    3 pod v1 + 1 pod v2 = ~25%   (thô, dễ, không cần công cụ)
Theo router       Ingress/mesh chia 5%          (chính xác, cần Istio/Linkerd/Argo Rollouts)
```

Và với người dùng đăng nhập, chia theo **hash của user id** tốt hơn chia ngẫu nhiên: một người dùng luôn thấy cùng phiên bản, tránh trải nghiệm không nhất quán.

### Feature flag: tách deploy khỏi release

```text
DEPLOY  đưa code lên production          (kỹ thuật, thường xuyên, rủi ro thấp)
RELEASE bật tính năng cho người dùng     (nghiệp vụ, có kiểm soát)
```

```ts
if (await flags.enabled('new-checkout', { userId, tenantId })) {
  return this.newCheckout(...);
}
return this.legacyCheckout(...);
```

Đây là chiến lược có **độ phân giải cao nhất**: bật cho nội bộ → 1% → 10% → 100%, và tắt trong vài giây khi có vấn đề — không cần deploy.

Cái giá đã nêu ở [Configuration](../../02-backend-api/04-architecture/05-configuration.md): **mỗi flag nhân đôi số đường đi qua code.** Mười flag là 1.024 tổ hợp, và bạn test được vài cái.

Vì thế: flag loại release phải có **hạn xoá** ngay khi tạo.

### Rollback phải nhanh hơn fix-forward

```text
Rollback: trỏ về digest cũ            ~1–2 phút
Fix-forward: viết fix → CI → deploy   ~15–30 phút
```

Khi đang có sự cố, **rollback trước, điều tra sau**. Nhưng nó chỉ khả thi khi:

```text
① Digest cũ còn trong registry
② Migration tương thích ngược
③ Đã diễn tập — rollback lần đầu không nên là lúc có sự cố
```

Điều kiện ② là ràng buộc nghiêm ngặt nhất, và nó quyết định bạn có thực sự có phương án rollback hay không.

### Thay đổi không rollback được

```text
✗ migration DROP COLUMN
✗ đã gửi email/webhook cho người dùng
✗ đã ghi dữ liệu ở định dạng mới mà code cũ không đọc được
✗ đã gọi API bên ngoài không hoàn tác được
```

Với những thay đổi này, chiến lược phải là **expand-migrate-contract** và **feature flag**, không phải rollback. Xem [Migrations](../../03-database/03-data-modeling/04-migrations.md).

### Smoke test sau deploy

```bash
#!/bin/sh
BASE=$1
curl -fsS "$BASE/health" >/dev/null                       || exit 1
curl -fsS "$BASE/ready"  >/dev/null                       || exit 1
curl -fsS "$BASE/api/products?limit=1" | jq -e '.data'    || exit 1   # đọc
curl -fsS -X POST "$BASE/api/_selftest" -H "$AUTH"        || exit 1   # ghi
echo "smoke OK"
```

Smoke test bắt được lớp lỗi mà **không test nào ở CI bắt được**: sai biến môi trường, thiếu secret, không kết nối được database ở môi trường đó, DNS sai, certificate hết hạn.

Nó phải bao gồm ít nhất một thao tác **ghi** — nhiều lỗi cấu hình chỉ lộ khi ghi.

## Example

Chọn chiến lược theo loại thay đổi:

```text
Đổi text trên UI                → rolling, không cần gì thêm
Thêm endpoint mới               → rolling
Đổi logic tính giá              → feature flag (bật dần, so metric nghiệp vụ)
Nâng version thư viện lớn       → canary (rủi ro không đoán trước được)
Đổi schema database             → expand-migrate-contract qua 3 deploy
Đổi thuật toán gợi ý            → feature flag + A/B test
Nâng version PostgreSQL         → blue-green với replica, có kế hoạch rollback riêng
```

Và một canary tự động với Argo Rollouts:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
spec:
  strategy:
    canary:
      steps:
        - setWeight: 5
        - pause: { duration: 10m }
        - analysis:
            templates: [{ templateName: error-rate }]
        - setWeight: 25
        - pause: { duration: 10m }
        - setWeight: 50
        - pause: { duration: 10m }
        - setWeight: 100
```

```yaml
kind: AnalysisTemplate
metadata: { name: error-rate }
spec:
  metrics:
    - name: error-rate
      interval: 1m
      failureLimit: 2                    # 2 lần fail → rollback tự động
      successCondition: result[0] < 0.01
      provider:
        prometheus:
          query: |
            sum(rate(http_requests_total{app="api",version="canary",status=~"5.."}[2m]))
            / sum(rate(http_requests_total{app="api",version="canary"}[2m]))
```

Điểm quan trọng: **`failureLimit` và `successCondition` là nơi canary trở nên tự động.** Không có chúng, bạn vẫn đang nhìn dashboard bằng mắt.

## Prediction

1. Recreate với 3 pod — downtime bao lâu?
2. Rolling với `maxUnavailable: 0, maxSurge: 1` — có downtime không? Cần bao nhiêu tài nguyên thừa?
3. Trong lúc rolling, client cũ gọi API — server có thể là phiên bản nào?
4. Rolling deploy với migration `DROP COLUMN` chạy trước — pod cũ thế nào?
5. Blue-green, database dùng chung — schema có cần tương thích ngược không?
6. Blue-green, rollback sau khi đã chuyển — mất bao lâu?
7. Canary 5% không có metric tự động — khác gì rolling?
8. Canary chia traffic ngẫu nhiên, user đăng nhập refresh nhiều lần — họ thấy gì?
9. Chia theo hash user id — họ thấy gì?
10. Feature flag deploy code tắt, sau đó bật — cần deploy lại không?
11. Mười feature flag chưa xoá — bao nhiêu tổ hợp đường đi?
12. Rollback code sau khi migration đã `DROP COLUMN` — được không?
13. Không có smoke test sau deploy, thiếu một biến môi trường ở production — phát hiện khi nào?

<details>
<summary>Đáp án</summary>

1. Từ khi pod cuối cùng của v1 dừng tới khi pod đầu tiên của v2 ready — thường **10–60 giây**, tuỳ thời gian khởi động.
2. **Không downtime.** Cần thừa capacity cho 1 pod (`maxSurge: 1`).
3. **Cả hai** — v1 và v2 chạy song song. Đây là lý do API phải tương thích ngược.
4. Pod cũ **lỗi** khi truy vấn cột không còn tồn tại — trong suốt thời gian rollout.
5. **Có** — blue và green dùng chung database.
6. **Tức thì** — chỉ chuyển router về blue.
7. Về cơ bản giống rolling, chỉ chậm hơn. Bạn vẫn phát hiện bằng mắt.
8. Thấy **v1 và v2 luân phiên** — trải nghiệm không nhất quán, và có thể lỗi nếu session/state khác nhau.
9. Luôn thấy **cùng một phiên bản** — nhất quán.
10. **Không** — đó chính là điểm của feature flag: tách deploy khỏi release.
11. 2^10 = **1.024**. Bạn test được vài cái.
12. **Không** — cột không còn. Đây là lý do migration phải tương thích ngược.
13. Khi có người dùng chạm vào tính năng cần biến đó — có thể hàng giờ sau.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Recreate với tải ổn định, đo downtime | Số lỗi trong cửa sổ |
| Rolling với `maxUnavailable: 0`, lặp lại | Về 0 (nếu graceful shutdown đúng) |
| Deploy phiên bản có API không tương thích ngược trong lúc rolling | Client cũ lỗi ngẫu nhiên |
| Chạy `DROP COLUMN` rồi rolling deploy | Pod cũ lỗi trong cửa sổ rollout |
| Blue-green, chuyển router, đo thời gian | Gần như tức thì |
| Blue-green với WebSocket đang mở | Kết nối bị ngắt |
| Canary 5% không metric, deploy bản có bug | Đo thời gian tới khi phát hiện |
| Thêm analysis tự động | Rollback trong vài phút |
| Canary chia ngẫu nhiên, refresh 20 lần | Thấy hai phiên bản |
| Chia theo hash user id | Nhất quán |
| Bật/tắt feature flag, đo thời gian | Vài giây |
| Rollback bằng digest, đo thời gian | 1–2 phút |
| Fix-forward cho cùng bug, đo thời gian | 15–30 phút |
| Bỏ một biến môi trường, deploy không smoke test | Phát hiện muộn |

## What Usually Goes Wrong

- **Rolling nhưng API không tương thích ngược** → lỗi trong cửa sổ rollout.
- **Migration không tương thích ngược** → pod cũ lỗi, và rollback bất khả thi.
- **Canary không có metric tự động** → chỉ là rolling chậm hơn.
- **Canary chia ngẫu nhiên với user đăng nhập** → trải nghiệm không nhất quán.
- **Blue-green mà quên database dùng chung** → schema vẫn phải tương thích cả hai.
- **Chưa bao giờ diễn tập rollback** → lần đầu là lúc có sự cố, dưới áp lực.
- **Rollback chậm hơn fix-forward** → không ai dùng nó.
- **Không có smoke test sau deploy** → lỗi cấu hình lộ qua người dùng.
- **Feature flag không xoá** → bùng nổ tổ hợp, code không đọc được.
- **Deploy vào thứ Sáu chiều** → ít người xử lý nếu có sự cố (trừ khi rollback thật sự tự động và đáng tin).
- **Không có monitoring đủ tốt để phát hiện** → mọi chiến lược đều vô nghĩa.
- **Deploy nhiều thay đổi cùng lúc** → không biết cái nào gây lỗi.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Rolling deploy không có rủi ro | Hai phiên bản chạy song song — ràng buộc tương thích |
| Blue-green giải quyết vấn đề schema | Database dùng chung; schema vẫn phải tương thích |
| Canary tự bảo vệ bạn | Chỉ khi có metric tự động quyết định |
| Rollback luôn khả thi | Cần image còn, migration tương thích, và đã diễn tập |
| Feature flag chỉ để A/B test | Nó tách deploy khỏi release — giá trị lớn hơn nhiều |
| Deploy và release là một | Deploy là kỹ thuật; release là quyết định nghiệp vụ |
| Downtime nhỏ thì chấp nhận được | Với deploy 10 lần/ngày, nó cộng dồn |
| Chiến lược phức tạp luôn tốt hơn | Rolling + flag đủ cho hầu hết trường hợp |
| Fix-forward nhanh hơn vì "chỉ một dòng" | Nó vẫn phải qua CI và deploy |
| Blue-green không ảnh hưởng kết nối dài | WebSocket vẫn bị ngắt khi chuyển |

## Debugging

1. **Lỗi sau deploy** → **rollback trước**, điều tra sau. Đừng debug ở production dưới áp lực.
2. **Phiên bản nào đang chạy?** `kubectl get deploy -o jsonpath='{..image}'` — digest cụ thể.
3. **Lỗi ở phiên bản nào?** Log và metric phải có label `version` — nếu không, bạn không phân biệt được.
4. **Lỗi trong cửa sổ rollout hay sau đó?** Trong cửa sổ = vấn đề tương thích giữa hai phiên bản. Sau đó = bug của phiên bản mới.
5. **Client cũ hay mới?** Nếu chỉ client cũ lỗi → API không tương thích ngược.
6. **Rollback không được?** Image còn trong registry? Migration đã phá vỡ tương thích?
7. **Sau sự cố**: đo ba con số — bao nhiêu % người dùng bị ảnh hưởng, phát hiện sau bao lâu, phục hồi sau bao lâu. Chúng cho biết chiến lược nào cần cải thiện.

## Production Considerations

- **Rolling + feature flag là mặc định thực dụng** cho hầu hết đội ngũ. Canary khi thay đổi rủi ro cao.
- **Mọi thay đổi phải tương thích ngược** trong một cửa sổ rollout — API, schema, payload, cache key.
- **Rollback phải nhanh hơn fix-forward**, và phải được diễn tập theo lịch.
- **Smoke test sau mọi deploy**, gồm ít nhất một thao tác ghi.
- **Metric phải có label `version`** — không có nó, canary và điều tra sau sự cố đều không làm được.
- **Alert tự động trên error rate và latency** ngay sau deploy — với cửa sổ so sánh trước/sau.
- **Feature flag có hạn xoá** ngay khi tạo, và một job liệt kê flag quá hạn.
- **Deploy thường xuyên, mỗi lần ít thay đổi** — nó giảm rủi ro nhiều hơn mọi chiến lược phức tạp.
- **Ghi lại mọi deploy** (ai, digest, lúc nào) và hiển thị trên dashboard cạnh biểu đồ lỗi — tương quan thời gian là công cụ chẩn đoán đầu tiên.
- **Kết nối dài (WebSocket) cần xử lý riêng** — chúng đứt ở mọi chiến lược trừ feature flag. Xem [WebSocket gateway](../../02-backend-api/02-nestjs/behavior/08-websocket-gateway.md).
- **Đo bốn chỉ số DORA** — chúng cho biết quy trình deploy đang giúp hay cản.

## Trade-offs

| Chiến lược | Được | Mất |
|---|---|---|
| Recreate | đơn giản nhất | downtime |
| Rolling | không downtime, không tốn thêm nhiều | hai phiên bản song song |
| Blue-green | chuyển và rollback tức thì | gấp đôi tài nguyên; schema vẫn dùng chung |
| Canary | giới hạn thiệt hại | cần routing và metric tốt; rollout lâu |
| Feature flag | tách deploy/release, tắt tức thì | bùng nổ tổ hợp; nợ kỹ thuật nếu không xoá |
| Rollback | nhanh nhất khi có sự cố | cần image còn + migration tương thích |
| Fix-forward | sửa dứt điểm | chậm, làm dưới áp lực |
| Deploy thường xuyên, ít thay đổi | rủi ro mỗi lần thấp, dễ xác định nguyên nhân | cần pipeline nhanh và đáng tin |
| Deploy ít, nhiều thay đổi | ít nghi thức | rủi ro cao, khó xác định nguyên nhân |
| Phê duyệt thủ công | kiểm soát | chậm; người phê duyệt thường không đủ thông tin |

## Explain Without Notes

1. Ba con số mà chiến lược deploy quyết định?
2. Năm chiến lược và mỗi cái phù hợp khi nào?
3. Ràng buộc mà rolling áp đặt lên API, schema, payload?
4. Vì sao blue-green không giải quyết vấn đề schema?
5. Điều gì làm canary có giá trị hơn rolling chậm?
6. Deploy và release khác nhau thế nào? Cái gì tách chúng?
7. Ba điều kiện để rollback thật sự khả thi?
8. Smoke test sau deploy bắt được lớp lỗi nào mà CI không bắt được?

## Related

- [Build & artifact promotion](02-build-artifact-promotion.md) — deploy bằng digest
- [CI/CD pipeline](01-pipeline.md) — nơi artifact được tạo
- [Rollout & rollback](../04-kubernetes/workloads-networking/03-rollout-rollback.md) — cơ chế trong Kubernetes
- [Migrations](../../03-database/03-data-modeling/04-migrations.md) — tương thích ngược
- [Configuration](../../02-backend-api/04-architecture/05-configuration.md) — feature flag vs config
- [Alerting & dashboards](../../05-cross-cutting/observability/05-alerting-dashboards.md) — phát hiện tự động
- [Metrics & SLO](../../05-cross-cutting/observability/04-metrics-slo.md) — metric cho canary analysis
- [Graceful shutdown](../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) — điều kiện để rolling không mất request
- [WebSocket gateway](../../02-backend-api/02-nestjs/behavior/08-websocket-gateway.md) — kết nối dài khi deploy

## Version / Context

Kubernetes Deployment hỗ trợ Recreate và RollingUpdate. Canary và blue-green cần công cụ bổ sung: Argo Rollouts, Flagger, hoặc service mesh (Istio, Linkerd). Feature flag: Unleash, Flagsmith, LaunchDarkly, hoặc một bảng trong database.
