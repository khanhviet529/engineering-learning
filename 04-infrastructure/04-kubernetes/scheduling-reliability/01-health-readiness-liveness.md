---
level: intermediate
area: infra
prerequisites:
  - ../workloads-networking/01-pod-deployment-service.md
related:
  - ../workloads-networking/03-rollout-rollback.md
  - ../../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md
  - ../../01-networking/05-reverse-proxy-load-balancer.md
---

# Readiness, liveness & startup probe

> Database chậm lại trong 90 giây do một query báo cáo nặng. Liveness probe của mọi pod gọi `SELECT 1` và bắt đầu timeout. Kubernetes kết luận **mọi pod đều chết** và restart tất cả cùng lúc. Bây giờ không còn pod nào phục vụ, và các pod mới khởi động lại đập vào database vốn đã quá tải. Một sự cố 90 giây trở thành 12 phút downtime toàn phần — gây ra bởi chính cơ chế lẽ ra bảo vệ hệ thống.

## Position

```text
kubelet ──probe──▶ container
   ├─ startup    "đã khởi động xong chưa?"      → chưa xong thì HOÃN hai probe kia
   ├─ liveness   "còn sống không?"              → chết thì RESTART
   └─ readiness  "sẵn sàng nhận traffic chưa?"  → chưa thì RÚT khỏi Service
```

Ba probe, ba hành động **hoàn toàn khác nhau**. Nhầm chúng là nguyên nhân của một lớp sự cố nghiêm trọng.

## Problem

```text
Không có probe:
  · traffic vào pod chưa khởi động xong → lỗi khi deploy
  · pod treo (deadlock) mãi mãi không được restart
  · rolling update không biết khi nào pod mới sẵn sàng → downtime

Probe SAI:
  · liveness kiểm tra dependency → dependency chậm = restart TẤT CẢ  ← tệ nhất
  · readiness quá nhạy → pod bị rút liên tục
  · timeout quá ngắn → false positive dưới tải
  · thiếu startup probe → app khởi động chậm bị restart vô hạn
```

Điểm mấu chốt: **probe sai còn nguy hiểm hơn không có probe**, vì nó chủ động phá hệ thống khi hệ thống đang yếu.

## Mental Model

### Ba probe, ba câu hỏi, ba hành động

```text
STARTUP    "khởi động xong chưa?"
           fail → tiếp tục chờ (tới failureThreshold thì restart)
           TRONG KHI CHẠY: liveness và readiness bị HOÃN

LIVENESS   "process còn sống không?"
           fail → RESTART CONTAINER
           ⇒ chỉ dùng cho tình trạng mà RESTART sửa được

READINESS  "có phục vụ được không?"
           fail → RÚT khỏi Service endpoints (KHÔNG restart)
           ⇒ dùng cho tình trạng TẠM THỜI
```

Câu hỏi phân loại, và nó quyết định mọi thứ:

> **"Restart có sửa được tình trạng này không?"**
>
> Có → liveness. Không → readiness.

Database chậm: restart **không** sửa được → readiness.
Deadlock trong app: restart **có** sửa được → liveness.

### Liveness KHÔNG được phụ thuộc dependency

```ts
// ❌ NGUY HIỂM — đây là sự cố ở đầu note
app.get('/health', async (_, res) => {
  await db.query('SELECT 1');       // DB chậm → mọi pod bị restart
  await redis.ping();
  res.send('ok');
});
```

```ts
// ✅ liveness: CHỈ kiểm tra process của chính nó
app.get('/health', (_, res) => res.status(200).send('ok'));

// ✅ readiness: kiểm tra "có phục vụ được không"
app.get('/ready', async (_, res) => {
  if (shuttingDown) return res.status(503).send('shutting down');
  try {
    await db.query('SELECT 1');
    res.send('ok');
  } catch {
    res.status(503).send('db unavailable');
  }
});
```

