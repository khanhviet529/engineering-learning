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
  navigation,
  ok,
  renderWithProviders,
  resetNavigation,
  user,
} from "./harness.tsx";
import { WorkspaceListScreen } from "../features/workspaces/workspace-list.tsx";
import { ProjectListScreen } from "../features/projects/project-list.tsx";
import { ProjectSettingsScreen } from "../features/projects/project-settings.tsx";

/**
 * Mutation của M2: validation, `Idempotency-Key`, và trạng thái sau lỗi.
 *
 * Vòng đời key là phần dễ sai nhất, và sai thì hậu quả là **dữ liệu** chứ
 * không phải giao diện: giữ key khi payload đổi tạo `409 IDEMPOTENCY_KEY_REUSED`,
 * còn xoay key khi chỉ retry vì lỗi mạng tạo ra bản ghi thứ hai.
 */

const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });
const WORKSPACES = ok({ items: [workspace], page: { nextCursor: null, hasMore: false } });

function keysSentTo(path: string): string[] {
  const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
    .calls;
  return calls
    .filter(([url]) => url.endsWith(path))
    .map(([, init]) => (init.headers as Record<string, string>)["idempotency-key"] ?? "");
}

beforeEach(() => {
  resetNavigation();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WSP-02 — tạo không gian", () => {
  it("gửi Idempotency-Key và điều hướng vào workspace vừa tạo", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
    });
    renderWithProviders(<WorkspaceListScreen />);

    await screen.findByText(workspace.name);
    await actor.click(screen.getByRole("button", { name: "Tạo không gian" }));

    const dialog = await screen.findByRole("dialog");
    await actor.type(screen.getByRole("textbox", { name: /Tên không gian/ }), "Nhóm mới");

    // Đổi route `/workspaces` sang POST thành công cho lần gửi.
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": ok({ workspace: { ...workspace, id: ids.workspace } }, 201),
    });
    await actor.click(within(dialog).getByRole("button", { name: "Tạo không gian" }));

    await waitFor(() => {
      expect(navigation.pushed).toContain(`/khong-gian-lam-viec/${ids.workspace}`);
    });
    const keys = keysSentTo("/workspaces").filter(Boolean);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("nút tạo tắt khi tên rỗng — không gửi một request chắc chắn hỏng", async () => {
    const actor = user();
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    await screen.findByText(workspace.name);
    await actor.click(screen.getByRole("button", { name: "Tạo không gian" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Tạo không gian" })).toBeDisabled();
  });

  it("VALIDATION_FAILED hiện lỗi tại field và GIỮ giá trị đã nhập", async () => {
    const actor = user();
    mockRoutes({ "/auth/session": SESSION, "/workspaces": WORKSPACES });
    renderWithProviders(<WorkspaceListScreen />);

    await screen.findByText(workspace.name);
    await actor.click(screen.getByRole("button", { name: "Tạo không gian" }));
    const dialog = await screen.findByRole("dialog");
    const input = screen.getByRole("textbox", { name: /Tên không gian/ });
    await actor.type(input, "Tên nào đó");

    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": {
        status: 400,
        body: {
          error: {
            code: "VALIDATION_FAILED",
            message: "Request validation failed.",
            details: [{ field: "name", code: "too_long", message: "Tên quá dài." }],
          },
          requestId: "req-x",
        },
      },
    });
    await actor.click(within(dialog).getByRole("button", { name: "Tạo không gian" }));

    expect(await screen.findByText("Tên quá dài.")).toBeInTheDocument();
    expect(input).toHaveValue("Tên nào đó");
  });
});

