import { describe, expect, it } from "vitest";
import { AppError } from "../../../shared/errors/app-error.ts";
import {
  NoTasksYetAssigneeCheck,
  assertNotAssignedToTasks,
  assertProjectKeepsAnOwner,
  ownerCountAfterRemoval,
  ownerCountAfterRoleChange,
} from "./project-membership-rules.ts";

/**
 * Số học của bất biến Owner, tách khỏi database.
 *
 * Đếm Owner sau một thay đổi là chỗ dễ sai theo cách mà integration test khó
 * bắt: nó chỉ sai ở đúng một tổ hợp vai-trò-cũ / vai-trò-mới, và integration
 * test thường chỉ chạy một tổ hợp. Ở đây phủ hết cả chín.
 */

const ROLES = ["owner", "editor", "viewer"] as const;

describe("đếm Owner sau khi đổi vai trò", () => {
  for (const from of ROLES) {
    for (const to of ROLES) {
      const expected =
        from === "owner" && to !== "owner" ? 2 : from !== "owner" && to === "owner" ? 4 : 3;
      it(`${from} → ${to}: 3 Owner thành ${String(expected)}`, () => {
        expect(ownerCountAfterRoleChange(3, from, to)).toBe(expected);
      });
    }
  }

  it("owner → owner không đổi số lượng", () => {
    expect(ownerCountAfterRoleChange(1, "owner", "owner")).toBe(1);
  });
});

describe("đếm Owner sau khi gỡ member", () => {
  it("gỡ một Owner làm giảm một", () => {
    expect(ownerCountAfterRemoval(2, "owner")).toBe(1);
  });

  it("gỡ Editor hay Viewer không đụng tới số Owner", () => {
    expect(ownerCountAfterRemoval(1, "editor")).toBe(1);
    expect(ownerCountAfterRemoval(1, "viewer")).toBe(1);
  });
});

describe("project phải luôn còn ít nhất một Owner", () => {
  it("còn Owner thì cho qua", () => {
    expect(() => {
      assertProjectKeepsAnOwner(1);
    }).not.toThrow();
  });

  it("về 0 thì chặn", () => {
    expect(() => {
      assertProjectKeepsAnOwner(0);
    }).toThrow(AppError);
  });

  it("số âm cũng chặn — không có nhánh nào để lọt", () => {
    expect(() => {
      assertProjectKeepsAnOwner(-1);
    }).toThrow(AppError);
  });

  it("lỗi mang code 409 riêng, không dùng lại code optimistic concurrency", () => {
    // Ba code `409` sẵn có đều là optimistic concurrency. Dùng lại một trong số
    // chúng sẽ nói dối client rằng "tải lại rồi gửi lại sẽ xong", trong khi tải
    // lại không giúp gì — người dùng phải chỉ định một Owner khác trước.
    try {
      assertProjectKeepsAnOwner(0);
      throw new Error("đáng lẽ phải ném");
    } catch (error) {
      const appError = error as AppError;
      expect(appError.code).toBe("PROJECT_LAST_OWNER");
      expect(appError.status).toBe(409);
      // Danh mục công bố code này KHÔNG có `details`.
      expect(appError.details).toBeUndefined();
    }
  });

  it("thông điệp không lộ danh tính của Owner nào", () => {
    try {
      assertProjectKeepsAnOwner(0);
      throw new Error("đáng lẽ phải ném");
    } catch (error) {
      const message = (error as AppError).message;
      expect(message).not.toMatch(/@/);
      expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });
});

describe("không gỡ member đang giữ việc", () => {
  it("không giữ việc thì cho qua", () => {
    expect(() => {
      assertNotAssignedToTasks(false);
    }).not.toThrow();
  });

  it("đang giữ việc thì chặn, và không có nhánh tự unassign", () => {
    expect(() => {
      assertNotAssignedToTasks(true);
    }).toThrow(AppError);
  });
});

describe("adapter assignee của M2", () => {
  it("trả false vì bảng tasks chưa tồn tại — đúng sự thật, không phải chỗ nối bỏ trống", async () => {
    const check = new NoTasksYetAssigneeCheck();
    expect(await check.hasAssignedTasks()).toBe(false);
  });
});
