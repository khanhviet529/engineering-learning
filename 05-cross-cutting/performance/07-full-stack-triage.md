---
level: intermediate
area: cross-cutting
prerequisites:
  - 01-latency-throughput-bottleneck.md
related:
  - 05-profiling-load-testing.md
  - ../../01-web-frontend/04-application-engineering/03-slow-api-ux.md
---

# Full-stack triage

> Người dùng nói "trang chậm". Đây là **playbook** để tìm ra chậm ở đâu — không phải lý thuyết về hiệu năng (đã có ở [note 01](01-latency-throughput-bottleneck.md)) mà là thứ tự kiểm tra và câu lệnh cụ thể.

## Position

```text
Browser render → Network → API → External dep → Cache → DB → CPU/Memory
       └────────── mỗi trạm một cách đo, một cách loại trừ ──────────┘
```

## Problem

"Trang chậm" có thể là bảy nguyên nhân ở bảy tầng, và mỗi tầng có cách sửa hoàn toàn khác:

```text
Browser:   bundle lớn, long task, layout thrashing
Network:   nhiều round-trip, payload lớn, DNS/TLS
API:       await tuần tự, blocking event loop
External:  API bên thứ ba chậm, không timeout
Cache:     miss rate cao, stampede
DB:        N+1, thiếu index, lock, pool cạn
Infra:     CPU throttling, memory pressure, container limit
```

Phản ứng sai phổ biến nhất là **đoán rồi sửa**: thêm index, thêm cache, thêm replica. Nếu nút thắt ở chỗ khác, bạn tốn nhiều ngày mà không thay đổi gì.

Nguyên tắc duy nhất:

> **Đo trước khi sửa. Và đo theo thứ tự để loại trừ, không đo ngẫu nhiên.**

## Mental Model

Chia bài toán làm hai ở **TTFB** — đây là bước quan trọng nhất và rẻ nhất:

```text
Tổng thời gian người dùng cảm nhận
        │
        ├── TTFB (Time To First Byte)
        │   → thời gian SERVER + NETWORK
        │   → TTFB cao? Đi xuống backend/DB
        │
        └── Sau TTFB
            → thời gian BROWSER (parse, render, JS)
            → TTFB thấp mà vẫn chậm? Đi xuống frontend
```

Một phép đo chia bài toán làm hai, và loại trừ một nửa. Làm việc này trước mọi việc khác.

Rồi đi theo thứ tự **rẻ → đắt**:

```text
1. DevTools Network       (10 giây)  → TTFB, waterfall, payload
2. Server-Timing          (10 phút)  → thời gian ở đâu trong backend
3. Đếm query DB           (10 phút)  → N+1?
4. EXPLAIN ANALYZE        (30 phút)  → index?
5. Profiler (CPU/heap)    (1 giờ)    → hàm nào?
6. Load test              (nhiều giờ) → giới hạn ở đâu?
```

Đừng bắt đầu từ bước 5. Bước 1–3 giải quyết phần lớn trường hợp.

## Triage checklist

### Trạm 1 — Browser

**Đo:** DevTools → Performance → record trong lúc tương tác.

```text
□ Long task (> 50ms, thanh vàng có gạch đỏ)?
    → JS chặn main thread. Tìm hàm rộng nhất trong flamegraph.
□ Layout (tím) / Paint (xanh) chiếm nhiều?
    → CSS/DOM. Nghi layout thrashing hoặc animate thuộc tính layout.
□ Số DOM node: document.querySelectorAll('*').length
    → > 5.000: cần virtualization
□ Bundle size: next build output, hoặc Coverage tab
    → First Load JS lớn: code splitting
□ Số lần render (React DevTools Profiler)
    → render nhiều + mỗi lần đắt: xem note React performance
```

Câu lệnh nhanh:

```js
// Trong console: đếm DOM node và listener
document.querySelectorAll('*').length;
getEventListeners(window);              // Chrome only
performance.getEntriesByType('longtask');
```

