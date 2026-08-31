---
level: intermediate
area: ai-engineering
prerequisites:
  - ../00-fundamentals/02-ai-application-architecture.md
related:
  - 02-calling-provider-from-web.md
  - 03-streaming.md
  - 05-conversation-storage.md
---

# Chatbot architecture: một full-stack feature

> Chatbot demo trong một buổi chiều: `useState` giữ messages, `fetch` gọi API, API gọi model. Đưa lên staging thì lộ ra: F5 mất hết hội thoại, mở hai tab thì lệch nhau, người dùng bấm gửi hai lần thì có hai câu trả lời chồng nhau, đóng tab giữa lúc trả lời thì câu trả lời biến mất nhưng vẫn bị tính tiền, và một người dùng gửi 400 request trong một phút. Không có lỗi nào trong danh sách đó là lỗi về AI.

## Position

```text
Đây là note "chương trình chính" của track.
Nó cho thấy các note khác nối vào nhau ở đâu.
```

## Problem

Chatbot trông đơn giản vì mental model mặc định của nó sai:

```text
❌ Mental model sai:  chat = một ô input + một API + một câu trả lời

✅ Thực tế: chat là một feature có
     · state phân tán ở 3 nơi (DB, server, browser)
     · một response DÀI, có thể huỷ giữa dòng
     · state không nhị phân (đang stream ≠ xong ≠ lỗi)
     · chi phí theo request và theo độ dài
     · lịch sử phải lưu, nhưng KHÔNG gửi lại toàn bộ
```

## Mental Model

### Đường đi đầy đủ của một tin nhắn

```text
 ① Người dùng gõ, bấm Enter
        ↓
 ② FE: optimistic render tin nhắn của user + placeholder assistant
        ↓  POST /api/conversations/:id/messages   (SSE response)
 ③ BE: AUTH — user này sở hữu conversation này không?
        ↓
 ④ BE: RATE LIMIT (Redis) — theo user, không theo IP
        ↓
 ⑤ BE: VALIDATE — độ dài, định dạng, đếm TOKEN (không phải ký tự)
        ↓
 ⑥ BE: IDEMPOTENCY — clientMessageId đã xử lý chưa?
        ↓
 ⑦ BE: LƯU tin nhắn user  ── COMMIT ngay, trước khi gọi model
        ↓
 ⑧ BE: LOAD lịch sử đã lưu
        ↓
 ⑨ BE: BUILD CONTEXT   ← memory? RAG? cắt/tóm tắt? trong budget
        ↓
 ⑩ BE: gọi model (stream, có AbortSignal)
        ↓
 ⑪ ┌── vòng lặp tool (nếu có) ──────────────┐
    │  model xin gọi tool                    │
    │  → authz + validate + audit + timeout  │
    │  → tool_result → gọi model lại         │
    └────────────────────────────────────────┘
        ↓
 ⑫ BE: stream ChatEvent xuống FE, VÀ tích luỹ text ở server
        ↓
 ⑬ BE: LƯU tin nhắn assistant + usage + finishReason
        ↓  (kể cả khi stream bị ngắt — lưu phần đã có)
 ⑭ BE: emit trace + cost
        ↓
 ⑮ FE: chốt state, thay placeholder bằng message thật
```

Mười lăm trạm. Chỉ trạm ⑩ là "gọi AI". Mười bốn trạm còn lại là **web engineering bạn đã biết** — và chúng là nơi chatbot thực sự hỏng.

### Bốn quyết định định hình toàn bộ phần còn lại

**① Lưu tin nhắn user *trước* khi gọi model (trạm ⑦)**

```text
❌ gọi model → thành công → lưu cả user message và assistant message
   → model lỗi = TIN NHẮN NGƯỜI DÙNG BIẾN MẤT. Họ phải gõ lại.

✅ lưu user message + COMMIT → rồi gọi model
   → model lỗi = tin nhắn còn đó, có nút "Thử lại"
```

