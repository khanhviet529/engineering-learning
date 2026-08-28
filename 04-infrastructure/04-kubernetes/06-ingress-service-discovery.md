---
level: intermediate
area: infra
prerequisites:
  - 01-pod-deployment-service.md
  - ../01-networking/05-reverse-proxy-load-balancer.md
related:
  - 10-debugging-k8s.md
  - ../01-networking/01-ip-port-dns.md
---

# Ingress & service discovery

> Bạn tạo Ingress cho `api.example.com`, DNS đã trỏ đúng, certificate đã cấp. Gọi thử: `404 Not Found` — nhưng không phải từ app, mà từ ingress controller. Ingress nằm ở namespace `default`, Service nằm ở namespace `backend`. Ingress **không thể** trỏ tới Service ở namespace khác, và nó không báo lỗi khi bạn tạo — nó chỉ im lặng không khớp.

## Position

```text
Internet → LoadBalancer của cloud → Ingress Controller → Service → Pod
                                     ↑ routing theo host/path, TLS
```

Và bên trong cluster:

```text
Pod → DNS (CoreDNS) → ClusterIP → kube-proxy → Pod khác
```

## Problem

```text
① Lộ service ra internet: mỗi Service một LoadBalancer = tốn tiền, khó quản lý
② TLS: mỗi service tự quản certificate?
③ Routing: nhiều service, một domain, theo path
④ Bên trong cluster: pod tìm nhau thế nào khi IP thay đổi liên tục?
```

Kubernetes giải bằng hai cơ chế: **Service + DNS** cho nội bộ, **Ingress** cho bên ngoài.

## Mental Model

### DNS nội bộ

```text
<service>.<namespace>.svc.cluster.local

api.backend.svc.cluster.local     đầy đủ
api.backend                        đủ trong cluster
api                                đủ trong CÙNG namespace
```

Đây là lý do pod không bao giờ cần biết IP của nhau: **tên Service ổn định, IP pod thì không.**

### `ndots:5`: chi phí ẩn của DNS trong cluster

```text
/etc/resolv.conf trong pod:
  search default.svc.cluster.local svc.cluster.local cluster.local
  options ndots:5
```

```text
Tra "api.stripe.com" (2 dấu chấm < 5) → thử LẦN LƯỢT:
  api.stripe.com.default.svc.cluster.local   ✗
  api.stripe.com.svc.cluster.local           ✗
  api.stripe.com.cluster.local               ✗
  api.stripe.com                             ✓
⇒ 4 truy vấn DNS cho MỘT lần tra cứu domain ngoài
```

Với app gọi API bên ngoài nhiều, đây là tải thật lên CoreDNS và là nguyên nhân của "DNS chậm trong cluster".

Hai cách sửa:

```yaml
# ① giảm ndots cho pod
dnsConfig:
  options: [{ name: ndots, value: "2" }]
```

```ts
// ② FQDN có dấu chấm cuối — bỏ qua search list
fetch('https://api.stripe.com./v1/charges');
```

### Bốn loại Service, và khi nào dùng

```text
ClusterIP      IP ảo nội bộ                       → mặc định, dùng cho hầu hết
NodePort       mở port trên MỌI node (30000+)     → test, hoặc LB tự quản
LoadBalancer   tạo LB của cloud                    → mỗi Service một LB = TỐN
ExternalName   CNAME tới tên ngoài                 → trỏ tới dịch vụ ngoài cluster
```

`ExternalName` hữu ích hơn nó có vẻ: nó cho phép app gọi `db` (tên nội bộ) trong khi thực tế nó trỏ tới RDS bên ngoài — và bạn đổi được đích mà không sửa app.

```yaml
kind: Service
metadata: { name: db }
spec:
  type: ExternalName
  externalName: prod-db.abc.rds.amazonaws.com
```

### Headless Service

```yaml
spec:
  clusterIP: None
```

```text
ClusterIP thường: DNS → MỘT IP ảo; kube-proxy cân bằng theo KẾT NỐI
Headless:         DNS → IP của TỪNG pod
```

Hai trường hợp bắt buộc dùng headless:

```text
① StatefulSet — mỗi pod cần danh tính DNS ổn định
   api-0.api.default.svc.cluster.local

② gRPC / HTTP2 — client giữ MỘT kết nối dài
   → ClusterIP cân bằng theo kết nối ⇒ mọi request vào MỘT pod
   → cần headless + client-side load balancing, hoặc service mesh
```

Điểm ② là bẫy phổ biến: gRPC qua ClusterIP trông "hoạt động" nhưng tải dồn hết vào một pod, và bạn chỉ phát hiện khi nhìn metric theo pod.

