---
level: intermediate
area: ai-engineering
prerequisites:
  - 02-tool-security.md
related:
  - ../07-production/02-cost-and-model-routing.md
  - ../05-evaluation/02-rag-and-agent-evaluation.md
---

# Agent loop và điều kiện dừng

> Một agent "tự động xử lý ticket" được bật vào chiều thứ Sáu. Sáng thứ Hai, hoá đơn là 3.100 USD. Nó gặp một ticket có tài liệu đính kèm không đọc được, gọi tool `readAttachment` thất bại, thử lại, thất bại, **thử lại cùng tool với cùng tham số 11.000 lần** trong 62 giờ. Không có lỗi nào trong log ứng dụng — mọi lượt đều "thành công": model xin gọi tool, tool trả lỗi, model thử lại. Không ai viết điều kiện dừng.

## Position

```text
Một lượt tool call (note 01)
        │  lặp lại
        ▼
   AGENT LOOP  ← note này: vòng lặp, ngân sách, và điều kiện dừng
```

## Problem

"Agent" là từ bị thần bí hoá nhiều nhất trong toàn bộ chủ đề AI. Định nghĩa thẳng:

> **Agent = model + vòng lặp + tool + state + policy.**

Không có gì hơn. Nó không "suy nghĩ", không "tự chủ" theo nghĩa nào ngoài việc **bạn viết một vòng `while` và để model quyết định bước tiếp theo**.

Và chính vì nó là một vòng `while` do bạn viết, mọi vấn đề của nó là vấn đề kỹ thuật quen thuộc:

```text
① Vòng lặp không có điều kiện dừng    → như while(true) — nhưng TỐN TIỀN THẬT
② Không tiến triển mà vẫn lặp          → agent không biết nó đang lặp
③ State ở đâu khi có nhiều instance?   → cùng bài toán stateless đã biết
④ Lỗi tích luỹ qua nhiều bước          → bước 7 sai vì bước 3 sai
⑤ Context phình theo mỗi bước          → tool result cộng dồn
```

## Mental Model

### Vòng lặp, ở dạng trần trụi nhất

```text
state = { messages, budget, stepCount }

while (true) {
  ① kiểm ĐIỀU KIỆN DỪNG  ← TRƯỚC khi gọi model, không phải sau
  ② gọi model với state.messages
  ③ nếu finishReason ≠ 'tool_call' → xong, trả lời
  ④ với mỗi tool call: validate → authz → execute → tool_result
  ⑤ append vào messages
  ⑥ trừ ngân sách, tăng stepCount
  ⑦ kiểm KHÔNG TIẾN TRIỂN
}
```

Bước ① và bước ⑦ là hai bước phân biệt agent chạy được với agent ở đầu note.

Kiểm điều kiện dừng **trước** khi gọi model, vì gọi model là chỗ tốn tiền. Kiểm sau nghĩa là bạn đã trả tiền cho lượt vượt hạn.

### Sáu điều kiện dừng — cần TẤT CẢ

Không phải chọn một. Mỗi cái chặn một chế độ hỏng khác nhau:

```text
① MAX STEPS          vòng lặp tối đa N (thường 5–15)
② MAX TOOL CALLS     tổng số tool call
③ MAX TOKENS         tổng input+output đã dùng
④ MAX TIME           thời gian tường (wall clock)
⑤ MAX COST           USD — tính từ usage thật, không ước lượng
⑥ NO PROGRESS        không tiến triển  ← cái chặn được sự cố đầu note
```

Điều kiện ⑥ là điều kiện duy nhất không phải một con số, và là điều kiện quan trọng nhất.

### Điều kiện ⑥: phát hiện không tiến triển

Sự cố ở đầu note không bị chặn bởi ①–⑤ nếu đặt lỏng, vì mỗi lượt riêng lẻ đều "hợp lệ". Cần phát hiện **mẫu lặp**:

```ts
function detectNoProgress(state: AgentState): string | null {
  const calls = state.toolCalls;

  // A. cùng tool + cùng args, lặp lại
  const sig = (c: ToolCall) => `${c.name}:${stableStringify(c.args)}`;
  const last = calls.slice(-3).map(sig);
  if (last.length === 3 && new Set(last).size === 1) {
    return 'REPEATED_IDENTICAL_TOOL_CALL';           // ← sự cố đầu note
  }

  // B. cùng tool thất bại N lần liên tiếp (args có thể khác)
  const recentFails = calls.slice(-4).filter(c => c.failed);
  if (recentFails.length === 4) return 'REPEATED_TOOL_FAILURE';

  // C. chu kỳ: A → B → A → B
  if (last.length >= 4 && last[0] === last[2] && last[1] === last[3]) {
    return 'TOOL_CALL_CYCLE';
  }

  // D. không có tool call mới VÀ không có text mới trong 2 lượt
  if (state.stepsWithoutNewInfo >= 2) return 'NO_NEW_INFORMATION';

  return null;
}
```

