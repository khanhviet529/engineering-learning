---
level: intermediate
area: frontend
prerequisites:
  - ../../04-infrastructure/01-networking/00-network-vocabulary.md
  - 01-browser-request-render.md
  - 03-url-dns-tcp-tls.md
related:
  - ../../02-backend-api/02-nestjs/behavior/08-websocket-gateway.md
  - ../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md
---

# WebSocket & SSE

> Ba cách để server đẩy dữ liệu xuống client. Chọn sai làm bạn phải xây lại reconnect logic mà giao thức đã có sẵn.

> **Chưa biết những từ này?** [Từ vựng Network](../../04-infrastructure/01-networking/00-network-vocabulary.md) — TCP, socket, port

## Position

```text
Browser ←──────────────────→ Server
   polling  | SSE (1 chiều) | WebSocket (2 chiều)
        ↑ qua reverse proxy — nơi các kết nối dài hay bị cắt
```

## Problem

HTTP là request–response: client hỏi, server trả. Nhưng nhiều tính năng cần điều ngược lại — **server có tin mới và muốn nói ngay**: thông báo, presence, tiến độ job, chat, cập nhật giá.

Cách rẻ nhất là polling: client hỏi mỗi 5 giây. Với 10.000 người dùng, đó là 2.000 request/giây, phần lớn trả về "chưa có gì mới". Vừa tốn tài nguyên vừa trễ tới 5 giây.

Cần một cách để server chủ động gửi. Có ba lựa chọn, và chúng không tương đương.

## Mental Model

```text
Polling         client hỏi lặp lại        đơn giản, tốn, trễ
                GET /msgs → 200 (rỗng) → chờ 5s → GET /msgs → ...

SSE             MỘT response không kết thúc, server ghi dần
                GET /stream → 200, text/event-stream → data: ... → data: ...
                một chiều (server → client), tự reconnect, chạy trên HTTP thường

WebSocket       nâng cấp HTTP thành kết nối TCP hai chiều
                GET /ws (Upgrade) → 101 → frame ⇄ frame
                hai chiều, protocol riêng, TỰ quản reconnect
```

Quy tắc chọn:

| Nhu cầu | Chọn |
|---|---|
| Client chỉ **nhận** (notification, tiến độ, dashboard, token LLM streaming) | **SSE** |
| Cần **gửi liên tục cả hai chiều** với độ trễ thấp (chat, game, collaborative editing, cursor) | **WebSocket** |
| Cập nhật hiếm, không cần realtime thật | **Polling** — và đừng cảm thấy tệ về nó |

Mặc định nên là SSE nếu bạn chỉ cần một chiều. Lý do: nó là HTTP thường, nên nó nhận được **miễn phí** mọi thứ hạ tầng của bạn đã có — auth bằng cookie, compression, HTTP/2, proxy, load balancer, observability — và nó có **auto-reconnect trong chuẩn**. WebSocket bắt bạn tự làm lại hầu hết những thứ đó.

## How It Works

### SSE

Server giữ response mở và ghi text theo format cố định:

```text
data: {"type":"task.updated","id":42}\n\n
event: ping\ndata: {}\n\n
id: 1042\ndata: {...}\n\n
retry: 3000\n\n
```

- Hai `\n` kết thúc một event. Đây là chỗ hay sai.
- `id:` cho phép resume: khi reconnect, browser tự gửi header `Last-Event-ID`. Server dùng nó để gửi lại phần bị mất — **đây là tính năng quan trọng nhất của SSE** và nó có sẵn.
- `EventSource` tự reconnect với backoff. Bạn không viết dòng code nào.
- Giới hạn: **6 kết nối/domain trên HTTP/1.1**. Mở SSE trong 6 tab là hết quota, tab thứ 7 treo. Trên HTTP/2 thì không còn vấn đề (multiplexing) — vì vậy HTTP/2 gần như bắt buộc cho SSE production.
- `EventSource` **không gửi được custom header** (không có `Authorization`). Auth phải qua cookie, hoặc dùng `fetch` + `ReadableStream` thay cho `EventSource`.

### WebSocket

Handshake là một HTTP request đặc biệt:

```http
GET /ws HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <base64>
```

```http
HTTP/1.1 101 Switching Protocols
```

Sau `101`, không còn HTTP nữa — chỉ còn frame trên TCP. Hệ quả rất thực tế:

- Middleware HTTP, CORS, cache, logging **không áp dụng** sau handshake. Auth phải xảy ra **ở** handshake (hoặc ở message đầu tiên).
- Không có status code cho lỗi giữa phiên; bạn tự định nghĩa message lỗi.
- Proxy phải được cấu hình cho phép upgrade và có `read timeout` dài.

### Cả hai đều cần

