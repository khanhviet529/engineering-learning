---
level: intermediate
area: ai-engineering
prerequisites:
  - 03-streaming.md
related:
  - 05-conversation-storage.md
  - ../../01-web-frontend/02-react/behavior/01-state-render.md
---

# Chat UX và state machine phía frontend

> Người dùng bấm Gửi, đợi 3 giây, tưởng bị treo nên bấm lại. Hai stream chạy song song, chữ của cả hai đan vào nhau trong cùng một bong bóng. Họ bấm Reload. Hội thoại quay về trạng thái trước đó vì tin nhắn cuối chỉ tồn tại trong `useState`. Không có lỗi nào trong console. Toàn bộ sự cố là do UI có **hai** trạng thái (`loading: boolean`) cho một quy trình có **bảy**.

## Position

```text
Backend ──ChatEvent──▶ [ STATE MACHINE ] ──▶ Render
                              ▲
                    note này: FE giữ gì, và ở trạng thái nào
```

## Problem

`loading: boolean` là mô hình sai cho chat, vì nó không phân biệt được những tình huống cần UI khác nhau:

```text
"đang chờ server nhận"       → hiện spinner, cho phép huỷ
"đang chờ token đầu"         → hiện "đang suy nghĩ", cho phép huỷ
"đang nhận chữ"              → hiện chữ + con trỏ, cho phép DỪNG
"đang chạy tool"             → hiện "đang tra đơn hàng...", cho phép huỷ
"xong"                       → hiện đủ + nút Regenerate
"bị ngắt giữa dòng"          → hiện partial + nút TIẾP TỤC (khác Regenerate)
"lỗi"                        → hiện lý do + nút Thử lại (nếu retryable)
"đã huỷ"                     → hiện partial, KHÔNG phải lỗi
```

Tám tình huống, và `loading: boolean` gộp chúng thành hai.

Cùng với đó là ranh giới quan trọng nhất của note:

> **State đã lưu (server) ≠ state đang stream (browser).** Nhập chúng lại là nguồn của mọi lỗi "F5 mất dữ liệu" và "hai tab lệch nhau".

## Mental Model

### State machine của một lượt chat

```text
        idle
          │ user gửi
          ▼
       sending ─────────────── error ◀──┐
          │ server nhận                 │
          ▼                             │
       waiting  (chưa có token)  ───────┤
          │ token đầu tiên              │
          ▼                             │
      streaming ◀──────────┐      ──────┤
          │  │             │            │
          │  │ tool call   │ resumed    │
          │  ▼             │            │
          │ tool-running ──┘            │
          │                             │
    ┌─────┼─────┬───────────┐           │
    ▼     ▼     ▼           ▼           │
completed cancelled interrupted ────────┘
```

Ba nhánh kết thúc **không tương đương**, và đây là điểm quan trọng nhất:

| Trạng thái cuối | Có `done`? | UI hiện | Hành động chính |
|---|---|---|---|
| `completed` | ✓ `completed` | câu trả lời đủ | Regenerate |
| `cancelled` | ✓ `cancelled` | partial + "đã dừng" | **Tiếp tục** |
| `interrupted` | ✗ không có | partial + "bị ngắt" | **Tiếp tục** |
| `error` | ✗ hoặc `error` | thông báo lý do | Thử lại (nếu retryable) |

`cancelled` **không phải lỗi** — người dùng chủ động dừng. Hiện nó bằng UI lỗi đỏ là làm người dùng tưởng có gì sai.

### Hai lớp state, hai nguồn sự thật

```text
┌─ SERVER STATE (nguồn sự thật) ───────────────────────┐
│  messages đã lưu: id thật, role, content, isPartial  │
│  → fetch khi mở; invalidate sau khi một lượt xong    │
│  → sống qua F5, qua tab khác, qua instance khác      │
└──────────────────────────────────────────────────────┘

┌─ EPHEMERAL STATE (chỉ trong tab này) ────────────────┐
│  turnState: 'streaming' | 'tool-running' | ...       │
│  streamingText: string        ← đang tích luỹ        │
│  optimisticUserMessage        ← chưa có id server    │
│  activeToolName               ← hiện "đang tra..."   │
│  abortController                                      │
└──────────────────────────────────────────────────────┘
```