Lý do: khi database chậm, restart app **làm mọi thứ tệ hơn** — mất connection pool đang có, thêm tải khởi động lại lên database, và mất luôn khả năng phục vụ request không cần DB.

Readiness fail thì pod bị rút khỏi traffic nhưng **vẫn sống**; khi database hồi phục, nó tự quay lại. Đó là hành vi đúng.

### Nhưng readiness phụ thuộc dependency cũng có bẫy

```text
Nếu MỌI pod cùng fail readiness (database chậm)
   → endpoints rỗng → Service không có backend → 503 cho MỌI request
```

Đây là đánh đổi thật, và có hai cách xử lý:

```text
① Readiness chỉ kiểm tra dependency THIẾT YẾU
   → phần chức năng không cần DB vẫn phục vụ được
② Chấp nhận 503 khi DB chết
   → thà 503 rõ ràng còn hơn trả lỗi 500 ngẫu nhiên
```

Với API mà mọi endpoint đều cần database, ② là lựa chọn hợp lý. Với API có phần đọc cache được, ① tốt hơn.

Điều **không** nên làm: cho readiness kiểm tra mọi dependency kể cả không thiết yếu (analytics, search) — một dịch vụ phụ chết sẽ làm cả service biến mất khỏi LB.

### Startup probe: cho app khởi động chậm

```yaml
startupProbe:
  httpGet: { path: /health, port: http }
  periodSeconds: 5
  failureThreshold: 30          # cho phép tới 150 giây để khởi động
livenessProbe:
  httpGet: { path: /health, port: http }
  periodSeconds: 20
  failureThreshold: 3
```

```text
Không có startup probe, app khởi động 60 giây:
   liveness bắt đầu ngay → fail → RESTART → khởi động lại → fail → CrashLoopBackOff
   ⇒ app KHÔNG BAO GIỜ khởi động xong

Có startup probe:
   liveness và readiness bị HOÃN cho tới khi startup pass
   ⇒ liveness giữ được periodSeconds ngắn cho lúc chạy bình thường
```

Trước khi có startup probe, người ta dùng `initialDelaySeconds` lớn cho liveness — nhưng nó buộc bạn chọn giữa "chờ đủ lâu lúc khởi động" và "phát hiện nhanh lúc chạy". Startup probe tách hai mối lo đó.

### Readiness phải phản ánh trạng thái shutdown

```ts
let shuttingDown = false;

process.on('SIGTERM', async () => {
  shuttingDown = true;                    // ① readiness → 503 NGAY
  await sleep(5_000);                     // ② chờ LB rút traffic
  await server.close();                   // ③ ngừng nhận kết nối mới
  // ④ chờ request đang xử lý, đóng dependency, exit 0
});
```

```text
Liveness KHÔNG được phản ánh shutdown.
Nếu liveness trả 503 khi đang shutdown → K8s coi pod CHẾT → SIGKILL NGAY
   ⇒ cắt ngắn graceful shutdown, mất request đang xử lý
```

Chỉ readiness được phản ánh trạng thái shutdown. Xem [Graceful shutdown](../../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md).

### Tham số probe

```yaml
readinessProbe:
  httpGet: { path: /ready, port: http }
  periodSeconds: 2          # NGẮN → rút traffic nhanh khi shutdown
  timeoutSeconds: 1         # phải < periodSeconds
  failureThreshold: 1       # rút ngay khi fail một lần
  successThreshold: 1

livenessProbe:
  httpGet: { path: /health, port: http }
  periodSeconds: 20         # DÀI → tránh restart vì một lần chậm
  timeoutSeconds: 3
  failureThreshold: 3       # cần 3 lần fail liên tiếp → 60 giây
```

Nguyên tắc bất đối xứng, và nó là điểm quan trọng nhất về tham số:

```text
READINESS  nhạy   (period ngắn, threshold 1)
           → hậu quả của false positive: pod bị rút tạm thời — RẺ

LIVENESS   chậm   (period dài, threshold cao)
           → hậu quả của false positive: RESTART — ĐẮT
```