### Ingress: một LB, nhiều service

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app
  namespace: backend                    # PHẢI cùng namespace với Service
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
spec:
  ingressClassName: nginx
  tls:
    - hosts: [api.example.com]
      secretName: api-tls               # cert-manager tạo Secret này
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api               # Service trong CÙNG namespace
                port: { number: 80 }
```

Ba điều hay sai:

```text
① Ingress và Service phải CÙNG NAMESPACE  ← lỗi ở đầu note, và nó IM LẶNG
② Thiếu ingressClassName → không controller nào nhận Ingress này
③ Annotation là ĐẶC THÙ controller (nginx ≠ traefik ≠ ALB)
```

Điểm ③ đáng nhớ khi đọc tài liệu: một annotation copy từ blog viết cho nginx sẽ **không có tác dụng** với Traefik — và cũng không báo lỗi.

### Ingress vs Gateway API

```text
INGRESS       ổn định, phổ biến nhất
              nhưng: mọi thứ ngoài routing cơ bản đều qua ANNOTATION
              → không portable, không type-safe

GATEWAY API   thay thế hiện đại (GA từ 1.1)
              Gateway (hạ tầng) / HTTPRoute (routing) tách nhau
              → chia traffic theo %, header matching, cross-namespace có kiểm soát
              → phù hợp với mô hình tổ chức: team hạ tầng quản Gateway,
                team app quản HTTPRoute
```

Với dự án mới và controller hỗ trợ, Gateway API đáng cân nhắc. Với hệ thống hiện có, Ingress vẫn ổn — nhưng biết giới hạn của nó.

### `externalTrafficPolicy`: đánh đổi IP nguồn

```yaml
kind: Service
spec:
  type: LoadBalancer
  externalTrafficPolicy: Local      # hoặc Cluster (mặc định)
```

```text
Cluster (mặc định)  traffic tới node bất kỳ → SNAT → chuyển tới pod ở node khác
                    + phân bố đều
                    − MẤT IP nguồn thật (app thấy IP node)
                    − thêm một chặng mạng

Local               chỉ route tới pod TRÊN NODE nhận traffic
                    + giữ IP nguồn thật
                    − node không có pod thì không nhận traffic → phân bố LỆCH
                    − cần LB health check đúng để bỏ qua node không có pod
```

Với HTTP qua Ingress, thường không cần `Local` — ingress controller đã thêm `X-Forwarded-For`. `Local` cần thiết khi bạn dùng `LoadBalancer` Service trực tiếp (TCP, không qua L7 proxy).

### `X-Forwarded-For` và `trust proxy`

```text
Client 203.0.113.99
   ↓
Cloud LB          → X-Forwarded-For: 203.0.113.99
   ↓
Ingress           → X-Forwarded-For: 203.0.113.99, <ip-lb>
   ↓
App               → phải parse header, KHÔNG đọc socket
```

```ts
app.set('trust proxy', 2);   // số proxy CHÍNH XÁC, không dùng `true`
```

`true` nghĩa là tin mọi giá trị trong header — client tự đặt được → giả mạo IP, làm vô hiệu rate limit và audit log.

### NetworkPolicy: cô lập trong cluster

```text
MẶC ĐỊNH: mọi pod gọi được mọi pod, mọi namespace
Có NetworkPolicy chọn một pod → pod đó DENY mọi thứ trừ cái được cho phép
```

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-policy, namespace: backend }
spec:
  podSelector: { matchLabels: { app: api } }
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { name: ingress-nginx } }
      ports: [{ protocol: TCP, port: 3000 }]
  egress:
    - to: [{ podSelector: { matchLabels: { app: postgres } } }]
      ports: [{ protocol: TCP, port: 5432 }]
    - to:                                   # ← BẮT BUỘC: cho phép DNS
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }
          podSelector: { matchLabels: { k8s-app: kube-dns } }
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
```

Hai điều gây sự cố:

```text
① Chặn egress mà QUÊN DNS
   → pod không phân giải được TÊN NÀO → mọi thứ hỏng
   → triệu chứng trông như "mạng chết hoàn toàn"

② CNI không hỗ trợ NetworkPolicy
   → policy được CHẤP NHẬN nhưng KHÔNG có hiệu lực
   → bạn nghĩ đã bảo vệ, thực tế không
```

Điểm ② phải kiểm chứng bằng cách **thử một kết nối lẽ ra bị cấm** — không dựa vào việc `kubectl apply` thành công.

### Service mesh: khi nào cần