Đây là đúng sự phân biệt **server state vs client state** mà repo đã dạy ở [server state vs client state](../../01-web-frontend/04-application-engineering/02-data-fetching-architecture.md). Chat không phát minh gì mới — nó chỉ làm hậu quả của việc nhập hai thứ rõ hơn.

Nguyên tắc thực dụng:

```text
Khi một lượt hoàn tất → XOÁ ephemeral, ĐỌC LẠI từ server.
Không "chuyển" streamingText thành message trong state client.
```

Vì sao: message thật có `id` do server sinh, có `createdAt` của server, có `usage`. Nếu bạn tự dựng nó ở client, hai tab sẽ có hai phiên bản khác nhau của cùng một tin nhắn.

### Optimistic UI: hoà giải, không chỉ hiển thị

```text
① User bấm Gửi
      → thêm ngay { id: tempId, clientMessageId, role: 'user', pending: true }
      → UI phản hồi tức thì
② Server nhận, trả về id thật (hoặc kết thúc lượt)
      → THAY thế theo clientMessageId, không phải theo vị trí
③ Nếu thất bại
      → GIỮ LẠI tin nhắn, đánh dấu failed, cho nút Thử lại
      → KHÔNG xoá: người dùng sẽ phải gõ lại
```

Bước ③ là bước quan trọng nhất và hay làm sai nhất. Xoá tin nhắn khi gửi thất bại là hành vi khiến người dùng mất công sức — nhất là khi họ vừa gõ một đoạn dài.

Và `clientMessageId` là khoá hoà giải, không phải index:

```text
❌ messages[messages.length - 1] = realMessage
   → sai nếu có tin nhắn khác chen vào (tab khác, retry)

✅ messages.map(m => m.clientMessageId === id ? realMessage : m)
```

Cùng `clientMessageId` đó cũng là idempotency key ở backend — một giá trị, hai mục đích.

### Mười ba trạng thái UI cần có

```text
① placeholder assistant rỗng            ngay khi gửi
② "đang suy nghĩ"                        waiting, chưa có token
③ chữ + con trỏ nhấp nháy                streaming
④ nút DỪNG                               chỉ khi streaming/tool-running
⑤ "đang tra đơn hàng..."                 tool-running, tên tool THÂN THIỆN
⑥ citation                                sau/kèm câu trả lời
⑦ partial + "đã dừng" + Tiếp tục          cancelled
⑧ partial + "bị ngắt" + Tiếp tục          interrupted
⑨ lỗi + lý do + Thử lại (nếu retryable)   error
⑩ Regenerate                              completed
⑪ Sửa & gửi lại                           trên tin nhắn user
⑫ trạng thái offline                       mất mạng
⑬ hết hạn mức / hết ngân sách             429 hoặc cost cap
```

Ba cái hay bị bỏ nhất và tốn nhất:

**⑤ tên tool thân thiện.** Hiện `getOrderById` cho người dùng là rò rỉ chi tiết nội bộ và vô nghĩa với họ. Map sang nhãn người đọc được — và **chỉ** hiện những tool bạn cố ý muốn hiện.

**⑧ interrupted khác error.** Câu trả lời bị ngắt vẫn có giá trị; hiện nó kèm đường tiếp tục.

**⑬ hết hạn mức.** `429` không phải "có gì sai" — nó là "đợi một chút" hoặc "đã hết hạn mức hôm nay". Thông báo phải nói được cái nào.

### Regenerate, Retry, Tiếp tục, Sửa & gửi lại — bốn thứ khác nhau

| Hành động | Từ trạng thái | Làm gì | Chi phí |
|---|---|---|---|
| **Thử lại** | error | gửi lại **cùng** tin nhắn user | một lượt mới |
| **Regenerate** | completed | sinh lại câu trả lời cho tin nhắn user đó | một lượt mới |
| **Tiếp tục** | cancelled / interrupted | lượt mới, có partial trong context | một lượt mới |
| **Sửa & gửi lại** | bất kỳ | sửa tin nhắn user → **cắt bỏ mọi lượt sau nó** | một lượt mới |