Mẫu A là mẫu rẻ nhất để phát hiện và chặn được phần lớn thảm hoạ. Nếu chỉ làm được một thứ trong note này, làm mẫu A.

### Ngân sách phải tính từ usage thật

```text
❌ ước lượng: "mỗi bước ~2000 token" → sai khi context phình
✅ cộng dồn usage THẬT sau mỗi lượt
```

```ts
state.tokensUsed += res.usage.inputTokens + res.usage.outputTokens;
state.costUsd += price(cfg.model, res.usage);

if (state.costUsd > cfg.maxCostPerRunUsd) {
  return stop('COST_BUDGET_EXCEEDED', state);
}
```

Chú ý điều làm agent đắt hơn dự kiến: **input token lặp lại ở mỗi bước**. Bước 8 gửi lại toàn bộ messages của bước 1–7, kể cả mọi `tool_result`. Đây là tăng trưởng bình phương, đúng như hội thoại dài ở [06-context-window-management.md](../02-chatbot-web/06-context-window-management.md).

```text
Bước 1:   2.000 token input
Bước 5:  18.000 token input
Bước 10: 55.000 token input
→ tổng của 10 bước ≈ 250.000 input token, không phải 20.000
```

Hai cách giảm:

```text
① Trần kích thước tool_result (note 01) — cái này quan trọng nhất
② Nén/bỏ tool_result cũ khi chúng không còn cần
   (một số provider có cơ chế xoá tool result cũ khỏi context)
```

### State phải ở ngoài process

```text
❌ state trong biến local của một request handler
   → agent chạy 3 phút; request timeout; instance restart giữa run
   → mất toàn bộ tiến trình đã trả tiền

✅ agent run là một RECORD trong database + một JOB trong queue
```

```sql
CREATE TABLE agent_run (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL,
  org_id       UUID NOT NULL,
  goal         TEXT NOT NULL,
  status       TEXT NOT NULL,      -- 'running'|'completed'|'stopped'|'failed'|'needs_input'
  stop_reason  TEXT,
  step_count   INT NOT NULL DEFAULT 0,
  tokens_used  INT NOT NULL DEFAULT 0,
  cost_usd     NUMERIC(10,4) NOT NULL DEFAULT 0,
  state        JSONB NOT NULL,     -- messages + toolCalls
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at  TIMESTAMPTZ NOT NULL  -- ④ max time, cưỡng chế được từ bên ngoài
);
```

Hai lợi ích ngoài việc chịu được restart:

```text
① Job dọn: mọi run 'running' quá deadline_at → đánh dấu stopped
   (đây là lớp phòng thủ cuối, chặn run bị kẹt vĩnh viễn)
② Trạng thái 'needs_input' cho human-in-the-loop
```

Và **một lock** cho mỗi run, để hai worker không cùng chạy một run:

```ts
const lock = await redis.acquireLock(`agent:${runId}`, { ttlMs: 60_000 });
if (!lock) return;                      // worker khác đang chạy
```

Đây đúng distributed lock ở [02-rate-limit-locking.md](../../03-database/02-redis/02-rate-limit-locking.md).

### Agent không phải mặc định — nó là lựa chọn cuối

Đây là phần thực dụng nhất của note:

```text
Tác vụ của bạn thuộc loại nào?

① MỘT LỜI GỌI          "phân loại ticket này"
   → không cần vòng lặp

② PIPELINE CỐ ĐỊNH     "đọc ticket → phân loại → tra KB → viết trả lời"
   → BẠN viết các bước. Model làm từng bước.
   → dự đoán được, test được, debug được, chi phí biết trước
   ← ĐÂY LÀ CÁI 80% TRƯỜNG HỢP CẦN

③ AGENT (vòng lặp mở)  "xử lý ticket này, làm gì cần thiết"
   → chỉ khi thứ tự các bước KHÔNG BIẾT TRƯỚC
```