### Trạm 2 — Network

**Đo:** DevTools → Network, có throttling.

```text
□ TTFB của request HTML/API đầu tiên?
    → cao: đi xuống trạm 3
□ Waterfall dạng BẬC THANG?
    → request tuần tự không cần thiết
□ Số round-trip TUẦN TỰ (không phải tổng số request)?
    → × RTT thật = thời gian network tối thiểu
□ Payload: tổng byte vs dữ liệu UI thật dùng?
    → over-fetching
□ Có request nào bị chặn (queueing) lâu?
    → HTTP/1.1 giới hạn 6 kết nối/domain
```

```bash
# Chia TTFB thành từng chặng — loại trừ DNS/TCP/TLS
curl -o /dev/null -s -w \
 'dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' \
 https://api.example.com/dashboard
```

Nếu `ttfb - tls` lớn → server chậm. Nếu `tls` lớn → vấn đề kết nối, không phải application.

### Trạm 3 — API / application

**Đo:** `Server-Timing` header — công cụ rẻ nhất và hữu ích nhất ở trạm này.

```ts
const marks: string[] = [];
const t = (name: string, start: number) =>
  marks.push(`${name};dur=${(performance.now() - start).toFixed(0)}`);

const a = performance.now(); const user = await getUser(id);   t('user', a);
const b = performance.now(); const stats = await getStats(id); t('stats', b);
res.setHeader('Server-Timing', marks.join(', '));
```

DevTools → Network → request → **Timing** hiện breakdown này. Nó cho biết ngay nên đào ở đâu, không cần dựng APM.

```text
□ Thời gian tập trung ở một phần?
    → đào phần đó
□ await TUẦN TỰ cho việc độc lập?
    → Promise.all
□ Event loop lag (Node)?
    → có code đồng bộ chặn
□ Connection pool đầy?
    → request xếp hàng chờ connection
```

```ts
// Event loop lag — metric quan trọng nhất của Node
import { monitorEventLoopDelay } from 'node:perf_hooks';
const h = monitorEventLoopDelay({ resolution: 20 }); h.enable();
setInterval(() => console.log('lag p99', h.percentile(99) / 1e6, 'ms'), 5000);
```

Đọc kết hợp hai chỉ số:

| CPU | Event loop lag | Kết luận |
|---|---|---|
| cao | cao | CPU-bound thật — cần worker/queue hoặc thêm CPU |
| **thấp** | **cao** | **code đồng bộ chặn** (JSON lớn, regex, `*Sync`) |
| thấp | thấp | đang chờ I/O — nút thắt ở DB hoặc external |
| cao | thấp | nhiều request nhỏ, CPU là giới hạn thật |

Hàng thứ hai là chẩn đoán mà CPU usage một mình không cho được.

### Trạm 4 — External dependency

```text
□ Server-Timing tách riêng thời gian gọi external?
□ Có timeout không? Bao nhiêu?
□ Có circuit breaker không?
□ Gọi tuần tự hay song song?
□ Kết quả có cache được không?
```

Không có timeout ở đây là nguyên nhân phổ biến của "toàn hệ thống chậm vì một dependency". Xem [Timeout, retry, circuit breaker](../reliability/02-timeout-retry-circuit-breaker.md).

### Trạm 5 — Cache

```text
□ Hit rate? (nếu không đo được → đó là vấn đề đầu tiên)
□ Key có đúng granularity? (quá thô → miss nhiều; quá mịn → không hit)
□ TTL hợp lý?
□ Stampede khi key nóng hết hạn?
□ Cache per-instance hay dùng chung? (nhiều pod → không nhất quán)
```

```bash
# Redis: hit rate và các số cơ bản
redis-cli info stats | grep -E 'keyspace_(hits|misses)'
redis-cli info memory | grep -E 'used_memory_human|maxmemory_policy'
redis-cli --latency
```

