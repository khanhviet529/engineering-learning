---
level: intermediate
area: frontend
prerequisites:
  - ../fundamentals/01-execution-context-closure.md
related:
  - ../../../02-backend-api/01-nodejs/production/01-process-memory.md
  - ../../../04-infrastructure/00-linux/02-memory-cpu-limits.md
---

# Memory & garbage collection

> Process RSS tăng đều, restart thì hết. Đó là leak — và trong JavaScript, leak không phải "quên free", mà là "vô tình vẫn còn giữ".

## Position

```text
Code JS → V8 heap [new space | old space] → GC → RSS của process → cgroup limit → OOMKilled
                         ↑ note này
```

## Problem

GC tự động, nên "không thể leak" — đó là niềm tin sai phổ biến. Thực tế:

- Một Node service chạy 3 ngày rồi bị `OOMKilled`, restart lại bình thường.
- Một SPA dùng 1,5GB RAM sau 2 giờ điều hướng qua lại.
- Heap tăng đều nhưng không có chỗ nào gọi `malloc`.

Nguyên nhân: **GC chỉ xoá cái không còn *reachable*.** Nếu bạn còn giữ một tham chiếu — kể cả không cố ý, kể cả không dùng nữa — object đó là "còn dùng" theo định nghĩa của GC.

Leak trong JS = **vô tình còn reachable**.

## Mental Model

```text
GC roots: global object, call stack hiện tại, closure đang sống
    │
    ├─→ object A ─→ object B      REACHABLE  → giữ lại
    │
    └── object C  (không ai trỏ tới)  UNREACHABLE → thu hồi
```

GC không đếm "bạn còn dùng không". Nó đi từ root theo mọi tham chiếu và giữ lại tất cả những gì đi tới được.

Câu hỏi debug leak vì vậy **không** là "cái gì đang bị leak" mà là:

> **Ai đang giữ tham chiếu tới nó?**

DevTools trả lời chính xác câu này bằng *retainer path*.

### Generational GC

```text
New space (nhỏ, vài MB)     → phần lớn object chết ở đây, scavenge rất nhanh và thường xuyên
       ↓ sống qua 2 lần GC
Old space (lớn)             → mark-sweep-compact, chậm hơn, ít hơn
```

Giả định nền: **phần lớn object chết non**. Đó là lý do tạo nhiều object tạm thời trong một hàm không đáng lo, còn giữ object lâu dài trong một Map global thì đáng lo.

## How It Works

### Năm nguồn leak thực tế

**1. Cấu trúc global tăng mãi** — nguyên nhân số một ở server:

```ts
const cache = new Map<string, Data>();          // ❌ không bao giờ xoá
export function get(id: string) {
  if (!cache.has(id)) cache.set(id, load(id));
  return cache.get(id)!;
}
```

Đây không phải cache, đây là một memory leak có tên đẹp. Cache phải có **giới hạn** (LRU) và/hoặc **TTL**.

**2. Listener / timer không dọn:**

```ts
// ❌ mỗi lần mount thêm một listener; listener giữ closure giữ component
useEffect(() => {
  window.addEventListener('resize', onResize);
}, []);

// ✅
useEffect(() => {
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}, [onResize]);
```

**3. Closure giữ nhiều hơn cần thiết:**

```ts
function make(bigData: Huge) {          // 50MB
  const id = bigData.id;
  return () => id;                     // ✅ chỉ giữ id
  // return () => bigData.id;          // ❌ giữ cả 50MB
}
```

Closure giữ **toàn bộ scope**, không chỉ biến được dùng. Trích xuất giá trị cần thiết ra biến riêng.

**4. Detached DOM** — DOM node đã bị xoá khỏi cây nhưng JS còn giữ:

```ts
const el = document.getElementById('big-table')!;
elements.push(el);                     // giữ trong array
el.remove();                           // xoá khỏi DOM nhưng KHÔNG khỏi memory
```

