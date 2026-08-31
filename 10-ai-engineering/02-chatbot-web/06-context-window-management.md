---
level: intermediate
area: ai-engineering
prerequisites:
  - 05-conversation-storage.md
  - ../01-context-and-output/02-context-engineering.md
related:
  - 07-memory.md
  - ../07-production/02-cost-and-model-routing.md
---

# Context window management: khi lịch sử dài hơn cửa sổ

> Một trợ lý nội bộ chạy tốt hai tháng. Rồi những người dùng nhiệt tình nhất bắt đầu báo lỗi — chỉ họ, không ai khác. Họ là những người có hội thoại 400 lượt. Ba tuần trước đó, chi phí mỗi lượt chat của họ đã tăng gấp 30 lần so với người dùng mới, vì mỗi lượt gửi lại toàn bộ lịch sử. Không ai để ý, vì dashboard chỉ có chi phí **trung bình**.

## Position

```text
Lịch sử đã lưu (không giới hạn)
        │
        ▼  ← NOTE NÀY: cắt gì, giữ gì, tóm tắt gì
context vừa budget  ──▶ Model
```

## Problem

Hội thoại **chỉ dài ra**. Cửa sổ model thì cố định. Nên mọi chatbot đều gặp đúng một đường cong này:

```text
Lượt 1:     500 token   → nhanh, rẻ
Lượt 20:  12.000 token   → vẫn ổn
Lượt 100: 60.000 token   → chậm rõ, đắt gấp 100 lần lượt đầu
Lượt 400: 240.000 token  → 400 context too large
```

Và điều làm nó khó thấy:

```text
① Chi phí tăng TUYẾN TÍNH theo độ dài history, cho MỖI lượt
   → tổng chi phí một hội thoại tăng theo BÌNH PHƯƠNG số lượt
② Nó chỉ ảnh hưởng người dùng NHIỆT TÌNH NHẤT
③ Trung bình che mất nó — phải xem p95/p99
```

Điểm ① là điểm quan trọng nhất và ít người tính: một hội thoại 100 lượt không tốn 100× lượt đầu, nó tốn khoảng **5000×**, vì lượt thứ n gửi lại n-1 lượt trước.

## Mental Model

### Bốn chiến lược, và cái gì bị mất

```text
① TRUNCATE (cắt cứng)
   giữ N token gần nhất, bỏ phần đầu
   MẤT: phần đầu, hoàn toàn và im lặng
   GIÁ: 0

② SLIDING WINDOW
   giữ N LƯỢT gần nhất (cặp user+assistant)
   MẤT: phần cũ
   GIÁ: 0
   ✓ tốt hơn ① vì không cắt giữa một lượt

③ SUMMARIZE (tóm tắt cuộn)
   tóm tắt phần cũ thành một đoạn, giữ nguyên văn N lượt gần nhất
   MẤT: chi tiết trong phần đã tóm tắt
   GIÁ: một lần gọi model (và lỗi tóm tắt TÍCH LUỸ)

④ RETRIEVE (lấy lại theo nhu cầu)
   coi lịch sử như một corpus; embed và chỉ lấy lượt liên quan
   MẤT: mạch hội thoại tuần tự
   GIÁ: embedding + vector search
```

Chiến lược thực dụng cho hầu hết chatbot là **③ + ②**:

```text
┌─ system prompt ──────────────────────────┐  luôn có, cache được
├─ TÓM TẮT lượt 1..80 ────────────────────┤  ~500 token, lưu trong DB
├─ NGUYÊN VĂN lượt 81..100 ───────────────┤  ~8.000 token, sliding window
└─ câu hỏi hiện tại ──────────────────────┘
```

### Vì sao tóm tắt phải được LƯU, không tính lại

Đây là sai lầm tốn tiền nhất trong note này:

```text
❌ Mỗi lượt: tóm tắt lại toàn bộ phần cũ
   → 2 lần gọi model cho mỗi lượt chat
   → latency tóm tắt CỘNG VÀO TTFT của người dùng
   → chi phí tóm tắt cũng tăng theo độ dài history

✅ Tóm tắt LŨY TIẾN, lưu vào conversation.summary:
   khi (số lượt chưa tóm tắt) > ngưỡng:
       summary_mới = tóm_tắt(summary_cũ + N lượt tiếp theo)
       summary_upto_seq = seq của lượt cuối đã gộp
   → tóm tắt xảy ra MỖI 20 LƯỢT, không phải mỗi lượt
```