> Nếu bạn viết được sơ đồ các bước, **hãy viết code theo sơ đồ đó**, đừng để model tự tìm đường. Pipeline cố định rẻ hơn, nhanh hơn, và debug được — agent chỉ đáng khi bạn *không thể* biết trước thứ tự.

Rất nhiều "agent" trong thực tế là pipeline được viết dưới dạng vòng lặp một cách không cần thiết, và trả giá bằng chi phí không dự đoán được.

## Example

```ts
async function runAgent(runId: string): Promise<AgentResult> {
  const lock = await redis.acquireLock(`agent:${runId}`, { ttlMs: 60_000 });
  if (!lock) return { skipped: true };

  try {
    const run = await agentRuns.load(runId);

    while (true) {
      // ① điều kiện dừng — TRƯỚC khi gọi model
      const stop = checkStopConditions(run);
      if (stop) return await finish(run, 'stopped', stop);

      // ② gọi model
      const res = await provider.chat({
        messages: run.state.messages,
        tools: registry.schemasFor(run.allowedTools),   // allowlist theo run
        maxOutputTokens: cfg.maxOutput,
      });

      run.tokensUsed += res.usage.inputTokens + res.usage.outputTokens;
      run.costUsd += price(cfg.model, res.usage);
      run.stepCount += 1;

      // ③ xong?
      if (res.finishReason !== 'tool_call') {
        return await finish(run, 'completed', null, res.text);
      }

      // ④ thực thi tool — song song nếu độc lập, mọi lớp bảo mật của note 02
      const results = await Promise.all(
        res.toolCalls.map(c => executeToolCall(c, run.ctx)),
      );

      // hành động cần xác nhận → DỪNG và chờ người
      if (results.some(r => r.needsConfirmation)) {
        return await pause(run, 'needs_input', results);
      }

      // ⑤ append — cả assistant lẫn TẤT CẢ tool_result trong MỘT message
      run.state.messages.push(
        { role: 'assistant', content: res.raw },
        { role: 'user', content: results },
      );
      run.state.toolCalls.push(...res.toolCalls.map((c, i) => ({
        ...c, failed: results[i].isError === true,
      })));

      // ⑦ không tiến triển?
      const noProgress = detectNoProgress(run.state);
      if (noProgress) return await finish(run, 'stopped', noProgress);

      await agentRuns.save(run);          // ← lưu SAU MỖI BƯỚC, chịu được restart
      await lock.extend(60_000);
    }
  } finally {
    await lock.release();
  }
}

function checkStopConditions(run: AgentRun): string | null {
  if (run.stepCount >= cfg.maxSteps) return 'MAX_STEPS';
  if (run.state.toolCalls.length >= cfg.maxToolCalls) return 'MAX_TOOL_CALLS';
  if (run.tokensUsed >= cfg.maxTokens) return 'MAX_TOKENS';
  if (Date.now() > +run.deadlineAt) return 'DEADLINE';
  if (run.costUsd >= cfg.maxCostUsd) return 'MAX_COST';
  return null;
}
```

Ba dòng đáng chú ý: `agentRuns.save(run)` **sau mỗi bước**, `lock.extend` để lock không hết hạn giữa run dài, và `finish()` luôn ghi `stop_reason` — nếu không bạn không biết vì sao run dừng.

## Prediction

1. Bạn đặt `maxSteps = 20` nhưng không có phát hiện lặp. Tool fail liên tục. Chi phí?
2. Agent chạy 3 phút trong một HTTP request. Load balancer có timeout 60 giây. Kết quả?
3. Agent state trong RAM. Deploy giữa lúc 40 run đang chạy. Mất gì?
4. Bạn cộng dồn ước lượng "2000 token/bước" thay vì usage thật. Ở bước 10, ước lượng lệch bao nhiêu?
5. Hai worker cùng nhận job cho một `runId`. Không có lock. Chuyện gì xảy ra?

<details>
<summary>Đáp án</summary>

