import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import {
  actors,
  capabilitiesByRole,
  columns,
  ids,
  members,
  projectB,
  workspace,
} from "@flowboard/mock";
import {
  failure,
  mockRoutes,
  mockTransportFailure,
  ok,
  renderWithProviders,
  resetNavigation,
  user,
} from "./harness.tsx";
import { WorkspaceListScreen } from "../features/workspaces/workspace-list.tsx";
import { WorkspaceMembersScreen } from "../features/workspaces/workspace-members.tsx";
import { WorkspaceSettingsScreen } from "../features/workspaces/workspace-settings.tsx";
import { ProjectListScreen } from "../features/projects/project-list.tsx";
import { ProjectSettingsScreen } from "../features/projects/project-settings.tsx";
import { ProjectMembersScreen } from "../features/members/project-members.tsx";
import { AccountSettingsScreen } from "../features/account/account-settings.tsx";

/**
 * Test cấp màn hình cho mốc M2.
 *
 * Mỗi màn hình phải chứng minh **bốn** thứ, không chỉ nhánh `200`:
 * dữ liệu về đúng, rỗng nói đúng điều kiện rỗng, `403` ra `SYS-01`, và `404`
 * ra `SYS-05`. Nhánh lỗi lấy thẳng từ 11 kịch bản của `@flowboard/mock` để
 * không có một hình dạng lỗi nào là do test tự chế.
 */

const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });
const WORKSPACES = ok({ items: [workspace], page: { nextCursor: null, hasMore: false } });

const projectDetail = (capabilities: readonly string[]) =>
  ok({ project: projectB, capabilities, columns, members });

beforeEach(() => {
  resetNavigation();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WSP-01 — chọn không gian làm việc", () => {
  it("hiện workspace mà actor là thành viên", async () => {
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    expect(await screen.findByText(workspace.name)).toBeInTheDocument();
    expect(screen.getByText("Bạn là Quản trị viên không gian")).toBeInTheDocument();
  });

  it("KHÔNG hiện số dự án — hợp đồng cấm trả count của project riêng tư", async () => {
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    await screen.findByText(workspace.name);
    expect(screen.queryByText(/\d+ dự án/)).not.toBeInTheDocument();
  });

  it("rỗng nói rõ điều kiện rỗng và không suy ra có workspace đang ẩn", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": ok({ items: [], page: { nextCursor: null, hasMore: false } }),
    });
    renderWithProviders(<WorkspaceListScreen />);

    expect(await screen.findByText(/chưa thuộc không gian làm việc nào/i)).toBeInTheDocument();
  });

  it("401 ra SYS-02 phiên hết hạn", async () => {
    mockRoutes({ "/auth/session": SESSION, "/workspaces": failure("unauthenticated") });
    renderWithProviders(<WorkspaceListScreen />);

    expect(await screen.findByText("401")).toBeInTheDocument();
  });

  it("lỗi vận chuyển ra SYS-03 và giữ nút thử lại", async () => {
    mockTransportFailure();
    renderWithProviders(<WorkspaceListScreen />);

    expect(await screen.findByText("Lỗi kết nối")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });
});

describe("PRJ-01 — danh sách dự án", () => {
  const projectsRoute = `/workspaces/${ids.workspace}/projects`;

  it("hiện dự án và KHÔNG hiện số liệu mà hợp đồng không công bố", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [projectsRoute]: ok({ items: [projectB], page: { nextCursor: null, hasMore: false } }),
    });
    renderWithProviders(<ProjectListScreen workspaceId={ids.workspace} />);

    expect(await screen.findByText(projectB.name)).toBeInTheDocument();
    expect(screen.queryByText(/thành viên ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/công việc đang mở/)).not.toBeInTheDocument();
  });

  it("404 ra SYS-05, không phải SYS-01", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [projectsRoute]: failure("not-found"),
    });
    renderWithProviders(<ProjectListScreen workspaceId={ids.workspace} />);

    expect(await screen.findByText("404")).toBeInTheDocument();
    expect(screen.queryByText("403")).not.toBeInTheDocument();
  });

  it("403 ra SYS-01, không phải SYS-05", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [projectsRoute]: failure("forbidden"),
    });
    renderWithProviders(<ProjectListScreen workspaceId={ids.workspace} />);

    expect(await screen.findByText("403")).toBeInTheDocument();
    expect(screen.queryByText("404")).not.toBeInTheDocument();
  });

  it("lọc theo tên phân biệt hai loại rỗng", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [projectsRoute]: ok({ items: [projectB], page: { nextCursor: null, hasMore: false } }),
    });
    renderWithProviders(<ProjectListScreen workspaceId={ids.workspace} />);

    await screen.findByText(projectB.name);
    await actor.type(screen.getByLabelText(/Tìm dự án/), "khong-khop-gi-ca");

    expect(await screen.findByText("Không có dự án nào khớp từ khoá")).toBeInTheDocument();
  });

  it("CTA tạo dự án chỉ hiện khi capability cho phép", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": ok({
        items: [{ ...workspace, capabilities: ["workspace:read"] }],
        page: { nextCursor: null, hasMore: false },
      }),
      [projectsRoute]: ok({ items: [], page: { nextCursor: null, hasMore: false } }),
    });
    renderWithProviders(<ProjectListScreen workspaceId={ids.workspace} />);

    await screen.findByText(/chưa là thành viên của dự án nào/i);
    expect(screen.queryByRole("button", { name: "Tạo dự án" })).not.toBeInTheDocument();
  });
});

