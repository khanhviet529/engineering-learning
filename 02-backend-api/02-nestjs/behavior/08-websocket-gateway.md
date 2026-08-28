---
level: advanced
area: backend
prerequisites:
  - ../../../01-web-frontend/00-web-foundations/08-websocket-sse.md
  - 04-guards-interceptors.md
related:
  - ../../../03-database/02-redis/06-pubsub-streams.md
  - ../../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md
  - ../../../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md
---

# WebSocket gateway

> Tính năng chat chạy hoàn hảo ở local. Lên production với 3 pod: người dùng A gửi tin nhắn, người dùng B trong cùng phòng không nhận được — nhưng người dùng C thì có. Không có lỗi nào trong log. Vấn đề là A và C đang nói chuyện với pod 1, còn B đang ở pod 2, và pod 1 không biết pod 2 tồn tại.

## Position

```text
Browser ──WS handshake (HTTP Upgrade)──▶ Reverse proxy ──▶ Nest Gateway (pod 1)
   │                                          │                    │
   │◀────── kết nối TCP giữ mở ───────────────┘                    │
                                                          Redis pub/sub  ◀── thiếu cái này
                                                                   │        thì broadcast
                                              Nest Gateway (pod 2) ┘        không xuyên pod
```

WebSocket phá vỡ giả định nền tảng của HTTP mà mọi thứ khác trong repo này dựa vào: **request không còn ngắn và không còn stateless**. Mỗi client là một kết nối TCP sống, gắn với **một pod cụ thể**, tồn tại hàng giờ.

Hầu như mọi vấn đề của WebSocket ở production đều là hệ quả của một câu đó.

## Problem

HTTP là request → response → xong. Server không có cách nào chủ động gửi gì cho client.

```ts
// polling: cách làm khi chưa có gì khác
setInterval(() => fetch('/api/notifications'), 3000);
```

Với 10.000 người dùng online:

```text
10.000 request / 3 giây = 3.333 req/s
Trong đó ~99% trả về "không có gì mới"
Độ trễ: trung bình 1,5 giây, tệ nhất 3 giây
```

Bạn trả tiền cho 3.300 request/s để vận chuyển gần như không có thông tin nào. Giảm chu kỳ xuống 1 giây thì tải gấp ba mà độ trễ vẫn tệ.

Ba lựa chọn thay thế, và chọn đúng quan trọng hơn là chọn cái mạnh nhất:

| | Hướng | Tự reconnect | Qua proxy/CDN | Chi phí | Dùng khi |
|---|---|---|---|---|---|
| **Polling** | client kéo | — | dễ nhất | cao | cập nhật hiếm, đơn giản là ưu tiên |
| **SSE** | server → client | **có, sẵn** | dễ (là HTTP) | thấp | notification, feed, tiến độ job |
| **WebSocket** | hai chiều | không, tự viết | cần cấu hình | trung bình | chat, collaborative editing, game |

Điều đáng nói: **phần lớn tính năng "realtime" chỉ cần một chiều.** Thông báo, cập nhật tiến độ, dashboard trực tiếp — SSE làm được hết, tự reconnect sẵn, đi qua mọi proxy vì nó chỉ là một HTTP response không kết thúc, và không cần adapter đặc biệt để scale ngang (mỗi client vẫn gắn một pod, nhưng bạn có thể dùng Redis pub/sub y hệt mà không cần sticky session cho handshake).

Chọn WebSocket khi **client cũng cần gửi thường xuyên**. Nếu client chỉ gọi API bình thường và server cần đẩy xuống, SSE là lựa chọn rẻ hơn về mọi mặt. Xem [WebSocket & SSE](../../../01-web-frontend/00-web-foundations/08-websocket-sse.md).

## Mental Model

```text
HTTP request                    WebSocket connection
─────────────                   ────────────────────
sống vài chục ms                sống hàng giờ
stateless                       stateful — server nhớ ai đang ở đâu
pod nào cũng xử lý được         gắn CỨNG vào MỘT pod
scale = thêm pod                scale = thêm pod + một kênh liên pod
deploy = drain vài giây         deploy = MỌI kết nối đứt
1 request = 1 slot tạm thời     1 client = 1 socket + bộ nhớ, thường trực
```

