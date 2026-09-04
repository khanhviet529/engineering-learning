import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  evaluatePassword,
  hashPassword,
  normalizePassword,
  verifyPassword,
} from "./password.ts";
import { isBlockedPassword } from "./password-blocklist.ts";

const identity = { email: "mai.nguyen@example.test", displayName: "Mai Nguyen" };

describe("độ dài, không có quy tắc composition", () => {
  it("nhận mật khẩu chỉ gồm chữ thường nếu đủ dài — không đòi hoa, số hay ký hiệu", () => {
    expect(evaluatePassword("conmeoquathuong", identity)).toEqual([]);
  });

  it("nhận mật khẩu có khoảng trắng", () => {
    expect(evaluatePassword("mot cau dai lam mat khau", identity)).toEqual([]);
  });

  it("nhận ký tự ngoài ASCII", () => {
    expect(evaluatePassword("mật khẩu tiếng Việt có dấu", identity)).toEqual([]);
  });

  it.each([
    ["ngắn hơn giới hạn", "a".repeat(PASSWORD_MIN_LENGTH - 1), "too_short"],
    ["dài hơn giới hạn", "a".repeat(PASSWORD_MAX_LENGTH + 1), "too_long"],
  ])("từ chối khi %s", (_label, value, kind) => {
    expect(evaluatePassword(value, identity).map((r) => r.kind)).toContain(kind);
  });

  it("đếm theo code point, không theo UTF-16 code unit", () => {
    // 12 emoji = 12 ký tự với người dùng, nhưng `.length` là 24.
    const twelveEmoji = "🙂".repeat(12);
    expect(twelveEmoji.length).toBe(24);
    expect(evaluatePassword(twelveEmoji, identity).map((r) => r.kind)).not.toContain("too_short");

    const elevenEmoji = "🙂".repeat(11);
    expect(evaluatePassword(elevenEmoji, identity).map((r) => r.kind)).toContain("too_short");
  });
});

describe("NFKC được áp giống nhau ở mọi đường đi", () => {
  it("hai cách gõ cùng một chuỗi cho cùng kết quả normalize", () => {
    // "ế" dựng sẵn, và "ế" ghép từ "ê" + dấu sắc tổ hợp.
    const precomposed = "mật khẩu tiếng Việt";
    const decomposed = "mật khẩu tiếng Việt".normalize("NFD");
    expect(decomposed).not.toBe(precomposed);
    expect(normalizePassword(decomposed)).toBe(normalizePassword(precomposed));
  });

  it("mật khẩu gõ bằng tổ hợp vẫn đăng nhập được sau khi băm từ dạng dựng sẵn", async () => {
    const precomposed = "mật khẩu tiếng Việt";
    const stored = await hashPassword(precomposed);
    expect(await verifyPassword(stored, precomposed.normalize("NFD"))).toBe(true);
  });
});

describe("không được chứa danh tính của chính account", () => {
  it.each([
    ["local-part của email", "mai.nguyen-that-la-dai"],
    ["một phần display name", "nguyen-cua-toi-day-nhe"],
  ])("từ chối khi mật khẩu chứa %s", (_label, value) => {
    expect(evaluatePassword(value, identity).map((r) => r.kind)).toContain("contains_identity");
  });

  it("không phân biệt hoa thường", () => {
    expect(evaluatePassword("MAI.NGUYEN cua toi day", identity).map((r) => r.kind)).toContain(
      "contains_identity",
    );
  });

  it("mảnh dưới bốn ký tự không tính là chứa", () => {
    const shortIdentity = { email: "an@example.test", displayName: "An" };
    expect(
      evaluatePassword("an toan tuyet doi nhe", shortIdentity).map((r) => r.kind),
    ).not.toContain("contains_identity");
  });
});

describe("blocklist", () => {
  it.each(["password", "123456789", "qwerty", "matkhau", "flowboard"])("chặn %s", (value) => {
    expect(isBlockedPassword(value)).toBe(true);
  });

  it("chặn cả biến thể thêm số ở cuối — cách né phổ biến nhất", () => {
    expect(isBlockedPassword("password2026")).toBe(true);
    expect(isBlockedPassword("qwerty99")).toBe(true);
  });

  it("không chặn nhầm mật khẩu bình thường có số ở cuối", () => {
    expect(isBlockedPassword("conmeoquathuong2026")).toBe(false);
  });

  it("blocklist chạy trong process, không gọi ra ngoài", async () => {
    // Không có cách trực tiếp để khẳng định "không có network call", nhưng hàm
    // là đồng bộ và thuần: một lượt tra ra ngoài buộc phải bất đồng bộ.
    expect(isBlockedPassword("password")).toBe(true);
    expect(typeof isBlockedPassword("password")).toBe("boolean");
  });
});

describe("Argon2id", () => {
  it("băm rồi kiểm lại được", async () => {
    const stored = await hashPassword("mot mat khau du dai");
    expect(stored.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(stored, "mot mat khau du dai")).toBe(true);
  });

  it("từ chối mật khẩu sai", async () => {
    const stored = await hashPassword("mot mat khau du dai");
    expect(await verifyPassword(stored, "mot mat khau khac han")).toBe(false);
  });

  it("hai lần băm cùng mật khẩu cho hai hash khác nhau — có salt", async () => {
    const a = await hashPassword("mot mat khau du dai");
    const b = await hashPassword("mot mat khau du dai");
    expect(a).not.toBe(b);
  });

  it("không truncate: hai mật khẩu dài khác nhau ở ký tự cuối vẫn phân biệt được", async () => {
    const base = "b".repeat(PASSWORD_MAX_LENGTH - 1);
    const stored = await hashPassword(base + "x");
    expect(await verifyPassword(stored, base + "y")).toBe(false);
    expect(await verifyPassword(stored, base + "x")).toBe(true);
  });

  it("hash hỏng trả false thay vì ném lỗi", async () => {
    expect(await verifyPassword("khong-phai-hash", "mot mat khau du dai")).toBe(false);
  });
});
