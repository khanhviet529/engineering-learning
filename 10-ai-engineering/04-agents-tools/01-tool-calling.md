---
level: intermediate
area: ai-engineering
prerequisites:
  - ../01-context-and-output/03-structured-output.md
related:
  - 02-tool-security.md
  - 03-agent-loop.md
---

# Tool calling: model xin, application làm

> Một trợ lý nội bộ được cho tool `runSqlQuery` để "tự tra dữ liệu". Nó hoạt động rất ấn tượng trong demo. Tuần thứ hai, một câu hỏi vô hại — *"khách hàng nào mua nhiều nhất?"* — sinh ra một query `JOIN` bốn bảng không có `LIMIT` trên bảng 80 triệu dòng. Database bị khoá 4 phút. Không ai tấn công gì. Model chỉ làm đúng việc nó được cho phép làm.

## Position

```text
Model  ──"tôi muốn gọi X(args)"──▶  APPLICATION
                                        │ validate · authz · timeout · audit
                                        ▼
                                    thực thi
                                        │
Model  ◀──tool_result──────────────────┘
```

## Problem

Tool calling giải quyết giới hạn cơ bản nhất của LLM: **nó chỉ sinh text.** Nó không đọc được database, không gọi được API, không biết hôm nay là ngày nào.

Nhưng cái tên "tool calling" gây ra một hiểu sai nguy hiểm, và nó là nội dung chính của note này:

> **Model KHÔNG chạy tool. Nó chỉ sinh ra một yêu cầu có cấu trúc rằng nó muốn chạy tool. Application của bạn quyết định có chạy không, và chạy như thế nào.**

Nghĩa là: mọi câu hỏi về bảo mật, quyền, giới hạn, timeout đều thuộc về **code của bạn** — không thuộc về model, và không giải quyết được bằng prompt.

## Mental Model

### Vòng một lượt tool call

```text
① Bạn gửi: messages + DANH SÁCH TOOL (tên, mô tả, JSON schema của args)
        ↓
② Model trả về: finishReason = 'tool_call'
        + toolCalls: [{ id, name, args }]        ← args là TEXT model SINH RA
        ↓
③ ỨNG DỤNG:
        · tool này có trong ALLOWLIST không?
        · args parse được và ĐÚNG SCHEMA không?
        · user NÀY có quyền làm việc này không?
        · có cần XÁC NHẬN của người không?
        · chạy với TIMEOUT và giới hạn tài nguyên
        · GHI AUDIT LOG
        ↓
④ Bạn gửi lại: messages + assistant(toolCalls) + tool_result cho MỖI call
        ↓
⑤ Model dùng kết quả → trả lời, hoặc xin gọi tool tiếp (về ②)
```

Trạm ③ là toàn bộ giá trị công việc của bạn. Bỏ bất kỳ dòng nào trong đó là tạo ra một lỗ hổng.

### Ba quy tắc về hình dạng dữ liệu

**① `args` là output của model, nên nó là dữ liệu không đáng tin.**

```ts
// ❌ tin vào type
const { orderId } = toolCall.args as { orderId: string };

// ✅ args là unknown, phải validate
const parsed = CancelOrderArgs.safeParse(toolCall.args);
if (!parsed.success) {
  return toolError(toolCall.id, 'INVALID_ARGS', parsed.error);
}
```

Và luôn `JSON.parse` chuỗi args — đừng so khớp chuỗi trên nó. Model có thể escape ký tự theo những cách khác nhau (Unicode, dấu `/`), nên xử lý chuỗi thô là nguồn bug ngẫu nhiên.

**② Mọi `tool_call` phải có `tool_result` tương ứng — kể cả khi lỗi.**

```ts
// Tool fail → VẪN trả tool_result, với cờ lỗi
return {
  type: 'tool_result',
  toolCallId: call.id,
  isError: true,
  content: 'Không tìm thấy đơn hàng, hoặc bạn không có quyền xem đơn này.',
};
```

Bỏ một `tool_result` làm nhiều provider trả `400`, và làm hội thoại không hợp lệ ở lượt sau. Đây cũng là lý do cắt context phải cẩn thận — xem [06-context-window-management.md](../02-chatbot-web/06-context-window-management.md).

**③ Nhiều tool call song song → trả TẤT CẢ kết quả trong MỘT message.**

