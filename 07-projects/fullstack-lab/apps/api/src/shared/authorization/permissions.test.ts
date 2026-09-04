import { describe, expect, it } from "vitest";
import type { ProjectPermission, ProjectRole, WorkspacePermission } from "@flowboard/contracts";
import {
  ALL_PROJECT_PERMISSIONS,
  ALL_WORKSPACE_PERMISSIONS,
  CORE_MVP_PROJECT_PERMISSIONS,
  projectCapabilities,
  projectRoleAllows,
  workspaceCapabilities,
  workspaceRoleAllows,
} from "./permissions.ts";

/**
 * Ma trận phân quyền — `docs/security/authorization-test-matrix.md`.
 *
 * Tài liệu nói rõ: unit test phải đánh giá **từng ô** của cả hai ma trận. Vì
 * vậy bảng dưới đây được viết lại nguyên văn theo tài liệu, rồi test sinh ra
 * một assertion cho mỗi ô — thay vì chọn vài ô tiêu biểu. Ma trận phân quyền
 * sai ở một ô là một lỗ hổng thật, và "vài ô tiêu biểu" chính là cách một ô sai
 * sống sót qua review.
 *
 * `A` là Allow, `D` là Deny. Viết tắt để bảng giữ được hình dạng của tài liệu
 * gốc và đối chiếu bằng mắt được.
 */

const A = true;
const D = false;

/**
 * Sáu actor của fixture chuẩn, ánh xạ sang vai trò project của họ trên
 * Project B. `undefined` nghĩa là **không có dòng `project_members`** — trạng
 * thái của Workspace Admin chưa được thêm và của User A.
 */
type Actor =
  "owner" | "editor" | "editorTimeApprover" | "viewer" | "wsAdminNotMember" | "userA" | "userB";

const ACTOR_PROJECT_ROLE: Readonly<Record<Actor, ProjectRole | undefined>> = {
  owner: "owner",
  editor: "editor",
  editorTimeApprover: "editor",
  viewer: "viewer",
  // Không có dòng `project_members` cho Project B. Chức danh admin của workspace
  // không tạo ra một vai trò project.
  wsAdminNotMember: undefined,
  userA: undefined,
  // User B là Owner của Project B.
  userB: "owner",
};

const IS_TIME_APPROVER: Readonly<Record<Actor, boolean>> = {
  owner: false,
  editor: false,
  editorTimeApprover: true,
  viewer: false,
  wsAdminNotMember: false,
  userA: false,
  userB: false,
};

/**
 * Ma trận action đọc/ghi/quản lý/export trên Project B.
 *
 * Chép từ bảng "Action đọc, ghi, quản lý và export trên Project B" và bảng
 * "Action theo phase trên Project B" của tài liệu.
 */
const PROJECT_MATRIX: Readonly<Record<ProjectPermission, Readonly<Record<Actor, boolean>>>> = {
  //                              owner editor eTA   viewer wsAdmin userA userB
  "project:read": r(A, A, A, A, D, D, A),
  "project:update": r(A, D, D, D, D, D, A),
  "project:member:manage": r(A, D, D, D, D, D, A),
  "board-column:read": r(A, A, A, A, D, D, A),
  "board-column:manage": r(A, D, D, D, D, D, A),
  "task:read": r(A, A, A, A, D, D, A),
  "task:create": r(A, A, A, D, D, D, A),
  "task:update": r(A, A, A, D, D, D, A),
  "task:move": r(A, A, A, D, D, D, A),
  "task:assign": r(A, A, A, D, D, D, A),
  "comment:read": r(A, A, A, A, D, D, A),
  "comment:create": r(A, A, A, D, D, D, A),
  "activity:read": r(A, A, A, A, D, D, A),
  "report:export": r(A, D, D, D, D, D, A),

  // Phase 1.4
  "sprint:read": r(A, A, A, A, D, D, A),
  "sprint:manage": r(A, D, D, D, D, D, A),

  // Phase 1.3
  "time-tracking:settings:update": r(A, D, D, D, D, D, A),
  "work-log:read": r(A, A, A, A, D, D, A),
  "work-log:create:self": r(A, A, A, D, D, D, A),
  "work-log:update:self": r(A, A, A, D, D, D, A),
  "work-log:submit:self": r(A, A, A, D, D, D, A),
  // Đây là hai ô mà "Editor" tách làm đôi: chỉ Editor **đang giữ** record
  // approver mới Allow.
  "work-log:review": r(A, D, A, D, D, D, A),
  "work-log:backfill:override": r(A, D, D, D, D, D, A),
  "time-report:read": r(A, D, A, D, D, D, A),
};

function r(
  owner: boolean,
  editor: boolean,
  editorTimeApprover: boolean,
  viewer: boolean,
  wsAdminNotMember: boolean,
  userA: boolean,
  userB: boolean,
): Readonly<Record<Actor, boolean>> {
  return { owner, editor, editorTimeApprover, viewer, wsAdminNotMember, userA, userB };
}