Hit rate < 80% cho dữ liệu đọc nhiều thường nghĩa là key design sai, không phải cần thêm RAM.

### Trạm 6 — Database

Đây là nơi nút thắt nằm trong phần lớn ứng dụng nghiệp vụ.

```text
□ Số query mỗi request? (tăng theo số dòng → N+1)
□ Query chậm nhất là gì?
□ EXPLAIN ANALYZE: seq scan? sort trên disk? estimated ≠ actual?
□ Lock đang chờ?
□ Pool cạn?
□ Transaction dài / idle in transaction?
```

```sql
-- Query chậm nhất (cần extension pg_stat_statements)
SELECT calls, round(mean_exec_time::numeric, 1) AS avg_ms,
       round(total_exec_time::numeric) AS total_ms, left(query, 90) AS q
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;

-- Đang chạy gì, chờ gì
SELECT pid, state, wait_event_type, wait_event,
       now() - query_start AS dur, left(query, 80)
FROM pg_stat_activity
WHERE state <> 'idle' ORDER BY dur DESC;

-- Transaction mở lâu (giữ lock, chặn vacuum)
SELECT pid, state, now() - xact_start AS xact_dur, left(query, 80)
FROM pg_stat_activity
WHERE xact_start < now() - interval '5 seconds' ORDER BY xact_dur DESC;

-- Bảng bị seq scan nhiều
SELECT relname, seq_scan, idx_scan, n_live_tup
FROM pg_stat_user_tables
WHERE seq_scan > idx_scan AND n_live_tup > 10000
ORDER BY seq_scan DESC LIMIT 10;
```

`ORDER BY total_exec_time` (không phải `mean_exec_time`) là chi tiết quan trọng: một query 5ms chạy 100.000 lần tốn nhiều hơn một query 2 giây chạy 10 lần. Query cần sửa là cái tốn **tổng** thời gian nhiều nhất.

Bảng `wait_event` cho biết đang chờ gì: `Lock` → contention; `IO` → disk; `Client` → đang chờ application (thường là idle in transaction).

### Trạm 7 — Infrastructure

```text
□ CPU throttling? (cgroup limit — pod bị throttle dù CPU node còn rảnh)
□ Memory pressure / OOMKill?
□ Disk I/O saturation?
□ Network saturation?
□ Số replica đủ?
```

```bash
# CPU throttling trong container — thường bị bỏ qua
cat /sys/fs/cgroup/cpu.stat | grep throttled          # cgroup v2
kubectl top pod
kubectl describe pod <pod> | grep -A5 "Last State"     # OOMKilled?
```

CPU throttling là nguyên nhân bị bỏ qua nhiều nhất: pod có `limits.cpu: 500m` bị throttle ngay cả khi node còn rảnh, và biểu hiện là latency tăng đột ngột theo chu kỳ. Xem [Scheduling & resources](../../04-infrastructure/04-kubernetes/scheduling-reliability/02-scheduling-resources.md).

## Cây quyết định

```text
"Trang chậm"
    │
    ├─ TTFB > 500ms?
    │   │
    │   ├─ CÓ → backend/DB
    │   │   ├─ Server-Timing: phần nào lớn nhất?
    │   │   │   ├─ DB → đếm query → N+1? → EXPLAIN → index?
    │   │   │   ├─ External → timeout? cache? song song?
    │   │   │   └─ CPU trong app → event loop lag? profiler?
    │   │   └─ Không có Server-Timing → THÊM NÓ TRƯỚC
    │   │
    │   └─ KHÔNG → frontend
    │       ├─ Performance panel: JS (vàng) hay Layout/Paint (tím/xanh)?
    │       │   ├─ JS → long task → flamegraph → hàm nào?
    │       │   └─ Layout → DOM lớn? layout thrashing? animate sai thuộc tính?
    │       └─ Waterfall bậc thang → request tuần tự
    │
    └─ Chậm KHÔNG ĐỀU (p50 ổn, p99 tệ)?
        ├─ Queue/pool contention → pool size, concurrency
        ├─ GC pause → heap size
        ├─ Lock contention → pg_stat_activity wait_event
        ├─ Cache miss theo chu kỳ → stampede
        └─ CPU throttling → cgroup limit
```