```text
Model trả về 3 tool_use trong một lượt
   ↓ thực thi song song (Promise.all) nếu chúng độc lập
   ↓ gom 3 tool_result vào MỘT user message
```

Chia chúng thành nhiều message làm model **học rằng gọi song song không được hỗ trợ**, và nó sẽ chuyển sang gọi tuần tự — chậm hơn nhiều mà không có lỗi nào báo.

### Nội dung của `tool_result` là context, phải có ngân sách

```text
❌ trả về nguyên object 200KB từ database
   → nhồi hết vào context ở lượt sau
   → tràn cửa sổ, hoặc tốn tiền khủng khiếp

✅ trả về ĐỦ ĐỂ TRẢ LỜI, có trần:
   · chỉ field cần thiết
   · giới hạn số dòng (kèm ghi chú "còn N dòng nữa")
   · trần token cho mỗi tool result
```

```ts
function formatOrders(rows: Order[], limit = 20) {
  const shown = rows.slice(0, limit);
  return {
    orders: shown.map(o => ({ id: o.id, status: o.status, total: o.totalMinorUnits })),
    truncated: rows.length > limit,
    totalCount: rows.length,          // ← model biết còn nữa, không tưởng đây là tất cả
  };
}
```

Trường `truncated` quan trọng: không có nó, model sẽ nói "bạn có 20 đơn hàng" khi thật ra có 340.

### Thiết kế tool: hẹp thắng rộng

Đây là bài học từ sự cố ở đầu note:

```text
❌ TOOL RỘNG — mạnh, và mở ra không gian rủi ro không giới hạn
   runSqlQuery(sql: string)
   callHttpApi(url: string, method: string, body: string)
   executeShell(cmd: string)

✅ TOOL HẸP — nhàm, và có thể suy luận về nó
   getOrderById(orderId: string)
   listMyRecentOrders(limit: number)          ← userId từ SESSION, không từ model
   getRefundPolicy(productCategory: string)
```

Vì sao tool hẹp thắng, ba lý do:

```text
① Bề mặt tấn công hữu hạn và LIỆT KÊ ĐƯỢC
   Với runSqlQuery, bạn phải chứng minh MỌI query có thể là an toàn.
   Với getOrderById, bạn chỉ phải đúng một lần.

② Phân quyền tự nhiên
   Tool hẹp biết chính xác nó cần quyền gì.
   Tool rộng cần "quyền làm mọi thứ nó có thể làm".

③ Model dùng tốt hơn
   Mô tả rõ ràng của một tool hẹp giúp model chọn đúng.
   Tool rộng buộc model tự nghĩ ra cách dùng → nhiều lỗi hơn.
```

Nguyên tắc quan trọng nhất trong thiết kế tool:

> **Tham số định danh người dùng KHÔNG BAO GIỜ đến từ model.** `userId`, `orgId`, `tenantId` lấy từ session ở tầng thực thi. Nếu model cung cấp được `userId`, nó có thể cung cấp `userId` của người khác.

```ts
// ❌ model quyết định nó đang hỏi cho ai
{ name: 'listOrders', args: { userId: 'u_123', limit: 10 } }

// ✅ schema không có userId; tầng thực thi thêm vào từ session
{ name: 'listMyOrders', args: { limit: 10 } }
execute: (args, ctx) => orders.listFor(ctx.userId, args.limit)
```

### Mô tả tool là prompt — và nó tốn token

```text
Mô tả tool đi vào MỌI request, nên nó vừa quan trọng vừa tốn tiền.

Tốt:  "Lấy trạng thái giao hàng của một đơn hàng thuộc người dùng hiện tại.
       Dùng khi người dùng hỏi về tình trạng đơn cụ thể. KHÔNG dùng để
       liệt kê nhiều đơn — dùng listMyOrders cho việc đó."

Tệ:   "Lấy đơn hàng."
```

Mô tả tốt nói cả **khi nào dùng** và **khi nào KHÔNG dùng** — cái thứ hai là cái giảm gọi sai tool nhiều nhất. Và vì tool schema là phần ổn định của prompt, nó nằm trong phần cache được: giữ danh sách tool **có thứ tự xác định**, đừng sinh nó từ một `Set` hay `Object.keys` không đảm bảo thứ tự. Xem [03-ai-caching.md](../07-production/03-ai-caching.md).

### Số lượng tool: ít thắng nhiều

```text
5–10 tool     model chọn tốt
20+ tool      chọn sai nhiều hơn; và tốn token schema mỗi request
50+ tool      cần lọc động: chỉ đưa tool liên quan vào từng request
```