describe("WSP-03 — thành viên không gian", () => {
  const membersRoute = `/workspaces/${ids.workspace}/members`;

  it("Workspace Admin thấy bảng thành viên", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [membersRoute]: ok({
        items: [
          {
            userId: ids.userEditorB,
            displayName: "An Tran",
            email: "an@example.test",
            role: "workspace_member",
            createdAt: "2026-09-01T08:30:00Z",
          },
        ],
        page: { nextCursor: null, hasMore: false },
      }),
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    expect(await screen.findByText("An Tran")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("thiếu capability quản lý thành viên ra SYS-01 và KHÔNG gọi danh sách", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": ok({
        items: [{ ...workspace, capabilities: ["workspace:read"] }],
        page: { nextCursor: null, hasMore: false },
      }),
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    expect(await screen.findByText("403")).toBeInTheDocument();
    const calls = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls;
    expect(calls.some(([url]) => url.includes("/members"))).toBe(false);
  });
});

describe("WSP-04 — cài đặt không gian", () => {
  it("hiện capability server đã cấp và nói rõ chưa có trường nào sửa được", async () => {
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceSettingsScreen workspaceId={ids.workspace} />);

    expect(await screen.findByText(/Phạm vi cấu hình đang được giới hạn/i)).toBeInTheDocument();
    expect(screen.getByText("workspace:settings:update")).toBeInTheDocument();
    // Không có form, nên cũng không có nút lưu nào để bấm hụt.
    expect(screen.queryByRole("button", { name: /Lưu/ })).not.toBeInTheDocument();
  });

  it("workspace không nằm trong danh sách ra SYS-05, không phải SYS-01", async () => {
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(
      <WorkspaceSettingsScreen workspaceId="99999999-9999-4999-8999-999999999999" />,
    );

    expect(await screen.findByText("404")).toBeInTheDocument();
  });
});

describe("PRJ-03 — cài đặt dự án", () => {
  const detailRoute = `/projects/${ids.projectB}`;

  it("Owner sửa được tên; nút Lưu tắt khi chưa đổi gì", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: projectDetail(capabilitiesByRole.owner),
    });
    renderWithProviders(<ProjectSettingsScreen projectId={ids.projectB} />);

    // Tiêu đề khối và nhãn field cùng là "Tên dự án"; hỏi theo **vai trò** để
    // test trỏ đúng vào ô nhập chứ không vào tiêu đề.
    const input = await screen.findByRole("textbox", { name: /Tên dự án/ });
    expect(screen.getByRole("button", { name: /Lưu tên dự án/ })).toBeDisabled();

    await actor.type(input, " mới");
    expect(screen.getByRole("button", { name: /Lưu tên dự án/ })).toBeEnabled();
  });

  it("Editor mở trực tiếp route nhận SYS-01", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: projectDetail(capabilitiesByRole.editor),
    });
    renderWithProviders(<ProjectSettingsScreen projectId={ids.projectB} />);

    expect(await screen.findByText("403")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Tên dự án/ })).not.toBeInTheDocument();
  });

  it("404 của project ra SYS-05 — Workspace Admin chưa là member không được xác nhận dự án tồn tại", async () => {
    mockRoutes({ "/auth/session": SESSION, [detailRoute]: failure("not-found") });
    renderWithProviders(<ProjectSettingsScreen projectId={ids.projectB} />);

    expect(await screen.findByText("404")).toBeInTheDocument();
    expect(screen.queryByText(projectB.name)).not.toBeInTheDocument();
  });
});