Nhánh cuối (p50 ổn, p99 tệ) là nhóm nguyên nhân khác hoàn toàn — nó là vấn đề **hàng đợi**, không phải vấn đề tốc độ. Xem [Latency & throughput](01-latency-throughput-bottleneck.md).

## Prediction

1. TTFB 50ms, tổng 4 giây — đào ở đâu?
2. TTFB 3 giây, render nhanh — đào ở đâu?
3. CPU 20%, event loop lag p99 800ms — nguyên nhân?
4. CPU 95%, event loop lag 5ms — nguyên nhân?
5. p50 = 80ms, p99 = 6 giây — nghi gì?
6. Số query DB tăng tuyến tính theo số dòng trả về — bug gì?
7. `pg_stat_activity` có nhiều dòng `idle in transaction` — vấn đề ở đâu?
8. `pg_stat_statements`: query A mean 2000ms/10 calls, query B mean 5ms/200.000 calls — sửa cái nào trước?
9. CPU node 30% nhưng pod latency tăng theo chu kỳ — nghi gì?

<details>
<summary>Đáp án</summary>

1. Frontend — server đã trả nhanh.
2. Backend/DB.
3. Code đồng bộ chặn event loop (JSON lớn, regex, `*Sync`) — không phải thiếu CPU.
4. CPU-bound thật.
5. Vấn đề hàng đợi: pool contention, GC pause, lock, hoặc CPU throttling.
6. N+1.
7. **Application** — transaction mở mà không chạy SQL, thường vì gọi network trong transaction.
8. **B** — tổng 1000 giây so với 20 giây của A.
9. CPU throttling do cgroup limit.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Thêm `await sleep(2000)` ở backend | TTFB tăng; xác nhận cách đọc TTFB |
| Thêm `JSON.parse` chuỗi 50MB | CPU thấp, event loop lag cao |
| Thêm vòng lặp CPU 2 giây | CPU cao, lag cao |
| Tạo N+1 rồi đếm query | Số query tăng theo số dòng |
| Xoá một index, chạy `EXPLAIN ANALYZE` | Seq scan, `Rows Removed by Filter` lớn |
| Giảm pool size xuống 2, gửi 50 request | p99 nổ, p50 vẫn ổn |
| Mở transaction rồi `sleep` 10s | `idle in transaction` trong `pg_stat_activity` |
| Đặt `limits.cpu: 100m` cho pod cần nhiều hơn | `throttled_usec` tăng; latency theo chu kỳ |
| Render 10.000 DOM node | Layout time tăng; đếm bằng `querySelectorAll` |
| Thêm `Server-Timing` cho một endpoint chậm thật | Thường bất ngờ về nơi thời gian đi |

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| Chậm thì thêm index | Chỉ đúng nếu nút thắt ở DB và là thiếu index |
| CPU cao là cần thêm CPU | Có thể là một task đồng bộ dài; xem event loop lag |
| Tối ưu query chậm nhất trước | Sửa query tốn **tổng** thời gian nhiều nhất |
| p50 tốt nghĩa là hệ thống khoẻ | p99 tệ ảnh hưởng người dùng thật và thường là vấn đề khác loại |
| Cache giải quyết mọi chậm | Miss vẫn chậm; và cache sai gây bug |
| Thêm replica giải quyết latency | Replica giúp throughput, không giúp latency một request |
| CPU node rảnh nghĩa là không throttle | cgroup limit throttle ở mức pod |
| Profiler là bước đầu tiên | Bước 1–3 (Network, Server-Timing, đếm query) rẻ hơn nhiều |

