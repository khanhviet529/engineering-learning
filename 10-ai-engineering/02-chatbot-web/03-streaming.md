---
level: intermediate
area: ai-engineering
prerequisites:
  - 01-chatbot-architecture.md
  - ../../01-web-frontend/00-web-foundations/08-websocket-sse.md
related:
  - 04-chat-ux-and-state.md
  - ../07-production/04-latency-engineering.md
---

# Streaming: token tới dần

> Team chuyển chatbot sang WebSocket vì "streaming cần WebSocket". Ba tuần sau: cần sticky session ở load balancer, cần Redis pub/sub để hai instance thấy nhau, kết nối chết sau ~100 giây qua CDN nếu không có heartbeat, và reconnect làm mất đúng đoạn giữa. Câu trả lời vẫn đi **một chiều** từ server xuống client — đúng thứ mà SSE làm được với không dòng hạ tầng nào thêm.

## Position

```text
Provider ──chunk──▶ Backend ──ChatEvent──▶ Browser ──▶ render dần
                       ▲            ▲
              tích luỹ + lưu    note này: chọn transport,
                                 và xử lý vòng đời stream
```

## Problem

Streaming giải quyết **một** vấn đề, và nó là vấn đề về cảm nhận:

```text
Không stream:  [───────── 4.2s im lặng ─────────] toàn bộ câu trả lời
               → cảm giác: treo

Có stream:     [─0.6s─] chữ...chữ...chữ... (4.2s)
               → cảm giác: nhanh

Cùng total latency. Khác hoàn toàn về trải nghiệm.
```

Con số quyết định là **TTFT**, không phải total. Xem [04-latency-engineering.md](../07-production/04-latency-engineering.md).

Nhưng streaming mua sự cải thiện đó bằng bốn vấn đề mới:

```text
① Không biết thành công cho tới khi stream KẾT THÚC
② Ngắt giữa dòng trông giống trả lời ngắn
③ Huỷ phải đi hết đường: browser → backend → provider
④ finishReason và usage chỉ có Ở CUỐI
```

## Mental Model

### Chọn transport: ba lựa chọn, một câu hỏi

Câu hỏi duy nhất cần trả lời: **dữ liệu đi một chiều hay hai chiều, liên tục?**

| | SSE / fetch stream | WebSocket |
|---|---|---|
| Hướng | server → client | hai chiều |
| Giao thức | HTTP thường | upgrade sau `101` |
| Qua proxy/CDN/LB | như HTTP bình thường | cần cấu hình; hay bị cắt sau ~60–100s |
| Sticky session | không cần | thường cần |
| Nhiều instance | không cần gì | cần pub/sub để fan-out |
| Reconnect | trivial (request mới) | phải tự quản state |
| Gửi tin nhắn lên | request HTTP riêng | qua cùng kết nối |

```text
Chatbot text tiêu chuẩn:            → SSE trên POST + fetch stream.  ĐỦ.
Cần server đẩy KHI KHÔNG CÓ REQUEST:  (thông báo, presence, nhiều người
   cùng một phòng)                     → WebSocket có lý do.
Audio/video hai chiều realtime:      → WebSocket / WebRTC.
```

Với chatbot: mỗi tin nhắn là **một request có một response dài**. Đó chính xác là hình dạng mà HTTP streaming phục vụ.

### `EventSource` vs `fetch` + reader

Cả hai đọc `text/event-stream`. Khác nhau ở chỗ quan trọng:

```text
EventSource                        fetch + ReadableStream
· chỉ GET                          · POST được → gửi body dài
· không đặt được header tuỳ ý       · đặt được header
· tự reconnect (đôi khi KHÔNG muốn) · bạn kiểm soát
· không abort tinh tế               · AbortController hoạt động đúng
```

Chatbot cần POST (tin nhắn có thể dài) → **`fetch` + reader**. Và cần abort → cũng `fetch`.

Cảnh báo về tự reconnect của `EventSource`: với chatbot, reconnect tự động nghĩa là **model sinh lại từ đầu và bạn bị tính tiền lần nữa**. Đó không phải hành vi bạn muốn tự động.

### Vòng đời một stream