Lọc động đơn giản nhất: nhóm tool theo ngữ cảnh (đơn hàng / thanh toán / hỗ trợ) và chỉ nạp nhóm liên quan. Nhưng chú ý: **thay đổi danh sách tool giữa các request phá prompt cache** — nên chỉ làm khi số tool thật sự lớn.

## Example

Registry + executor — mỗi tool khai báo cả quyền của nó:

```ts
type ToolDef<A> = {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  requiredScope: string;                        // ← quyền, khai báo cùng tool
  needsConfirmation: boolean;                   // ← hành động khó đảo ngược
  timeoutMs: number;
  execute(args: A, ctx: Ctx): Promise<unknown>;
};

export const listMyOrders: ToolDef<{ limit: number }> = {
  name: 'listMyOrders',
  description:
    'Liệt kê đơn hàng gần đây của người dùng hiện tại. Dùng khi họ hỏi ' +
    '"đơn hàng của tôi". KHÔNG dùng để tra một đơn cụ thể — dùng getOrderById.',
  schema: z.object({ limit: z.number().int().min(1).max(20) }),   // max: TRẦN CỨNG
  requiredScope: 'orders:read',
  needsConfirmation: false,
  timeoutMs: 3_000,
  execute: (args, ctx) => orders.listFor(ctx.userId, args.limit),  // userId từ ctx
};
```

Executor — trạm ③, đầy đủ:

```ts
async function executeToolCall(call: ToolCall, ctx: Ctx): Promise<ToolResult> {
  // ① allowlist — tool không có trong registry thì KHÔNG chạy
  const def = registry.get(call.name);
  if (!def) {
    metrics.increment('tool.unknown', { name: call.name });   // model bịa tên tool
    return toolError(call.id, 'UNKNOWN_TOOL');
  }

  // ② validate args — args là dữ liệu không đáng tin
  const parsed = def.schema.safeParse(call.args);
  if (!parsed.success) return toolError(call.id, 'INVALID_ARGS', parsed.error);

  // ③ authz — Ở TẦNG THỰC THI, không ở prompt
  if (!ctx.scopes.includes(def.requiredScope)) {
    audit.log({ action: 'tool.denied', tool: def.name, userId: ctx.userId });
    return toolError(call.id, 'FORBIDDEN');
  }

  // ④ xác nhận của người cho hành động khó đảo ngược
  if (def.needsConfirmation && !ctx.confirmedToolCallIds.includes(call.id)) {
    return { type: 'tool_result', toolCallId: call.id, needsConfirmation: true,
             preview: describeAction(def, parsed.data) };
  }

  // ⑤ chạy có timeout
  const started = Date.now();
  try {
    const out = await withTimeout(def.execute(parsed.data, ctx), def.timeoutMs);

    // ⑥ audit — TRƯỚC khi trả về, và độc lập với bảng message
    audit.log({ action: 'tool.executed', tool: def.name, userId: ctx.userId,
                args: redact(parsed.data), durationMs: Date.now() - started });

    return { type: 'tool_result', toolCallId: call.id,
             content: JSON.stringify(capSize(out, def)) };   // ⑦ trần kích thước
  } catch (e) {
    audit.log({ action: 'tool.failed', tool: def.name, error: String(e) });
    return toolError(call.id, 'TOOL_FAILED');                // vẫn TRẢ tool_result
  }
}
```

Bảy bước, và không bước nào phụ thuộc vào việc model "cư xử tốt".

## Prediction

1. Bạn cho tool `runSqlQuery`. Model sinh query không có `LIMIT` trên bảng lớn. Chuyện gì xảy ra?
2. Tool schema của bạn có `userId: string`. Model điền `userId` của người khác. Có chặn được không?
3. Bạn không trả `tool_result` cho một tool bị lỗi. Lượt sau?
4. Model trả 3 tool call song song, bạn trả 3 `tool_result` trong 3 message riêng. Ảnh hưởng gì?
5. Tool của bạn trả về nguyên 200KB JSON. Chi phí ở lượt tiếp theo?

<details>
<summary>Đáp án</summary>

