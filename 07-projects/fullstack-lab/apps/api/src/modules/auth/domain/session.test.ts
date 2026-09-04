import { describe, expect, it } from "vitest";
import {
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  SESSION_TTL_MS,
  generateOneTimeToken,
  generateSessionToken,
  hashSessionToken,
  isSessionUsable,
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
