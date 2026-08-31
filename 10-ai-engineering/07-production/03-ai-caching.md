---
level: intermediate
area: ai-engineering
prerequisites:
  - 02-cost-and-model-routing.md
related:
  - ../../03-database/02-redis/03-cache-patterns.md
  - ../01-context-and-output/02-context-engineering.md
---

# AI caching: bốn loại cache, bốn bài toán invalidation

> Một team thêm semantic cache để giảm chi phí: nếu câu hỏi mới "gần giống" một câu hỏi cũ (cosine > 0.92), trả về câu trả lời đã lưu. Chi phí giảm 34%. Hai tuần sau, một khách hàng phàn nàn: họ hỏi *"đơn hàng của tôi giao chưa?"* và nhận câu trả lời về **đơn hàng của người khác** — câu hỏi của hai người giống nhau về ngữ nghĩa gần như tuyệt đối, và key cache không chứa `userId`.

## Position

```text
Bốn chỗ có thể cache trong một AI feature — bốn cơ chế khác nhau
prompt prefix · embedding · retrieval · câu trả lời (exact / semantic)
```

## Problem

Cache trong AI khác cache truyền thống ở hai điểm, và cả hai đều làm invalidation khó hơn:

```text
① OUTPUT KHÔNG XÁC ĐỊNH
   Cùng input có thể cho output khác → "cache hit" nghĩa là
   bạn cố tình chọn MỘT trong nhiều output hợp lệ.

② "GIỐNG NHAU" LÀ MỜ
   Cache thường: key khớp byte hay không. Nhị phân.
   Semantic cache: "gần giống" — và ngưỡng do bạn chọn.
   → Sai ngưỡng = trả lời câu hỏi khác.
```

Và điều đầu tiên phải nói, vì nó là gốc của sự cố ở đầu note:

> **Cache key của AI phải chứa mọi thứ ảnh hưởng tới câu trả lời** — kể cả những thứ không nằm trong câu hỏi: `userId`, `orgId`, quyền, phiên bản prompt, model, phiên bản tài liệu.

## Mental Model

### Bốn loại cache, xếp theo an toàn

```text
① PROMPT PREFIX CACHE (provider)      an toàn nhất — làm trước
   provider cache phần đầu prompt đã xử lý
   → giảm 50–90% chi phí input; KHÔNG đổi output
   → invalidation: tự động, theo tiền tố byte

② EMBEDDING CACHE                      an toàn
   text → vector là hàm THUẦN KHIẾT với một model cố định
   → key: hash(text) + embedModel + embedVersion
   → invalidation: chỉ khi đổi model (và khi đó phải embed lại hết)

③ RETRIEVAL CACHE                      cần cẩn thận
   query → danh sách chunk
   → key PHẢI chứa: orgId + phạm vi quyền + phiên bản corpus
   → invalidation: khi tài liệu đổi → TTL ngắn hoặc theo phiên bản

④ ANSWER CACHE                         nguy hiểm nhất
   exact:    key = hash(toàn bộ input đã chuẩn hoá)   ← chấp nhận được
   semantic: "câu hỏi gần giống"                       ← rủi ro cao
   → invalidation: khó nhất; và sai thì trả lời SAI CHO NGƯỜI KHÁC
```

Thứ tự này cũng là thứ tự nên triển khai. Loại ① cho phần lớn lợi ích với gần như không rủi ro; loại ④ cho ít lợi ích hơn với nhiều rủi ro nhất.

### ① Prompt prefix cache: cơ chế và cách tự phá

Đã nêu ở [02-cost-and-model-routing.md](./02-cost-and-model-routing.md), nhưng đây là chi tiết cơ chế:

```text
Cache khớp theo TIỀN TỐ BYTE, theo thứ tự render: tools → system → messages.
Một byte đổi ở vị trí N ⇒ mất cache từ N tới hết.
```

```text
✅ ĐÚNG — ổn định ở đầu
[tools (sắp xếp)] [system prompt] [few-shot] ┃ [tài liệu] [history] [câu hỏi]
                                             ↑ breakpoint

❌ SAI — biến đổi ở đầu phá tất cả
[system: "Thời gian: 2026-08-31T10:23:44Z"] [tools] [few-shot] [...]
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ đổi mỗi request
```