Từ đó ra ba câu hỏi bắt buộc phải trả lời trước khi viết dòng gateway đầu tiên:

```text
1. Ai được kết nối?          → xác thực ở HANDSHAKE, không phải ở message
2. Broadcast xuyên pod thế nào? → Redis adapter (pub/sub)
3. Client mất kết nối rồi quay lại thì bù dữ liệu thế nào? → không tự động
```

Câu 3 là câu bị bỏ qua nhiều nhất và là nguồn của bug "thỉnh thoảng mất tin nhắn".

## How It Works

### Gateway cơ bản

```ts
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: process.env.WEB_ORIGIN, credentials: true },   // KHÔNG dùng '*' với credentials
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  async handleConnection(client: Socket) {
    try {
      const user = await this.auth.verifyFromHandshake(client.handshake);
      client.data.user = user;                       // gắn danh tính vào socket
      await client.join(`user:${user.id}`);          // room riêng để gửi đích danh
    } catch {
      client.disconnect(true);                        // từ chối NGAY, không để socket vô danh tồn tại
    }
  }

  handleDisconnect(client: Socket) {
    this.presence.markOffline(client.data.user?.id);
  }

  @SubscribeMessage('message:send')
  async onMessage(@ConnectedSocket() client: Socket, @MessageBody() dto: SendMessageDto) {
    const user = client.data.user as AuthUser;
    // PHẢI kiểm tra quyền ở TỪNG message — quyền có thể đã thay đổi từ lúc handshake
    await this.chat.assertMember(user.id, dto.roomId);
    const saved = await this.chat.save(user.id, dto);
    this.server.to(`room:${dto.roomId}`).emit('message:new', saved);
    return { ack: true, id: saved.id };               // giá trị trả về → ack cho client
  }
}
```

### Xác thực: handshake, không phải message

```ts
// ✅ handshake — kiểm tra một lần, socket vô danh không bao giờ tồn tại
const token = client.handshake.auth?.token
  ?? parseCookie(client.handshake.headers.cookie ?? '')['session'];
```

```ts
// ❌ mẫu sai phổ biến
@SubscribeMessage('auth')
handleAuth(client, token) { client.data.user = verify(token); }
```

Mẫu sai để socket tồn tại ở trạng thái "đã kết nối nhưng chưa xác thực". Mọi handler khác phải nhớ kiểm tra `client.data.user`, và **một handler quên là một lỗ hổng** — cùng loại vấn đề với guard opt-in ở [Guards & interceptors](04-guards-interceptors.md), nhưng khó phát hiện hơn vì không có route để rà soát.

Ba chi tiết về token trong WebSocket:

1. **Trình duyệt không cho đặt header tuỳ ý trong `new WebSocket()`.** Nên token đi qua `Sec-WebSocket-Protocol`, query string, hoặc cookie. Socket.IO tránh vấn đề này bằng `auth` payload trong handshake.
2. **Token trong query string bị ghi vào access log** của proxy. Nếu buộc phải dùng, dùng token ngắn hạn dùng một lần.
3. **Cookie là lựa chọn tốt nhất** nếu cùng site: `HttpOnly`, không lộ ra JavaScript, tự gửi kèm handshake. Cần `credentials: true` và origin cụ thể ở cả hai phía.

Và một điều quan trọng về vòng đời: **kết nối sống lâu hơn token.** Access token hết hạn sau 15 phút nhưng socket sống 6 giờ. Nếu bạn chỉ kiểm tra lúc handshake, một người dùng bị vô hiệu hoá vẫn nhận dữ liệu suốt phần còn lại của kết nối.

```ts
// kiểm tra định kỳ trong lúc kết nối còn sống
@Interval(60_000)
async revalidate() {
  for (const [, socket] of this.server.sockets.sockets) {
    if (!(await this.auth.stillValid(socket.data.user?.id))) socket.disconnect(true);
  }
}
```

### Guard trong ngữ cảnh WebSocket khác HTTP

```ts
@Injectable()
export class WsAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const client = ctx.switchToWs().getClient<Socket>();     // KHÔNG phải switchToHttp()
    if (!client.data.user) throw new WsException('unauthorized');
    return true;
  }
}
```

