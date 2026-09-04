import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "./session-cookie.ts";
import { csrfTokenMatches, deriveCsrfToken } from "./csrf.ts";

/**
 * Cookie session và CSRF sau khi chuyển sang `shared/http/`.
 *
 * Cùng những khẳng định đã có ở module `auth`, chỉ đổi chỗ ở: hai thứ này nay
 * có ba consumer, nên chúng thuộc về shared theo quy tắc hai consumer.
 */

const MAX_AGE = 30 * 24 * 60 * 60;
const generateSessionToken = () => randomBytes(32).toString("base64url");

describe("cookie session", () => {
  it("luôn HttpOnly — XSS không được biến thành đánh cắp phiên", () => {
    expect(sessionCookieOptions("development", MAX_AGE).httpOnly).toBe(true);
    expect(sessionCookieOptions("production", MAX_AGE).httpOnly).toBe(true);
  });

  it("Secure bật ngoài development", () => {
    expect(sessionCookieOptions("production", MAX_AGE).secure).toBe(true);
    expect(sessionCookieOptions("test", MAX_AGE).secure).toBe(true);
  });

  it("chỉ development mới được nới lỏng Secure", () => {
    expect(sessionCookieOptions("development", MAX_AGE).secure).toBe(false);
  });

  it("SameSite lax và path gốc", () => {
    const options = sessionCookieOptions("production", MAX_AGE);
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