Hai cột `summary` và `summary_upto_seq` trong [05-conversation-storage.md](./05-conversation-storage.md) tồn tại chính vì điều này.

Và một tối ưu nữa: **tóm tắt là việc có thể làm bất đồng bộ.** Đẩy nó vào queue sau khi lượt chat kết thúc, không chặn người dùng. Xem [04-message-queues/](../../03-database/04-message-queues/README.md).

### Lỗi tóm tắt tích luỹ — và cách hạn chế

```text
summary_1 = tóm_tắt(lượt 1-20)              ← mất một ít chi tiết
summary_2 = tóm_tắt(summary_1 + lượt 21-40) ← mất thêm, kể cả từ summary_1
summary_3 = tóm_tắt(summary_2 + lượt 41-60) ← lỗi từ summary_1 giờ không sửa được
```

Ba cách hạn chế:

```text
① Tóm tắt CÓ CẤU TRÚC thay vì văn xuôi tự do:
     { goals: [], decisions: [], facts: [], openQuestions: [] }
   → dữ kiện được giữ ở dạng danh sách, khó bị "mờ" hơn văn xuôi

② TÁCH dữ kiện cứng ra khỏi tóm tắt:
     tên, id đơn hàng, số tiền, ngày → lưu thành FACT có nguồn (xem note 07)
     tóm tắt chỉ giữ mạch và ý định

③ Giữ NGUYÊN VĂN lượt đầu tiên
   → lượt đầu thường chứa yêu cầu gốc; mất nó là mất mục tiêu hội thoại
```

Mục ② là ranh giới giữa *tóm tắt* và *memory*. Xem [07-memory.md](./07-memory.md).

### Cắt ở đâu: hai quy tắc bắt buộc

**Quy tắc 1 — cắt theo LƯỢT, không theo message lẻ.**

```text
❌ giữ 20 message cuối
   → có thể bắt đầu bằng một 'assistant' không có 'user' tương ứng
   → hoặc cắt mất tool_result mà tool_call vẫn còn

✅ giữ 10 CẶP (user + assistant, cùng tool call/result của nó)
```

Một `tool_call` không có `tool_result` tương ứng làm nhiều provider trả lỗi `400`. Đây là bug hay gặp khi cắt naïve.

**Quy tắc 2 — không bao giờ cắt system prompt.**

Nghe hiển nhiên, nhưng nó xảy ra khi bạn cắt bằng cách slice một mảng `messages` phẳng đã bao gồm system.

### Đếm token: đếm trước, không đoán

```text
❌ text.length / 4                    → sai, nhất là với tiếng Việt
❌ đếm ở client                        → tokenizer khác nhau
✅ đếm bằng API/tokenizer của provider → dùng cột token_count đã lưu
```

Lưu `token_count` khi ghi message (như trong schema note 05) nghĩa là dựng context không cần đếm lại — chỉ cộng dồn:

```ts
function selectRecent(messages: Msg[], budget: number): Msg[] {
  const out: Msg[] = [];
  let used = 0;
  for (const m of [...messages].reverse()) {        // từ mới nhất về cũ
    const t = m.tokenCount ?? estimate(m.content);
    if (used + t > budget) break;
    out.unshift(m);
    used += t;
  }
  return dropOrphanToolMessages(out);               // ← quy tắc 1
}
```

### Chừa chỗ cho output, và cho sai số

```text
Cửa sổ:                 200.000
− max output tokens:     − 4.000     ← output CHIẾM CHỖ trong cửa sổ
− biên an toàn (~2%):    − 4.000     ← đếm token có sai số; tool schema thay đổi
────────────────────────────────
Ngân sách input:         192.000
```

Biên an toàn là thứ chặn được lớp lỗi "vượt cửa sổ một chút" — thường do tool schema hoặc system prompt đổi mà bạn không tính lại.

### Khi nào dùng cửa sổ lớn thay vì quản lý context

Câu hỏi thật: model có cửa sổ 1M, có nên bỏ hết chuyện này?