**5. Request/context không kết thúc** — ở server, mỗi request tạo context; nếu context bị đưa vào một cấu trúc sống lâu (log buffer, subscriber list) thì mỗi request thêm một chút.

### WeakMap / WeakRef

```ts
const meta = new WeakMap<object, Meta>();   // key không bị giữ lại bởi map
meta.set(node, { seen: true });
// node bị xoá ở nơi khác → entry tự biến mất
```

`WeakMap`/`WeakSet` là công cụ đúng khi bạn cần gắn dữ liệu vào một object mà **không** muốn kéo dài tuổi thọ của nó. Không iterate được — đó là cái giá.

## Example

```ts
// Cache có giới hạn — đủ cho phần lớn nhu cầu, không leak
class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(private max: number) {}

  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); }  // đưa lên mới nhất
    return v;
  }

  set(k: K, v: V) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value!);   // xoá cái cũ nhất
    }
  }
}
```

`Map` giữ thứ tự insert — đó là điều làm LRU trở nên đơn giản như trên.

## Prediction

1. `const cache = new Map()` không giới hạn, thêm 1 entry mỗi request, mỗi entry 10KB. Sau 100.000 request, heap tăng bao nhiêu?
2. Component thêm `addEventListener` mà không remove, người dùng navigate qua lại 50 lần. Có bao nhiêu listener? RAM thế nào?
3. `WeakMap` với key là DOM node đã bị remove — entry còn không?
4. `return () => bigData.id` vs `const id = bigData.id; return () => id` — object 50MB được GC trong trường hợp nào?
5. Node với `--max-old-space-size=512` trong container có limit 256MB — cái gì xảy ra trước: `heap out of memory` hay `OOMKilled`?

Câu 5 quan trọng cho production: nếu heap limit của Node **lớn hơn** memory limit của container, bạn sẽ bị `OOMKilled` (SIGKILL, không có log, không có stack) thay vì nhận lỗi JS có thể log được.

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Map global tăng mãi, chạy load test | RSS tăng tuyến tính, không bao giờ giảm |
| Thêm listener trong effect, không remove, navigate 100 lần | `getEventListeners(window)` trong console đếm được |
| Giữ mảng 100k DOM node đã remove | DevTools Memory → filter "Detached" |
| Đặt heap limit > container limit | `OOMKilled` (exit 137), không có stack trace |
| Đặt heap limit < container limit | `JS heap out of memory` — có stack trace, debug được |
| Chạy `global.gc()` với `--expose-gc` sau khi xoá tham chiếu | Xác nhận memory *có* được thu hồi khi thả đúng |
| Tạo 10M object nhỏ trong loop | Quan sát GC pause trong `--trace-gc` |

Thí nghiệm 4 và 5 cạnh nhau là bài học vận hành quan trọng nhất của note này.

## What Usually Goes Wrong

- **"Cache" không giới hạn** — leak phổ biến nhất ở backend.
- **Listener/timer/subscription không cleanup** — phổ biến nhất ở frontend.
- **Closure giữ object lớn** vì tiện.
- **Log buffer / array metrics tăng mãi** trong process.
- **Heap limit không khớp container limit** → `OOMKilled` im lặng, không có gì để debug.
- **Giữ response body lớn** trong biến để "dùng lại sau".
- **Stream không đóng** — giữ buffer. Xem [Streams & buffers](../../../02-backend-api/01-nodejs/runtime-io/01-streams-buffers.md).

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| GC tự động nên không thể leak | Leak = vẫn còn reachable. GC không đọc được ý định của bạn |
| Đặt `= null` là giải phóng | Chỉ khi đó là tham chiếu **cuối cùng** |
| Memory tăng = leak | Có thể chỉ là GC chưa chạy. Phải so sánh nhiều snapshot sau GC |
| `delete obj.key` giải phóng ngay | Bỏ tham chiếu; thu hồi khi GC chạy |
| RSS = heap của JS | RSS gồm cả heap, stack, buffer ngoài heap, code, native |
| RSS giảm là dấu hiệu tốt duy nhất | Nhiều allocator không trả RAM về OS ngay; xem heap used thay vì RSS |
| `WeakMap` là "Map nhanh hơn" | Nó là Map **không giữ key**; mục đích khác hoàn toàn |