### Ba loại probe handler

```yaml
httpGet:   { path: /health, port: http }          # phổ biến nhất
tcpSocket: { port: 5432 }                          # chỉ kiểm tra port mở
exec:      { command: ["sh","-c","pg_isready"] }   # chạy lệnh trong container
```

```text
httpGet   → kubelet gọi trực tiếp IP pod (KHÔNG qua Service)
tcpSocket → chỉ biết port mở, không biết app có hoạt động không
exec      → TỐN NHẤT: fork một process mỗi lần probe
```

Với `exec` và `periodSeconds: 1`, bạn fork một process mỗi giây cho mỗi pod — trên cluster lớn, đó là tải thật. Ưu tiên `httpGet`.

Và lưu ý: kubelet gọi probe **trực tiếp tới IP pod**, không qua Service. Nên app phải bind `0.0.0.0`, không phải `127.0.0.1`.

### Endpoint health nên trả gì

```ts
// liveness: rẻ nhất có thể — không I/O, không allocation lớn
app.get('/health', (_, res) => res.status(200).send('ok'));

// readiness: kiểm tra thiết yếu, có TIMEOUT NGẮN, có CACHE
let lastCheck = { at: 0, ok: false };
app.get('/ready', async (_, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting_down' });

  if (Date.now() - lastCheck.at < 1_000) {              // cache 1 giây
    return res.status(lastCheck.ok ? 200 : 503).end();
  }
  try {
    await Promise.race([
      db.query('SELECT 1'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 500)),
    ]);
    lastCheck = { at: Date.now(), ok: true };
    res.status(200).json({ status: 'ok' });
  } catch (e) {
    lastCheck = { at: Date.now(), ok: false };
    res.status(503).json({ status: 'degraded', reason: String(e) });
  }
});
```

Ba chi tiết:

```text
timeout 500ms trong probe   → probe không treo theo dependency
cache 1 giây                → với period 2s và nhiều replica, giảm tải lên DB
trả JSON có lý do           → `kubectl describe` và log cho biết vì sao fail
```

### Probe và PodDisruptionBudget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
spec:
  minAvailable: 2
  selector: { matchLabels: { app: api } }
```

PDB đảm bảo nâng cấp node hoặc `kubectl drain` không lấy đi quá nhiều pod cùng lúc. Nhưng nó chỉ đếm pod **ready** — nên probe sai làm PDB tính sai và có thể chặn mọi thao tác bảo trì.

## Example

Cấu hình đầy đủ, và sự cố ở đầu note được ngăn thế nào:

```yaml
spec:
  terminationGracePeriodSeconds: 45
  containers:
    - name: api
      startupProbe:                       # app mất tới 90s để khởi động
        httpGet: { path: /health, port: http }
        periodSeconds: 5
        failureThreshold: 20              # 100 giây
      livenessProbe:                      # CHỈ process — không chạm DB
        httpGet: { path: /health, port: http }
        periodSeconds: 20
        timeoutSeconds: 3
        failureThreshold: 3               # 60 giây trước khi restart
      readinessProbe:                     # có chạm DB, timeout ngắn
        httpGet: { path: /ready, port: http }
        periodSeconds: 2
        timeoutSeconds: 1
        failureThreshold: 1               # rút traffic ngay
```

```text
Kịch bản: database chậm 90 giây

Với cấu hình SAI (liveness gọi DB):
   liveness fail → 3 lần → restart TẤT CẢ pod
   → mất connection pool, thêm tải khởi động lên DB
   → CrashLoopBackOff → downtime 12 phút

Với cấu hình ĐÚNG:
   liveness vẫn PASS (không chạm DB) → pod KHÔNG bị restart
   readiness fail → pod bị rút khỏi Service → trả 503 rõ ràng
   DB hồi phục → readiness pass → pod tự quay lại
   → downtime = đúng 90 giây, và không có sự cố thứ cấp