```text
Cho: mTLS tự động, retry/timeout/circuit breaker ở tầng mạng,
     traffic splitting cho canary, observability chi tiết

Giá: một tầng hạ tầng lớn (sidecar hoặc ambient mode),
     độ trễ thêm, độ phức tạp debug, tài nguyên
```

Với dưới ~10 service, những gì mesh cung cấp thường rẻ hơn khi làm ở tầng ứng dụng (timeout, retry trong HTTP client) và ở tầng Ingress. Mesh trở nên đáng giá khi số service lớn và bạn cần chính sách thống nhất mà không sửa từng app.

## Example

Chẩn đoán "Ingress trả 404":

```bash
# 1. Ingress có được controller nhận không?
kubectl get ingress -n backend
# NAME   CLASS   HOSTS              ADDRESS         PORTS
# app    nginx   api.example.com    52.1.2.3        80, 443
#        ↑ nếu CLASS <none> → thiếu ingressClassName
#                            ↑ nếu ADDRESS rỗng → controller chưa xử lý

# 2. Backend Service có tồn tại trong CÙNG namespace không?
kubectl get svc -n backend api
# Error: not found          ← Service ở namespace khác

# 3. Service có endpoints không?
kubectl get endpoints -n backend api
# <none>                    ← selector sai hoặc pod chưa ready

# 4. Log của ingress controller — nó nói chính xác vì sao
kubectl logs -n ingress-nginx deploy/ingress-nginx-controller --tail=50 | grep api.example.com

# 5. Test từng tầng, từ trong ra ngoài
kubectl run tmp --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s -o /dev/null -w '%{http_code}' http://api.backend.svc.cluster.local/health
# 200 → Service OK, vấn đề ở Ingress
# lỗi → vấn đề ở Service/pod, không phải Ingress

# 6. Bỏ qua Ingress hoàn toàn
kubectl port-forward -n backend svc/api 8080:80
curl localhost:8080/health
```

Bước 5 và 6 chia đôi không gian tìm kiếm: nếu Service hoạt động từ trong cluster, vấn đề chắc chắn ở tầng Ingress/DNS/LB.

## Prediction

1. Ingress ở namespace `default`, Service ở `backend` — Ingress trỏ được không? Có báo lỗi không?
2. Ingress không có `ingressClassName`, cluster có nginx controller — nó có xử lý không?
3. Annotation của nginx dùng với Traefik controller — có tác dụng không?
4. Pod gọi `api.stripe.com` với `ndots:5` — bao nhiêu truy vấn DNS?
5. Thêm dấu chấm cuối — bao nhiêu?
6. gRPC client gọi ClusterIP với 3 pod — traffic phân bố thế nào?
7. Đổi sang headless + client-side LB — thế nào?
8. `externalTrafficPolicy: Cluster` — app thấy IP nguồn nào?
9. `Local` — thấy IP nào? Đánh đổi gì?
10. `trust proxy: true`, client gửi `X-Forwarded-For: 1.2.3.4` — log ghi IP nào?
11. NetworkPolicy chặn egress, quên cho phép DNS — triệu chứng?
12. NetworkPolicy trên CNI không hỗ trợ — điều gì xảy ra?
13. 10 microservice HTTP, mỗi cái một `LoadBalancer` Service trên AWS — hệ quả?

<details>
<summary>Đáp án</summary>