Ba khác biệt phải biết, nếu không bạn sẽ tưởng guard đang bảo vệ mà thực ra không:

1. **`switchToWs()`** — dùng `switchToHttp()` sẽ nhận `undefined` và guard trả `true` một cách vô nghĩa.
2. **Guard `@UseGuards` trên `@SubscribeMessage` chỉ chạy cho message, KHÔNG chạy cho `handleConnection`.** Bảo vệ handshake phải viết tay trong `handleConnection`.
3. **`WsException`, không phải `HttpException`.** Không có status code; client nhận một event lỗi. Exception filter HTTP không bắt được nó.

### Scale ngang: Redis adapter

Đây là lời giải cho vấn đề ở đầu note.

```ts
// redis-io.adapter.ts
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor!: ReturnType<typeof createAdapter>;

  async connectToRedis(url: string) {
    const pub = createClient({ url });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    this.adapterConstructor = createAdapter(pub, sub);
  }
  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}

// main.ts
const adapter = new RedisIoAdapter(app);
await adapter.connectToRedis(env.REDIS_URL);
app.useWebSocketAdapter(adapter);
```

Cơ chế: khi pod 1 gọi `server.to('room:42').emit(...)`, adapter publish lên Redis; mọi pod subscribe và tự gửi cho socket của **chúng** trong room đó.

```text
pod 1: emit → Redis PUBLISH ──┬──▶ pod 1 gửi cho socket của nó
                              ├──▶ pod 2 gửi cho socket của nó
                              └──▶ pod 3 gửi cho socket của nó
```

Hai điều Redis adapter **không** làm, và cả hai đều bị tưởng nhầm:

- **Không lưu tin nhắn.** Pub/sub là fire-and-forget. Client đang mất kết nối lúc đó sẽ không bao giờ thấy tin nhắn. Nếu tin nhắn quan trọng, nguồn sự thật phải là **database**; pub/sub chỉ là kênh thông báo.
- **Không sống sót khi Redis chết.** Redis chết → broadcast xuyên pod dừng, socket vẫn kết nối. Triệu chứng chính xác giống bug ở đầu note. Phải có health check trên Redis pub/sub.

### Reverse proxy và sticky session

```nginx
location /socket.io/ {
  proxy_pass http://api;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;      # bắt buộc cho handshake
  proxy_set_header Connection "upgrade";       # bắt buộc
  proxy_read_timeout 3600s;                    # mặc định 60s sẽ cắt kết nối im lặng
  proxy_send_timeout 3600s;
}
```

Thiếu hai dòng `Upgrade`/`Connection` → handshake trả 400 và không ai hiểu vì sao. Thiếu `proxy_read_timeout` → kết nối bị cắt sau 60 giây không có traffic, client reconnect liên tục, và log trông như "mạng người dùng kém".

**Sticky session**: Socket.IO mặc định thử polling trước rồi mới nâng cấp lên WebSocket. Trong giai đoạn polling, các HTTP request phải tới **cùng một pod** — nếu không, handshake không bao giờ hoàn tất.

```text
Cách 1: bật sticky session ở LB (ingress annotation: affinity cookie)
Cách 2: ép transport WebSocket ngay: transports: ['websocket']
        → không cần sticky, nhưng mất fallback ở môi trường chặn WS
```

Với hạ tầng hiện đại, cách 2 thường tốt hơn: sticky session làm tải phân bố lệch và cản trở rolling update.

### Kubernetes: kết nối dài gặp rolling update

```text
kubectl rollout restart
  → pod cũ nhận SIGTERM
  → MỌI WebSocket trên pod đó ĐỨT
  → hàng nghìn client reconnect trong cùng một giây
  → dồn hết vào pod còn sống → pod đó quá tải → đứt tiếp → bão reconnect
```

Đây là failure mode riêng của WebSocket và nó không xuất hiện với HTTP. Ba biện pháp, cần cả ba:

```ts
// 1. Server: đóng có trật tự, báo cho client biết
async onApplicationShutdown() {
  this.server.emit('server:shutdown', { reconnectAfterMs: 5_000 });
  await sleep(1_000);                    // cho client kịp nhận
  this.server.close();
}
```