| Vấn đề | Vì sao | Xử lý |
|---|---|---|
| Proxy cắt kết nối rảnh | nginx `proxy_read_timeout` mặc định 60s | heartbeat/ping định kỳ (15–30s) |
| Buffering | nginx buffer response → SSE không tới | `X-Accel-Buffering: no`, `proxy_buffering off` |
| Reconnect | mạng di động, sleep, deploy | SSE: sẵn có. WebSocket: tự viết backoff + jitter |
| Mất message khi mất kết nối | client offline vài giây | sequence/`id` + resume, hoặc fetch lại state khi reconnect |
| Nhiều instance backend | client A ở pod 1, event sinh ở pod 2 | Redis pub/sub hoặc message broker để fan-out |
| Sticky session | WebSocket gắn với một instance | LB phải sticky hoặc dùng shared state |
| Scale kết nối | mỗi kết nối tốn RAM + fd | tính toán ulimit và memory per connection |

Hàng "nhiều instance backend" là điều bất ngờ nhất khi lên production: realtime chạy hoàn hảo với 1 instance và hỏng ngay khi scale lên 2. Xem [Pub/Sub & streams](../../03-database/02-redis/06-pubsub-streams.md).

## Example

```ts
// SSE server (Route Handler) — chú ý heartbeat và header
export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);

      const tick = setInterval(() => send({ at: Date.now() }), 1000);
      const beat = setInterval(() => controller.enqueue(`: ping\n\n`), 15000);

      // Dọn khi client ngắt — không có dòng này là leak
      return () => { clearInterval(tick); clearInterval(beat); };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

```ts
// SSE client — reconnect là miễn phí
const es = new EventSource('/api/stream', { withCredentials: true });
es.onmessage = (e) => console.log(JSON.parse(e.data));
es.onerror = () => { /* browser tự reconnect; chỉ log */ };
// Nhớ es.close() trong cleanup của effect
```

```ts
// WebSocket client — reconnect phải tự viết
function connect(attempt = 0) {
  const ws = new WebSocket('wss://api.example.com/ws');
  ws.onclose = () => {
    const delay = Math.min(1000 * 2 ** attempt, 30_000) * (0.5 + Math.random());
    setTimeout(() => connect(attempt + 1), delay);   // backoff + jitter
  };
  ws.onopen = () => { /* attempt = 0; gửi lại subscription */ };
  return ws;
}
```

Jitter (`Math.random()`) không phải chi tiết nhỏ: không có nó, sau một lần restart server, toàn bộ client reconnect **cùng lúc** và làm server sập lại. Xem [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md).

## Prediction

1. Mở 7 tab cùng dùng SSE trên HTTP/1.1 — tab thứ 7 thế nào? Trên HTTP/2?
2. Bạn quên `\n\n` cuối mỗi event — client nhận được gì?
3. nginx với `proxy_read_timeout 60s`, SSE không có heartbeat — sau 60 giây điều gì xảy ra?
4. Deploy backend (rolling restart) với 5.000 WebSocket client, reconnect không có jitter — dự đoán tải lúc t+1s.
5. Scale API từ 1 lên 3 pod. Client kết nối vào pod 1; event được tạo trong pod 3. Client nhận được không?
6. `EventSource` cần `Authorization: Bearer ...` — làm thế nào?

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Bỏ heartbeat, đặt proxy timeout 30s | Kết nối bị cắt lặp lại; SSE tự reconnect, WebSocket thì im lặng chết |
| Bỏ `X-Accel-Buffering: no` sau nginx | Không nhận được gì cho đến khi buffer đầy — tưởng server lỗi |
| Tắt mạng 10 giây rồi bật | SSE tự nối lại (kiểm tra `Last-Event-ID`); WebSocket đứng nếu không tự viết reconnect |
| Scale lên 2 instance không có pub/sub | Một nửa client không nhận event |
| Không `close()` trong cleanup của React effect | Mỗi lần navigate tạo thêm một kết nối; đếm trong Network tab |
| Gửi 10.000 message/giây | Client lag; hiểu vì sao cần batch/throttle |
| Reconnect không jitter, restart server | Thundering herd |
| Auth chỉ ở message đầu, không ở handshake | Client chưa auth vẫn giữ được kết nối — tốn tài nguyên, dễ bị abuse |

## What Usually Goes Wrong

- **Dùng WebSocket khi chỉ cần một chiều** → phải tự viết reconnect, resume, auth, và mất tương thích proxy.
- **Không có heartbeat** → kết nối chết âm thầm; client tưởng vẫn đang nhận.
- **Không dọn kết nối** trong cleanup effect → leak kết nối, server hết fd.
- **Không xử lý multi-instance** → realtime hỏng khi scale.
- **Coi realtime là nguồn sự thật duy nhất** → mất một message là UI sai vĩnh viễn. Luôn có đường refetch state đầy đủ khi reconnect.
- **Auth qua query string** (`?token=...`) cho WebSocket → token vào access log của mọi proxy.
- **Không giới hạn số kết nối / message rate** → dễ bị lạm dụng.
- **Gửi từng message một khi có burst** → client không kịp render; cần batch theo frame.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| WebSocket luôn tốt hơn SSE | Chỉ khi cần hai chiều. SSE đơn giản và có resume sẵn |
| SSE là polling | Một response duy nhất, không đóng — không có request lặp lại |
| WebSocket không có giới hạn kết nối | Có, nhưng SSE trên HTTP/1.1 giới hạn chặt hơn (6/domain) |
| Middleware HTTP áp dụng cho WebSocket | Chỉ ở handshake; sau `101` thì không |
| Realtime nghĩa là không cần cache/state | Vẫn cần: mất kết nối là chuyện thường |
| `wss://` chỉ là WebSocket qua TLS, không khác gì | Bắt buộc trên production, và nhiều proxy chỉ upgrade đúng với TLS |
| Reconnect tự động có sẵn cho WebSocket | Không. Chỉ SSE có |