```text
① OPEN        request đi, header đã gửi, chưa có chunk
        ↓
② FIRST TOKEN ← TTFT đo ở đây; UI đổi từ "đang nghĩ" sang "đang viết"
        ↓
③ CHUNKS      text-delta liên tiếp; có thể xen tool-start / tool-result
        ↓
④ FINISH      event 'done' mang finishReason + usage
        ↓
⑤ PERSIST     lưu message hoàn chỉnh + usage
        ↓
⑥ RECONCILE   FE thay placeholder bằng message thật (có id từ server)
```

Ba nhánh rời khỏi luồng chính, và **cả ba phải được xử lý tường minh**:

```text
③ → HUỶ         người dùng bấm Stop / đóng tab
③ → IDLE        không có chunk trong N giây
③ → LỖI         provider trả error giữa stream
```

Điểm quan trọng nhất của cả note:

> **Không có event `done` nghĩa là stream *chưa* thành công.** Một stream ngắt ở token 300 trông giống một câu trả lời ngắn hoàn chỉnh. Phân biệt chúng bằng sự **có mặt** của `done`, không bằng độ dài text.

Đây là lý do `ChatEvent` có `{ type: 'done', finishReason, usage }` như một event riêng — nó là **tín hiệu hoàn tất tường minh**.

### Format trên dây: SSE

```text
data: {"type":"text-delta","text":"Đơn hàng"}

data: {"type":"text-delta","text":" của bạn"}

data: {"type":"tool-start","toolCallId":"t1","tool":"getOrder"}

data: {"type":"done","finishReason":"completed","usage":{"inputTokens":1204,"outputTokens":318}}

```

Bốn quy tắc SSE hay bị vi phạm:

```text
① Mỗi event kết thúc bằng DÒNG TRỐNG. Thiếu nó = client không nhận được.
② Payload không được chứa newline thô → JSON một dòng (JSON.stringify là đủ).
③ Header: Content-Type: text/event-stream · Cache-Control: no-cache ·
          X-Accel-Buffering: no  ← với Nginx, thiếu dòng này là stream bị BUFFER
④ Nén (gzip/br) cũng buffer → tắt cho endpoint này.
```

Quy tắc ③ là nguyên nhân của một sự cố kinh điển: **stream hoạt động ở local, "không stream" ở production.** Nginx buffer toàn bộ response rồi gửi một lần. Không có lỗi nào, chỉ là streaming biến mất. Xem [05-reverse-proxy-load-balancer.md](../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md).

### Huỷ: đường dây ba khâu

```text
Browser              Backend                Provider
   │                    │                       │
   │ abort()            │                       │
   ├── kết nối đóng ───▶│                       │
   │                    │ phát hiện aborted     │
   │                    ├── abort request ─────▶│
   │                    │                       │ NGỪNG sinh token
   │                    │ lưu partial ✓         │
```

Đứt ở khâu nào cũng có hậu quả riêng:

| Đứt ở | Hậu quả |
|---|---|
| Browser không abort | request vẫn chạy; tab mới có thể chồng stream |
| Backend không phát hiện | vẫn stream vào hư không; giữ tài nguyên |
| Backend không abort provider | **vẫn bị tính tiền** cho phần còn lại |
| Không lưu partial | mất text đã trả tiền; hội thoại có lượt trống |

```ts
// Backend: phát hiện client ngắt (Express/Nest)
const ac = new AbortController();
res.on('close', () => ac.abort());            // client đóng kết nối

for await (const ev of provider.stream({ ...req, signal: ac.signal })) {
  acc += ev.type === 'text-delta' ? ev.text : '';
  res.write(`data: ${JSON.stringify(ev)}\n\n`);
}
```

```ts
// Frontend: Stop + cleanup
const ac = new AbortController();
const res = await fetch(url, { method: 'POST', body, signal: ac.signal });
// nút Stop:  ac.abort()
// unmount:   useEffect(() => () => ac.abort(), [])
```

### "Resume" một stream: gần như không làm được

Câu hỏi hay gặp: người dùng mất mạng ở giữa, nối lại — có tiếp tục được không?

```text
Về mặt kỹ thuật, gần như KHÔNG:
· generation là một request tới provider; kết nối đó đã đứt
· model không có "con trỏ" để tiếp tục từ token thứ 300
· sinh lại từ đầu = tốn tiền lần nữa, và output CÓ THỂ KHÁC (stochastic)
```

