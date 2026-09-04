import { describe, expect, it } from "vitest";
import { capabilitiesByRole } from "@flowboard/mock";
import type { Permission } from "@flowboard/contracts";
import { can } from "./can.ts";

/**
 * `can` là **cửa duy nhất** mà UI dùng để quyết định affordance, nên thứ tự
 * resolve của nó phải được chứng minh chứ không chỉ được mô tả.
 */

const owner = { capabilities: capabilitiesByRole.owner as readonly Permission[] };
const editor = { capabilities: capabilitiesByRole.editor as readonly Permission[] };
const viewer = { capabilities: capabilitiesByRole.viewer as readonly Permission[] };

describe("capability quyết định affordance, role thì không", () => {
  it("Owner quản lý được thành viên và đổi được tên dự án", () => {
    expect(can("project:member:manage", owner)).toBe(true);
    expect(can("project:update", owner)).toBe(true);
  });

  it("Editor ghi được task nhưng KHÔNG quản lý được thành viên hay settings", () => {
    expect(can("task:create", editor)).toBe(true);
    expect(can("project:member:manage", editor)).toBe(false);
    expect(can("project:update", editor)).toBe(false);
  });

  it("Viewer chỉ đọc — không một action ghi nào", () => {
    expect(can("project:read", viewer)).toBe(true);
    for (const action of [
      "task:create",
      "task:update",
      "task:move",
      "task:assign",
      "comment:create",
      "project:update",
      "project:member:manage",
      "board-column:manage",
    ] as const) {
      expect(can(action, viewer)).toBe(false);
    }
  });
});

describe("deny by default", () => {
  it("không có capabilities thì mọi action bị từ chối", () => {
    expect(can("project:read", undefined)).toBe(false);
    expect(can("project:read", null)).toBe(false);
    expect(can("project:read", {})).toBe(false);
  });

  it("danh sách rỗng cũng là từ chối, không phải 'chưa biết nên cho qua'", () => {
    expect(can("project:read", { capabilities: [] })).toBe(false);
  });
});

describe("capability theo từng record thắng capability mức project", () => {
  it("record có capabilities riêng thì danh sách đó quyết định", () => {
    const record = { capabilities: ["work-log:update:self"] as readonly Permission[] };
    // Project cho `work-log:review`, nhưng chính record này thì không.
    const project = { capabilities: ["work-log:review"] as readonly Permission[] };

    expect(can("work-log:update:self", record, project)).toBe(true);
    expect(can("work-log:review", record, project)).toBe(false);
  });

  it("record KHÔNG có capabilities thì mới rơi xuống mức project", () => {
    const project = { capabilities: ["work-log:review"] as readonly Permission[] };

    expect(can("work-log:review", {}, project)).toBe(true);
    expect(can("work-log:review", undefined, project)).toBe(true);
  });

  it("record có capabilities RỖNG vẫn thắng — rỗng là một câu trả lời, không phải thiếu dữ liệu", () => {
    const project = { capabilities: ["work-log:review"] as readonly Permission[] };
    expect(can("work-log:review", { capabilities: [] }, project)).toBe(false);
  });
});
