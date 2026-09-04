import { describe, expect, it } from "vitest";
import { DEFAULT_RETURN_PATH, safeReturnPath } from "./safe-return.ts";

/**
 * Đích quay lại là một giá trị **do người gửi liên kết viết**.
 *
 * Vì vậy bộ kiểm này viết theo hướng tấn công: mỗi trường hợp dưới đây là một
 * chuỗi thật sự được dùng để biến trang đăng nhập của một sản phẩm thành bàn
 * đạp chuyển hướng. Một cái lọt là đủ để `/dang-nhap?next=…` gửi người dùng
 * sang tên miền khác ngay sau khi họ vừa gõ mật khẩu.
 */

describe("safeReturnPath — nhận đường dẫn nội bộ", () => {
  it("giữ nguyên đường dẫn tương đối", () => {
    expect(safeReturnPath("/khong-gian-lam-viec")).toBe("/khong-gian-lam-viec");
  });

  it("giữ query string, vì WSP-05 mang token trong đó", () => {
    expect(safeReturnPath("/loi-moi/chap-nhan?token=abc123")).toBe(
      "/loi-moi/chap-nhan?token=abc123",
    );
  });

  it("giữ fragment", () => {
    expect(safeReturnPath("/du-an/1#thanh-vien")).toBe("/du-an/1#thanh-vien");
  });
});

describe("safeReturnPath — từ chối mọi đích ngoài miền", () => {
  const hostile = [
    ["URL tuyệt đối", "https://evil.test/thu-hoach"],
    ["URL tuyệt đối http", "http://evil.test"],
    ["protocol-relative", "//evil.test"],
    ["protocol-relative có path", "//evil.test/dang-nhap"],
    ["gạch ngược thay gạch chéo", "/\\evil.test"],
    ["gạch ngược ở giữa", "/khong-gian\\..\\..\\evil.test"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["mailto:", "mailto:ai-do@example.test"],
    ["xuống dòng chèn giữa", "/\n//evil.test"],
    ["tab chèn giữa", "/\t//evil.test"],
    ["ký tự NUL", "/khong-gian\u0000//evil.test"],
    ["đường dẫn tương đối không có gạch đầu", "khong-gian-lam-viec"],
    ["chuỗi rỗng", ""],
  ] as const;

  it.each(hostile)("%s rơi về đích mặc định", (_label, value) => {
    expect(safeReturnPath(value)).toBe(DEFAULT_RETURN_PATH);
  });

  it("undefined và null rơi về đích mặc định", () => {
    expect(safeReturnPath(undefined)).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath(null)).toBe(DEFAULT_RETURN_PATH);
  });

  it("fallback tuỳ chọn được tôn trọng", () => {
    expect(safeReturnPath("https://evil.test", "/dang-nhap")).toBe("/dang-nhap");
  });

  it("không có chuỗi thù địch nào lọt ra ngoài dưới dạng khác", () => {
    // Phép kiểm cuối: không giá trị trả về nào được mang tên miền lạ, kể cả khi
    // một trong các phép lọc phía trên bị nới lỏng theo kiểu không ai để ý.
    for (const [, value] of hostile) {
      expect(safeReturnPath(value)).not.toContain("evil.test");
    }
  });
});