## Debugging

1. DevTools → Network → filter **WS** (WebSocket) hoặc **EventStream** (SSE). Cả hai đều có tab xem message thật.
2. SSE không nhận gì:
   - `Content-Type` có đúng `text/event-stream`?
   - Có `\n\n` sau mỗi event?
   - Có bị proxy buffer? Test trực tiếp vào app (bỏ qua proxy) để so sánh.
3. WebSocket không kết nối: xem request handshake — status `101` là thành công. `200` nghĩa là server không upgrade (thường proxy chưa cấu hình). `401/403` là auth ở handshake.
4. Kết nối chết sau đúng N giây → timeout của proxy; N sẽ khớp một giá trị cấu hình.
5. Chỉ một số client nhận event → nghi vấn multi-instance; kiểm tra bằng cách scale về 1 replica.
6. Server hết file descriptor → `ss -s`, đếm kết nối; kiểm tra leak từ client không đóng.

## Production Considerations

- **HTTP/2 hoặc HTTP/3** cho SSE để bỏ giới hạn 6 kết nối.
- **Cấu hình proxy**: `proxy_http_version 1.1`, `proxy_set_header Upgrade`/`Connection`, `proxy_read_timeout` lớn, `proxy_buffering off` cho stream.
- **Fan-out qua Redis pub/sub hoặc broker** ngay từ đầu nếu sẽ có nhiều instance.
- **Sticky session hoặc stateless connection** — quyết định sớm; đổi sau rất đau.
- **Đo số kết nối đồng thời** như một metric hạng nhất, cùng với RAM/fd per connection.
- **Kế hoạch cho deploy**: rolling restart sẽ ngắt mọi kết nối. Reconnect có backoff + jitter là điều kiện bắt buộc.
- **Graceful shutdown** phải đóng kết nối có thông báo, không cắt đột ngột. Xem [Graceful shutdown](../../02-backend-api/01-nodejs/production/02-graceful-shutdown.md).

## Trade-offs

| Lựa chọn | Được | Mất |
|---|---|---|
| Polling | đơn giản nhất, dùng hết hạ tầng HTTP, dễ debug | trễ, tốn request |
| Long polling | trễ thấp hơn polling, tương thích cao | giữ nhiều request mở, phức tạp hơn nó trông |
| SSE | reconnect + resume sẵn, HTTP thường, auth bằng cookie | một chiều, giới hạn HTTP/1.1, không custom header |
| WebSocket | hai chiều, độ trễ thấp nhất, payload nhỏ | tự làm reconnect/resume/auth, proxy phức tạp, sticky session |

## Explain Without Notes

1. Ba cách server đẩy dữ liệu, và điều kiện chọn mỗi cách?
2. SSE cho bạn miễn phí hai tính năng nào mà WebSocket bắt bạn tự viết?
3. Vì sao cần heartbeat, và giá trị nào là hợp lý?
4. Vì sao realtime chạy tốt với 1 instance và hỏng với 3 instance? Sửa thế nào?
5. Vì sao reconnect cần jitter?

## Related

- [Từ vựng Network](../../04-infrastructure/01-networking/00-network-vocabulary.md) — foundation: TCP, socket, port
- [WebSocket gateway (NestJS)](../../02-backend-api/02-nestjs/behavior/08-websocket-gateway.md) — phía server
- [Pub/Sub & streams](../../03-database/02-redis/06-pubsub-streams.md) — fan-out cho nhiều instance
- [Reverse proxy & load balancer](../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) — cấu hình cho kết nối dài
- [Timeout, retry, circuit breaker](../../05-cross-cutting/reliability/02-timeout-retry-circuit-breaker.md) — backoff và jitter
- [Server state & cache](../02-react/behavior/04-server-state-cache.md) — kết hợp realtime với cache của client