```ts
// 2. Client: reconnect có backoff + jitter — KHÔNG phải retry ngay
const socket = io(url, {
  reconnectionDelay: 1_000,
  reconnectionDelayMax: 30_000,
  randomizationFactor: 0.5,              // jitter — nếu không, mọi client reconnect cùng lúc
});
```

```yaml
# 3. K8s: rollout chậm, grace period đủ dài
spec:
  strategy: { rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } }
  terminationGracePeriodSeconds: 60
```

Jitter ở bước 2 là thứ rẻ nhất và hiệu quả nhất: không có nó, 10.000 client reconnect trong cùng một mili giây và tạo ra chính xác cái đỉnh tải mà rolling update định tránh.

### Bù dữ liệu sau khi reconnect

Kết nối lại **không** tự động lấy lại những gì đã bỏ lỡ. Phải làm tường minh:

```ts
// client gửi mốc cuối cùng nó biết
socket.on('connect', () => socket.emit('sync', { roomId, lastMessageId }));

// server trả phần thiếu từ DATABASE, không phải từ pub/sub
@SubscribeMessage('sync')
async onSync(@ConnectedSocket() c: Socket, @MessageBody() { roomId, lastMessageId }: SyncDto) {
  await this.chat.assertMember(c.data.user.id, roomId);
  return this.chat.messagesAfter(roomId, lastMessageId, { limit: 100 });
}
```

Đây là chỗ thể hiện rõ vai trò đúng của WebSocket: **kênh vận chuyển nhanh, không phải nguồn sự thật.** Nguồn sự thật là database; WebSocket chỉ rút ngắn thời gian client biết có thay đổi.

### Bộ nhớ và backpressure

```text
1 socket ≈ vài KB đến vài chục KB (buffer + state của thư viện)
10.000 socket ≈ vài trăm MB — trước khi tính dữ liệu ứng dụng
```

Và một cái bẫy: nếu server gửi nhanh hơn client nhận, dữ liệu **dồn trong buffer ở server**. Một client trên mạng chậm có thể làm pod tăng RSS đều đặn cho tới OOMKilled.

```ts
// bỏ client không theo kịp thay vì để nó ăn hết bộ nhớ
if (socket.conn.writeBuffer.length > 100) socket.disconnect(true);
```

Xem [Backpressure](../../../05-cross-cutting/performance/06-backpressure.md) và [Process & memory](../../01-nodejs/production/01-process-memory.md).

## Example

Kiểm chứng vấn đề mở đầu bằng ba lệnh:

```bash
# 1. một instance — hoạt động
npm start
# hai tab trình duyệt, cùng room, gửi tin → cả hai nhận

# 2. hai instance sau một LB, KHÔNG có Redis adapter
PORT=3001 npm start & PORT=3002 npm start &
# hai tab, mỗi tab tới một port khác nhau → CHỈ tab gửi thấy tin nhắn

# 3. bật Redis adapter, lặp lại bước 2
# → cả hai nhận
```

Bước 2 là experiment quan trọng nhất của note này. Nó tái hiện một bug production trong 30 giây, ở local, mà không cần Kubernetes.

## Prediction

1. Hai pod, không Redis adapter, A ở pod 1 gửi tin cho room có B ở pod 2 — B nhận không?
2. Có Redis adapter nhưng Redis chết — socket còn kết nối không? Broadcast còn chạy không? Triệu chứng?
3. Xác thực bằng `@SubscribeMessage('auth')` và một handler khác quên kiểm tra `client.data.user` — hậu quả?
4. Access token hết hạn sau 15 phút, socket sống 6 giờ, chỉ kiểm tra ở handshake — user bị khoá lúc phút thứ 20 còn nhận dữ liệu không?
5. `proxy_read_timeout` mặc định 60s, kết nối im lặng 2 phút — chuyện gì xảy ra? Log của bạn trông thế nào?
6. Socket.IO với polling fallback, 3 pod, không sticky session — handshake thành công không?
7. `kubectl rollout restart` với 10.000 kết nối, client reconnect không jitter — điều gì xảy ra với pod còn lại?
8. Client mất mạng 30 giây rồi reconnect, không có cơ chế sync — tin nhắn trong 30 giây đó?
9. Guard dùng `switchToHttp()` thay vì `switchToWs()` — guard bảo vệ được gì?
10. Client trên mạng 2G, server gửi 100 msg/s — RSS của pod theo thời gian?
11. `cors: { origin: '*', credentials: true }` — trình duyệt xử lý thế nào?