Đây là quyết định về **nguồn sự thật**: tin nhắn của người dùng là dữ kiện đã xảy ra, không phụ thuộc việc model có trả lời được hay không.

**② Server tích luỹ text, không chỉ chuyển tiếp (trạm ⑫)**

```text
❌ BE proxy chunk từ provider xuống FE, không giữ gì
   → mất kết nối = mất câu trả lời, dù đã tốn tiền sinh ra nó

✅ BE ghi vào buffer song song với việc stream
   → ngắt giữa dòng vẫn lưu được phần đã có, đánh dấu là partial
```

**③ Idempotency ở tầng tin nhắn (trạm ⑥)**

Người dùng double-click, mạng chập chờn nên client retry, hoặc React StrictMode gọi effect hai lần — cả ba tạo ra hai request cho cùng một tin nhắn. Nếu không có idempotency, bạn có hai câu trả lời và bị tính tiền hai lần.

```text
FE sinh clientMessageId (UUID) MỘT LẦN cho mỗi lần bấm gửi
BE: unique index (conversation_id, client_message_id)
    → request thứ hai nhận lại kết quả cũ, không gọi model lần nữa
```

Đây đúng là **idempotency key** mà repo đã dạy ở [03-http-semantics-idempotency.md](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md). Không có gì mới ngoài việc hậu quả đắt hơn.

**④ Rate limit theo user, và có giới hạn chi phí**

```text
Rate limit thường:   N request / phút / user
Rate limit của AI:   + N token / ngày / user
                     + trần chi phí / ngày / tổ chức
```

Lý do cần trần thứ hai: một người dùng gửi 10 request với 100k token context tốn hơn 1000 người gửi request ngắn. Đếm request không phản ánh chi phí. Redis là chỗ giữ cả hai. Xem [02-rate-limit-locking.md](../../03-database/02-redis/02-rate-limit-locking.md).

### Ba nơi giữ state — và ai là nguồn sự thật

```text
POSTGRESQL          nguồn sự thật. conversation, message, usage.
                    Sống qua reload, qua deploy, qua instance khác.

REDIS               state ngắn hạn: rate limit, idempotency key,
                    lock cho agent đang chạy. TTL rõ ràng.
                    KHÔNG phải nơi giữ hội thoại.

BROWSER (React)     state ĐANG STREAM + optimistic. Không bền.
                    Phải hoà giải lại với DB khi xong.
```

Sai lầm kinh điển: giữ hội thoại trong bộ nhớ process backend. Nó hoạt động trên laptop và chết ngay khi có instance thứ hai — cùng một lỗi như session in-memory ở [01-where-to-run.md](../../04-infrastructure/05-platforms/01-where-to-run.md).

### Vì sao endpoint là POST trả về SSE

```text
GET + SSE (EventSource)     ← không gửi được body dài; không đặt được header dễ dàng
POST + response stream      ← gửi được body; đọc bằng fetch + ReadableStream
```

Chatbot cần gửi tin nhắn (body) **và** nhận stream. Nên hình dạng thực dụng là:

```text
POST /api/conversations/:id/messages
  body: { clientMessageId, content }
  response: text/event-stream  (ChatEvent, mỗi event một dòng data:)
```

Đây **không** phải WebSocket, và trong phần lớn trường hợp không cần WebSocket. Lý do đầy đủ: [03-streaming.md](./03-streaming.md).

## Example

Orchestrator — mỏng, chỉ điều phối, mỗi bước là một trạm ở trên:

```ts
async function* handleMessage(ctx: Ctx, dto: SendMessageDto): AsyncIterable<ChatEvent> {
  // ③ authz — quyền ở tầng truy vấn, không ở prompt
  const conv = await conversations.findOwned(dto.conversationId, ctx.userId);
  if (!conv) throw new NotFoundError();               // 404, không phải 403

  // ④⑤ rate limit + validate token (không phải ký tự)
  await limiter.consume(ctx.userId);
  const inputTokens = await tokenizer.count(dto.content);
  if (inputTokens > cfg.maxUserInputTokens) throw new AppError('MESSAGE_TOO_LONG');

  // ⑥⑦ idempotency + lưu, trong một transaction
  const userMsg = await messages.createIdempotent({
    conversationId: conv.id,
    clientMessageId: dto.clientMessageId,             // unique index
    role: 'user',
    content: dto.content,
  });
  if (userMsg.wasExisting) {
    yield* replayExistingAnswer(userMsg);             // không gọi model lần nữa
    return;
  }

  // ⑧⑨ load + build context trong budget
  const history = await messages.listForContext(conv.id);
  const messagesForModel = await contextBuilder.build({ conv, history, question: dto.content });

  // ⑩⑫ stream, tích luỹ Ở SERVER
  let acc = '';
  let finishReason: FinishReason = 'error';
  let usage: Usage | undefined;

  try {
    for await (const ev of provider.stream({ ...messagesForModel, signal: ctx.signal })) {
      if (ev.type === 'text-delta') acc += ev.text;   // ← tích luỹ
      if (ev.type === 'done') { finishReason = ev.finishReason; usage = ev.usage; }
      yield ev;                                        // ← và chuyển tiếp
    }
  } catch (e) {
    finishReason = ctx.signal.aborted ? 'cancelled' : 'error';
    yield { type: 'error', code: classify(e), retryable: isRetryable(e) };
  } finally {
    // ⑬ LƯU DÙ CÓ LỖI — đây là điểm quan trọng nhất của hàm này
    if (acc.length > 0 || finishReason !== 'error') {
      await messages.create({
        conversationId: conv.id,
        role: 'assistant',
        content: acc,
        finishReason,
        usage,
        isPartial: finishReason !== 'completed',
      });
    }
    // ⑭
    logger.info('chat.turn', { requestId: ctx.requestId, conversationId: conv.id,
      finishReason, ...usage, model: cfg.model, promptVersion: PROMPT.version });
  }
}
```

Khối `finally` là khác biệt giữa chatbot demo và chatbot production. Nó đảm bảo: **bạn đã trả tiền cho những token đó, nên bạn phải lưu chúng** — kể cả khi người dùng đóng tab.

## Prediction

1. Bạn gọi model **trước** khi lưu tin nhắn user, và model trả `429`. Người dùng thấy gì?
2. Người dùng double-click nút Gửi. Không có idempotency. Chi phí và UI?
3. Người dùng đóng tab ở giây thứ 2 của generation 10 giây. Không có `finally`. Bạn mất gì?
4. Bạn giữ hội thoại trong `Map` ở backend. Scale lên 2 instance. Triệu chứng?
5. Rate limit của bạn là 20 request/phút/user. Một user gửi 20 request, mỗi cái kèm 150k token RAG. Ổn không?

<details>
<summary>Đáp án</summary>

1. Tin nhắn họ vừa gõ **biến mất**. Họ phải gõ lại — và nếu đó là một đoạn dài, đó là trải nghiệm rất tệ. Lưu trước, commit trước.
2. **Hai lần gọi model** (tính tiền hai lần) và hai câu trả lời chồng nhau trong UI. Với generation dài thì hai stream đan xen nhau, gần như không sửa được ở FE.
3. Mất toàn bộ text đã sinh — nhưng **vẫn bị tính tiền** cho nó. Và hội thoại có một tin nhắn user không có câu trả lời, nên lượt sau context bị lệch.
4. Request tiếp theo rơi vào instance khác → hội thoại "trống"; hoặc lệch nhau giữa các lần F5. Đúng lỗi session in-memory.
5. **Không ổn.** 20 request × 150k token có thể tốn hơn 2000 request ngắn. Cần thêm trần **theo token**, không chỉ theo số request.

</details>

## Failure Modes

