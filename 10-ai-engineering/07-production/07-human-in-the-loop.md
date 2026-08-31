---
level: intermediate
area: ai-engineering
prerequisites:
  - ../04-agents-tools/02-tool-security.md
related:
  - 06-versioning-and-release.md
  - ../05-evaluation/01-evaluating-ai-features.md
---

# Human in the loop: AI đề xuất, người quyết định

> Một hệ thống tự động phân loại và trả lời email khách hàng được bật hoàn toàn tự động vì độ chính xác đo được là 94%. Trong 6% còn lại có một email từ luật sư của khách hàng về một tranh chấp. Nó được phân loại là "câu hỏi chung" và nhận một câu trả lời mẫu về chính sách đổi hàng. Chi phí của 6% đó không tỉ lệ với 6% — nó tỉ lệ với **hậu quả tệ nhất trong 6% đó**.

## Position

```text
AI đề xuất  ──▶  NGƯỜI xác nhận  ──▶  Hệ thống thực thi
                      ▲
        note này: khi nào cần bước giữa, và thiết kế nó ra sao
```

## Problem

Câu hỏi "có nên để AI tự động làm việc này" thường được trả lời bằng độ chính xác. Đó là cách trả lời sai:

```text
❌ "94% chính xác → đủ tốt để tự động"
✅ "hậu quả của 6% sai là gì, và đảo ngược được không?"
```

Hai tình huống cùng độ chính xác 94%, quyết định hoàn toàn khác:

```text
Gợi ý tag cho một ticket        6% sai → người dùng sửa tag. Không sao.
Hoàn tiền tự động               6% sai → tiền đã ra khỏi hệ thống.
```

> Ngưỡng tự động hoá không phụ thuộc độ chính xác. Nó phụ thuộc **chi phí của sai × khả năng đảo ngược**.

## Mental Model

### Ma trận quyết định

```text
                    ĐẢO NGƯỢC ĐƯỢC DỄ        KHÓ / KHÔNG ĐẢO NGƯỢC
                 ┌───────────────────────┬──────────────────────────┐
HẬU QUẢ THẤP     │ TỰ ĐỘNG HOÀN TOÀN     │ TỰ ĐỘNG + THÔNG BÁO      │
                 │ gợi ý tag, tóm tắt,   │ + có nút Undo            │
                 │ soạn nháp             │ gửi tin nội bộ           │
                 ├───────────────────────┼──────────────────────────┤
HẬU QUẢ CAO      │ TỰ ĐỘNG + XEM SAU     │ NGƯỜI XÁC NHẬN TRƯỚC     │
                 │ (audit + spot check)  │ hoàn tiền, gửi email KH, │
                 │ cập nhật trạng thái   │ xoá dữ liệu, thay đổi     │
                 │ nội bộ                │ quyền, thanh toán        │
                 └───────────────────────┴──────────────────────────┘
```

Ô dưới-phải là ô bắt buộc có người. Không có ngoại lệ dựa trên độ chính xác.

### Bốn mức tự động hoá

```text
① SUGGEST      AI đề xuất, người phải chủ động chấp nhận
               → ma sát cao nhất, an toàn nhất
               → tốt cho: soạn email, gợi ý phân loại

② CONFIRM      AI chuẩn bị hành động, người bấm xác nhận
               → hành động cụ thể, người thấy PREVIEW trước
               → tốt cho: hoàn tiền, xoá, gửi ra ngoài

③ AUTO + UNDO  AI làm, thông báo, có cửa sổ hoàn tác
               → tốt cho: hậu quả thấp nhưng đáng biết
               → cần: hành động thật sự undo được

④ AUTO         AI làm, chỉ ghi audit
               → tốt cho: hậu quả thấp, đảo ngược dễ, khối lượng lớn
```

Chọn mức **theo từng hành động**, không theo tính năng. Cùng một trợ lý có thể ở mức ④ cho `getOrder` và mức ② cho `refundOrder`.

### Route theo confidence — và giới hạn của nó

```text
confidence cao  → tự động
confidence thấp → người xem
```

Nghe hợp lý, nhưng có một giới hạn phải biết:

> **`confidence` do model tự khai không phải xác suất đã hiệu chỉnh.** Nó là một con số model sinh ra, và model có thể **rất tự tin khi sai** — đặc biệt với ca ngoài phân bố huấn luyện.

Nên dùng nó đúng cách:

```text
✅ DÙNG ĐỂ XẾP THỨ TỰ    ca nào người xem trước
✅ DÙNG KÈM tín hiệu khác  không tìm thấy tài liệu · output không hợp lệ ·
                           giá trị lớn · khách hàng VIP · từ khoá rủi ro
❌ DÙNG LÀM ngưỡng duy nhất quyết định tự động hay không
```