<details>
<summary>Đáp án</summary>

1. **Không.** `emit` chỉ tới socket trên cùng pod. Chính xác bug ở đầu note.
2. Socket **vẫn kết nối** (TCP không liên quan tới Redis). Broadcast **xuyên pod dừng**. Triệu chứng giống hệt câu 1 — và vì socket vẫn "khoẻ", monitoring không báo gì.
3. Socket chưa xác thực gọi được handler đó. Lỗ hổng, và không có route nào để rà soát.
4. **Có** — suốt 5 giờ 40 phút còn lại. Cần revalidate định kỳ.
5. Proxy đóng kết nối; client reconnect. Log đầy `disconnect`/`connect` mỗi phút, và người ta kết luận nhầm là "mạng người dùng kém".
6. **Thất bại không ổn định**: các request polling của cùng một handshake rơi vào các pod khác nhau.
7. Toàn bộ 10.000 client reconnect gần như cùng lúc → dồn vào pod còn sống → có thể làm nó chết → bão reconnect.
8. **Mất vĩnh viễn** với client đó. Pub/sub không lưu trữ.
9. Không gì cả — `switchToHttp().getRequest()` trả `undefined`, và code kiểm tra `undefined?.user` thường rơi vào nhánh cho qua.
10. Tăng đều — buffer phía server dồn lại. Cuối cùng OOMKilled.
11. Trình duyệt **từ chối**: không được dùng `*` cùng với credentials. Phải ghi origin cụ thể.
</details>

## Break It

| Phá thế nào | Quan sát |
|---|---|
| Chạy 2 instance không Redis adapter, 2 client khác instance | Tin nhắn không xuyên instance |
| Bật Redis adapter rồi `redis-cli shutdown` khi đang chạy | Socket vẫn "connected", broadcast im lặng dừng |
| Xác thực bằng message thay vì handshake, gọi handler khác trước khi auth | Handler chạy với `user` là `undefined` |
| Đặt access token TTL 60s, giữ socket 5 phút | Xác nhận socket vẫn hoạt động sau khi token hết hạn |
| Đặt `proxy_read_timeout 10s`, để im 15 giây | Kết nối đứt; đọc log để thấy nó trông như lỗi mạng |
| Bỏ `proxy_set_header Upgrade` | Handshake trả 400 |
| Bật polling fallback, 3 pod, tắt sticky | Handshake thất bại ngẫu nhiên |
| 1.000 client, `kubectl rollout restart`, không jitter | Đo đỉnh CPU và số kết nối trên pod còn lại |
| Thêm jitter, lặp lại | So sánh đường cong |
| Ngắt mạng client 30 giây, không sync | Đếm tin nhắn bị mất |
| `tc` giả lập mạng chậm cho một client, gửi 100 msg/s | Đo RSS của pod tăng |
| Mở 20.000 kết nối bằng script | Tìm giới hạn: `ulimit -n`, bộ nhớ, `net.core.somaxconn` |

## What Usually Goes Wrong

- **Không có Redis adapter khi scale** → broadcast chỉ trong một pod. Bug im lặng, khó tái hiện.
- **Redis adapter chết mà không có alert** → cùng triệu chứng, còn khó hơn.
- **Xác thực ở message thay vì handshake** → socket vô danh tồn tại; một handler quên là một lỗ hổng.
- **Không kiểm tra lại quyền theo thời gian** → user bị khoá vẫn nhận dữ liệu tới hết phiên.
- **Không kiểm tra quyền ở từng message** → user rời khỏi room vẫn gửi được vào room đó.
- **Proxy thiếu header Upgrade** → handshake 400.
- **Proxy timeout ngắn** → reconnect liên tục, chẩn đoán nhầm thành lỗi mạng.
- **Không sticky session với polling fallback** → handshake thất bại ngẫu nhiên.
- **Bão reconnect khi deploy** → tự gây ra sự cố mỗi lần rollout.
- **Không có cơ chế sync sau reconnect** → mất dữ liệu im lặng.
- **Coi WebSocket là nguồn sự thật** → không có gì để phát lại khi client offline.
- **Không giới hạn kết nối mỗi user** → một script mở 10.000 socket làm hết bộ nhớ.
- **Không có backpressure** → client chậm làm OOM pod.
- **`origin: '*'` với credentials** → trình duyệt chặn, và đó là may mắn.
- **Không rate limit message** → một client spam làm nghẽn cả room.

