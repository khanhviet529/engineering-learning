---
level: intermediate
area: backend
prerequisites:
  - ../fundamentals/01-runtime-concurrency.md
related:
  - ../../../01-web-frontend/01-javascript-typescript/runtime-behavior/01-memory-gc.md
  - ../../../04-infrastructure/00-linux/02-memory-cpu-limits.md
---

# Process & memory

> Container bị `OOMKilled` (exit 137) không có log, không có stack trace, không có gì để debug. Nếu heap limit của Node nhỏ hơn memory limit của container, cùng vấn đề đó cho bạn một lỗi JavaScript có stack trace đầy đủ.

## Position

```text
Code JS → V8 heap → RSS của process → cgroup memory limit → OOMKilled (SIGKILL)
              ↑ bạn kiểm soát bằng --max-old-space-size
                          ↑ và bằng resources.limits.memory
```

## Problem

Hai kịch bản, cùng một nguyên nhân, hai trải nghiệm debug hoàn toàn khác nhau:

```text
Kịch bản A: heap limit (mặc định ~4GB trên 64-bit) > container limit (512MB)
  → RSS đạt 512MB → kernel gửi SIGKILL
  → exit code 137, không log, không stack, không có gì
  → "Pod tự restart, không biết vì sao"

Kịch bản B: heap limit 384MB < container limit 512MB
  → V8 đạt 384MB → throw "JavaScript heap out of memory"
  → có stack trace, có heap snapshot nếu bật
  → "Leak ở hàm X, dòng Y"
```

Cùng một bug, nhưng kịch bản B debug được trong 10 phút và kịch bản A có thể mất nhiều ngày.

Quy tắc:

> **Luôn đặt `--max-old-space-size` khoảng 75–80% memory limit của container.**

Đây là một dòng config đổi lại rất nhiều thời gian debug.

## Mental Model

```text
RSS (Resident Set Size) = tổng RAM thật process đang chiếm
  = V8 heap (object JS)
  + external (Buffer, ArrayBuffer — NGOÀI heap)
  + code + stack
  + native memory của addon

heapTotal = V8 đã cấp phát
heapUsed  = V8 đang dùng thật
external  = Buffer và bộ nhớ do C++ quản
arrayBuffers = phần của external là ArrayBuffer
```

Hai điều quan trọng suy ra từ mô hình này:

1. **`--max-old-space-size` chỉ giới hạn heap**, không giới hạn `external`. Một app dùng nhiều `Buffer` (upload, image processing) có thể bị OOMKilled dù heap còn thấp.
2. **`heapUsed` là chỉ số để theo dõi leak**, không phải RSS. RSS bị ảnh hưởng bởi cách allocator trả memory về OS — nó có thể phẳng trong khi heap tăng, hoặc ngược lại.

## How It Works

### Đo đúng

```ts
setInterval(() => {
  const m = process.memoryUsage();
  metrics.gauge('mem_rss_mb', m.rss / 1048576);
  metrics.gauge('mem_heap_used_mb', m.heapUsed / 1048576);
  metrics.gauge('mem_heap_total_mb', m.heapTotal / 1048576);
  metrics.gauge('mem_external_mb', m.external / 1048576);
}, 15_000);
```

Bốn chỉ số, bốn ý nghĩa:

| Chỉ số | Tăng đều = |
|---|---|
| `heapUsed` | leak object JS (Map global, closure, listener) |
| `external` | leak Buffer/stream không đóng |
| `heapTotal` >> `heapUsed` | phân mảnh, hoặc vừa có burst |
| `rss` mà heap phẳng | native memory, hoặc allocator giữ lại |

### Cấu hình giới hạn

```dockerfile
# Container limit 512Mi → heap 384MB (75%)
ENV NODE_OPTIONS="--max-old-space-size=384"
```

```yaml
# Kubernetes
resources:
  requests:
    memory: "256Mi"        # dùng để scheduling
  limits:
    memory: "512Mi"        # vượt = OOMKilled
```

