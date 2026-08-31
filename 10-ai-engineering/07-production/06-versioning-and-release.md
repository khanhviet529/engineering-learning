---
level: intermediate
area: ai-engineering
prerequisites:
  - ../05-evaluation/01-evaluating-ai-features.md
related:
  - 07-human-in-the-loop.md
  - ../../04-infrastructure/03-cicd/README.md
---

# Versioning và release cho AI feature

> Không ai deploy gì. Không ai sửa prompt. Sáng thứ Ba, tính năng trích xuất hoá đơn bắt đầu trả về `currency: "VND"` viết thường ở một số ca, và một field mới xuất hiện trong JSON. Nguyên nhân: provider cập nhật model đằng sau cùng một tên. **Với API thường, contract không đổi thì hành vi không đổi. Với AI, cùng prompt + cùng tên model có thể cho hành vi khác.**

## Position

```text
Thay đổi (của bạn HOẶC của provider)
        │
        ▼  ← NOTE NÀY: biết trước, đo được, rollback được
    production
```

## Problem

AI feature có một tính chất mà quy trình release thường không tính tới:

```text
API THƯỜNG          bạn kiểm soát mọi thay đổi hành vi
                    → contract test + version + changelog là đủ

AI FEATURE          hành vi đổi vì:
                      · bạn sửa prompt
                      · bạn đổi model
                      · bạn đổi chunking / retrieval / context builder
                      · PROVIDER cập nhật model  ← bạn không kiểm soát
                      · PROVIDER đổi mặc định / bỏ tham số
                    → cần thêm: EVAL, PIN VERSION, và giám sát trôi hành vi
```

Nguyên nhân thứ tư là nguyên nhân khiến sự cố ở đầu note xảy ra, và là nguyên nhân duy nhất bạn không thể chặn — chỉ có thể **phát hiện sớm**.

## Mental Model

### Năm thứ phải có version

```text
① PROMPT            id + số version, trong git
② MODEL             tên/id chính xác, trong config — KHÔNG hard-code trong code
③ CHUNKING/EMBED    embedVersion trên mỗi chunk (xem 03-rag/02)
④ OUTPUT SCHEMA     schema có version; đổi field là breaking
⑤ STREAM EVENT DTO  contract công khai với frontend
```

Và cả năm phải xuất hiện trong **mỗi trace**:

```text
promptId · promptVersion · model · embedVersion · schemaVersion
```

Không có chúng, câu hỏi *"chất lượng tụt từ hôm nào và vì thay đổi nào"* là không trả lời được.

### Pin model version, và biết cái gì pin được

```text
❌ model: 'latest-fast'                 → hành vi đổi khi provider cập nhật
❌ model hard-code trong service        → không đổi được không deploy
✅ model: cfg.model  (từ config/env)    → đổi bằng một dòng, rollback được
✅ pin phiên bản CỤ THỂ nếu provider cho → hành vi ổn định
```

Nhưng phải nói thật về giới hạn:

> **Pin version chỉ hoãn thay đổi, không loại bỏ nó.** Phiên bản cũ sẽ bị ngừng hỗ trợ. Nên bạn cần cả hai: pin để ổn định *bây giờ*, và một quy trình di trú để không bị buộc chuyển gấp.

Ba thứ cần chuẩn bị cho ngày phải chuyển:

```text
□ Golden dataset đã có sẵn (để so ngay được)
□ Model trong config (đổi không cần deploy code)
□ Một lần chạy eval song song hai model đã làm thử ít nhất một lần
```

### Phát hiện trôi hành vi: bốn tín hiệu tự động

Vì bạn không được thông báo trước, phát hiện phải là **tự động và liên tục**:

```text
① CANARY EVAL ĐỊNH KỲ
   chạy 30–50 ca golden mỗi ngày trên production config
   → so với baseline; cảnh báo khi lệch quá ngưỡng
   → đây là thứ chặn được sự cố đầu note

② METRIC HÌNH DẠNG OUTPUT
   tỉ lệ invalid_output · tỉ lệ enum lạ · độ dài output trung bình
   → "độ dài output tăng 40% không lý do" là dấu hiệu model đổi

③ METRIC CHI PHÍ / TOKEN
   input/output token trung bình mỗi route
   → tokenizer khác nhau giữa các thế hệ model → số token đổi

④ TÍN HIỆU NGƯỜI DÙNG
   tỉ lệ Regenerate · tỉ lệ chuyển người thật · tỉ lệ từ chối hành động
```