Cái làm được, và là cách đúng:

```text
✅ Lưu partial ở server (đã tích luỹ) → hiện lại cho người dùng
✅ Đánh dấu isPartial = true → UI hiện "câu trả lời bị ngắt" + nút Tiếp tục
✅ "Tiếp tục" = một lượt MỚI, có partial trong context
```

Nếu bạn muốn người dùng nối lại được **stream đang chạy** (đóng laptop, mở điện thoại), đó là bài toán khác hẳn: cần chạy generation trong background job, ghi chunk vào một chỗ dùng chung (Redis stream), và cho client đọc từ offset. Đó là kiến trúc đắt hơn nhiều — chỉ làm khi generation dài (nhiều phút) và giá trị cao. Xem [04-message-queues/](../../03-database/04-message-queues/README.md).

## Example

```ts
@Post(':id/messages')
async send(@Param('id') id: string, @Body() dto: SendMessageDto, @Res() res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');   // no-transform: đừng nén
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');                    // Nginx: đừng buffer
  res.flushHeaders();                                          // gửi header NGAY

  const ac = new AbortController();
  res.on('close', () => ac.abort());

  // heartbeat: giữ kết nối sống qua idle timeout của proxy
  const hb = setInterval(() => res.write(': ping\n\n'), 15_000);

  try {
    for await (const ev of this.chat.handleMessage({ ...ctx, signal: ac.signal }, dto)) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'error', code: classify(e), retryable: isRetryable(e) })}\n\n`);
  } finally {
    clearInterval(hb);
    res.end();
  }
}
```

Hai dòng dễ bỏ nhất trong đoạn trên:

```text
res.flushHeaders()   không có → client chờ tới chunk đầu mới biết kết nối mở
: ping               comment SSE (dòng bắt đầu bằng ':') — client bỏ qua,
                     nhưng proxy thấy có traffic nên không cắt kết nối
```

Frontend:

```ts
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
let buf = '';
let sawDone = false;

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += value;

  // SSE: event tách nhau bằng dòng trống
  const parts = buf.split('\n\n');
  buf = parts.pop() ?? '';                       // phần dở giữ lại cho lần sau
  for (const part of parts) {
    const line = part.split('\n').find(l => l.startsWith('data: '));
    if (!line) continue;                          // ': ping' → bỏ qua
    const ev: ChatEvent = JSON.parse(line.slice(6));
    if (ev.type === 'done') sawDone = true;
    dispatch(ev);
  }
}

if (!sawDone) dispatch({ type: 'interrupted' });   // ← ngắt, KHÔNG phải trả lời ngắn
```

Dòng `buf = parts.pop()` là dòng hay bị sai nhất ở FE: **một chunk TCP không tương ứng một SSE event.** Event có thể bị chia giữa hai chunk. Không giữ phần dở lại là mất event hoặc `JSON.parse` lỗi ngẫu nhiên.

## Prediction

1. Bạn deploy sau Nginx mà không đặt `X-Accel-Buffering: no`. Người dùng thấy gì?
2. Bạn dùng `EventSource` và người dùng mất mạng 2 giây giữa generation. Chi phí?
3. FE của bạn `JSON.parse` mỗi chunk đọc được từ reader. Bao lâu thì lỗi?
4. Bạn không gửi heartbeat và stream có đoạn 90 giây không có token (tool chạy lâu). Qua CDN?
5. Bạn dùng độ dài text để biết stream xong chưa. Sai ở đâu?

<details>
<summary>Đáp án</summary>

1. **Không thấy streaming** — toàn bộ câu trả lời hiện một lần sau khi xong. Không có lỗi nào. Đây là sự cố "chạy ở local, khác ở production" phổ biến nhất của streaming.
2. `EventSource` **tự reconnect** → model sinh lại từ đầu → **tính tiền lần nữa**, và output có thể khác lần đầu. Dùng `fetch` + reader để tự kiểm soát.
3. **Rất nhanh, và ngẫu nhiên** — ngay khi một event bị chia giữa hai chunk TCP. Phải buffer và tách theo `\n\n`.
4. Kết nối có thể **bị cắt** bởi idle timeout của CDN/proxy (thường 60–100s). Heartbeat (`: ping`) giữ nó sống.
5. Text ngắn có thể là câu trả lời ngắn **hoặc** stream bị ngắt — không phân biệt được. Phải dựa vào **sự có mặt của event `done`**.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Không stream ở production, stream ở local | proxy buffer: thiếu `X-Accel-Buffering: no` / nén bật |
| Client không nhận event nào | thiếu dòng trống `\n\n`, hoặc chưa `flushHeaders()` |
| `JSON.parse` lỗi ngẫu nhiên ở FE | không buffer; event bị chia giữa hai chunk |
| Kết nối chết sau ~60–100s | thiếu heartbeat qua proxy/CDN |
| Câu trả lời "ngắn bất thường" | stream ngắt; không kiểm event `done` |
| Bị tính tiền sau khi user bấm Stop | không truyền abort xuống provider |
| Mất câu trả lời khi đóng tab | không tích luỹ + lưu ở server |
| Hai stream đan xen trong UI | không abort stream cũ khi gửi tin mới |
| WebSocket cần sticky session, cache lệch | dùng WS khi SSE đủ |
| `usage` luôn `undefined` | đọc usage trước khi có event `done` |

## Debugging

```text
1. curl -N <endpoint>            → thấy chunk tới dần? (loại trừ FE)
   curl -N qua proxy prod        → còn thấy không? (bắt lỗi buffer)