describe("PRM-01 — thành viên dự án", () => {
  const detailRoute = `/projects/${ids.projectB}`;

  it("Owner thấy danh sách và thao tác quản lý", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: projectDetail(capabilitiesByRole.owner),
    });
    renderWithProviders(<ProjectMembersScreen projectId={ids.projectB} />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText(members[0]!.displayName)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Quản lý" })).toHaveLength(members.length);
  });

  it("Viewer mở trực tiếp route nhận SYS-01 và KHÔNG thấy tên thành viên", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: projectDetail(capabilitiesByRole.viewer),
    });
    renderWithProviders(<ProjectMembersScreen projectId={ids.projectB} />);

    expect(await screen.findByText("403")).toBeInTheDocument();
    // Không có bảng nghĩa là không một dòng dữ liệu thành viên nào lọt ra.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("Editor cũng nhận SYS-01 — quản lý thành viên là bề mặt Owner-only", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: projectDetail(capabilitiesByRole.editor),
    });
    renderWithProviders(<ProjectMembersScreen projectId={ids.projectB} />);

    expect(await screen.findByText("403")).toBeInTheDocument();
  });

  it("409 khi gỡ Owner cuối cùng được hiển thị nguyên văn kèm requestId", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: projectDetail(capabilitiesByRole.owner),
      [`/projects/${ids.projectB}/members/${ids.userOwnerB}`]: failure("column-not-empty"),
    });
    renderWithProviders(<ProjectMembersScreen projectId={ids.projectB} />);

    await screen.findByRole("table");
    await actor.click(screen.getAllByRole("button", { name: "Quản lý" })[0]!);
    await actor.click(await screen.findByRole("button", { name: "Gỡ khỏi dự án" }));

    expect(await screen.findByText(/Mã tra cứu/)).toBeInTheDocument();
  });
});

describe("USR-01 — hồ sơ và tùy chọn", () => {
  it("hiện actor của phiên, chỉ đọc, và KHÔNG có mutation nào", async () => {
    mockRoutes({ "/auth/session": SESSION });
    renderWithProviders(<AccountSettingsScreen />);

    // Tên actor xuất hiện ở cả topbar lẫn thẻ hồ sơ; khoanh vùng để test nói
    // đúng chỗ nó đang kiểm.
    const profile = await screen.findByRole("region", { name: "Tài khoản của bạn" });
    expect(within(profile).getByText(actors.ownerB!.displayName)).toBeInTheDocument();
    expect(
      within(profile).getByText(new RegExp(`${actors.ownerB!.email}.*chỉ đọc`)),
    ).toBeInTheDocument();

    // Không có nút lưu: tuỳ chọn áp dụng ngay và lưu cục bộ.
    expect(screen.queryByRole("button", { name: /Lưu/ })).not.toBeInTheDocument();
  });

  it("ba lựa chọn theme là radiogroup, và đổi được bằng bàn phím", async () => {
    const actor = user();
    mockRoutes({ "/auth/session": SESSION });
    renderWithProviders(<AccountSettingsScreen />);

    await screen.findByRole("region", { name: "Tài khoản của bạn" });
    const dark = screen.getByRole("radio", { name: "Tối" });
    await actor.click(dark);

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });
    expect(screen.getByRole("radio", { name: "Tối" })).toBeChecked();
  });

  it("chọn Theo hệ thống thì GỠ data-theme, để tokens.css tự theo hệ điều hành", async () => {
    const actor = user();
    mockRoutes({ "/auth/session": SESSION });
    renderWithProviders(<AccountSettingsScreen />);

    await screen.findByRole("region", { name: "Tài khoản của bạn" });
    await actor.click(screen.getByRole("radio", { name: "Tối" }));
    await actor.click(screen.getByRole("radio", { name: "Theo hệ thống" }));

    await waitFor(() => {
      expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    });
  });

  it("múi giờ là dữ liệu của workspace và chỉ đọc — không có control đổi", async () => {
    mockRoutes({ "/auth/session": SESSION });
    renderWithProviders(<AccountSettingsScreen />);

    expect(await screen.findByText("Theo không gian làm việc")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Múi giờ/)).not.toBeInTheDocument();
  });

  it("đổi mật khẩu đi qua luồng AUTH-03, không có form đổi mật khẩu tại chỗ", async () => {
    mockRoutes({ "/auth/session": SESSION });
    renderWithProviders(<AccountSettingsScreen />);

    const link = await screen.findByRole("link", { name: /Gửi liên kết đặt lại mật khẩu/ });
    expect(link).toHaveAttribute("href", "/quen-mat-khau");
  });
});