Và **hiệu chỉnh nó**: lấy 200 ca đã có kết quả thật, xem tỉ lệ đúng ở từng khoảng confidence.

```text
confidence 0.9–1.0  → đúng 96%   ← ngưỡng dùng được
confidence 0.7–0.9  → đúng 81%
confidence 0.5–0.7  → đúng 62%   ← "0.6" không nghĩa là 60%
```

Bảng đó là thứ biến `confidence` từ một con số vô nghĩa thành một công cụ route được.

### Tín hiệu tốt hơn confidence

```text
Chuyển cho người khi:
  □ RAG không tìm thấy tài liệu liên quan      ← tín hiệu mạnh nhất
  □ output không đúng schema sau retry
  □ giá trị nghiệp vụ vượt ngưỡng (tiền, số lượng)
  □ khách hàng thuộc nhóm cần cẩn thận (VIP, đang tranh chấp)
  □ nội dung khớp từ khoá rủi ro (luật sư, khiếu nại, hoàn tiền, dữ liệu cá nhân)
  □ agent dừng vì MAX_STEPS hoặc NO_PROGRESS
  □ người dùng đã Regenerate ≥ 2 lần
```

Dòng "từ khoá rủi ro" là dòng chặn được sự cố ở đầu note — và nó là một `if` đơn giản, không cần AI:

```ts
const RISK_PATTERNS = [/luật sư/i, /khiếu nại/i, /kiện/i, /GDPR/i, /báo chí/i];
if (RISK_PATTERNS.some(r => r.test(email.body))) {
  return escalateToHuman(email, 'RISK_KEYWORD');
}
```

Một danh sách regex không thay thế được AI, nhưng nó là **lớp an toàn không phụ thuộc AI** — và đó chính là giá trị của nó.

### Thiết kế bước xác nhận: bốn quy tắc

```text
① PREVIEW DO CODE SINH, từ dữ liệu thật
   ❌ model viết "Tôi sẽ hoàn 500.000đ cho đơn #4471"
   ✅ code đọc đơn hàng và render:
      "Hoàn 12.400.000đ cho đơn #8823 (Nguyễn A, giao 12/03)"
   → nếu model viết mô tả, nó có thể mô tả A và làm B

② HIỆN CÁI SẼ XẢY RA, không hiện tên hàm
   ❌ "Chạy refundOrder({orderId: '...'})?"
   ✅ "Hoàn 12.400.000đ về thẻ ****4242. Không thể hoàn tác."

③ MẶC ĐỊNH LÀ TỪ CHỐI
   không auto-focus nút Xác nhận; không cho Enter xác nhận
   hành động lớn → yêu cầu gõ lại số tiền, hoặc bấm hai bước

④ HẾT HẠN
   xác nhận sau 10 phút → yêu cầu tạo lại
   (dữ liệu có thể đã đổi; trạng thái đơn có thể đã khác)
```

Quy tắc ④ hay bị bỏ và gây lỗi thật: người dùng để tab mở, bấm xác nhận sau một giờ, và đơn hàng đã ở trạng thái khác.

### Vòng phản hồi: người sửa gì là dữ liệu quý nhất

Đây là lợi ích lớn nhất và ít được khai thác nhất của human-in-the-loop:

```text
Người xem → sửa / từ chối → GHI LẠI CÁI HỌ SỬA
                                    │
                                    ├──▶ golden dataset (ca thật, có đáp án đúng)
                                    ├──▶ metric: tỉ lệ sửa theo loại
                                    └──▶ biết nên nâng/hạ mức tự động ở đâu
```

```sql
CREATE TABLE ai_review (
  id            UUID PRIMARY KEY,
  request_id    TEXT NOT NULL,
  reviewer_id   UUID NOT NULL,
  ai_output     JSONB NOT NULL,
  final_output  JSONB NOT NULL,
  decision      TEXT NOT NULL,     -- 'accepted'|'edited'|'rejected'
  reason        TEXT,
  reviewed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Bảng này biến công việc review — vốn là chi phí — thành **nguồn dữ liệu eval liên tục và miễn phí**. Mỗi dòng `edited` hoặc `rejected` là một ca golden với đáp án do người xác nhận.

Và nó cho bạn con số để điều chỉnh mức tự động hoá:

```text
Tỉ lệ 'accepted' của một loại hành động:
   > 95% trong 3 tháng, không có sai nghiêm trọng  → cân nhắc nâng lên AUTO+UNDO
   < 80%                                            → hạ xuống SUGGEST, và điều tra