1. **Không** — Ingress chỉ trỏ tới Service **cùng namespace**. Và nó **không báo lỗi** khi tạo; chỉ trả 404 lúc chạy.
2. Tuỳ: nếu có `IngressClass` được đánh dấu default thì có; nếu không thì **không controller nào nhận**.
3. **Không** — annotation đặc thù từng controller, và không có cảnh báo nào.
4. **4** — ba lần với search domain rồi mới tới tên thật.
5. **1** — FQDN bỏ qua search list.
6. **Dồn vào một pod** — gRPC giữ một kết nối HTTP/2 dài; ClusterIP cân bằng theo kết nối.
7. Phân bố đều — client tự chọn pod cho mỗi request.
8. **IP của node** (do SNAT).
9. IP client **thật**. Đánh đổi: node không có pod thì không nhận traffic → phân bố lệch.
10. **`1.2.3.4`** — IP giả mạo. Rate limit theo IP và audit log đều sai.
11. Pod **không phân giải được tên nào** → mọi kết nối theo tên fail. Trông như mạng chết hoàn toàn.
12. Policy được **chấp nhận nhưng không có hiệu lực** — cảm giác an toàn giả.
13. **10 load balancer** của cloud → chi phí lớn và 10 IP phải quản lý. Một Ingress thay được tất cả.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Tạo Ingress ở namespace khác Service | 404, không có lỗi lúc apply |
| Bỏ `ingressClassName` | `ADDRESS` rỗng, không được xử lý |
| Dùng annotation nginx với Traefik | Không tác dụng, không cảnh báo |
| Đo thời gian DNS cho domain ngoài trong pod | Nhiều truy vấn |
| Thêm dấu chấm cuối, đo lại | Nhanh hơn |
| gRPC qua ClusterIP với 3 pod, đếm request mỗi pod | Lệch hoàn toàn |
| Đổi sang headless | Phân bố đều |
| Log IP nguồn với `externalTrafficPolicy: Cluster` | IP node |
| Đổi sang `Local`, xem phân bố traffic | Lệch theo node có pod |
| `trust proxy: true`, gửi `X-Forwarded-For` giả | Log ghi IP giả |
| NetworkPolicy deny-all egress không cho phép DNS | Mọi tên không phân giải được |
| Thêm rule DNS | Hoạt động lại |
| Áp NetworkPolicy trên CNI không hỗ trợ, thử kết nối bị cấm | Vẫn kết nối được |
| `kubectl port-forward svc/api` khi Ingress lỗi | Cô lập được tầng vấn đề |

## What Usually Goes Wrong

- **Ingress và Service khác namespace** → 404 im lặng.
- **Thiếu `ingressClassName`** → không controller nào xử lý.
- **Annotation sai controller** → không có tác dụng, không cảnh báo.
- **`endpoints` rỗng** → Service không khớp pod, hoặc pod chưa ready.
- **gRPC qua ClusterIP** → tải dồn một pod.
- **NetworkPolicy chặn DNS** → toàn bộ pod hỏng.
- **NetworkPolicy trên CNI không hỗ trợ** → cảm giác an toàn giả.
- **`trust proxy: true`** → giả mạo IP.
- **Nhiều `LoadBalancer` Service** → chi phí lớn.
- **`ndots:5` với nhiều gọi ra ngoài** → tải CoreDNS, DNS chậm.
- **CoreDNS thiếu replica/tài nguyên** → DNS chậm làm **mọi thứ** chậm, và rất khó quy trách nhiệm.
- **Không giới hạn body ở Ingress** → request khổng lồ tới app.
- **Timeout của Ingress ngắn hơn của app** → 504 trong khi app vẫn đang xử lý.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Ingress trỏ được tới Service ở namespace khác | Không — phải cùng namespace |
| Annotation Ingress là chuẩn | Chúng đặc thù từng controller |
| ClusterIP cân bằng theo request | Nó cân bằng theo **kết nối** |
| gRPC hoạt động bình thường qua ClusterIP | Nó ghim vào một pod |
| DNS trong cluster miễn phí | `ndots:5` nhân số truy vấn cho domain ngoài |
| Mặc định pod bị cô lập | Ngược lại: mọi pod gọi được mọi pod |
| NetworkPolicy có hiệu lực ngay | Cần CNI hỗ trợ |
| `externalTrafficPolicy` chỉ là chi tiết | Nó quyết định IP nguồn và phân bố traffic |
| `X-Forwarded-For` đáng tin | Chỉ khi tin đúng số proxy |
| Service mesh cần cho mọi cluster | Với ít service, chi phí lớn hơn lợi ích |

## Debugging

Thứ tự từ trong ra ngoài — mỗi bước loại trừ một tầng:

1. **Pod chạy được không?** `kubectl get pods -l app=api` → `READY 1/1`?
2. **Service có endpoints không?** `kubectl get endpoints api` → `<none>` là dấu hiệu rõ ràng.
3. **Gọi Service từ trong cluster:**
   ```bash
   kubectl run tmp --rm -it --image=curlimages/curl --restart=Never -- curl -v http://api.backend/health
   ```
   Nếu OK → vấn đề ở tầng Ingress trở ra.
4. **`kubectl port-forward svc/api 8080:80`** — bỏ qua Ingress và LB hoàn toàn.
5. **Ingress được nhận chưa?** `kubectl get ingress` → có `CLASS` và `ADDRESS` không?
6. **Log của ingress controller** — nó ghi chính xác vì sao 404/502/504.
7. **DNS bên ngoài:** `dig api.example.com` → có trỏ tới IP của LB không?
8. **TLS:** `openssl s_client -connect api.example.com:443 -servername api.example.com`.
9. **NetworkPolicy:** `kubectl get networkpolicy -A`; test bằng một pod tạm.

## Production Considerations