"Sửa & gửi lại" là hành động có hệ quả dữ liệu lớn nhất: nó làm nhánh sau đó **không còn hợp lệ**. Hai cách xử lý:

```text
① Cắt cứng:  xoá/ẩn mọi message sau điểm sửa
   → đơn giản, dễ hiểu, mất lịch sử

② Phân nhánh: giữ nhánh cũ, tạo nhánh mới
   → giữ được lịch sử, nhưng schema và UI phức tạp hơn nhiều
   (message cần parentId, conversation cần activeLeafId)
```

Chọn ① trừ khi bạn thật sự cần so sánh nhánh. Xem [05-conversation-storage.md](./05-conversation-storage.md).

Và cả bốn hành động đều tốn một lượt gọi model — nên cả bốn đều phải đi qua rate limit và cost cap.

## Example

Reducer — trạng thái tường minh, không `boolean`:

```ts
type TurnState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'waiting' }
  | { kind: 'streaming'; text: string }
  | { kind: 'tool-running'; text: string; tool: string }
  | { kind: 'completed' }
  | { kind: 'cancelled'; text: string }
  | { kind: 'interrupted'; text: string }
  | { kind: 'error'; code: string; retryable: boolean; text: string };

function reduce(s: TurnState, ev: ChatEvent | UiEvent): TurnState {
  switch (ev.type) {
    case 'text-delta': {
      const prev = 'text' in s ? s.text : '';
      return { kind: 'streaming', text: prev + ev.text };
    }
    case 'tool-start':
      return { kind: 'tool-running', text: 'text' in s ? s.text : '', tool: ev.tool };
    case 'tool-result':
      return { kind: 'streaming', text: 'text' in s ? s.text : '' };
    case 'done':
      return ev.finishReason === 'cancelled'
        ? { kind: 'cancelled', text: 'text' in s ? s.text : '' }
        : { kind: 'completed' };
    case 'error':
      return { kind: 'error', code: ev.code, retryable: ev.retryable,
               text: 'text' in s ? s.text : '' };
    case 'interrupted':                                  // reader kết thúc mà KHÔNG có 'done'
      return { kind: 'interrupted', text: 'text' in s ? s.text : '' };
  }
}
```

Hai chi tiết:

```text
① 'text' in s   → giữ được partial khi chuyển sang cancelled/error/interrupted
② 'interrupted' là UiEvent do FE tự sinh khi reader kết thúc mà chưa thấy 'done'
```

Và cleanup — không tuỳ chọn:

```ts
useEffect(() => {
  return () => abortRef.current?.abort();     // unmount → huỷ stream
}, []);

async function send(content: string) {
  abortRef.current?.abort();                  // huỷ stream CŨ trước khi mở mới
  const ac = new AbortController();
  abortRef.current = ac;
  // ...
}
```

Dòng `abortRef.current?.abort()` ở đầu `send` là dòng chặn được sự cố "hai stream đan xen" ở đầu note.

Sau khi lượt xong, hoà giải với server:

```ts
if (state.kind === 'completed') {
  await queryClient.invalidateQueries({ queryKey: ['conversation', id] });
  setTurnState({ kind: 'idle' });             // xoá ephemeral
}
```

## Prediction

1. Bạn dùng `loading: boolean`. Người dùng bấm Dừng ở giây thứ 2. UI hiện gì, và bạn phân biệt được với lỗi không?
2. Bạn hoà giải optimistic message theo `messages[length-1]`. Tab khác gửi một tin nhắn cùng lúc. Kết quả?
3. Bạn xoá tin nhắn user khi gửi thất bại. Người dùng vừa gõ 500 từ. Phản ứng của họ?
4. Bạn chuyển `streamingText` thành message trong state client thay vì đọc lại từ server. Mở tab thứ hai?
5. Bạn không abort stream cũ khi người dùng gửi tin mới. Chuyện gì xảy ra trong DOM?

<details>
<summary>Đáp án</summary>