## Common Misconceptions

| Tưởng rằng | Thực tế |
|---|---|
| WebSocket tự scale ngang | Cần adapter chia sẻ trạng thái giữa pod |
| Redis adapter lưu tin nhắn | Pub/sub là fire-and-forget |
| Kết nối rồi thì đã xác thực | Chỉ nếu bạn xác thực ở handshake và từ chối ngay |
| Kiểm tra quyền một lần lúc kết nối là đủ | Kết nối sống lâu hơn token và lâu hơn quyền |
| Reconnect tự lấy lại dữ liệu đã bỏ lỡ | Không; phải tự viết sync |
| WebSocket luôn tốt hơn polling | Nó đắt hơn về vận hành; SSE thường là điểm cân bằng đúng |
| Guard HTTP dùng lại được cho WS | `switchToWs()` và `WsException` là khác nhau |
| Deploy chỉ ảnh hưởng request đang bay | Nó ngắt **mọi** kết nối WebSocket |
| Socket rẻ | Vài KB–vài chục KB mỗi cái, thường trực |
| Client chậm là vấn đề của client | Buffer dồn ở **server** |

## Debugging

1. **Client không kết nối được** → mở DevTools → Network → lọc `WS`. Xem status của handshake: `101` = thành công; `400` = proxy thiếu header Upgrade; `401/403` = xác thực; `404` = sai namespace/path; `502` = không tới được upstream.
2. **Kết nối được nhưng không nhận tin** → có bao nhiêu instance? Có Redis adapter không? Test bằng cách ép cả hai client vào cùng một instance — nếu hoạt động, nguyên nhân là broadcast xuyên pod.
3. **Redis adapter có nhưng vẫn không nhận** → `redis-cli MONITOR` và xem có `PUBLISH` không. Không có = adapter chưa gắn. Có mà pod kia không nhận = pod kia subscribe kênh khác (sai prefix/namespace).
4. **Reconnect liên tục mỗi ~60 giây** → timeout của proxy. Con số đều đặn là dấu hiệu nhận biết.
5. **Chỉ một số người dùng bị** → so sánh pod của họ (`kubectl exec` đếm socket mỗi pod). Phân bố lệch = sticky session.
6. **Bộ nhớ tăng đều** → đếm số socket theo thời gian. Không tăng mà bộ nhớ tăng = buffer dồn hoặc listener rò rỉ.
7. **Rò rỉ listener**: mỗi `handleConnection` đăng ký một listener trên một EventEmitter dùng chung mà không gỡ ở `handleDisconnect`. Triệu chứng: cảnh báo `MaxListenersExceededWarning`.
8. **Đếm kết nối theo pod** là metric quan trọng nhất, và nó cũng cho biết ngay khi bạn có vấn đề phân bố.

## Production Considerations