Ba quy tắc thực dụng:

```text
① Cần thời gian? Làm tròn tới NGÀY, và đặt sau phần ổn định.
② Tool list phải có thứ tự XÁC ĐỊNH (sort theo name), và schema
   serialize với key đã sort.
③ Prefix quá ngắn thường KHÔNG được cache (provider có ngưỡng tối thiểu).
   → nếu system prompt rất ngắn, cache có thể không kích hoạt.
```

Và cách duy nhất để biết nó hoạt động: `usage.cachedInputTokens`. Không có metric đó thì bạn đang đoán.

### ② Embedding cache: dễ và hiệu quả

```text
Vì sao hiệu quả:
  · query lặp lại nhiều hơn bạn nghĩ ("chính sách hoàn tiền" — hàng trăm lần/ngày)
  · re-index tài liệu không đổi → chunk không đổi → vector không đổi
  · embedding là hàm thuần khiết → cache không bao giờ sai
```

```ts
async function embed(text: string): Promise<number[]> {
  const key = `emb:${cfg.embedModel}:v${cfg.embedVersion}:${sha256(text)}`;
  const hit = await redis.get(key);
  if (hit) { metrics.increment('embed.hit'); return JSON.parse(hit); }

  const vec = await provider.embed(text);
  await redis.set(key, JSON.stringify(vec), 'EX', 60 * 60 * 24 * 30);
  metrics.increment('embed.miss');
  return vec;
}
```

`cfg.embedModel` và `embedVersion` **trong key** là phần bắt buộc — không có chúng, đổi model sẽ trả về vector của không gian cũ. Xem [01-embeddings.md](../03-rag/01-embeddings.md).

### ③ Retrieval cache: key phải chứa phạm vi quyền

```text
❌ key = hash(query)
   → người dùng org A nhận chunk của org B

✅ key = hash(query) + orgId + visibilityFingerprint
          + corpusVersion + embedModel + topK
```

`visibilityFingerprint` là phần khó: nếu quyền xem tài liệu khác nhau **giữa các user trong cùng org**, thì key phải phản ánh điều đó — và khi đó tỉ lệ hit thấp tới mức cache không đáng.

```text
Quyền theo ORG (mọi người trong org thấy như nhau)  → cache được, hit tốt
Quyền theo USER/nhóm/tài liệu                        → cache hầu như vô dụng
                                                        HOẶC rủi ro rò rỉ
```

Kết luận thực dụng: **chỉ cache retrieval khi phạm vi quyền là theo org, không theo user.** Nếu quyền phức tạp hơn, bỏ loại cache này — nó không đáng rủi ro.

`corpusVersion` tăng mỗi khi có tài liệu được ingest/xoá trong org đó, cho phép invalidate cả nhóm bằng một số:

```ts
const version = await redis.get(`corpus:v:${orgId}`) ?? '0';
const key = `ret:${orgId}:${version}:${embedModel}:${topK}:${sha256(query)}`;
// khi ingest: await redis.incr(`corpus:v:${orgId}`)  → mọi key cũ thành mồ côi
```

Đây là mẫu **version-prefixed key**: không cần xoá key cũ, chúng tự hết hạn theo TTL.

### ④ Answer cache: exact thì được, semantic thì cẩn thận

**Exact cache** chấp nhận được nếu key đầy đủ:

```text
key = hash(
  normalizedQuestion +      // trim, lowercase, chuẩn hoá khoảng trắng
  orgId + userScopeFingerprint +
  promptId + promptVersion +
  model +
  corpusVersion
)
```

Nó chỉ hit khi **cùng người, cùng câu hỏi, cùng phiên bản mọi thứ** — nên hit ratio thấp, nhưng khi hit thì an toàn.

**Semantic cache** là nơi sự cố đầu note xảy ra. Ba vấn đề, xếp theo mức nghiêm trọng:

```text
① CÂU HỎI GIỐNG NHƯNG NGỮ CẢNH KHÁC   ← lỗi nghiêm trọng nhất
   "đơn hàng của tôi giao chưa?" — cosine ~0.99 giữa hai người
   nhưng câu trả lời PHẢI khác nhau
   ⇒ mọi câu hỏi phụ thuộc dữ liệu người dùng KHÔNG ĐƯỢC semantic-cache

② NGƯỠNG SAI TRẢ LỜI CÂU KHÁC
   "hoàn tiền trong bao lâu?" vs "hoàn tiền có mất phí không?"
   → cosine có thể > 0.9, câu trả lời hoàn toàn khác

③ PHỦ ĐỊNH
   "bảo hiểm bao gồm gì?" vs "bảo hiểm KHÔNG bao gồm gì?"
   → embedding rất yếu với phủ định → cosine cao, nghĩa trái ngược
```

Vấn đề ③ đáng nhấn: nó nghĩa là semantic cache **sai ngay ở loại câu hỏi mà người dùng cần chính xác nhất**.

Khi nào semantic cache đáng dùng — rất hẹp:

```text
✓ Câu hỏi về kiến thức CHUNG, không phụ thuộc người dùng
  (FAQ, chính sách công khai, tài liệu sản phẩm)
✓ Trong CÙNG một phạm vi quyền
✓ Ngưỡng CAO (≥ 0.95) và đã đo trên dữ liệu thật
✓ TTL ngắn
✓ Có cờ "câu trả lời từ cache" để debug được

✗ Bất cứ thứ gì chạm dữ liệu riêng của người dùng
✗ Bất cứ thứ gì có phủ định hoặc số/mã
```

Và một biện pháp giảm thiểu đáng làm nếu vẫn dùng: **cache câu trả lời cho câu hỏi đã chuẩn hoá, nhưng chỉ cho nhóm câu hỏi đã được liệt kê trước** (FAQ) — không cho mọi câu hỏi tự do.

## Example

Thứ tự triển khai và mức lợi ích, để không làm ngược:

```text
BƯỚC 1  Prompt prefix cache
        · sắp xếp tool list · bỏ timestamp khỏi đầu prompt
        · đo cachedInputTokens
        → lợi ích: RẤT CAO · rủi ro: KHÔNG

BƯỚC 2  Embedding cache
        · key có model + version
        → lợi ích: CAO cho hệ thống RAG · rủi ro: KHÔNG

BƯỚC 3  Retrieval cache (CHỈ nếu quyền theo org)
        · key có orgId + corpusVersion
        · TTL 5–60 phút
        → lợi ích: TRUNG · rủi ro: THẤP nếu key đúng

BƯỚC 4  Exact answer cache cho FAQ
        · key đầy đủ; TTL ngắn
        → lợi ích: THẤP–TRUNG · rủi ro: THẤP

BƯỚC 5  Semantic cache
        → chỉ khi 1–4 đã làm và vẫn cần giảm chi phí
        → chỉ cho kiến thức chung; ngưỡng ≥ 0.95; có cờ debug
        → lợi ích: TRUNG · rủi ro: CAO
```

Và một quy tắc để cache không thành hố đen khi debug:

```ts
return {
  answer, citations,
  meta: {
    cached: hit ? { layer: 'answer-exact', ageSeconds } : null,
  },
};
```

Không có cờ này, câu hỏi *"vì sao câu trả lời không cập nhật sau khi tôi sửa tài liệu"* trở thành một buổi điều tra dài. Có nó, đó là một dòng trong response.

## Prediction

1. Semantic cache với key chỉ chứa câu hỏi. Hai người hỏi "đơn của tôi giao chưa?". Kết quả?
2. Bạn thêm timestamp vào đầu system prompt. `cachedInputTokens` thế nào?
3. Embedding cache không có `embedModel` trong key. Bạn đổi model. Kết quả?
4. Retrieval cache TTL 1 giờ. Người dùng upload tài liệu mới rồi hỏi ngay. Họ thấy gì?
5. Semantic cache ngưỡng 0.9. Người hỏi "bảo hiểm KHÔNG bao gồm gì?". Rủi ro?
6. Quyền xem tài liệu khác nhau theo từng user. Bạn cache retrieval theo org. Rủi ro?

<details>
<summary>Đáp án</summary>

