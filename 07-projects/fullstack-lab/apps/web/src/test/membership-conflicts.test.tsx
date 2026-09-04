import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { actors, capabilitiesByRole, ids, members, projectB, workspace } from "@flowboard/mock";
import { failure, mockRoutes, ok, renderWithProviders, resetNavigation, user } from "./harness.tsx";
import { ProjectMembersScreen } from "../features/members/project-members.tsx";
import { WorkspaceMembersScreen } from "../features/workspaces/workspace-members.tsx";

/**
 * Ba xung đột trạng thái membership: `PROJECT_LAST_OWNER`,
 * `MEMBER_HAS_ASSIGNED_TASKS`, `WORKSPACE_MEMBER_IN_PROJECTS`.
 *
 * Điều phải chứng minh không phải "có hiện lỗi", mà là **UI không chỉ sai
 * đường**. Ba code này là `409` nhưng không phải optimistic concurrency: tải
 * lại rồi gửi lại cho đúng câu trả lời cũ. Vì vậy mỗi test dưới đây kiểm ba
 * điều:
 *
 * 1. **Không** có nút `Thử lại` ở bất kỳ đâu trên màn.
 * 2. Có một câu nói **việc phải làm trước**.
 * 3. Đúng hành động vừa bị từ chối bị khoá, không phải cả hộp thoại.
 */

const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });
const WORKSPACES = ok({ items: [workspace], page: { nextCursor: null, hasMore: false } });

/** Hình dạng thật của `GET /projects/:projectId` ở M2: `columns` rỗng. */
const PROJECT_DETAIL_M2 = ok({
  project: projectB,
  capabilities: capabilitiesByRole.owner,
  columns: [],
  members,
});

const detailRoute = `/projects/${ids.projectB}`;
const projectMemberRoute = `/projects/${ids.projectB}/members/${ids.userOwnerB}`;
const workspaceMembersRoute = `/workspaces/${ids.workspace}/members`;

const WORKSPACE_MEMBERS = ok({
  items: [
    {
      userId: ids.userEditorB,
      displayName: "An Tran",
      email: "an@example.test",
      role: "workspace_member" as const,
      createdAt: "2026-09-01T08:30:00Z",
    },
  ],
  page: { nextCursor: null, hasMore: false },
});

beforeEach(() => {
  resetNavigation();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openManageDialog() {
  const actor = user();
  renderWithProviders(<ProjectMembersScreen projectId={ids.projectB} />);
  await screen.findByRole("table");
  await actor.click(screen.getAllByRole("button", { name: "Quản lý" })[0]!);
  return { actor, dialog: await screen.findByRole("dialog") };
}

describe("PROJECT_LAST_OWNER — hạ hoặc gỡ Owner cuối cùng", () => {
  it("khi gỡ: nói phải nâng người khác lên Owner trước, và KHÔNG có nút thử lại", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: PROJECT_DETAIL_M2,
      [projectMemberRoute]: failure("project-last-owner"),
    });
    const { actor, dialog } = await openManageDialog();

    await actor.click(within(dialog).getByRole("button", { name: "Gỡ khỏi dự án" }));

    expect(
      await within(dialog).findByText(/nâng một thành viên khác lên Owner trước/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Hệ thống không tự chuyển quyền sở hữu/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thử lại/ })).not.toBeInTheDocument();
  });

  it("khoá đúng nút vừa bị từ chối, hộp thoại vẫn đóng được", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: PROJECT_DETAIL_M2,
      [projectMemberRoute]: failure("project-last-owner"),
    });
    const { actor, dialog } = await openManageDialog();

    const remove = within(dialog).getByRole("button", { name: "Gỡ khỏi dự án" });
    await actor.click(remove);
    await within(dialog).findByText(/nâng một thành viên khác lên Owner trước/i);

    expect(within(dialog).getByRole("button", { name: "Gỡ khỏi dự án" })).toBeDisabled();
    // Đóng vẫn được: người dùng phải đi làm việc khác, nên đường ra phải mở.
    expect(within(dialog).getByRole("button", { name: "Đóng" })).toBeEnabled();
  });

  it("khi đổi vai trò bị từ chối: chọn một vai trò KHÁC thì nút lưu mở lại", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: PROJECT_DETAIL_M2,
      [projectMemberRoute]: failure("project-last-owner"),
    });
    const { actor, dialog } = await openManageDialog();

    const select = within(dialog).getByRole("combobox", { name: /Vai trò trong dự án/ });
    await actor.selectOptions(select, "viewer");
    await actor.click(within(dialog).getByRole("button", { name: "Lưu vai trò" }));
    await within(dialog).findByText(/nâng một thành viên khác lên Owner trước/i);

    expect(within(dialog).getByRole("button", { name: "Lưu vai trò" })).toBeDisabled();

    // Một lựa chọn khác là một request khác — đường đi đúng không bị khoá theo.
    await actor.selectOptions(select, "editor");
    expect(within(dialog).getByRole("button", { name: "Lưu vai trò" })).toBeEnabled();
  });
});