## Debugging — thứ tự cố định

1. **TTFB** — chia bài toán làm hai. Một phép đo, loại trừ một nửa.
2. **Server-Timing** — nếu chưa có, thêm nó trước khi làm gì khác. Nó rẻ hơn mọi công cụ khác.
3. **Đếm query DB mỗi request** — phát hiện N+1, con số thường gây bất ngờ.
4. **`pg_stat_statements` sắp theo `total_exec_time`** — tìm query tốn nhiều nhất *tổng cộng*.
5. **`EXPLAIN ANALYZE`** cho query đó. Xem [EXPLAIN ANALYZE workflow](../../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md).
6. **Event loop lag + CPU** cùng lúc — hai chỉ số này cùng nhau cho chẩn đoán mà từng cái không cho được.
7. **Profiler** chỉ khi 1–6 chưa tìm ra.
8. **Sửa MỘT thứ, đo lại.** Sửa nhiều thứ cùng lúc thì không biết cái nào có tác dụng.

## Production Considerations

- **`Server-Timing` cho mọi endpoint** ở dev/staging — công cụ debug rẻ nhất tồn tại.
- **`pg_stat_statements` bật thường trực** ở production.
- **Event loop lag là metric hạng nhất** cho Node service.
- **Đo p50/p95/p99**, không đo trung bình. Trung bình che mất vấn đề hàng đợi.
- **Distributed tracing** khi có nhiều service — không có nó, triage qua 4 service là không khả thi. Xem [Correlation & tracing](../observability/03-correlation-tracing.md).
- **Đo trên field data (RUM)** — máy dev và CI không đại diện cho người dùng.
- **Ghi lại kết quả triage** (nguyên nhân, cách sửa, số liệu trước/sau) — lần sau sẽ nhanh hơn nhiều.
- **Baseline trước khi tối ưu**: không có số trước thì không chứng minh được có cải thiện.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Đo trước | sửa đúng nguyên nhân | mất thời gian trước khi "làm gì" |
| Đoán rồi sửa | cảm giác nhanh | thường sửa sai chỗ |
| `Server-Timing` ở production | debug nhanh | lộ thông tin nội bộ (chỉ bật cho staff) |
| APM/tracing đầy đủ | thấy toàn bộ | chi phí, overhead, cần triển khai |
| Load test | biết giới hạn trước | tốn thời gian, cần môi trường giống prod |
| Tối ưu sớm | — | thường tối ưu sai chỗ |

## Explain Without Notes

1. Phép đo nào chia bài toán làm hai, và vì sao nó là bước đầu tiên?
2. Bảng CPU × event loop lag — bốn tổ hợp nghĩa là gì?
3. Vì sao sắp `pg_stat_statements` theo `total_exec_time` chứ không `mean_exec_time`?
4. p50 ổn nhưng p99 tệ — nhóm nguyên nhân nào?
5. Thứ tự 6 bước đo, từ rẻ tới đắt?
6. Vì sao CPU node rảnh mà pod vẫn bị throttle?

## Related

- [Latency & throughput](01-latency-throughput-bottleneck.md) — lý thuyết: queueing, tail latency, Amdahl
- [Frontend performance](02-frontend-performance.md) — trạm 1
- [Backend performance](03-backend-performance.md) — trạm 3
- [Database performance](04-database-performance.md) — trạm 6
- [Profiling & load testing](05-profiling-load-testing.md) — bước 5–6
- [Slow API UX](../../01-web-frontend/04-application-engineering/03-slow-api-ux.md) — actual vs perceived
- [EXPLAIN ANALYZE workflow](../../03-database/01-postgresql/indexes-query-planning/03-explain-analyze-workflow.md)
- [Correlation & tracing](../observability/03-correlation-tracing.md)
- [Scheduling & resources](../../04-infrastructure/04-kubernetes/scheduling-reliability/02-scheduling-resources.md) — CPU throttling