/** Ma trận action cấp workspace, cùng bộ actor. */
const WORKSPACE_MATRIX: Readonly<Record<WorkspacePermission, Readonly<Record<Actor, boolean>>>> = {
  "workspace:read": r(A, A, A, A, A, A, A),
  "workspace:member:manage": r(D, D, D, D, A, D, D),
  "workspace:settings:update": r(D, D, D, D, A, D, D),
  "project:create": r(D, D, D, D, A, D, D),
};

/**
 * Vai trò **workspace** của từng actor. Mọi actor của fixture đều là thành viên
 * của cùng một workspace; chỉ một người là admin.
 */
const ACTOR_WORKSPACE_ROLE = {
  owner: "workspace_member",
  editor: "workspace_member",
  editorTimeApprover: "workspace_member",
  viewer: "workspace_member",
  wsAdminNotMember: "workspace_admin",
  userA: "workspace_member",
  userB: "workspace_member",
} as const;

const ACTORS = Object.keys(ACTOR_PROJECT_ROLE) as Actor[];

describe("ma trận permission cấp project", () => {
  it("phủ đúng catalog của contract — không thiếu, không thừa", () => {
    expect(Object.keys(PROJECT_MATRIX).sort()).toEqual([...ALL_PROJECT_PERMISSIONS].sort());
  });

  for (const permission of Object.keys(PROJECT_MATRIX) as ProjectPermission[]) {
    describe(permission, () => {
      for (const actor of ACTORS) {
        const expected = PROJECT_MATRIX[permission][actor];
        it(`${actor} → ${expected ? "Allow" : "Deny"}`, () => {
          expect(
            projectRoleAllows(ACTOR_PROJECT_ROLE[actor], permission, {
              isTimeApprover: IS_TIME_APPROVER[actor],
            }),
          ).toBe(expected);
        });
      }
    });
  }
});

describe("ma trận permission cấp workspace", () => {
  it("phủ đúng catalog của contract — không thiếu, không thừa", () => {
    expect(Object.keys(WORKSPACE_MATRIX).sort()).toEqual([...ALL_WORKSPACE_PERMISSIONS].sort());
  });

  for (const permission of Object.keys(WORKSPACE_MATRIX) as WorkspacePermission[]) {
    describe(permission, () => {
      for (const actor of ACTORS) {
        const expected = WORKSPACE_MATRIX[permission][actor];
        it(`${actor} → ${expected ? "Allow" : "Deny"}`, () => {
          expect(workspaceRoleAllows(ACTOR_WORKSPACE_ROLE[actor], permission)).toBe(expected);
        });
      }
    });
  }
});

describe("không có quyền ngầm định từ workspace sang project", () => {
  it("Workspace Admin chưa là project member bị Deny mọi action của project", () => {
    for (const permission of ALL_PROJECT_PERMISSIONS) {
      expect(projectRoleAllows(undefined, permission, { isTimeApprover: true })).toBe(false);
    }
  });

  it("cả `isTimeApprover` cũng không cấp quyền cho người không phải member", () => {
    // Một record approver mồ côi không được biến thành đường vòng vào project.
    expect(projectRoleAllows(undefined, "work-log:review", { isTimeApprover: true })).toBe(false);
  });
});

describe("capabilities công bố cho frontend", () => {
  it("chỉ chứa permission của core MVP, không chứa permission của phase chưa mở", () => {
    for (const role of ["owner", "editor", "viewer"] as const) {
      for (const capability of projectCapabilities(role)) {
        expect(CORE_MVP_PROJECT_PERMISSIONS).toContain(capability);
      }
    }
  });

  it("Owner nhận đủ 13 capability của core MVP", () => {
    expect(projectCapabilities("owner")).toEqual([...CORE_MVP_PROJECT_PERMISSIONS]);
  });

  it("Editor không nhận capability quản trị", () => {
    const editor = projectCapabilities("editor");
    expect(editor).not.toContain("project:update");
    expect(editor).not.toContain("project:member:manage");
    expect(editor).not.toContain("board-column:manage");
    expect(editor).toContain("task:move");
  });

  it("Viewer không nhận capability ghi nào", () => {
    expect(projectCapabilities("viewer")).toEqual([
      "project:read",
      "board-column:read",
      "task:read",
      "comment:read",
      "activity:read",
    ]);
  });

  it("người không phải member nhận danh sách rỗng, không phải danh sách chỉ-đọc", () => {
    expect(projectCapabilities(undefined)).toEqual([]);
  });

  it("Workspace Admin nhận capability workspace nhưng không có capability project", () => {
    expect(workspaceCapabilities("workspace_admin")).toEqual([
      "workspace:read",
      "workspace:member:manage",
      "workspace:settings:update",
      "project:create",
    ]);
    expect(workspaceCapabilities("workspace_member")).toEqual(["workspace:read"]);
  });

  it("capabilities giữ thứ tự ổn định giữa các lần gọi", () => {
    expect(projectCapabilities("editor")).toEqual(projectCapabilities("editor"));
  });
});