Tín hiệu ② là tín hiệu rẻ nhất và bén nhất: **độ dài output trung bình** là một con số duy nhất phản ánh rất nhiều thay đổi hành vi.

### Quy trình release cho một thay đổi prompt/model

```text
① OFFLINE EVAL       chạy golden dataset: candidate vs baseline
                     → CHẶN nếu deterministic < 100% hoặc tag regression/security tụt
② SHADOW (tuỳ chọn)   chạy candidate SONG SONG trên traffic thật, KHÔNG trả cho user
                     → so output; đo cost/latency thật
③ CANARY             5% traffic → theo dõi metric 24h
④ RAMP               25% → 50% → 100%, mỗi bước có thời gian quan sát
⑤ GIỮ ĐƯỜNG ROLLBACK  đổi ngược bằng CONFIG, không cần deploy
```

Bước ② đắt (nhân đôi chi phí cho phần traffic được shadow) nhưng nó là bước duy nhất cho bạn **dữ liệu thật trước khi ảnh hưởng người dùng**. Dùng nó cho thay đổi lớn (đổi model, đổi chunking), không cho mỗi lần sửa chữ trong prompt.

### Feature flag: điều khiển bằng config, không bằng deploy

```ts
type AiVariant = {
  model: string;
  promptId: string;
  promptVersion: number;
  useRerank: boolean;
  docTokenBudget: number;
  maxOutputTokens: number;
};

async function variantFor(ctx: Ctx): Promise<AiVariant> {
  // rollout theo hash ổn định → một user luôn thấy cùng variant
  const bucket = hashToBucket(ctx.userId, 100);
  const rollout = await flags.get('ai.support.v8.rollout');   // 0..100
  return bucket < rollout ? VARIANT_V8 : VARIANT_V7;
}
```

Hash ổn định theo `userId` là phần quan trọng: nếu variant đổi giữa các request của cùng một người, họ thấy hành vi không nhất quán trong cùng hội thoại — và bạn không so sánh được vì dữ liệu bị trộn.

Và variant phải nằm trong trace:

```ts
span.setAttribute('ai.variant', variant.promptId + '@' + variant.promptVersion);
```

### A/B test cho AI: khác A/B test thường

```text
A/B test thường:  đo conversion, click → dữ liệu nhị phân, dễ đo
A/B test AI:      chất lượng KHÔNG nhị phân

Metric dùng được (theo thứ tự tin cậy):
  · tỉ lệ chuyển sang người thật        ← rõ ràng, đo được
  · tỉ lệ Regenerate                    ← rõ ràng
  · tỉ lệ hành động đề xuất bị từ chối   ← rõ ràng (agent)
  · thời gian tới khi giải quyết xong    ← tốt nếu đo được
  · rating của người dùng                ← ít người bấm, lệch mẫu
  · điểm LLM-as-judge trên traffic mẫu   ← tương đối, cần hiệu chỉnh
```

Ba metric đầu là ba metric đáng xây trước: chúng là **hành vi**, không phải ý kiến, và chúng có sẵn nếu bạn đã có UI đúng theo [04-chat-ux-and-state.md](../02-chatbot-web/04-chat-ux-and-state.md).

### Rollback: cái gì rollback được, cái gì không

```text
ROLLBACK ĐƯỢC bằng config (giây)
  ✓ prompt version
  ✓ model
  ✓ tham số (top_k, budget, maxOutput, useRerank)
  ✓ feature flag

ROLLBACK ĐẮT (giờ tới ngày)
  ⚠ chunking strategy → phải re-index toàn bộ
  ⚠ embedding model   → phải embed lại toàn bộ

KHÔNG ROLLBACK ĐƯỢC
  ✗ hành động tool đã thực hiện (email đã gửi, tiền đã hoàn)
  ✗ dữ liệu đã ghi từ output sai
  ✗ fine-tuned model đã huấn luyện trên dữ liệu cần xoá
```