- **Bốn metric**: số kết nối mỗi pod, tỉ lệ reconnect, message/s vào–ra, độ trễ end-to-end (client gửi → client kia nhận, đo bằng timestamp).
- **Health check phải bao gồm Redis pub/sub**, không chỉ HTTP. Một pod "khoẻ" mà không broadcast được là pod hỏng.
- **Giới hạn kết nối mỗi user** (2–5) và **rate limit message** — WebSocket bỏ qua mọi rate limit HTTP của bạn.
- **Validate message như validate HTTP body.** `@MessageBody()` chạy pipe nếu bạn cấu hình, nhưng nó không tự động như `ValidationPipe` toàn cục cho HTTP. Kiểm chứng bằng cách gửi một payload rác.
- **Giới hạn kích thước message** (`maxHttpBufferSize` với Socket.IO). Mặc định 1 MB đủ lớn để gây hại nếu có ai gửi liên tục.
- **Rollout chậm** (`maxUnavailable: 0`, `maxSurge: 1`) và grace period đủ để client di chuyển dần.
- **Tách deployment WebSocket khỏi API HTTP** nếu tải lớn: hai loại này có profile tài nguyên và nhịp deploy hoàn toàn khác nhau. API deploy 10 lần/ngày; gateway càng ít deploy càng tốt.
- **Kiểm tra `ulimit -n`** trong container. 10.000 kết nối cần ít nhất chừng đó file descriptor.
- **Cân nhắc dịch vụ ngoài** (Ably, Pusher, Centrifugo) nếu realtime không phải năng lực cốt lõi. Chi phí vận hành WebSocket ở quy mô lớn là thật, và nó không tạo ra khác biệt cạnh tranh cho hầu hết sản phẩm.
- **Nghiêm túc cân nhắc SSE trước.** Nếu sau khi liệt kê yêu cầu mà không có luồng client → server thường xuyên, SSE cho bạn 80% giá trị với 20% chi phí vận hành.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Polling | đơn giản nhất, không state | tải cao, độ trễ kém |
| SSE | tự reconnect, qua mọi proxy, rẻ | một chiều |
| WebSocket | hai chiều, độ trễ thấp | stateful, phức tạp vận hành |
| Auth ở handshake | không có socket vô danh | không đổi được danh tính giữa chừng |
| Revalidate định kỳ | thu hồi quyền có hiệu lực | thêm tải, thêm code |
| Redis adapter | scale ngang | thêm phụ thuộc; nó chết thì broadcast chết |
| Sticky session | polling fallback hoạt động | tải lệch, cản trở rollout |
| Ép `transports: ['websocket']` | không cần sticky | mất fallback ở mạng chặn WS |
| Lưu message vào DB | phát lại được, sync được | thêm ghi cho mỗi tin nhắn |
| Chỉ pub/sub | nhanh, rẻ | mất tin nhắn khi offline |
| Gateway tách riêng | cô lập, deploy độc lập | thêm một service |
| Dịch vụ realtime bên ngoài | không phải vận hành | chi phí, phụ thuộc bên thứ ba |

## Explain Without Notes

1. Vì sao WebSocket phá vỡ giả định stateless, và ba hệ quả cụ thể của điều đó?
2. Vì sao broadcast không xuyên pod nếu không có adapter? Vẽ đường đi của một tin nhắn có và không có Redis.
3. Vì sao xác thực phải ở handshake? Chế độ hỏng của việc xác thực bằng message là gì?
4. Redis pub/sub **không** đảm bảo điều gì, và điều đó buộc bạn thiết kế thế nào?
5. Chuyện gì xảy ra với 10.000 kết nối khi rolling update, và ba biện pháp giảm nhẹ?
6. Khi nào chọn SSE thay vì WebSocket? Nêu hai lợi ích cụ thể của SSE.

## Related

- [WebSocket & SSE](../../../01-web-frontend/00-web-foundations/08-websocket-sse.md) — phía client, so sánh giao thức
- [Guards & interceptors](04-guards-interceptors.md) — `switchToWs`, khác biệt ngữ cảnh
- [Redis pub/sub & streams](../../../03-database/02-redis/06-pubsub-streams.md) — pub/sub vs stream cho phát lại
- [Reverse proxy & load balancer](../../../04-infrastructure/01-networking/05-reverse-proxy-load-balancer.md) — Upgrade header, timeout, sticky
- [Rollout & rollback](../../../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md) — kết nối dài gặp rolling update
- [Graceful shutdown](../../01-nodejs/production/02-graceful-shutdown.md) — đóng gateway có trật tự
- [Backpressure](../../../05-cross-cutting/performance/06-backpressure.md) — client chậm làm OOM server
- [Rate limiting](../../00-http-api/07-rate-limiting.md) — WebSocket bỏ qua rate limit HTTP

## Version / Context

NestJS 10/11 với `@nestjs/websockets` và Socket.IO 4 (adapter mặc định). `@socket.io/redis-adapter` 8. Với adapter `ws` thuần, khái niệm giữ nguyên nhưng không có room/namespace/fallback sẵn — bạn phải tự viết.
