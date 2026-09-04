import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERROR_STATUS, type ErrorCode } from "./error-codes.js";
import { PERMISSIONS } from "./capabilities.js";

/**
 * Cổng ra đo được của M0.2.
 *
 * Test này không kiểm code chạy đúng — nó kiểm **hợp đồng TypeScript và hợp
 * đồng Markdown không trôi khỏi nhau**. Đây là loại lỗi im lặng nhất trong dự
 * án: cả hai bên đều "đúng" theo tài liệu mình đọc, và chỉ lộ ra ở tích hợp.
 *
 * Nếu ai đó thêm một error code vào enum mà quên bảng Markdown, hoặc sửa status
 * trong tài liệu mà quên code, build fail ngay tại đây.
 */

const docsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs");

const endpointContracts = readFileSync(resolve(docsDir, "api/endpoint-contracts.md"), "utf8");
const authorizationModel = readFileSync(
  resolve(docsDir, "security/authorization-model.md"),
  "utf8",
);

/** Đọc bảng "Danh mục error code": `| \`CODE\` | status | ... |`. */
function parseErrorCatalogue(): Map<ErrorCode, number> {
  const rows = endpointContracts.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*(\d{3}|5xx)\s*\|/gm);
  const out = new Map<ErrorCode, number>();
  for (const row of rows) {
    const code = row[1] as ErrorCode;
    const status = row[2] === "5xx" ? 500 : Number(row[2]);
    out.set(code, status);
  }
  return out;
}

describe("danh mục error code khớp tài liệu", () => {
  const catalogue = parseErrorCatalogue();

  it("bảng Markdown đọc được và không rỗng", () => {
    expect(catalogue.size).toBeGreaterThan(0);
  });

  it("mọi code trong tài liệu đều có trong enum", () => {
    const missing = [...catalogue.keys()].filter((c) => !ERROR_CODES.includes(c));
    expect(missing).toEqual([]);
  });

  it("mọi code trong enum đều có trong tài liệu", () => {
    const extra = ERROR_CODES.filter((c) => !catalogue.has(c));
    expect(extra).toEqual([]);
  });

  it("status của từng code khớp tài liệu", () => {
    const mismatched = [...catalogue.entries()]
      .filter(([code, status]) => ERROR_STATUS[code] !== status)
      .map(([code, status]) => `${code}: doc ${status} vs code ${ERROR_STATUS[code]}`);
    expect(mismatched).toEqual([]);
  });
});

describe("catalog permission khớp tài liệu", () => {
  it("mọi permission trong enum đều xuất hiện trong authorization model", () => {
    const missing = PERMISSIONS.filter((p) => !authorizationModel.includes(`\`${p}\``));
    expect(missing).toEqual([]);
  });

  it("mọi permission project trong bảng catalog đều có trong enum", () => {
    const rows = authorizationModel.matchAll(/^\|\s*`([a-z][a-z-]*(?::[a-z-]+)+)`\s*\|/gm);
    const documented = [...rows].map((r) => r[1] as string);
    expect(documented.length).toBeGreaterThan(0);
    const missing = documented.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
    expect(missing).toEqual([]);
  });
});
