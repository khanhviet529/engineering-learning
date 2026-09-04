import { describe, expect, it } from "vitest";
import {
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  csrfTokenMatches,
  deriveCsrfToken,
  generateOneTimeToken,
  generateSessionToken,
  hashSessionToken,
  isSessionUsable,
  sessionCookieOptions,
  sessionExpiry,
} from "./session.ts";

describe("session token", () => {
  it("mỗi lần sinh cho một giá trị khác nhau", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateSessionToken()));
    expect(seen.size).toBe(500);
  });

  it("đủ dài để không brute-force được — 32 byte", () => {
    const token = generateSessionToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("an toàn cho URL và cookie: không có ký tự cần escape", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("hash tất định, và hash không suy ngược ra token", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toContain(token);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hai token khác nhau cho hai hash khác nhau", () => {
    expect(hashSessionToken(generateSessionToken())).not.toBe(
      hashSessionToken(generateSessionToken()),
    );
  });
});

describe("vòng đời session", () => {
  const now = new Date("2026-09-04T10:00:00Z");

  it("hạn dùng đúng bằng TTL kể từ lúc tạo", () => {
    expect(sessionExpiry(now).getTime() - now.getTime()).toBe(SESSION_TTL_MS);
  });

  it("còn hạn và chưa revoke thì dùng được", () => {
    expect(isSessionUsable({ expiresAt: sessionExpiry(now), revokedAt: null }, now)).toBe(true);
  });

  it("hết hạn thì không dùng được", () => {
    const expired = new Date(now.getTime() - 1);
    expect(isSessionUsable({ expiresAt: expired, revokedAt: null }, now)).toBe(false);
  });

  it("đã revoke thì không dùng được, dù còn hạn", () => {
    expect(isSessionUsable({ expiresAt: sessionExpiry(now), revokedAt: new Date(now) }, now)).toBe(
      false,
    );
  });

  it("đúng thời điểm hết hạn là không còn dùng được", () => {
    expect(isSessionUsable({ expiresAt: new Date(now), revokedAt: null }, now)).toBe(false);
  });
});

describe("cookie session", () => {
  it("luôn HttpOnly — XSS không được biến thành đánh cắp phiên", () => {
    expect(sessionCookieOptions("development").httpOnly).toBe(true);
    expect(sessionCookieOptions("production").httpOnly).toBe(true);
  });

  it("Secure bật ngoài development", () => {
    expect(sessionCookieOptions("production").secure).toBe(true);
    expect(sessionCookieOptions("test").secure).toBe(true);
  });

  it("chỉ development mới được nới lỏng Secure", () => {
    expect(sessionCookieOptions("development").secure).toBe(false);
  });

  it("SameSite lax và path gốc", () => {
    const options = sessionCookieOptions("production");
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.name).toBe(SESSION_COOKIE_NAME);
  });
});

describe("CSRF token gắn với session", () => {
  const secret = "c".repeat(32);

  it("cùng session cho cùng token — suy lại được, không cần lưu", () => {
    const session = generateSessionToken();
    expect(deriveCsrfToken(session, secret)).toBe(deriveCsrfToken(session, secret));
  });

  it("hai session khác nhau cho hai CSRF token khác nhau", () => {
    expect(deriveCsrfToken(generateSessionToken(), secret)).not.toBe(
      deriveCsrfToken(generateSessionToken(), secret),
    );
  });

  it("đổi secret thì token đổi — xoay secret vô hiệu hoá token cũ", () => {
    const session = generateSessionToken();
    expect(deriveCsrfToken(session, secret)).not.toBe(deriveCsrfToken(session, "d".repeat(32)));
  });

  it("CSRF token không lộ session token", () => {
    const session = generateSessionToken();
    expect(deriveCsrfToken(session, secret)).not.toContain(session);
  });

  it("so khớp đúng chỉ khi trùng hoàn toàn", () => {
    const token = deriveCsrfToken(generateSessionToken(), secret);
    expect(csrfTokenMatches(token, token)).toBe(true);
    expect(csrfTokenMatches(token, token.slice(0, -1) + "x")).toBe(false);
  });

  it("độ dài khác nhau trả false, không ném lỗi", () => {
    expect(csrfTokenMatches("abc", "abcd")).toBe(false);
    expect(csrfTokenMatches("", "abc")).toBe(false);
  });
});

describe("token một lần", () => {
  it("cùng tính chất với session token: entropy cao, chỉ lưu hash", () => {
    const token = generateOneTimeToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("token xác minh sống lâu hơn token reset — reset là đường nhạy cảm hơn", () => {
    expect(EMAIL_VERIFICATION_TTL_MS).toBeGreaterThan(PASSWORD_RESET_TTL_MS);
  });
});