```

## Prediction

1. Liveness probe gọi `SELECT 1`, database chậm 90 giây — bao nhiêu pod bị restart?
2. Hệ quả với người dùng?
3. Readiness probe gọi `SELECT 1`, cùng tình huống — pod có bị restart không? Người dùng thấy gì?
4. App khởi động 60 giây, `livenessProbe` không có `startupProbe`, `initialDelaySeconds: 0` — kết quả?
5. Thêm `startupProbe` với `failureThreshold: 20, periodSeconds: 5` — kết quả?
6. Liveness trả 503 khi đang shutdown — chuyện gì xảy ra?
7. Readiness trả 503 khi đang shutdown — chuyện gì xảy ra?
8. Không có readiness probe, rolling update — traffic vào pod mới khi nào?
9. `readinessProbe.periodSeconds: 30`, pod shutdown — LB mất bao lâu để rút traffic?
10. Probe dùng `exec` với `periodSeconds: 1`, 100 pod — bao nhiêu process fork mỗi giây?
11. App bind `127.0.0.1`, `httpGet` probe — probe pass hay fail?
12. Readiness phụ thuộc dịch vụ analytics (không thiết yếu), analytics chết — chuyện gì xảy ra?
13. `livenessProbe.failureThreshold: 1, periodSeconds: 5`, một lần GC pause 6 giây — kết quả?

<details>
<summary>Đáp án</summary>

1. **Tất cả** — mọi pod đều fail cùng probe.
2. Downtime toàn phần, và pod khởi động lại đập thêm vào DB đang quá tải → sự cố kéo dài hơn nhiều so với 90 giây.
3. **Không bị restart.** Pod bị rút khỏi Service → người dùng nhận **503 rõ ràng**; khi DB hồi phục, pod tự quay lại.
4. Liveness fail trước khi app khởi động xong → restart → lặp lại → **CrashLoopBackOff vĩnh viễn**.
5. Liveness bị hoãn cho tới khi startup pass (tối đa 100 giây) → app khởi động được bình thường.
6. K8s coi pod **chết** → SIGKILL ngay → graceful shutdown bị cắt ngắn, mất request đang xử lý.
7. Pod bị rút khỏi endpoints → LB ngừng gửi traffic → graceful shutdown hoạt động đúng.
8. **Ngay khi container start** — trước khi app sẵn sàng → lỗi trong cửa sổ rollout.
9. Tới **30 giây** — quá chậm; trong thời gian đó traffic vẫn vào pod đang shutdown → 502.
10. **100 process/giây** — tải thật lên kubelet và node.
11. **Fail** — kubelet gọi tới IP pod, không phải loopback của container.
12. Mọi pod bị rút khỏi Service dù chức năng chính vẫn hoạt động → **downtime tự gây ra**.
13. Pod bị **restart** vì một lần GC pause. `failureThreshold: 1` cho liveness là quá nhạy.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Liveness gọi DB, làm DB chậm 60 giây | Mọi pod restart |
| Đổi sang readiness, lặp lại | Pod bị rút, không restart |
| Bỏ readiness probe, rolling update với tải | Lỗi trong cửa sổ deploy |
| Thêm readiness, lặp lại | Về 0 |
| App khởi động 60s không có startup probe | CrashLoopBackOff |
| Thêm startup probe | Khởi động bình thường |
| Cho liveness trả 503 khi shutdown, đo thời gian tắt | Bị SIGKILL sớm |
| Chỉ readiness trả 503, lặp lại | Graceful shutdown hoàn tất |
| `readinessProbe.periodSeconds: 30`, rollout với tải | 502 kéo dài |
| Giảm xuống 2 với `failureThreshold: 1` | Giảm mạnh |
| `livenessProbe.failureThreshold: 1`, tạo GC pause | Restart oan |
| Bind `127.0.0.1`, xem probe | Fail; `describe` cho thấy connection refused |
| Readiness phụ thuộc dịch vụ phụ, tắt dịch vụ đó | Toàn bộ service biến mất khỏi LB |
| Probe `exec` với period 1s trên nhiều pod, đo tải node | Fork liên tục |

## What Usually Goes Wrong

- **Liveness kiểm tra dependency** → dependency chậm gây restart hàng loạt. Sai lầm nghiêm trọng nhất.
- **Dùng chung một endpoint cho cả hai probe** → thừa hưởng vấn đề trên.
- **Không có startup probe cho app khởi động chậm** → CrashLoopBackOff vĩnh viễn.
- **Liveness phản ánh trạng thái shutdown** → SIGKILL sớm, mất request.
- **`readinessProbe.periodSeconds` quá dài** → 502 khi deploy.
- **`livenessProbe.failureThreshold` quá thấp** → restart oan vì GC pause hoặc một lần chậm.
- **`timeoutSeconds` quá ngắn** → false positive dưới tải.
- **Readiness phụ thuộc dịch vụ không thiết yếu** → downtime tự gây ra.
- **Probe không có timeout ở phía app** → probe treo theo dependency.
- **`exec` probe với period ngắn** → tải fork lên node.
- **App bind `127.0.0.1`** → probe không tới được.
- **Không có probe nào** → traffic vào pod chưa sẵn sàng; pod treo không được restart.
- **Health endpoint trả 200 mà không kiểm tra gì thật** ở readiness → pod hỏng vẫn nhận traffic.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Liveness và readiness gần như nhau | Một cái RESTART, một cái RÚT TRAFFIC |
| Health check nên kiểm tra mọi dependency | Liveness thì không — nó gây restart hàng loạt |
| Một endpoint `/health` là đủ | Cần ít nhất hai, với ngữ nghĩa khác nhau |
| Pod `Running` nghĩa là nhận traffic | Cần `READY` — readiness probe pass |
| `initialDelaySeconds` thay được startup probe | Nó buộc đánh đổi giữa khởi động chậm và phát hiện nhanh |
| Probe càng nhạy càng tốt | Liveness nhạy = restart oan |
| Cả hai probe nên phản ánh shutdown | Chỉ readiness; liveness trả 503 gây SIGKILL |
| Probe đi qua Service | kubelet gọi trực tiếp IP pod |
| `tcpSocket` đủ để biết app khoẻ | Nó chỉ biết port mở |
| Readiness fail là chuyện xấu | Nó là cơ chế bảo vệ hoạt động đúng |

## Debugging

1. **Pod `0/1 Running`** → readiness fail. `kubectl describe pod` → phần **Events** cho biết lý do.
2. **Gọi probe bằng tay từ trong pod**:
   ```bash
   kubectl exec <pod> -- wget -qO- --timeout=2 http://localhost:3000/ready; echo $?
   ```
3. **CrashLoopBackOff** → `kubectl logs <pod> --previous`. Nếu log rỗng, nghi liveness giết trước khi app khởi động xong.
4. **Đếm restart**: `kubectl get pods` cột `RESTARTS`. Tăng đều = liveness probe sai hoặc OOM.
5. **Phân biệt liveness-restart và OOM**:
   ```bash
   kubectl describe pod <p> | grep -A5 'Last State'
   # Reason: Error       → liveness giết
   # Reason: OOMKilled   → vượt memory limit
   ```
6. **`endpoints` rỗng** → pod có ready không? `kubectl get pods -l <selector>`.
7. **Probe timeout dưới tải** → tăng `timeoutSeconds`, hoặc làm endpoint rẻ hơn (cache kết quả).
8. **Xem sự kiện probe**: `kubectl get events --field-selector involvedObject.name=<pod>`.

## Production Considerations

- **Ba endpoint riêng biệt**: `/health` (liveness, rẻ nhất), `/ready` (readiness, kiểm tra thiết yếu), `/startup` (nếu khác `/health`).
- **Liveness tuyệt đối không chạm dependency.**
- **Readiness chỉ kiểm tra dependency THIẾT YẾU**, có timeout ngắn (500ms) và cache kết quả (1 giây).
- **Startup probe cho mọi app khởi động > 10 giây.**
- **Bất đối xứng**: readiness nhạy (period 2s, threshold 1); liveness chậm (period 20s, threshold 3).
- **Readiness phản ánh shutdown; liveness KHÔNG.**
- **`httpGet` thay `exec`** khi có thể.
- **App bind `0.0.0.0`.**
- **PodDisruptionBudget** để bảo trì node không lấy đi quá nhiều pod ready.
- **Alert trên số restart** — nó là tín hiệu sớm của probe sai hoặc rò rỉ bộ nhớ.
- **Test probe trong staging bằng cách chủ động làm dependency chậm** — đây là cách duy nhất biết cấu hình đúng trước khi có sự cố.
- **Ghi lại lý do fail trong response** của readiness — nó xuất hiện trong log và tiết kiệm thời gian điều tra.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Liveness đơn giản (chỉ process) | không restart hàng loạt | không phát hiện được deadlock logic |
| Liveness kiểm tra sâu | phát hiện nhiều vấn đề hơn | rủi ro restart hàng loạt — thường không đáng |
| Readiness kiểm tra dependency | không gửi traffic vào pod hỏng | mọi pod fail cùng lúc = 503 toàn phần |
| Readiness nông | luôn có backend | traffic vào pod không phục vụ được |
| Readiness period ngắn | rút traffic nhanh, ít 502 | nhiều probe hơn |
| Readiness period dài | ít tải | 502 khi deploy |
| Liveness threshold cao | ít restart oan | phát hiện pod treo chậm hơn |
| Liveness threshold thấp | phát hiện nhanh | restart oan vì GC/chậm tạm thời |
| Startup probe | tách khởi động khỏi vận hành | thêm một probe phải cấu hình |
| `initialDelaySeconds` lớn | đơn giản | phải đánh đổi độ nhạy lúc chạy |

## Explain Without Notes

1. Ba probe, ba câu hỏi, ba hành động?
2. Câu hỏi phân loại giữa liveness và readiness?
3. Vì sao liveness không được chạm dependency? Kể chuỗi sự cố nếu vi phạm.
4. Readiness phụ thuộc dependency có bẫy gì, và hai cách xử lý?
5. Startup probe giải quyết vấn đề gì mà `initialDelaySeconds` không giải quyết được?
6. Vì sao chỉ readiness được phản ánh trạng thái shutdown?
7. Nguyên tắc bất đối xứng về tham số probe, và lý do?
8. Vì sao app phải bind `0.0.0.0` để probe hoạt động?

## Related

- [Pod, Deployment, Service](../workloads-networking/01-pod-deployment-service.md) — endpoints và readiness
- [Rollout & rollback](../workloads-networking/03-rollout-rollback.md) — readiness quyết định tốc độ rollout
- [Debugging Kubernetes](../operations/02-debugging-k8s.md) — CrashLoopBackOff
- [Graceful shutdown](../../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md) — readiness khi SIGTERM
- [Reverse proxy & load balancer](../../01-networking/05-reverse-proxy-load-balancer.md) — cùng khái niệm ở tầng LB
- [Memory, CPU & limits](../../00-linux/02-memory-cpu-limits.md) — phân biệt restart do liveness và do OOM
- [Graceful degradation](../../../05-cross-cutting/reliability/03-graceful-degradation.md) — dependency thiết yếu vs tuỳ chọn
- [Error handling strategy](../../../02-backend-api/04-architecture/04-error-handling-strategy.md) — phân loại dependency

## Version / Context

Kubernetes 1.29+. `startupProbe` ổn định từ 1.20. `terminationGracePeriodSeconds` có thể đặt riêng cho probe từ 1.25 (`terminationGracePeriodSeconds` trong probe spec). Kubernetes bỏ qua `HEALTHCHECK` trong Dockerfile.