1. Nó dừng ở 20 bước — nhưng **mỗi run** tốn 20 lượt vô ích, và nếu có 500 ticket thì đó là 10.000 lượt vô ích. `maxSteps` giới hạn *thảm hoạ mỗi run*, không chặn *lãng phí hệ thống*. Cần phát hiện lặp.
2. LB **cắt kết nối ở 60 giây**; nếu state ở RAM thì mất tiến trình; và có thể không ai biết run đã dừng. Agent dài phải là job.
3. **Toàn bộ 40 run** — và bạn đã trả tiền cho chúng. Lưu state sau mỗi bước.
4. Rất nhiều. Thực tế bước 10 có thể là 55k token input; ước lượng nói 2k. Bạn vượt ngân sách **hàng chục lần** mà tưởng vẫn trong hạn.
5. Cả hai chạy song song trên cùng state → tool có side effect **chạy hai lần** (gửi email hai lần, hoàn tiền hai lần), và state ghi đè lẫn nhau.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Chi phí khổng lồ, không có lỗi trong log | thiếu phát hiện không tiến triển |
| Agent gọi cùng tool cùng args nhiều lần | mẫu A không được phát hiện |
| Agent chạy A→B→A→B mãi | mẫu C (chu kỳ) không được phát hiện |
| `400 context too large` ở bước 8–12 | tool_result không có trần; context phình |
| Mất tiến trình khi deploy | state trong RAM |
| Tool có side effect chạy hai lần | thiếu lock cho run; hoặc thiếu idempotency |
| Run kẹt `running` mãi | thiếu `deadline_at` + job dọn |
| Không biết vì sao agent dừng | không ghi `stop_reason` |
| Bước 7 sai vì bước 3 sai | lỗi tích luỹ; không có kiểm tra trung gian |
| Agent làm hành động ngoài ý muốn | thiếu allowlist tool theo run; thiếu confirmation |
| Chi phí vượt hạn dù có `maxTokens` | dùng ước lượng thay vì usage thật |

## Debugging

```text
1. SELECT stop_reason, count(*) FROM agent_run GROUP BY 1
   → run dừng vì gì? Nhiều 'MAX_STEPS' = agent không hoàn thành việc
2. Với run đắt nhất: in ra chuỗi (tool, args) theo bước
   → thấy ngay mẫu lặp
3. Đồ thị tokens_used theo step_count → tăng bình phương?
4. SELECT * FROM agent_run WHERE status='running'
   AND updated_at < now() - interval '10 minutes'  → run kẹt
5. cost_usd theo run: p50 vs p99 → đuôi phân bố ở đâu
6. Đếm tool call thất bại / tổng tool call theo tên tool
```

Bước 2 là bước cho câu trả lời nhanh nhất, và nó cần bạn đã lưu `toolCalls` trong state.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Pipeline cố định | dự đoán được, rẻ, test được | không xử lý được việc ngoài sơ đồ |
| Agent vòng lặp mở | xử lý được việc không biết trước | chi phí biến thiên; khó test; khó debug |
| `maxSteps` chặt | chi phí có trần | agent bỏ dở việc phức tạp |
| `maxSteps` lỏng | hoàn thành việc dài | rủi ro chi phí |
| Phát hiện không tiến triển | chặn thảm hoạ | có thể dừng sớm một run đang tiến triển chậm |
| State trong DB + queue | chịu restart, quan sát được | phức tạp hơn; thêm queue |
| Xác nhận cho tool W!/$ | an toàn | agent không chạy tự động hết được |
| Trần chi phí mỗi run | hoá đơn có trần | run đắt hợp lệ bị cắt |

## Explain Without Notes

1. Agent = model + vòng lặp + tool + state + policy. Không có gì thần bí.
2. **Sáu** điều kiện dừng, cần tất cả; kiểm **trước** khi gọi model.
3. Điều kiện quan trọng nhất là **không tiến triển** — lặp cùng tool cùng args.
4. Ngân sách tính từ **usage thật**; input token tăng theo bình phương số bước.
5. State ở DB + queue + lock, không ở RAM. Và pipeline cố định thắng agent trong 80% trường hợp.

## Related

- [Tool calling](./01-tool-calling.md) — một lượt trong vòng lặp
- [Tool security](./02-tool-security.md) — mỗi bước phải qua bảy lớp
- [Context window management](../02-chatbot-web/06-context-window-management.md) — context phình theo bước
- [Cost & model routing](../07-production/02-cost-and-model-routing.md) — trần chi phí
- [Human in the loop](../07-production/07-human-in-the-loop.md) — trạng thái `needs_input`
- [RAG & agent evaluation](../05-evaluation/02-rag-and-agent-evaluation.md) — đo agent thế nào
- [AI observability](../07-production/01-ai-observability.md) — trace nhiều bước
- [Message queues](../../03-database/04-message-queues/README.md) — agent run là job
- [Rate limit & locking (Redis)](../../03-database/02-redis/02-rate-limit-locking.md) — lock cho run
- [Chạy ở đâu](../../04-infrastructure/05-platforms/01-where-to-run.md) — vì sao state không ở RAM