- **Một Ingress controller cho nhiều service**, không dùng nhiều `LoadBalancer` Service.
- **cert-manager** để tự động cấp và gia hạn certificate — kèm alert khi gia hạn thất bại.
- **Giới hạn ở Ingress**: body size, rate limit, timeout header — rẻ hơn chặn ở app rất nhiều.
- **Timeout của Ingress > timeout của app** — nếu ngược lại, bạn luôn thấy 504 của Ingress thay vì lỗi thật.
- **CoreDNS đủ replica và tài nguyên**, có monitoring. DNS chậm biểu hiện thành "mọi thứ chậm".
- **Giảm `ndots` hoặc dùng FQDN** cho app gọi nhiều API bên ngoài.
- **Headless Service + client-side LB cho gRPC**, hoặc service mesh.
- **NetworkPolicy mặc định deny**, và **luôn cho phép DNS**. Kiểm chứng bằng cách thử kết nối bị cấm.
- **`trust proxy` đúng số proxy**, không dùng `true`.
- **Log `X-Forwarded-For` và `upstream_addr`** ở Ingress — chúng cần cho mọi cuộc điều tra.
- **Cân nhắc Gateway API** cho hệ thống mới — nó giải quyết vấn đề annotation không portable.
- **Test từ ngoài internet định kỳ** (synthetic monitoring) — nó bắt được vấn đề DNS, TLS, LB mà monitoring nội bộ không thấy.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Ingress | một LB, routing theo host/path, TLS tập trung | thêm một thành phần; annotation không portable |
| LoadBalancer mỗi Service | đơn giản, không thêm thành phần | tốn tiền, nhiều IP phải quản lý |
| NodePort | không cần LB | port cao, không TLS, khó quản lý |
| Gateway API | portable, tách vai trò rõ | mới hơn, hỗ trợ chưa đầy đủ ở mọi controller |
| ClusterIP | đơn giản, ổn định | cân bằng theo kết nối — vấn đề với gRPC |
| Headless | client-side LB, danh tính pod | client phải tự cân bằng |
| `externalTrafficPolicy: Local` | giữ IP nguồn | phân bố lệch |
| `Cluster` | phân bố đều | mất IP nguồn, thêm một chặng |
| NetworkPolicy chặt | cô lập tốt | dễ chặn nhầm DNS; cần CNI hỗ trợ |
| Không NetworkPolicy | đơn giản | mọi pod gọi được mọi pod |
| Service mesh | mTLS, retry, canary, observability | tầng hạ tầng lớn, độ trễ, phức tạp |

## Explain Without Notes

1. Tên DNS đầy đủ của một Service? Ba dạng rút gọn?
2. `ndots:5` gây ra chuyện gì, và hai cách sửa?
3. Vì sao gRPC qua ClusterIP phân bố lệch? Cách sửa?
4. Ba điều hay sai khi cấu hình Ingress?
5. `externalTrafficPolicy` `Cluster` vs `Local` — đánh đổi gì?
6. Mặc định của NetworkPolicy là gì? Điều gì xảy ra khi áp policy đầu tiên?
7. Vì sao NetworkPolicy chặn egress hay làm hỏng mọi thứ?
8. Bốn bước đầu tiên khi Ingress trả 404?

## Related

- [Pod, Deployment, Service](01-pod-deployment-service.md) — Service và endpoints
- [Readiness & liveness](02-health-readiness-liveness.md) — endpoints rỗng vì pod chưa ready
- [Debugging Kubernetes](10-debugging-k8s.md) — quy trình đầy đủ
- [Storage & StatefulSet](08-storage-statefulset.md) — headless Service cho StatefulSet
- [Reverse proxy & load balancer](../01-networking/05-reverse-proxy-load-balancer.md) — Ingress là reverse proxy
- [IP, port & DNS](../01-networking/01-ip-port-dns.md) — DNS, `ndots`
- [TLS](../01-networking/03-tls.md) — cert-manager, `X-Forwarded-Proto`
- [NAT, firewall & routing](../01-networking/04-nat-firewall-routing.md) — NetworkPolicy, mất IP nguồn
- [Container networking](../02-docker/02-container-networking.md) — mô hình mạng pod

## Version / Context

Kubernetes 1.29+. `networking.k8s.io/v1` cho Ingress và NetworkPolicy. Gateway API GA (v1.1) — cần cài CRD và controller hỗ trợ. NetworkPolicy cần CNI hỗ trợ (Calico, Cilium); `kubenet` và một số CNI đơn giản **không** hỗ trợ. CoreDNS là DNS mặc định từ 1.13.