Chú ý về `requests` vs `limits`: `requests` là cái scheduler dùng để chọn node; `limits` là mức bị kill. Đặt `requests` quá thấp so với mức dùng thật làm node bị overcommit và pod bị kill khi node thiếu memory — kể cả khi pod của bạn chưa vượt limit của nó.

### Heap snapshot trong production

```ts
import { writeHeapSnapshot } from 'node:v8';

// Kích hoạt bằng signal — không cần restart, không cần mở port debug
process.on('SIGUSR2', () => {
  const file = writeHeapSnapshot(`/tmp/heap-${Date.now()}.heapsnapshot`);
  logger.warn({ file }, 'heap snapshot written');
});
```

```bash
kubectl exec <pod> -- kill -SIGUSR2 1
kubectl cp <pod>:/tmp/heap-xxx.heapsnapshot ./
# Mở trong Chrome DevTools → Memory → Load
```

Lưu ý: `writeHeapSnapshot` **chặn event loop** trong vài giây và tạo file lớn bằng heap. Dùng nó khi đã có kế hoạch, không dùng bừa trên production đang phục vụ traffic.

Quy trình tìm leak: chụp 2–3 snapshot cách nhau, so sánh ở chế độ *Comparison*, sort theo Delta, rồi xem **Retainers** của constructor tăng nhiều nhất. Chi tiết: [Memory & GC](../../../01-web-frontend/01-javascript-typescript/runtime-behavior/01-memory-gc.md).

### Nguồn leak ở server

```ts
// 1. Map/Set global không giới hạn — phổ biến nhất
const sessions = new Map();                    // ❌ tăng theo số user
const cache = new LruCache({ max: 10_000 });   // ✅ có trần

// 2. Listener trên object sống lâu
emitter.on('event', handler);                  // ❌ không remove
// ✅ emitter.off('event', handler) khi xong

// 3. Timer không clear
setInterval(poll, 1000);                       // ❌ giữ closure mãi
const id = setInterval(poll, 1000);
// ✅ clearInterval(id) khi shutdown

// 4. Request context bị giữ lại
const auditLog: RequestContext[] = [];         // ❌ mỗi request thêm một entry
auditLog.push(ctx);

// 5. Stream không đóng → external memory tăng
// ✅ dùng pipeline() — xem note 02
```

Ba nguồn đầu chiếm phần lớn leak thật trong code server.

### Signal và exit code

| Exit code | Nghĩa |
|---|---|
| 0 | thoát bình thường |
| 1 | uncaught exception |
| 137 | **128 + 9 = SIGKILL** → OOMKilled hoặc bị kill cưỡng chế |
| 143 | 128 + 15 = SIGTERM → shutdown bình thường (K8s gửi khi rolling update) |
| 130 | 128 + 2 = SIGINT (Ctrl+C) |

Nhìn thấy 137 là gần như chắc chắn OOM (hoặc `terminationGracePeriodSeconds` hết trước khi process thoát). Xem [Signals & lifecycle](../../../04-infrastructure/00-linux/04-signals-lifecycle.md).

### Bắt lỗi cuối cùng

```ts
process.on('uncaughtException', (err, origin) => {
  logger.fatal({ err, origin }, 'uncaught exception');
  // Process đã ở trạng thái KHÔNG XÁC ĐỊNH — không cố tiếp tục
  gracefulShutdown().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection');
  gracefulShutdown().finally(() => process.exit(1));
});
```

Điểm quan trọng: **không cố tiếp tục chạy sau `uncaughtException`.** Một exception không được bắt nghĩa là một phần code đã dừng giữa đường — có thể để lại transaction mở, lock chưa nhả, hoặc state không nhất quán. Log rồi thoát để process manager restart một process sạch.

Đây là điểm khác biệt với triết lý "phải luôn giữ server chạy": một process ở trạng thái không xác định có thể làm hỏng dữ liệu, và điều đó tệ hơn một lần restart.

## Example