```text
Cửa sổ lớn ĐÚNG khi:
  ✓ tài liệu dài phải đọc TOÀN BỘ một lần (hợp đồng, codebase)
  ✓ tác vụ một lần, không lặp lại
  ✓ giá trị mỗi lần gọi cao (phân tích sâu, không phải chat)

Cửa sổ lớn SAI khi:
  ✗ chatbot nhiều lượt        → chi phí tăng bình phương
  ✗ traffic cao               → nhân chi phí với số request
  ✗ cần latency thấp          → TTFT tăng theo input
```

Cửa sổ lớn không xoá bài toán; nó **dời** bài toán từ "vừa không" sang "đắt bao nhiêu và chính xác bao nhiêu".

## Example

```ts
async function buildHistory(convId: string, budget: number) {
  const conv = await conversations.get(convId);
  const recent = await messages.listAfter(convId, conv.summaryUptoSeq ?? 0);

  // ① nếu phần chưa tóm tắt đã vượt ngưỡng → xếp việc tóm tắt (BẤT ĐỒNG BỘ)
  const recentTokens = sum(recent, 'tokenCount');
  if (recentTokens > cfg.summarizeThresholdTokens) {
    await queue.add('summarize-conversation', { convId }, { jobId: `sum:${convId}` });
    // jobId cố định → không xếp trùng nhiều job cho cùng hội thoại
  }

  // ② dựng context với những gì ĐANG có
  const parts: Message[] = [];
  let remaining = budget;

  if (conv.summary) {
    const s = { role: 'system' as const,
                content: `Tóm tắt phần trước của hội thoại:\n${conv.summary}` };
    parts.push(s);
    remaining -= conv.summaryTokens;
  }

  // ③ giữ nguyên văn lượt ĐẦU TIÊN nếu còn chỗ (yêu cầu gốc)
  const first = await messages.firstUserMessage(convId);
  if (first && first.tokenCount < remaining * 0.15) {
    parts.push({ role: 'user', content: `[Yêu cầu ban đầu] ${first.content}` });
    remaining -= first.tokenCount;
  }

  // ④ sliding window theo token, cắt theo lượt
  parts.push(...selectRecent(recent, remaining));

  return parts;
}
```

Bốn quyết định:

```text
① tóm tắt là job bất đồng bộ, jobId cố định → không chặn, không trùng
② dựng context với summary HIỆN CÓ, không chờ job xong
③ giữ yêu cầu gốc — dùng tối đa 15% ngân sách
④ cắt theo token và theo LƯỢT
```

Và metric cần có:

```ts
metrics.histogram('chat.input_tokens', totalInputTokens, { route });
metrics.histogram('chat.turn_index', conv.turnCount);
metrics.increment('chat.context_strategy', { strategy: conv.summary ? 'summary+window' : 'window' });
```

Đo `input_tokens` theo **p95/p99**, không theo trung bình — nếu không bạn sẽ không thấy nhóm người dùng ở đầu note.

## Prediction

1. Hội thoại 100 lượt, mỗi lượt ~600 token. Tổng chi phí input của cả hội thoại xấp xỉ bao nhiêu lần chi phí lượt đầu?
2. Bạn tóm tắt lại toàn bộ phần cũ ở mỗi lượt. Người dùng thấy gì về latency?
3. Bạn giữ "20 message cuối" bằng `messages.slice(-20)`. Lượt đó có tool call. Rủi ro?
4. Bạn dùng sliding window 10 lượt, không tóm tắt. Người dùng nhắc lại điều đã nói ở lượt 3, ở lượt 40. Kết quả?
5. Dashboard của bạn hiện chi phí trung bình mỗi request và nó ổn định. Vấn đề ở đầu note có xuất hiện không?

<details>
<summary>Đáp án</summary>