1. `loading` về `false`, và bạn **không phân biệt được** dừng chủ động với lỗi. Người dùng thấy UI lỗi cho một hành động họ tự làm — hoặc thấy y như thành công, không biết câu trả lời bị cắt.
2. Bạn **thay thế sai tin nhắn**. Hoà giải phải theo `clientMessageId`.
3. Họ mất 500 từ và phải gõ lại. Đây là loại lỗi làm người dùng bỏ sản phẩm chứ không phải báo bug. Giữ tin nhắn, đánh dấu `failed`.
4. Tab hai không thấy tin nhắn đó cho tới khi reload; và message ở tab một không có `id` thật, `usage`, `createdAt` của server. Hai tab có hai phiên bản của cùng hội thoại.
5. Cả hai stream cùng ghi vào state → chữ đan xen nhau. Và cả hai đều đang bị tính tiền.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Hai stream đan xen chữ | không abort stream cũ khi gửi tin mới |
| F5 mất tin nhắn cuối | ephemeral state không được lưu; không invalidate sau khi xong |
| Hai tab lệch nhau | tự dựng message ở client thay vì đọc lại từ server |
| "Đã dừng" hiện như lỗi | không phân biệt `cancelled` với `error` |
| Câu trả lời ngắn bất thường, không báo gì | không xử lý `interrupted` (thiếu `done`) |
| Người dùng mất tin nhắn dài khi lỗi | xoá optimistic message khi thất bại |
| Stream tiếp tục sau khi rời trang | thiếu cleanup trong `useEffect` |
| Hiện `getOrderById` cho người dùng | không map tên tool sang nhãn thân thiện |
| Nút Thử lại cho lỗi không retry được | `error` không mang `retryable` |
| Nút Dừng vẫn hiện sau khi xong | UI phái sinh từ `boolean` thay vì từ state machine |

## Debugging

```text
1. In turnState mỗi lần đổi → có state nào bị nhảy qua?
2. Có nhận event 'done' không? → completed vs interrupted
3. Số AbortController đang sống = 1?
4. Sau khi xong, có invalidate query không? Reload có khớp UI không?
5. clientMessageId của optimistic có khớp với cái server trả về?
6. Rời trang giữa stream → request có bị abort? (Network tab: cancelled)
```

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| State machine tường minh | UI đúng cho từng tình huống | nhiều code hơn `boolean` |
| Optimistic UI | phản hồi tức thì | phải hoà giải, phải xử lý thất bại |
| Đọc lại từ server sau mỗi lượt | một nguồn sự thật, đa tab đúng | một request nữa (rẻ) |
| Cắt cứng khi sửa & gửi lại | đơn giản, dễ hiểu | mất lịch sử nhánh cũ |
| Phân nhánh hội thoại | so sánh được nhánh | schema + UI phức tạp hơn nhiều |
| Hiện trạng thái tool | minh bạch, giảm cảm giác treo | rò rỉ chi tiết nếu không map tên |

## Explain Without Notes

1. Chat có **tám** trạng thái, không phải hai — `loading: boolean` là mô hình sai.
2. `cancelled` ≠ `interrupted` ≠ `error`; cả ba cần UI khác nhau.
3. Server state là nguồn sự thật; ephemeral chỉ sống trong tab; xong lượt thì xoá ephemeral và đọc lại.
4. Hoà giải theo `clientMessageId`, và **không xoá** tin nhắn khi thất bại.
5. Abort stream cũ trước khi mở stream mới, và abort khi unmount.

## Related

- [Streaming](./03-streaming.md) — nguồn của `ChatEvent`
- [Chatbot architecture](./01-chatbot-architecture.md) — trạm ②⑮
- [Conversation storage](./05-conversation-storage.md) — sửa & gửi lại, phân nhánh
- [State & render (React)](../../01-web-frontend/02-react/behavior/01-state-render.md)
- [Data fetching architecture](../../01-web-frontend/04-application-engineering/02-data-fetching-architecture.md) — server vs client state
- [Frontend resilience](../../01-web-frontend/04-application-engineering/04-frontend-resilience.md) — 8 trạng thái UI
- [Slow API UX](../../01-web-frontend/04-application-engineering/03-slow-api-ux.md) — latency cảm nhận
- [Provider adapter & DTO](../01-context-and-output/04-provider-adapter-and-dto.md) — `retryable` trong event lỗi