```

### Chi phí của người: phải tính vào

```text
Route A: tự động 100%, chính xác 94%
  → 6% sai. Chi phí: xử lý sự cố + rủi ro + niềm tin khách hàng

Route B: tự động 70%, 30% người xem
  → chi phí người thật, ĐO ĐƯỢC, dự đoán được
```

Cách so sánh đúng: **`cost per correctly completed task`, gồm cả chi phí người**. Route A có thể rẻ hơn về API và đắt hơn nhiều về tổng — nhất là khi trong 6% có một ca như email của luật sư.

## Example

```ts
async function handleIncomingEmail(email: Email): Promise<Outcome> {
  // ① lớp an toàn KHÔNG phụ thuộc AI — chạy trước
  if (RISK_PATTERNS.some(r => r.test(email.body))) {
    return escalate(email, 'RISK_KEYWORD');
  }
  if (email.from.isVip || email.thread.hasOpenDispute) {
    return escalate(email, 'SENSITIVE_ACCOUNT');
  }

  // ② AI phân loại + soạn nháp
  const result = await classifyAndDraft(email);

  // ③ tín hiệu chuyển người — nhiều tín hiệu, không chỉ confidence
  const reasons: string[] = [];
  if (!result.foundRelevantDocs) reasons.push('NO_DOCS');
  if (result.confidence < cfg.minConfidence) reasons.push('LOW_CONFIDENCE');
  if (result.suggestsAction && result.actionValue > cfg.autoActionCap) {
    reasons.push('HIGH_VALUE_ACTION');
  }
  if (reasons.length > 0) return escalate(email, reasons.join(','), result.draft);

  // ④ mức tự động theo LOẠI hành động, không theo tính năng
  const level = automationLevelFor(result.category);
  switch (level) {
    case 'AUTO':
      await sendReply(result.draft);
      await audit.log({ action: 'email.auto_replied', requestId: result.requestId });
      return { kind: 'auto' };

    case 'AUTO_UNDO':
      await scheduleSend(result.draft, { delayMs: cfg.undoWindowMs });   // cửa sổ hoàn tác
      await notifyTeam(result);
      return { kind: 'auto-undo' };

    case 'CONFIRM':
      return queueForConfirmation(result);            // preview do CODE sinh

    case 'SUGGEST':
      return queueAsDraft(result);
  }
}
```

Thứ tự trong hàm trên là có chủ đích: **lớp an toàn không phụ thuộc AI chạy trước AI.** Nếu bạn đặt nó sau, một lỗi trong phân loại có thể bỏ qua nó.

Và mức `AUTO_UNDO` với `scheduleSend` là một mẫu đáng biết: gửi có **độ trễ**, cho phép hoàn tác thật trong cửa sổ đó. Nó biến một hành động không đảo ngược được thành một hành động đảo ngược được — bằng một quyết định thiết kế, không bằng công nghệ.

## Prediction

1. Độ chính xác 94%. Trong 6% sai có một ca hậu quả rất lớn. Quyết định tự động hoá dựa vào con số nào?
2. Bạn dùng `confidence < 0.6` làm ngưỡng duy nhất. Model rất tự tin nhưng sai. Chặn được không?
3. Preview cho xác nhận do model viết. Rủi ro cụ thể?
4. Xác nhận không hết hạn. Người dùng bấm sau một giờ. Rủi ro?
5. Bạn không ghi lại cái người review sửa. Mất gì?
6. Bạn tính chi phí AI mỗi request nhưng không tính chi phí người. So sánh route nào sai?

<details>
<summary>Đáp án</summary>

1. Không phải 94%, mà **hậu quả tệ nhất trong 6%** và khả năng đảo ngược. Đó là sự cố đầu note.
2. **Không.** Confidence do model tự khai; nó có thể cao khi sai, nhất là ca ngoài phân bố. Cần thêm tín hiệu: không tìm thấy tài liệu, giá trị lớn, từ khoá rủi ro.
3. Model có thể **mô tả một việc và gọi tool làm việc khác**. Người dùng xác nhận cái họ đọc, không phải cái sẽ chạy.
4. Trạng thái đã đổi — đơn có thể đã bị huỷ, đã hoàn, hoặc giá trị đã khác. Xác nhận phải hết hạn.
5. Mất **nguồn golden dataset tốt nhất** (ca thật + đáp án do người xác nhận), và mất cơ sở để biết nên nâng/hạ mức tự động ở đâu.
6. So sánh **"tự động nhiều" vs "có người xem"** sẽ luôn nghiêng về tự động — trong khi tổng chi phí có thể ngược lại. So bằng `cost per correctly completed task`, gồm chi phí người.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Một ca sai gây hậu quả lớn | quyết định tự động dựa trên độ chính xác trung bình |
| Model tự tin nhưng sai, vẫn tự động | dùng confidence làm ngưỡng duy nhất |
| Người dùng xác nhận việc A, việc B xảy ra | preview do model sinh |
| Xác nhận trên dữ liệu đã cũ | xác nhận không hết hạn |
| Người review bấm Chấp nhận theo phản xạ | mặc định là chấp nhận; auto-focus nút Xác nhận |
| Không biết nên nâng mức tự động ở đâu | không ghi `ai_review` |
| Không cải thiện được sau nhiều tháng | không dùng dữ liệu review làm golden dataset |
| Hàng đợi review tồn đọng | tỉ lệ chuyển người quá cao; hoặc thiếu người |
| Ca rủi ro không được chuyển người | lớp an toàn chạy **sau** AI, hoặc không có |

Dòng "bấm theo phản xạ" là chế độ hỏng của con người và nó thật: nếu 98% ca đều đúng, người review sẽ bấm Chấp nhận mà không đọc. Cách giảm: xếp ca **có tín hiệu rủi ro lên đầu**, và với hành động lớn thì yêu cầu một bước chủ động (gõ lại số tiền).

## Debugging

```text
1. Với mỗi hành động: mức tự động là gì, và ai quyết định mức đó?
2. Lớp an toàn (từ khoá, VIP, giá trị) chạy TRƯỚC hay SAU AI?
3. Tỉ lệ accepted/edited/rejected theo loại → mức nào đặt sai?
4. Hiệu chỉnh confidence: 200 ca, tỉ lệ đúng theo khoảng
5. Hàng đợi review: tồn đọng bao nhiêu? thời gian chờ trung bình?
6. Có ca nào hậu quả cao đang ở mức AUTO không?
```

Bước 6 nên là một rà soát định kỳ: **mức tự động có xu hướng trôi lên** theo thời gian khi người ta muốn giảm việc thủ công.

## Trade-offs

| Mức | Rủi ro | Chi phí người | Trải nghiệm |
|---|---|---|---|
| SUGGEST | thấp nhất | cao nhất | chậm, nhưng người kiểm soát |
| CONFIRM | thấp | trung | thêm một bước, minh bạch |
| AUTO + UNDO | trung | thấp | nhanh, có lối thoát |
| AUTO | cao nhất | thấp nhất | nhanh nhất |

| Quyết định | Được | Mất |
|---|---|---|
| Lớp an toàn bằng regex | không phụ thuộc AI | thiếu ca; nhiều dương tính giả |
| Route theo nhiều tín hiệu | bắt được nhiều ca rủi ro | tỉ lệ chuyển người cao hơn |
| Cửa sổ hoàn tác | biến không-đảo-ngược thành đảo-ngược | hành động chậm hơn |
| Ghi `ai_review` | golden dataset miễn phí | thêm một bảng (rẻ) |
| Hiệu chỉnh confidence | ngưỡng có nghĩa | công thủ công một lần |

## Explain Without Notes

1. Ngưỡng tự động hoá phụ thuộc **hậu quả × khả năng đảo ngược**, không phụ thuộc độ chính xác.
2. Bốn mức: SUGGEST · CONFIRM · AUTO+UNDO · AUTO — chọn **theo từng hành động**.
3. `confidence` do model tự khai không phải xác suất — dùng để xếp thứ tự, kèm tín hiệu khác, và phải hiệu chỉnh.
4. Preview do **code** sinh từ dữ liệu thật; xác nhận phải hết hạn; mặc định là từ chối.
5. Ghi lại cái người review sửa — đó là golden dataset tốt nhất và nó miễn phí.

## Related

- [Tool security](../04-agents-tools/02-tool-security.md) — lớp confirmation
- [Agent loop](../04-agents-tools/03-agent-loop.md) — trạng thái `needs_input`
- [Evaluating AI features](../05-evaluation/01-evaluating-ai-features.md) — review là nguồn golden
- [Versioning & release](./06-versioning-and-release.md) — hành động không rollback được
- [Failure handling](./05-failure-handling.md) — degrade sang người
- [Structured output](../01-context-and-output/03-structured-output.md) — `needsReview` trong schema
- [RAG pipeline](../03-rag/03-rag-pipeline.md) — `found: false` là tín hiệu chuyển người
- [Soft delete & audit patterns](../../03-database/03-data-modeling/05-soft-delete-audit-patterns.md)
- [Access control](../../05-cross-cutting/security/04-access-control.md)