```ts
// Cache có trần và có TTL — mẫu đúng cho mọi cache in-process
class TtlCache<K, V> {
  private m = new Map<K, { v: V; exp: number }>();
  constructor(private max: number, private ttlMs: number) {}

  get(k: K): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.m.delete(k); return undefined; }
    this.m.delete(k); this.m.set(k, e);        // LRU: đưa lên mới nhất
    return e.v;
  }

  set(k: K, v: V) {
    if (this.m.has(k)) this.m.delete(k);
    this.m.set(k, { v, exp: Date.now() + this.ttlMs });
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
  }
}
```

Hai điều bắt buộc cho cache in-process: **trần** (`max`) và **TTL**. Thiếu một trong hai là leak.

## Prediction

1. Heap limit mặc định (4GB), container limit 512Mi, có leak — exit code gì? Có stack trace?
2. Heap limit 384MB, container 512Mi, cùng leak — lỗi gì?
3. App dùng nhiều `Buffer` (upload), heap limit 384MB — `--max-old-space-size` có ngăn OOMKilled?
4. `heapUsed` phẳng nhưng `rss` tăng đều — nghi gì?
5. `Map` global thêm 1 entry 10KB mỗi request, 100.000 request — heap tăng bao nhiêu?
6. Tiếp tục chạy sau `uncaughtException` — rủi ro gì?
7. Exit code 143 sau `kubectl delete pod` — bình thường hay lỗi?
8. `requests.memory` = 64Mi nhưng app dùng 400Mi thật — rủi ro gì?

<details>
<summary>Đáp án</summary>

1. 137, không có gì để debug.
2. `JavaScript heap out of memory` với stack trace.
3. Không — `external` không nằm trong heap limit.
4. Native memory (addon), hoặc allocator giữ lại, hoặc `external`.
5. ~1GB.
6. Transaction mở, lock chưa nhả, state không nhất quán → có thể làm hỏng dữ liệu.
7. Bình thường — SIGTERM là shutdown có kiểm soát.
8. Node bị overcommit; pod có thể bị evict khi node thiếu memory dù chưa vượt limit của nó.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| `Map` global tăng mãi, chạy load test | `heapUsed` tăng tuyến tính |
| Heap limit > container limit | Exit 137, không log |
| Heap limit < container limit | Lỗi JS có stack trace |
| Tạo nhiều `Buffer` lớn, xem `external` | Tăng riêng, không tính vào heap |
| `setInterval` không clear, restart module nhiều lần (dev) | Số timer tăng |
| Listener không remove trên emitter global | `emitter.listenerCount()` tăng |
| `writeHeapSnapshot` trên process đang phục vụ | Event loop lag vài giây |
| Tiếp tục sau `uncaughtException`, gây lỗi giữa transaction | Kiểm tra DB: transaction mở, lock giữ |
| `requests` thấp hơn mức dùng thật, node bị overcommit | Pod bị evict |

## What Usually Goes Wrong

- **Heap limit không khớp container limit** → mất khả năng debug.
- **Cache/Map global không có trần và TTL** → leak phổ biến nhất ở backend.
- **Listener/timer không dọn**.
- **Không đo `heapUsed`** → chỉ biết có vấn đề khi bị kill.
- **Theo dõi RSS thay vì heap** → tín hiệu nhiễu.
- **Tiếp tục chạy sau `uncaughtException`** → rủi ro dữ liệu.
- **Bỏ qua `external`** khi app dùng nhiều Buffer.
- **`requests` đặt quá thấp** → pod bị evict bất ngờ.
- **Không có `unhandledRejection` handler** → lỗi mất, hoặc crash không rõ nguyên nhân.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| `--max-old-space-size` giới hạn toàn bộ memory | Chỉ giới hạn heap; `external` không tính |
| RSS = heap | RSS gồm heap + external + code + stack + native |
| RSS giảm là dấu hiệu tốt duy nhất | Allocator có thể giữ memory; theo `heapUsed` |
| GC tự động nên không leak | Leak = vẫn còn reachable |
| Nên giữ server chạy sau uncaught exception | Process ở trạng thái không xác định; restart an toàn hơn |
| Exit 137 là bug của app | Là kernel kill vì vượt memory limit |
| Memory tăng = leak | Có thể chỉ là GC chưa chạy; xem xu hướng dài hạn |