1. Query chạy thật và khoá database — đúng sự cố đầu note. Không có gì trong "prompt" chặn được; ranh giới phải ở tool. Nếu buộc phải có tool SQL: chỉ đọc, chỉ view đã chuẩn bị, có `LIMIT` cứng, có `statement_timeout`, và chạy bằng role riêng chỉ đọc.
2. **Chỉ chặn được nếu bạn không lấy `userId` từ args.** Nếu tầng thực thi dùng `args.userId`, model vừa vượt quyền. Định danh phải từ session.
3. Nhiều provider trả **`400`** vì hội thoại không hợp lệ; hoặc model chờ kết quả không bao giờ tới. Luôn trả, với `isError: true`.
4. Model **học rằng gọi song song không hoạt động** và chuyển sang tuần tự → chậm hơn nhiều, không có lỗi nào báo. Gom vào một message.
5. 200KB ≈ 50k+ token **mỗi lượt sau đó**, vì nó nằm trong history. Đây là cách làm nổ context và hoá đơn nhanh nhất.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Database bị khoá bởi query của model | tool quá rộng (`runSqlQuery`) |
| Người dùng đọc được dữ liệu của người khác | `userId` đến từ args thay vì session |
| `400` từ provider | thiếu `tool_result`, hoặc tool message mồ côi |
| Model gọi tool tuần tự dù có thể song song | `tool_result` bị chia nhiều message |
| Context nổ sau vài lượt có tool | `tool_result` không có trần kích thước |
| Model gọi sai tool | mô tả không nói "khi nào KHÔNG dùng" |
| Model bịa tên tool | không có allowlist → cần metric `tool.unknown` |
| Model nói "bạn có 20 đơn" khi có 340 | thiếu cờ `truncated` / `totalCount` |
| Tool treo làm cả request treo | thiếu timeout cho từng tool |
| Không biết ai đã làm gì | thiếu audit log |
| Cache hit ratio giảm sau khi thêm tool | danh sách tool không có thứ tự xác định |

## Debugging

```text
1. Log MỌI tool call: name, args (redact), kết quả, thời gian, ai gọi
2. Model gọi sai tool → đọc lại DESCRIPTION của tool đó
3. Model không gọi tool nào → tool có trong request không? mô tả có rõ không?
4. Context nổ → đo token của TỪNG tool_result trong history
5. Đếm tool call mỗi lượt → có lặp lại cùng tool cùng args? (xem note 03)
6. Kiểm mọi tool_call có tool_result tương ứng
```

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Tool hẹp, nhiều | an toàn, phân quyền rõ, model chọn đúng | nhiều code; nhiều token schema |
| Tool rộng, ít | linh hoạt, ít code | bề mặt rủi ro không giới hạn |
| Trần kích thước `tool_result` | context ổn định | model thấy dữ liệu không đầy đủ |
| Chạy song song | nhanh hơn | phải xử lý lỗi từng phần |
| Timeout ngắn cho tool | không treo request | huỷ oan tool chậm-nhưng-đúng |
| Lọc tool động | ít token, chọn đúng hơn | **phá prompt cache** |
| Xác nhận của người | không có hành động ngoài ý muốn | thêm ma sát UX |

## Explain Without Notes

1. Model **xin** gọi tool; application **quyết định và thực thi**.
2. `args` là output của model → validate bằng schema, `JSON.parse`, không tin type.
3. Định danh người dùng **không bao giờ** đến từ model — lấy từ session.
4. Mọi `tool_call` phải có `tool_result`, kể cả khi lỗi; nhiều call song song → một message.
5. Tool hẹp thắng tool rộng, và `tool_result` phải có trần kích thước.

## Related

- [Tool security](./02-tool-security.md) — trạm ③ chi tiết, và các hành động nguy hiểm
- [Agent loop](./03-agent-loop.md) — khi vòng ②–⑤ lặp nhiều lần
- [Structured output](../01-context-and-output/03-structured-output.md) — `args` là unknown
- [Provider adapter & DTO](../01-context-and-output/04-provider-adapter-and-dto.md) — normalize tool call
- [Context window management](../02-chatbot-web/06-context-window-management.md) — tool message mồ côi
- [AI caching](../07-production/03-ai-caching.md) — tool schema là phần ổn định
- [Access control](../../05-cross-cutting/security/04-access-control.md) — authz ở tầng thực thi
- [Injection](../../05-cross-cutting/security/02-injection.md) — vì sao `runSqlQuery` là ý tồi
- [RAG vs fine-tuning](../03-rag/05-rag-vs-fine-tuning.md) — tool thay cho việc dạy model tính toán