describe("MEMBER_HAS_ASSIGNED_TASKS", () => {
  it("ở PRM-01: nói phải giao lại việc trước, không hứa hệ thống tự bỏ gán", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: PROJECT_DETAIL_M2,
      [projectMemberRoute]: failure("member-has-assigned-tasks"),
    });
    const { actor, dialog } = await openManageDialog();

    await actor.click(within(dialog).getByRole("button", { name: "Gỡ khỏi dự án" }));

    expect(
      await within(dialog).findByText(/giao những việc đó cho người khác trước/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Hệ thống không tự bỏ gán việc/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thử lại/ })).not.toBeInTheDocument();
  });

  it("ở WSP-03: cùng thông điệp, và nút gỡ bị khoá", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [workspaceMembersRoute]: WORKSPACE_MEMBERS,
      [`/workspaces/${ids.workspace}/members/${ids.userEditorB}`]: failure(
        "member-has-assigned-tasks",
      ),
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    await screen.findByRole("table");
    await actor.click(screen.getByRole("button", { name: "Gỡ khỏi không gian" }));
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "Gỡ thành viên" }));

    expect(
      await within(dialog).findByText(/giao những việc đó cho người khác trước/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Gỡ thành viên" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Thử lại/ })).not.toBeInTheDocument();
  });
});

describe("WORKSPACE_MEMBER_IN_PROJECTS", () => {
  it("nói phải gỡ khỏi từng dự án trước, không hứa hệ thống tự gỡ hộ", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [workspaceMembersRoute]: WORKSPACE_MEMBERS,
      [`/workspaces/${ids.workspace}/members/${ids.userEditorB}`]: failure(
        "workspace-member-in-projects",
      ),
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    await screen.findByRole("table");
    await actor.click(screen.getByRole("button", { name: "Gỡ khỏi không gian" }));
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "Gỡ thành viên" }));

    expect(await within(dialog).findByText(/gỡ họ khỏi từng dự án trước/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Hệ thống không tự gỡ hộ/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thử lại/ })).not.toBeInTheDocument();
  });
});

describe("ba code này KHÔNG bị đối xử như version conflict", () => {
  it("không màn hình hệ thống nào xuất hiện — lỗi ở cấp form, trong hộp thoại", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: PROJECT_DETAIL_M2,
      [projectMemberRoute]: failure("project-last-owner"),
    });
    const { actor, dialog } = await openManageDialog();

    await actor.click(within(dialog).getByRole("button", { name: "Gỡ khỏi dự án" }));
    await within(dialog).findByText(/nâng một thành viên khác lên Owner trước/i);

    // Bảng thành viên vẫn đứng nguyên phía sau: đây không phải lỗi tải trang.
    expect(screen.getByRole("table")).toBeInTheDocument();
    for (const code of ["401", "403", "404", "503"]) {
      expect(screen.queryByText(code)).not.toBeInTheDocument();
    }
  });

  it("lỗi hiện ở CẤP FORM, không gắn vào field vai trò", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: PROJECT_DETAIL_M2,
      [projectMemberRoute]: failure("project-last-owner"),
    });
    const { actor, dialog } = await openManageDialog();

    await actor.click(within(dialog).getByRole("button", { name: "Gỡ khỏi dự án" }));
    await within(dialog).findByText(/nâng một thành viên khác lên Owner trước/i);

    // Ba code này không công bố `details`, nên không field nào được đánh dấu lỗi.
    const select = within(dialog).getByRole("combobox", { name: /Vai trò trong dự án/ });
    expect(select).toHaveAttribute("aria-invalid", "false");
    expect(select).not.toHaveAttribute("aria-describedby");
  });
});