1. Người thứ hai nhận **câu trả lời về đơn của người thứ nhất** — đúng sự cố đầu note. Đây là lỗi rò rỉ dữ liệu, không chỉ lỗi chất lượng.
2. **Về 0.** Mọi request thành cache miss, chi phí input tăng nhiều lần.
3. Bạn nhận **vector của model cũ** cho text đã cache → trộn hai không gian embedding → kết quả tìm kiếm vô nghĩa.
4. Có thể **không thấy tài liệu mới** trong tối đa 1 giờ. Sửa bằng `corpusVersion` trong key và `INCR` khi ingest — invalidate tức thì mà không cần xoá key.
5. Có thể trả về câu trả lời của **"bảo hiểm bao gồm gì?"** — nghĩa trái ngược. Embedding yếu với phủ định.
6. **Rò rỉ dữ liệu**: user A cache một kết quả chứa tài liệu chỉ A được xem; user B trong cùng org nhận lại nó. Với quyền theo user, đừng cache retrieval.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| Người dùng nhận câu trả lời của người khác | key thiếu `userId`/`orgId` |
| Rò rỉ tài liệu trong cùng org | cache retrieval khi quyền theo user |
| Câu trả lời trái nghĩa | semantic cache + phủ định |
| Tài liệu mới không xuất hiện | thiếu `corpusVersion`; TTL quá dài |
| Chi phí không giảm dù đã bật cache | `cachedInputTokens` = 0; prefix bị phá |
| Kết quả tìm kiếm vô nghĩa sau đổi model | embedding cache thiếu model trong key |
| Câu trả lời cũ sau khi sửa prompt | key thiếu `promptVersion` |
| Không debug được "vì sao câu trả lời này" | không có cờ `cached` trong response |
| Hit ratio ~0 với semantic cache | ngưỡng quá cao, hoặc câu hỏi quá đa dạng |

## Debugging

```text
1. cachedInputTokens theo ngày → mốc nào cache prefix bị phá?
2. Cache key của một request: liệt kê MỌI thành phần
   → thiếu userId? orgId? promptVersion? corpusVersion? model?
3. Hit ratio theo từng tầng cache (prefix/embed/retrieval/answer)
4. Với answer cache: age của hit → có quá cũ không?
5. Với semantic cache: log cosine của mỗi hit → phân bố ra sao?
6. Tài liệu mới → corpusVersion có tăng không?
```

Bước 2 nên là một checklist trong code review cho mọi cache mới: **liệt kê mọi thứ ảnh hưởng tới câu trả lời, và kiểm chúng đều có trong key.**

## Trade-offs

| Cache | Tiết kiệm | Rủi ro | Nên làm |
|---|---|---|---|
| Prompt prefix | **rất cao** | không | ✓ luôn luôn |
| Embedding | cao (RAG) | không | ✓ luôn luôn |
| Retrieval | trung | thấp nếu quyền theo org | ⚠ tuỳ mô hình quyền |
| Answer exact | thấp–trung | thấp | ✓ cho FAQ |
| Answer semantic | trung | **cao** | ⚠ chỉ kiến thức chung |
| Không cache gì | 0 | 0 | chấp nhận được lúc đầu |

## Explain Without Notes

1. Bốn loại cache; làm theo thứ tự an toàn: prefix → embedding → retrieval → answer.
2. Key phải chứa **mọi thứ ảnh hưởng câu trả lời**: user/org, quyền, promptVersion, model, corpusVersion.
3. Prefix cache khớp theo byte — timestamp ở đầu prompt phá toàn bộ; kiểm bằng `cachedInputTokens`.
4. Semantic cache sai ở đúng chỗ nguy hiểm: dữ liệu riêng của người dùng, và phủ định.
5. Luôn trả cờ `cached` để debug được.

## Related

- [Cost & model routing](./02-cost-and-model-routing.md) — cache là đòn số một
- [AI observability](./01-ai-observability.md) — `cachedInputTokens`
- [Context engineering](../01-context-and-output/02-context-engineering.md) — thứ tự ổn định trước
- [Embedding](../03-rag/01-embeddings.md) — vì sao model phải trong key
- [Vector search](../03-rag/02-vector-search.md) — `embed_version`, corpus
- [Prompt như input contract](../01-context-and-output/01-prompt-as-input-contract.md) — `promptVersion`
- [Cache patterns (Redis)](../../03-database/02-redis/03-cache-patterns.md) — cache-aside, hit ratio
- [Cache invalidation](../../03-database/02-redis/01-cache-invalidation.md) — version-prefixed key
- [Access control](../../05-cross-cutting/security/04-access-control.md) — phạm vi quyền trong key