2. DevTools Network → response có "streaming" hay tới một lần?
3. Có event 'done' không? → phân biệt ngắt vs hoàn tất
4. Khoảng cách giữa các chunk → TTFT? có khoảng lặng dài?
5. Bấm Stop → provider có ngừng? (kiểm usage đã tính bao nhiêu)
6. Log phía server: acc.length khi vào finally → có lưu partial không
```

Bước 1 với `curl -N` là bước tách FE khỏi BE nhanh nhất, và chạy nó **qua proxy production** là cách duy nhất phát hiện lỗi buffer.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| SSE trên POST | đơn giản, qua được hạ tầng HTTP, không sticky | một chiều; cần `fetch` + reader |
| WebSocket | hai chiều, đẩy được khi không có request | sticky session, pub/sub, heartbeat, reconnect |
| Non-streaming | đơn giản nhất; có `finishReason` ngay | cảm giác treo; rủi ro HTTP timeout với output dài |
| Lưu partial | không mất token đã trả tiền | cần trạng thái `isPartial` trong UI và trong context |
| Heartbeat | kết nối sống qua proxy | thêm traffic nhỏ; phải bỏ qua ở FE |
| Background job + resume được | nối lại được từ máy khác | kiến trúc đắt hơn nhiều; chỉ đáng khi generation dài |

## Explain Without Notes

1. Streaming mua **TTFT thấp**, trả bằng bốn vấn đề vòng đời.
2. Chatbot text: SSE trên POST là đủ. WebSocket cần lý do là **hai chiều** hoặc **đẩy khi không có request**.
3. Stream thành công = **có event `done`**, không phải "có text".
4. Ba khâu abort: browser → backend → provider. Đứt khâu cuối là mất tiền.
5. Proxy buffer là lý do streaming "biến mất" ở production; `curl -N` qua proxy là cách phát hiện.

## Related

- [WebSocket & SSE](../../01-web-frontend/00-web-foundations/08-websocket-sse.md) — nền tảng transport
- [Chatbot architecture](./01-chatbot-architecture.md) — trạm ⑫
- [Chat UX & state](./04-chat-ux-and-state.md) — render partial, state machine
- [Gọi provider từ web](./02-calling-provider-from-web.md) — timeout và abort
- [Latency engineering](../07-production/04-latency-engineering.md) — TTFT vs total
- [Provider adapter & DTO](../01-context-and-output/04-provider-adapter-and-dto.md) — `ChatEvent`
- [Reverse proxy & load balancer](../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) — buffer, idle timeout
- [Cloudflare & edge](../../04-infrastructure/05-platforms/02-cloudflare-and-edge.md) — WebSocket bị cắt sau ~100s
- [Message queues](../../03-database/04-message-queues/README.md) — generation dài chạy background
