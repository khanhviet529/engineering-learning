import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderCommentBody, safeLinkHref } from "./markdown.tsx";

/**
 * Allowlist Markdown của bình luận.
 *
 * Bộ kiểm này khẳng định bằng cách **tìm phần tử**, không bằng cách so chuỗi.
 * Lý do: một `<script>` vẫn có thể nằm trong `textContent` một cách hoàn toàn
 * an toàn — đó chính là kết quả đúng. Cái phải chứng minh là nó **không trở
 * thành một nút DOM**, và chỉ `querySelector` mới nói được điều đó.
 */

function renderBody(body: string) {
  return render(<div data-testid="body">{renderCommentBody(body)}</div>);
}

function root(): HTMLElement {
  return screen.getByTestId("body");
}

describe("sáu thứ được phép", () => {
  it("đậm", () => {
    renderBody("một **hai** ba");
    expect(root().querySelector("strong")).toHaveTextContent("hai");
  });

  it("nghiêng, cả dấu sao lẫn gạch dưới", () => {
    renderBody("*một* và _hai_");
    expect(root().querySelectorAll("em")).toHaveLength(2);
  });

  it("code nội tuyến", () => {
    renderBody("chạy `pnpm verify` trước");
    expect(root().querySelector("code")).toHaveTextContent("pnpm verify");
  });

  it("khối code có rào giữ nguyên xuống dòng", () => {
    renderBody("```\nmột\nhai\n```");
    const block = root().querySelector("pre code");
    expect(block?.textContent).toBe("một\nhai");
  });

  it("danh sách không thứ tự", () => {
    renderBody("- một\n- hai");
    expect(root().querySelectorAll("ul li")).toHaveLength(2);
  });

  it("danh sách có thứ tự", () => {
    renderBody("1. một\n2. hai");
    expect(root().querySelectorAll("ol li")).toHaveLength(2);
  });

  it("liên kết https có rel bảo vệ và mở tab mới", () => {
    renderBody("[tài liệu](https://example.test/a)");
    const link = root().querySelector("a");
    expect(link).toHaveAttribute("href", "https://example.test/a");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("code nội tuyến KHÔNG bị hiểu tiếp thành đậm bên trong", () => {
    renderBody("`**không đậm**`");
    expect(root().querySelector("strong")).toBeNull();
    expect(root().querySelector("code")).toHaveTextContent("**không đậm**");
  });
});

describe("mọi thứ ngoài allowlist KHÔNG trở thành DOM", () => {
  it("thẻ script chỉ là chữ", () => {
    renderBody("<script>alert(1)</script>");
    expect(root().querySelector("script")).toBeNull();
    // Nó vẫn phải **hiện ra** dưới dạng chữ: người đọc thấy đúng thứ người
    // viết gõ, và không có gì bị nuốt mất.
    expect(root()).toHaveTextContent("<script>alert(1)</script>");
  });

  it("img onerror không tạo ra thẻ img nào", () => {
    renderBody('<img src=x onerror="alert(1)">');
    expect(root().querySelector("img")).toBeNull();
    expect(root().querySelector("[onerror]")).toBeNull();
  });

  it("HTML nội tuyến không tạo phần tử", () => {
    renderBody("<b>đậm giả</b> và <a href='https://evil.test'>liên kết giả</a>");
    expect(root().querySelector("b")).toBeNull();
    expect(root().querySelector("a")).toBeNull();
  });

  it("iframe, style và svg đều không tồn tại", () => {
    renderBody("<iframe src=https://evil.test></iframe><style>*{}</style><svg onload=x></svg>");
    for (const tag of ["iframe", "style", "svg"]) {
      expect(root().querySelector(tag)).toBeNull();
    }
  });

  it("heading, bảng, blockquote và ảnh Markdown đều không được render", () => {
    renderBody("# Tiêu đề\n> trích dẫn\n| a | b |\n![ảnh](https://example.test/a.png)");
    for (const tag of ["h1", "h2", "h3", "blockquote", "table", "img"]) {
      expect(root().querySelector(tag)).toBeNull();
    }
  });
});

describe("liên kết chỉ nhận ba scheme", () => {
  it("javascript: không thành liên kết, và hiện nguyên văn cú pháp", () => {
    renderBody("[bấm đi](javascript:alert(1))");
    expect(root().querySelector("a")).toBeNull();
    expect(root()).toHaveTextContent("[bấm đi](javascript:alert(1))");
  });

  it("data: và file: cũng bị từ chối", () => {
    renderBody("[a](data:text/html,<script>x</script>) [b](file:///etc/passwd)");
    expect(root().querySelector("a")).toBeNull();
  });

  it("http và mailto được phép", () => {
    renderBody("[a](http://example.test) [b](mailto:ai@example.test)");
    expect(root().querySelectorAll("a")).toHaveLength(2);
  });

  it("đường dẫn tương đối không nằm trong allowlist nên không thành liên kết", () => {
    renderBody("[trang trong](/du-an/1)");
    expect(root().querySelector("a")).toBeNull();
  });

  it("mọi liên kết được render đều có rel bảo vệ — không có ngoại lệ nào", () => {
    renderBody("[a](https://a.test) [b](http://b.test) [c](mailto:c@d.test)");
    const links = [...root().querySelectorAll("a")];
    expect(links).toHaveLength(3);
    for (const link of links) expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("safeLinkHref", () => {
  it.each([
    ["https://a.test/x", true],
    ["http://a.test", true],
    ["mailto:a@b.test", true],
    ["javascript:alert(1)", false],
    ["JavaScript:alert(1)", false],
    ["data:text/html,x", false],
    ["file:///etc/passwd", false],
    ["/relative", false],
    ["", false],
    ["vbscript:msgbox(1)", false],
  ])("%s → %s", (raw, allowed) => {
    expect(safeLinkHref(raw) !== undefined).toBe(allowed);
  });
});
