import type { ReactNode } from "react";

/**
 * Renderer Markdown cho bình luận — **allowlist**, không phải blocklist.
 *
 * Hợp đồng ở [quy ước frontend](../../../../../docs/engineering/frontend-conventions.md)
 * liệt kê đúng sáu thứ được render: đậm, nghiêng, code nội tuyến, khối code,
 * danh sách, liên kết. Không heading, không bảng, không ảnh, không blockquote,
 * không embed, và **raw HTML tắt tuyệt đối**.
 *
 * ## Vì sao tự viết thay vì dùng thư viện
 *
 * Một thư viện Markdown mặc định cho phép HTML đi xuyên qua, và việc tắt nó là
 * một **tuỳ chọn** — tức là một dòng cấu hình mà một lần nâng cấp có thể đổi
 * mặc định. Ở đây allowlist là chính cấu trúc của code: hàm này trả về
 * `ReactNode`, và React escape mọi chuỗi. Không có `dangerouslySetInnerHTML`,
 * không có bước nào dựng chuỗi HTML, nên `<script>` trong bình luận là **văn
 * bản** — không phải một thẻ bị lọc, mà một thẻ chưa từng tồn tại.
 *
 * Đó là khác biệt giữa allowlist và blocklist mà tài liệu nhấn mạnh: một
 * blocklist bỏ sót một thẻ là một lỗ XSS; ở đây bỏ sót một thẻ chỉ có nghĩa là
 * thẻ đó hiện ra dưới dạng chữ.
 */

/** Scheme được phép cho liên kết trong bình luận. Không có `javascript:`, `data:`, `file:`. */
const LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Trả về URL nếu nó tuyệt đối và dùng scheme được phép, ngược lại `undefined`.
 *
 * URL tương đối cũng bị từ chối: allowlist nói về scheme, và một liên kết
 * không có scheme thì không nằm trong danh sách. Đường dẫn nội bộ trong bình
 * luận là nhu cầu chưa ai đặt ra, nên nó chưa được mở.
 */
export function safeLinkHref(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  return LINK_SCHEMES.has(url.protocol) ? url.href : undefined;
}

/**
 * Một lượt quét cho mọi cú pháp nội tuyến.
 *
 * Thứ tự nhánh có ý nghĩa: code nội tuyến đứng **trước**, vì nội dung bên
 * trong dấu backtick là văn bản nguyên văn — `` `**a**` `` phải hiện ra dấu
 * sao chứ không in đậm.
 */
const INLINE = /(`[^`\n]+`)|(\[[^\]\n]*\]\([^()\s]+\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let index = 0;

  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (match === null || match.index === undefined) {
      out.push(rest);
      break;
    }

    if (match.index > 0) out.push(rest.slice(0, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${String(index)}`;
    index += 1;

    if (token.startsWith("`")) {
      out.push(
        <code key={key} style={CODE_INLINE}>
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeLinkHref(token.slice(split + 2, -1));
      if (href === undefined) {
        // Scheme ngoài allowlist: hiện **nguyên văn** cú pháp Markdown. Người
        // đọc thấy đúng thứ người viết gõ, và không có gì bấm được.
        out.push(token);
      } else {
        out.push(
          <a
            key={key}
            href={href}
            target="_blank"
            // `noopener` cắt `window.opener`, `noreferrer` cắt cả Referer.
            // Bắt buộc, không phải tuỳ chọn: liên kết trong bình luận do người
            // dùng khác viết.
            rel="noopener noreferrer"
            style={LINK}
          >
            {label === "" ? href : label}
          </a>,
        );
      }
    } else if (token.startsWith("**")) {
      out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    } else {
      out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    }

    rest = rest.slice(match.index + token.length);
  }

  return out;
}

const CODE_INLINE = {
  padding: "1px 4px",
  borderRadius: "var(--fb-radius-sm)",
  background: "var(--fb-color-surface-subtle)",
  fontFamily: "var(--fb-font-family-mono), ui-monospace, monospace",
  fontSize: "var(--fb-font-size-caption)",
} as const;

const CODE_BLOCK = {
  margin: 0,
  padding: "var(--fb-space-3)",
  borderRadius: "var(--fb-radius-md)",
  background: "var(--fb-color-surface-subtle)",
  border: "1px solid var(--fb-color-border-subtle)",
  fontFamily: "var(--fb-font-family-mono), ui-monospace, monospace",
  fontSize: "var(--fb-font-size-caption)",
  color: "var(--fb-color-text-primary)",
  overflowX: "auto",
  whiteSpace: "pre",
} as const;

const LINK = {
  color: "var(--fb-color-brand-text)",
  textDecoration: "underline",
} as const;

const LIST = { margin: 0, paddingLeft: "var(--fb-space-5)" } as const;
const PARAGRAPH = { margin: 0, whiteSpace: "pre-wrap" } as const;

const UNORDERED = /^[-*]\s+/;
const ORDERED = /^\d+\.\s+/;

/**
 * Render một `body` bình luận thành cây React.
 *
 * Cấu trúc khối rất hẹp có chủ đích: khối code có rào, danh sách có thứ tự và
 * không thứ tự, còn lại là đoạn văn. Dòng trống ngắt đoạn.
 */
export function renderCommentBody(body: string): ReactNode[] {
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `p-${String(index)}`;
    index += 1;
    blocks.push(
      <p key={key} style={PARAGRAPH}>
        {renderInline(paragraph.join("\n"), key)}
      </p>,
    );
    paragraph = [];
  };

  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? "";

    if (line.trimStart().startsWith("```")) {
      flushParagraph();
      const code: string[] = [];
      cursor += 1;
      while (cursor < lines.length && !(lines[cursor] ?? "").trimStart().startsWith("```")) {
        code.push(lines[cursor] ?? "");
        cursor += 1;
      }
      const key = `code-${String(index)}`;
      index += 1;
      blocks.push(
        <pre key={key} style={CODE_BLOCK}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const ordered = ORDERED.test(line);
    const unordered = UNORDERED.test(line);
    if (ordered || unordered) {
      flushParagraph();
      const pattern = ordered ? ORDERED : UNORDERED;
      const items: string[] = [];
      while (cursor < lines.length && pattern.test(lines[cursor] ?? "")) {
        items.push((lines[cursor] ?? "").replace(pattern, ""));
        cursor += 1;
      }
      cursor -= 1;
      const key = `list-${String(index)}`;
      index += 1;
      const children = items.map((item, itemIndex) => (
        <li key={`${key}-${String(itemIndex)}`}>
          {renderInline(item, `${key}-${String(itemIndex)}`)}
        </li>
      ));
      blocks.push(
        ordered ? (
          <ol key={key} style={LIST}>
            {children}
          </ol>
        ) : (
          <ul key={key} style={LIST}>
            {children}
          </ul>
        ),
      );
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}
