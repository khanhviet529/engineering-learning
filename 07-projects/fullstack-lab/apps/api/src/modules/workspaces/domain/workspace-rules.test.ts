import { describe, expect, it } from "vitest";
import { AppError } from "../../../shared/errors/app-error.ts";
import {
  CREATOR_WORKSPACE_ROLE,
  assertCanProvisionWorkspace,
  assertNoDependentProjectMembership,
  canProvisionWorkspace,
} from "./workspace-rules.ts";

describe("chính sách cấp phát workspace", () => {
  it("actor đã xác minh email thì được tạo", () => {
    expect(canProvisionWorkspace({ emailVerified: true })).toBe(true);
  });

  it("actor chưa xác minh thì không — nếu không, luồng xác minh mất ý nghĩa", () => {
    expect(canProvisionWorkspace({ emailVerified: false })).toBe(false);
    expect(() => {
      assertCanProvisionWorkspace({ emailVerified: false });
    }).toThrow(AppError);
  });

  it("người tạo luôn là admin của workspace mình tạo", () => {
    // Nếu không, workspace mới sẽ không có ai quản trị được và không có đường
    // nào sửa qua API.
    expect(CREATOR_WORKSPACE_ROLE).toBe("workspace_admin");
  });
});

describe("gỡ workspace member không được để lại membership project mồ côi", () => {
  it("không còn project nào thì cho qua", () => {
    expect(() => {
      assertNoDependentProjectMembership(0);
    }).not.toThrow();
  });

  it("còn dù chỉ một project thì chặn", () => {
    expect(() => {
      assertNoDependentProjectMembership(1);
    }).toThrow(AppError);
  });

  it("thông điệp không nói project nào — Workspace Admin không có quyền biết", () => {
    try {
      assertNoDependentProjectMembership(3);
      throw new Error("đáng lẽ phải ném");
    } catch (error) {
      const message = (error as AppError).message;
      // Không đếm, không tên, không ID: cả ba đều là thông tin về project riêng tư.
      expect(message).not.toContain("3");
      expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });
});