## Debugging

Quy trình chuẩn cho một leak, dùng được cả browser và Node:

1. **Xác nhận đó là leak, không phải dao động.** Chạy tải ổn định, log `process.memoryUsage().heapUsed` mỗi 30 giây. Leak = đường tăng đều **sau khi** GC đã chạy nhiều lần.
2. **Chụp 3 heap snapshot**: sau warmup, sau tải, sau tải nữa. (DevTools → Memory → Heap snapshot; Node: `node --inspect` rồi dùng DevTools, hoặc `v8.writeHeapSnapshot()`.)
3. **So sánh snapshot 2 và 3** bằng chế độ *Comparison*. Sắp xếp theo **Delta**. Constructor nào tăng đều là ứng viên.
4. **Chọn một object, xem Retainers.** Đây là bước quyết định — nó chỉ đúng đường tham chiếu đang giữ object. Đọc từ dưới lên để thấy root.
5. **Kiểm tra "Detached" nodes** cho frontend.
6. Với Node, `--trace-gc` cho biết GC có đang chạy liên tục mà không thu được gì (dấu hiệu heap gần đầy).

Nguyên tắc: **không đoán.** Retainer path là bằng chứng; mọi thứ khác là giả thuyết.

## Production Considerations

- **Đặt `--max-old-space-size` thấp hơn memory limit của container** (khoảng 75–80%). Lý do: nhận lỗi JS có log tốt hơn nhận SIGKILL không có gì. Xem [Memory, CPU & limits](../../../04-infrastructure/00-linux/02-memory-cpu-limits.md).
- **Monitor `heapUsed` và RSS** như metric hạng nhất, và alert trên *độ dốc*, không chỉ giá trị tuyệt đối.
- **Mọi cache phải có max size hoặc TTL.** Không có ngoại lệ.
- **Restart định kỳ là băng cứu thương, không phải cách sửa** — nhưng nó là băng hợp lệ trong lúc bạn tìm nguyên nhân.
- GC pause ảnh hưởng p99 latency; heap rất lớn → pause dài hơn.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Cache in-process | nhanh nhất, không network | tốn RAM, mỗi instance một bản (không nhất quán) |
| Cache ngoài (Redis) | chia sẻ, không tốn heap | thêm network hop, thêm dependency |
| Heap lớn | ít GC | pause dài hơn, nguy cơ OOM |
| Heap nhỏ | GC thường xuyên, pause ngắn | có thể GC quá nhiều, tốn CPU |
| `WeakMap` | không giữ object | không iterate, không có size |

## Explain Without Notes

1. Vì sao "GC tự động" không loại trừ leak? Định nghĩa leak trong JS.
2. Kể 5 nguồn leak phổ biến và cách phòng mỗi cái.
3. Câu hỏi đúng khi debug leak là gì, và DevTools trả lời nó ở đâu?
4. Vì sao heap limit của Node nên nhỏ hơn memory limit của container?
5. `WeakMap` giải quyết vấn đề gì mà `Map` không?

## Related

- [Execution context & closure](../fundamentals/01-execution-context-closure.md) — closure là nguồn leak
- [Process & memory (Node)](../../../02-backend-api/01-nodejs/production/01-process-memory.md) — góc nhìn server
- [Memory, CPU & limits](../../../04-infrastructure/00-linux/02-memory-cpu-limits.md) — cgroup và OOMKilled
- [Eviction & memory (Redis)](../../../03-database/02-redis/04-eviction-memory.md) — cùng bài toán, khác tầng
- [Effects & lifecycle](../../02-react/behavior/02-effects-lifecycle.md) — cleanup trong React