1. Lượt n gửi ~n×600 token, nên tổng ≈ 600 × (1+2+...+100) = 600 × 5050 ≈ **5050 lần** lượt đầu. Đây là tăng trưởng bình phương, và là lý do quản lý context không phải tối ưu hoá sớm.
2. **TTFT tăng thêm toàn bộ thời gian tóm tắt** (thường 1–3 giây) cho mỗi lượt. Người dùng cảm nhận chatbot chậm dần theo độ dài hội thoại — một triệu chứng rất khó đoán nguyên nhân từ phía họ.
3. Có thể cắt mất `tool_result` trong khi `tool_call` vẫn còn (hoặc ngược lại) → **`400` từ provider**. Phải cắt theo lượt và loại bỏ tool message mồ côi.
4. Model **không thấy** lượt 3 → trả lời như chưa từng nói, hoặc hỏi lại điều đã trả lời. Đây là lý do sliding window đơn thuần không đủ cho hội thoại dài.
5. **Không xuất hiện.** Trung bình bị chi phối bởi đa số hội thoại ngắn. Phải xem p95/p99 của `input_tokens` và chi phí theo user — đúng bài học về đuôi phân bố ở [01-latency-throughput-bottleneck.md](../../05-cross-cutting/performance/01-latency-throughput-bottleneck.md).

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| `400 context too large` chỉ với một số user | không có trần token cho history |
| Chi phí tăng dần theo tuần | gửi lại toàn bộ history; không tóm tắt |
| Chatbot chậm dần theo độ dài hội thoại | input dài → TTFT cao; hoặc tóm tắt mỗi lượt |
| `400` khi có tool call | cắt tạo tool message mồ côi |
| Model "quên" mục tiêu ban đầu | tóm tắt mất yêu cầu gốc; không giữ lượt đầu |
| Model quên chi tiết đã nói 5 lượt trước | sliding window quá hẹp |
| Thông tin sai xuất hiện dai dẳng | lỗi trong tóm tắt, và nó tích luỹ |
| System prompt bị bỏ qua | bị cắt cùng history khi slice mảng phẳng |
| Vượt cửa sổ dù đã tính budget | không chừa chỗ cho output / không có biên an toàn |
| Nhiều job tóm tắt cho cùng hội thoại | không dùng `jobId` cố định |

## Debugging

```text
1. Phân rã token của request lỗi theo khối:
     system / summary / history / docs / tools / question
2. SELECT turn_count, input_tokens FROM ... ORDER BY input_tokens DESC LIMIT 20
   → ai đang ở đuôi phân bố
3. p95/p99 của input_tokens theo route — KHÔNG xem trung bình
4. Kiểm tool message mồ côi: mỗi tool_call có tool_result tương ứng?
5. Đọc summary hiện tại — nó còn giữ yêu cầu gốc không?
6. Xem summary_upto_seq có tiến không → job tóm tắt có chạy không
```

## Trade-offs

| Chiến lược | Chi phí | Giữ được | Dùng khi |
|---|---|---|---|
| Truncate | 0 | phần gần nhất | tác vụ không cần lịch sử |
| Sliding window | 0 | N lượt gần nhất | chat ngắn (< 20 lượt) |
| Summary + window | 1 lần gọi / N lượt | mạch + gần nhất | **mặc định cho chatbot** |
| Summary có cấu trúc | như trên | dữ kiện bền hơn | hội thoại nhiều quyết định |
| Retrieve over history | embedding + search | lượt liên quan | hội thoại rất dài, tra cứu lại |
| Cửa sổ lớn, không quản lý | cao và tăng dần | tất cả | tác vụ một lần, tài liệu dài |

## Explain Without Notes

1. Chi phí một hội thoại tăng theo **bình phương** số lượt, vì mỗi lượt gửi lại toàn bộ.
2. Bốn chiến lược; mặc định đúng cho chatbot là **tóm tắt cuộn + sliding window**.
3. Tóm tắt phải được **lưu** và cập nhật bất đồng bộ — không tính lại mỗi lượt.
4. Cắt theo **lượt**, không theo message; tool message mồ côi gây `400`.
5. Chừa chỗ cho output + biên an toàn; và đo `input_tokens` theo **p99**, không trung bình.

## Related

- [Conversation storage](./05-conversation-storage.md) — `summary`, `summary_upto_seq`, `token_count`
- [Context engineering](../01-context-and-output/02-context-engineering.md) — budget và pipeline chọn lọc
- [Memory](./07-memory.md) — tách dữ kiện cứng ra khỏi tóm tắt
- [Cost & model routing](../07-production/02-cost-and-model-routing.md)
- [Latency engineering](../07-production/04-latency-engineering.md) — input dài → TTFT cao
- [AI caching](../07-production/03-ai-caching.md) — phần ổn định của context
- [Message queues](../../03-database/04-message-queues/README.md) — tóm tắt bất đồng bộ
- [Latency, throughput, bottleneck](../../05-cross-cutting/performance/01-latency-throughput-bottleneck.md) — đuôi phân bố