Nhóm "đắt" là lý do `embedVersion` tồn tại: nó cho phép **chạy song song hai phiên bản** rồi chuyển bằng config — biến một thay đổi không rollback được thành một thay đổi rollback được.

```text
① embed lại vào embedVersion=2, SONG SONG với v1 đang phục vụ
② eval so recall v1 vs v2
③ đổi config sang v2  ← rollback = đổi lại, tức thì
④ sau thời gian quan sát, xoá v1
```

Đây đúng mẫu **expand/contract** của [05-prisma-migrations-production.md](../../03-database/05-data-access/05-prisma-migrations-production.md), áp dụng cho embedding.

Nhóm "không rollback được" là lý do [07-human-in-the-loop.md](./07-human-in-the-loop.md) tồn tại.

## Example

Checklist release, ở dạng dùng được:

```text
TRƯỚC KHI MERGE
  □ golden eval: candidate vs baseline, có bảng so sánh
  □ deterministic checks 100%
  □ tag 'regression' và 'security' không tụt
  □ cost/ca và p95 latency trong báo cáo
  □ promptVersion đã tăng
  □ có đường rollback bằng config

TRƯỚC KHI 100%
  □ canary 5% ≥ 24h
  □ metric theo variant: invalid_output · finishReason · cost · ttft
  □ tín hiệu người dùng: Regenerate · chuyển người thật
  □ không có alert mới

SAU KHI 100%
  □ giữ variant cũ trong config ≥ 1 tuần
  □ cập nhật baseline cho eval lần sau
```

Dòng cuối là dòng hay bị quên và gây hậu quả lặng lẽ: **nếu không cập nhật baseline, lần sau bạn so với một phiên bản đã cũ hai bước** — và regression nhỏ tích luỹ qua nhiều lần release mà không lần nào vượt ngưỡng cảnh báo.

Và canary eval hằng ngày, để bắt thay đổi từ phía provider:

```ts
// cron hằng ngày
const report = await runEval(goldenSubset(40), productionVariant());
const drift = compare(report, storedBaseline);

if (drift.exactMatchDelta < -0.03 || drift.invalidOutputDelta > 0.01) {
  alert('AI behavior drift detected', {
    model: productionVariant().model,
    promptVersion: productionVariant().promptVersion,
    ...drift,
  });
}
```

40 ca mỗi ngày là chi phí rất nhỏ, và nó là hệ thống cảnh báo duy nhất cho thay đổi bạn không kiểm soát.

## Prediction

1. Provider cập nhật model đằng sau cùng một tên. Bạn không có canary eval. Khi nào bạn biết?
2. Model được hard-code trong service. Cần rollback gấp. Mất bao lâu?
3. Bạn đổi chunking strategy và deploy. Chất lượng tụt. Rollback thế nào?
4. Bạn A/B test bằng rating người dùng. Chỉ 2% bấm. Kết luận có tin được?
5. Bạn không cập nhật baseline sau mỗi release. Sau 6 lần release, mỗi lần tụt 1%. Có alert nào?
6. Variant chọn ngẫu nhiên mỗi request. Người dùng thấy gì trong một hội thoại?

<details>
<summary>Đáp án</summary>