describe("PRJ-02 — tạo dự án", () => {
  const projectsRoute = `/workspaces/${ids.workspace}/projects`;

  it("người dùng SỬA payload rồi gửi lại thì key được XOAY", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [projectsRoute]: failure("internal-error"),
    });
    renderWithProviders(<ProjectListScreen workspaceId={ids.workspace} />);

    await screen.findByRole("button", { name: "Tạo dự án" });
    await actor.click(screen.getByRole("button", { name: "Tạo dự án" }));
    const dialog = await screen.findByRole("dialog");
    const input = screen.getByRole("textbox", { name: /Tên dự án/ });

    await actor.type(input, "Tên một");
    await actor.click(within(dialog).getByRole("button", { name: "Tạo dự án" }));
    await within(dialog).findByText(/Mã tra cứu/);

    // Sửa tên ⇒ ý định mới ⇒ key mới.
    await actor.clear(input);
    await actor.type(input, "Tên hai");
    await actor.click(within(dialog).getByRole("button", { name: "Tạo dự án" }));

    await waitFor(() => {
      expect(keysSentTo("/projects").filter(Boolean)).toHaveLength(2);
    });
    const [first, second] = keysSentTo("/projects").filter(Boolean);
    expect(first).not.toBe(second);
  });

  it("gửi lại CÙNG payload sau lỗi vận chuyển thì GIỮ NGUYÊN key", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [projectsRoute]: failure("internal-error"),
    });
    renderWithProviders(<ProjectListScreen workspaceId={ids.workspace} />);

    await actor.click(await screen.findByRole("button", { name: "Tạo dự án" }));
    const dialog = await screen.findByRole("dialog");
    await actor.type(screen.getByRole("textbox", { name: /Tên dự án/ }), "Cùng một tên");

    const submit = within(dialog).getByRole("button", { name: "Tạo dự án" });
    await actor.click(submit);
    await within(dialog).findByText(/Mã tra cứu/);
    await actor.click(submit);

    await waitFor(() => {
      expect(keysSentTo("/projects").filter(Boolean)).toHaveLength(2);
    });
    const [first, second] = keysSentTo("/projects").filter(Boolean);
    // Đây là toàn bộ lý do key tồn tại: replay trả outcome đã lưu thay vì tạo
    // một dự án thứ hai.
    expect(first).toBe(second);
  });
});

describe("PRJ-03 — đổi tên dự án", () => {
  const detailRoute = `/projects/${ids.projectB}`;

  it("gửi đúng { name } qua PATCH, không kèm field nào khác", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: ok({
        project: projectB,
        capabilities: capabilitiesByRole.owner,
        columns,
        members,
      }),
    });
    renderWithProviders(<ProjectSettingsScreen projectId={ids.projectB} />);

    const input = await screen.findByRole("textbox", { name: /Tên dự án/ });
    await actor.clear(input);
    await actor.type(input, "Tên mới");
    await actor.click(screen.getByRole("button", { name: /Lưu tên dự án/ }));

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
        .mock.calls;
      const patch = calls.find(([, init]) => init.method === "PATCH");
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch![1].body))).toEqual({ name: "Tên mới" });
    });
  });

  it("KHÔNG đổi tên lạc quan — tên chỉ đổi theo xác nhận của server", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: ok({
        project: projectB,
        capabilities: capabilitiesByRole.owner,
        columns,
        members,
      }),
    });
    renderWithProviders(<ProjectSettingsScreen projectId={ids.projectB} />);

    const input = await screen.findByRole("textbox", { name: /Tên dự án/ });
    await actor.clear(input);
    await actor.type(input, "Chưa được xác nhận");

    // Breadcrumb trên topbar vẫn là tên cũ cho tới khi server xác nhận.
    expect(screen.getByText(projectB.name)).toBeInTheDocument();
  });

  it("rời trang khi form bẩn đi qua xác nhận, mặc định là tiếp tục chỉnh sửa", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      [detailRoute]: ok({
        project: projectB,
        capabilities: capabilitiesByRole.owner,
        columns,
        members,
      }),
    });
    renderWithProviders(<ProjectSettingsScreen projectId={ids.projectB} />);

    const input = await screen.findByRole("textbox", { name: /Tên dự án/ });
    await actor.type(input, " thêm chữ");
    await actor.click(screen.getByRole("button", { name: "Quay lại dự án" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Bỏ thay đổi chưa lưu?")).toBeInTheDocument();
    // Phương án an toàn nhận focus mặc định.
    expect(within(dialog).getByRole("button", { name: "Tiếp tục chỉnh sửa" })).toHaveFocus();
  });
});