## Debugging

1. **Xác nhận leak, không phải dao động**: log `heapUsed` mỗi 30 giây dưới tải ổn định trong 30+ phút. Leak = đường tăng đều sau nhiều lần GC.
2. **Xác định loại**: `heapUsed` tăng → object JS. `external` tăng → Buffer/stream. `rss` tăng mà hai cái kia phẳng → native.
3. **Heap snapshot × 2–3**, so sánh Comparison, sort Delta, xem **Retainers**. Retainer path là bằng chứng; mọi thứ khác là giả thuyết.
4. **Exit 137** → `kubectl describe pod` xác nhận `OOMKilled`; sau đó hạ heap limit để lần sau có stack trace.
5. **`--trace-gc`** cho biết GC có đang chạy liên tục mà không thu được gì (heap gần đầy).
6. **Đếm listener và timer**: `emitter.listenerCount(event)`, và `process._getActiveHandles()` (không chính thức nhưng hữu ích trong dev).

## Production Considerations

- **`--max-old-space-size` = 75–80% container limit.** Đây là thay đổi có ROI cao nhất trong note này.
- **Alert trên độ dốc của `heapUsed`**, không chỉ giá trị tuyệt đối — leak chậm không vượt ngưỡng nhưng vẫn giết pod sau vài ngày.
- **Mọi cache in-process có trần và TTL.**
- **`requests.memory` gần mức dùng thật**; `limits` cao hơn khoảng 1,5–2×.
- **`uncaughtException`/`unhandledRejection`: log rồi thoát** có kiểm soát.
- **Restart định kỳ là băng cứu thương hợp lệ** trong lúc tìm nguyên nhân — nhưng phải có ticket đi kèm.
- **Đo external memory** nếu app xử lý file/ảnh.
- Với nhiều pod nhỏ thay vì một pod lớn: GC pause ngắn hơn, blast radius nhỏ hơn.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Heap limit thấp | lỗi JS debug được, GC pause ngắn | có thể OOM sớm hơn cần thiết |
| Heap limit cao | ít GC | pause dài, nguy cơ OOMKilled im lặng |
| Cache in-process | nhanh nhất, không network | tốn heap, mỗi instance một bản |
| Cache ngoài (Redis) | chia sẻ, không tốn heap | thêm hop, thêm dependency |
| Nhiều pod nhỏ | pause ngắn, blast radius nhỏ | overhead container, nhiều connection tới DB |
| Restart định kỳ | tránh outage | che nguyên nhân gốc |

## Explain Without Notes

1. Vì sao heap limit nên nhỏ hơn container limit? Hai kịch bản debug khác nhau thế nào?
2. RSS gồm những gì? `--max-old-space-size` **không** giới hạn cái gì?
3. Chỉ số nào theo dõi leak, và vì sao không dùng RSS?
4. Vì sao không nên tiếp tục chạy sau `uncaughtException`?
5. Exit code 137 và 143 nghĩa là gì?

## Related

- [Memory & GC](../../../01-web-frontend/01-javascript-typescript/runtime-behavior/01-memory-gc.md) — cơ chế GC và quy trình tìm leak
- [Node runtime & concurrency](../fundamentals/01-runtime-concurrency.md) — event loop lag
- [Streams & buffers](../runtime-io/01-streams-buffers.md) — external memory
- [Graceful shutdown](02-graceful-shutdown.md) — thoát đúng cách
- [Memory, CPU & limits](../../../04-infrastructure/00-linux/02-memory-cpu-limits.md) — cgroup, OOMKilled
- [Signals & lifecycle](../../../04-infrastructure/00-linux/04-signals-lifecycle.md) — exit code
- [Scheduling & resources](../../../04-infrastructure/04-kubernetes/scheduling-reliability/02-scheduling-resources.md) — requests vs limits