1. **Qua khiếu nại người dùng**, hoặc qua một bug ở tầng khác (JSON parse lỗi, enum lạ) — thường sau nhiều ngày. Canary eval hằng ngày bắt được trong 24h.
2. Một chu kỳ build + deploy đầy đủ (**phút tới giờ**), trong lúc production đang lỗi. Model phải ở config.
3. **Phải re-index toàn bộ** — giờ tới ngày. Đây là lý do chunking/embedding cần chạy song song theo version thay vì thay thế tại chỗ.
4. **Rất khó tin** — 2% là mẫu lệch mạnh (người rất hài lòng hoặc rất bất bình mới bấm). Dùng metric hành vi: Regenerate, chuyển người thật.
5. **Không có alert nào** — mỗi lần chỉ tụt 1%, dưới ngưỡng. Nhưng tổng đã tụt ~6%. Baseline phải được cập nhật, và nên có một baseline "dài hạn" cố định để so.
6. Hành vi **không nhất quán trong cùng hội thoại** (lượt này ngắn gọn, lượt sau dài dòng), và dữ liệu A/B bị trộn nên không kết luận được. Hash ổn định theo `userId`.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Hành vi đổi mà không ai deploy | provider cập nhật model; thiếu canary eval |
| Không rollback nhanh được | model/prompt hard-code trong code |
| Chunking đổi, không quay lại được | không chạy song song theo `embedVersion` |
| Không biết regression từ thay đổi nào | trace thiếu `promptVersion`/`model`/`variant` |
| Regression tích luỹ không ai thấy | baseline không cập nhật; không có baseline dài hạn |
| A/B không kết luận được | variant không ổn định theo user; hoặc metric là ý kiến |
| Hành vi không nhất quán trong một hội thoại | variant chọn ngẫu nhiên mỗi request |
| Đổi model xong chất lượng khác hẳn | prompt tinh chỉnh cho model cũ; không chạy lại eval |
| Số token đổi sau khi đổi model | tokenizer khác — phải tính lại ngân sách context |

Dòng cuối là chi tiết dễ bỏ: đổi model có thể đổi **số token của cùng một prompt**, nên ngân sách context và cost đều phải tính lại, không giả định giữ nguyên.

## Debugging

```text
1. Trace của request lỗi: promptVersion? model? variant? embedVersion?
2. So sánh phân bố finishReason / độ dài output trước và sau mốc nghi ngờ
3. Chạy golden eval NGAY với production config → có lệch baseline?
4. Metric theo variant → variant nào tệ hơn
5. input_tokens trung bình theo ngày → tokenizer đổi?
6. Có đường rollback bằng config chưa? Thử nó trên staging.
```

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Pin model version | hành vi ổn định | sẽ bị ngừng hỗ trợ; phải di trú |
| Dùng alias mới nhất | luôn có cải tiến mới | hành vi đổi không báo trước |
| Canary eval hằng ngày | phát hiện trôi trong 24h | chi phí nhỏ (40 ca/ngày) |
| Shadow traffic | dữ liệu thật trước khi ảnh hưởng user | nhân đôi chi phí phần shadow |
| Ramp từng bước | rủi ro thấp | release chậm hơn |
| Model/prompt trong config | rollback bằng giây | cần quản lý config cẩn thận |
| Song song `embedVersion` | chunking/embedding rollback được | lưu trữ gấp đôi tạm thời |
| Eval chặn merge | không regression âm thầm | PR chậm hơn |

## Explain Without Notes

1. Hành vi AI đổi vì **năm** nguyên nhân, và một trong đó bạn không kiểm soát.
2. Version hoá năm thứ, và đưa cả năm vào **mỗi trace**.
3. Pin model **hoãn** thay đổi, không loại bỏ — chuẩn bị đường di trú.
4. Canary eval hằng ngày là hệ thống cảnh báo duy nhất cho thay đổi từ provider.
5. Chunking/embedding rollback được **chỉ nếu** bạn chạy song song theo version.

## Related

- [Evaluating AI features](../05-evaluation/01-evaluating-ai-features.md) — golden dataset, baseline
- [AI observability](./01-ai-observability.md) — version trong trace
- [Human in the loop](./07-human-in-the-loop.md) — hành động không rollback được
- [Provider adapter & DTO](../01-context-and-output/04-provider-adapter-and-dto.md) — model trong config
- [Vector search](../03-rag/02-vector-search.md) — `embed_version` song song
- [Prompt như input contract](../01-context-and-output/01-prompt-as-input-contract.md) — prompt có version
- [Chat UX & state](../02-chatbot-web/04-chat-ux-and-state.md) — nguồn metric hành vi
- [API versioning & evolution](../../02-backend-api/00-http-api/06-api-versioning-evolution.md)
- [Prisma migrations production](../../03-database/05-data-access/05-prisma-migrations-production.md) — expand/contract
- [CI/CD](../../04-infrastructure/03-cicd/README.md) — eval là quality gate
- [Rollout & rollback (K8s)](../../04-infrastructure/04-kubernetes/workloads-networking/03-rollout-rollback.md)
