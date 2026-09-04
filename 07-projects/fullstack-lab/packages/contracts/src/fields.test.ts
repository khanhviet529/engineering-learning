import { describe, expect, it } from "vitest";
import { EVIDENCE_URL_MAX_LENGTH, evidenceUrlSchema, positionSchema } from "./fields.js";

/**
 * `evidenceUrl` là một ranh giới bảo mật, không phải một field tiện lợi: nó
 * được render thành link mà người dùng sẽ bấm. Vì vậy schema của nó phải có
 * test riêng chứ không chỉ có mô tả trong hợp đồng.
 */
describe("evidenceUrl", () => {
  it("nhận URL https tuyệt đối", () => {
    expect(evidenceUrlSchema.safeParse("https://example.test/a?b=1#c").success).toBe(true);
  });

  it.each([
    ["http", "http://example.test/a"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,<script>alert(1)</script>"],
    ["file", "file:///etc/passwd"],
    ["đường dẫn tương đối", "/a/b"],
    ["chuỗi rỗng", ""],
  ])("từ chối scheme %s", (_label, value) => {
    expect(evidenceUrlSchema.safeParse(value).success).toBe(false);
  });

  it("từ chối URL dài hơn giới hạn", () => {
    const tooLong = "https://example.test/" + "a".repeat(EVIDENCE_URL_MAX_LENGTH);
    expect(tooLong.length).toBeGreaterThan(EVIDENCE_URL_MAX_LENGTH);
    expect(evidenceUrlSchema.safeParse(tooLong).success).toBe(false);
  });
});

describe("position", () => {
  it("nhận chuỗi thập phân mà server cấp", () => {
    expect(positionSchema.safeParse("100.0000000000").success).toBe(true);
  });

  it.each([
    ["số âm", "-1"],
    ["SQL", "1; DROP TABLE tasks"],
    ["không phải số", "abc"],
  ])("từ chối %s", (_label, value) => {
    expect(positionSchema.safeParse(value).success).toBe(false);
  });
});