| Triệu chứng | Trạm | Nguyên nhân |
|---|---|---|
| F5 mất hội thoại | ⑦⑬ | chỉ giữ ở React state, không lưu DB |
| Hai câu trả lời cho một tin nhắn | ⑥ | thiếu idempotency |
| Tin nhắn user biến mất khi model lỗi | ⑦ | lưu sau khi gọi model |
| Đóng tab = mất câu trả lời đã tốn tiền | ⑬ | không lưu trong `finally` |
| Hai tab lệch nhau | ⑮ | không hoà giải state với DB |
| Người dùng A đọc được hội thoại của B | ③ | không kiểm sở hữu, chỉ kiểm đăng nhập |
| Hoá đơn tăng vọt vì một user | ④ | rate limit theo request, không theo token |
| Chạy tốt local, lỗi khi scale | — | state trong RAM process |
| `400 context too large` sau vài chục lượt | ⑨ | không có trần cho history |
| Latency tăng dần theo độ dài hội thoại | ⑨ | gửi lại toàn bộ history mỗi lượt |

Hai dòng cuối là cùng một nguyên nhân: **lịch sử đã lưu ≠ context gửi đi**. Xem [06-context-window-management.md](./06-context-window-management.md).

## Debugging

```text
1. Tin nhắn có trong DB không?    → phân biệt lỗi lưu vs lỗi hiển thị
2. finishReason của lượt lỗi?      → cắt / chặn / huỷ / lỗi
3. inputTokens của lượt đó?        → history có bị phình?
4. Có bao nhiêu message cho một clientMessageId? → idempotency
5. So messages[] gửi đi với history trong DB     → context builder có bỏ sót?
6. Trace: TTFT · retrieval · tool · generation   → chậm ở đâu
```

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Lưu user message trước | không mất input người dùng | có message "mồ côi" khi model fail — cần UI cho nó |
| Server tích luỹ text | không mất token đã trả tiền | dùng bộ nhớ server theo mỗi stream đang mở |
| SSE trên POST | đơn giản, một chiều, qua được hạ tầng HTTP | không hai chiều; cần `fetch` + reader thay vì `EventSource` |
| Idempotency ở tầng message | không nhân đôi chi phí | thêm một unique index và một nhánh code |
| Trần theo token | chi phí dự đoán được | phải đếm token trước khi gọi (một lượt tính toán) |
| Optimistic UI | cảm giác tức thì | phải hoà giải khi thất bại — xem [04](./04-chat-ux-and-state.md) |

## Explain Without Notes

1. Chatbot có 15 trạm; chỉ 1 trạm là "gọi AI".
2. Lưu tin nhắn user **trước** khi gọi model.
3. Tích luỹ text **ở server**, và lưu trong `finally` — bạn đã trả tiền cho nó.
4. Idempotency theo `clientMessageId`; rate limit theo **token**, không chỉ request.
5. Nguồn sự thật là PostgreSQL; Redis là ngắn hạn; browser là tạm.

## Related

- [AI application architecture](../00-fundamentals/02-ai-application-architecture.md) — sơ đồ tổng
- [Gọi provider từ web app](./02-calling-provider-from-web.md) — trạm ⑩ và bảo mật key
- [Streaming](./03-streaming.md) — trạm ⑫
- [Chat UX & state](./04-chat-ux-and-state.md) — trạm ②⑮
- [Conversation storage](./05-conversation-storage.md) — trạm ⑦⑬
- [Context window management](./06-context-window-management.md) — trạm ⑨
- [Tool calling](../04-agents-tools/01-tool-calling.md) — trạm ⑪
- [HTTP semantics & idempotency](../../02-backend-api/00-http-api/03-http-semantics-idempotency.md) — trạm ⑥
- [Rate limit & locking (Redis)](../../03-database/02-redis/02-rate-limit-locking.md) — trạm ④
- [Access control](../../05-cross-cutting/security/04-access-control.md) — trạm ③
- [Chạy ở đâu](../../04-infrastructure/05-platforms/01-where-to-run.md) — vì sao state không ở RAM
- [AI scenarios](../08-scenarios/01-ai-scenarios.md) — Scenario A và B chạy trên sơ đồ này
