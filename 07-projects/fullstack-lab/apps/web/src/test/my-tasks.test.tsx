import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { actors, ids, tasks, workspace } from "@flowboard/mock";
import type { Task } from "@flowboard/contracts";
import {
  failure,
  mockRoutes,
  navigation,
  ok,
  renderWithProviders,
  resetNavigation,
  user,
  type RouteHandler,
} from "./harness.tsx";
import { MyTasksScreen } from "../features/tasks/my-tasks.tsx";

/**
 * `MYT-01` — việc của tôi, cắt ngang project.
 *
 * Ba tính chất được canh chặt hơn phần còn lại:
 *
 * 1. **Tên project tra từ bảng `projects`**, không lặp vào từng task.
 * 2. **Mở một việc phải mở đúng project của nó** — đây là màn cắt ngang, nên
 *    một đường dẫn sai project là một `404` ở đầu kia.
 * 3. **Cursor chết vì phạm vi đổi không phải màn lỗi hệ thống.** Nó nghĩa là
 *    danh sách đã đổi dưới chân người dùng, và màn hình phải nói ra điều đó
 *    rồi về trang đầu.
 */

const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });
const TASKS_PATH = `/workspaces/${ids.workspace}/tasks`;
const OTHER_PROJECT = "77777777-7777-4777-8777-777777777777";

const base = tasks[0] as Task;

const mine = {
  ...base,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Chuẩn hoá hợp đồng lỗi",
  projectId: ids.projectB,
  dueState: "overdue" as const,
  dueDate: "2026-08-31",
  priority: "high" as const,
};
const other = {
  ...base,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  title: "Rà soát chỉ mục",
  projectId: OTHER_PROJECT,
  dueState: "due_today" as const,
  dueDate: "2026-09-05",
  priority: "none" as const,
};

const PROJECTS = [
  { id: ids.projectB, name: "Làm mới website" },
  { id: OTHER_PROJECT, name: "Nền tảng dữ liệu" },
];

function page(items: Task[], nextCursor: string | null = null) {
  return ok({
    items,
    projects: PROJECTS.filter((project) => items.some((task) => task.projectId === project.id)),
    page: { nextCursor, hasMore: nextCursor !== null },
  });
}

function screenRoutes(tasksRoute: RouteHandler): void {
  mockRoutes({
    "/auth/session": SESSION,
    "/workspaces": ok({ items: [workspace], page: { nextCursor: null, hasMore: false } }),
    [TASKS_PATH]: tasksRoute,
  });
}

function calls(): [string, RequestInit][] {
  return (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
}

beforeEach(() => {
  resetNavigation("/viec-cua-toi", `workspace=${ids.workspace}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MYT-01 — danh sách cắt ngang project", () => {
  it("mỗi dòng nói việc đó thuộc dự án nào, tra từ bảng projects", async () => {
    screenRoutes(page([mine, other]));
    renderWithProviders(<MyTasksScreen />);

    const table = await screen.findByRole("table", { name: "Việc được giao cho tôi" });
    const row = within(table).getByRole("rowheader", { name: mine.title }).closest("tr");
    expect(within(row as HTMLElement).getAllByRole("cell")[0]).toHaveTextContent("Làm mới website");

    const otherRow = within(table).getByRole("rowheader", { name: other.title }).closest("tr");
    expect(within(otherRow as HTMLElement).getAllByRole("cell")[0]).toHaveTextContent(
      "Nền tảng dữ liệu",
    );
  });

  it("KHÔNG gửi columnId — column thuộc về một project, vô nghĩa ở phạm vi workspace", async () => {
    screenRoutes(page([mine]));
    renderWithProviders(<MyTasksScreen />);
    await screen.findByRole("table", { name: "Việc được giao cho tôi" });

    for (const [url] of calls()) {
      const params = new URL(url, "http://api.test").searchParams;
      expect(params.has("columnId")).toBe(false);
    }
  });

  it("mở một việc thì đi tới đúng dự án của nó", async () => {
    const actor = user();
    screenRoutes(page([mine, other]));
    renderWithProviders(<MyTasksScreen />);
    await screen.findByRole("table", { name: "Việc được giao cho tôi" });

    await actor.click(screen.getByRole("button", { name: other.title }));
    // Dự án của `other` **khác** dự án của `mine`: một đường dẫn dựng từ dự án
    // đang xem thay vì từ chính task sẽ cho `404` ở đầu kia.
    expect(navigation.pushed).toContain(`/du-an/${OTHER_PROJECT}/bang-cong-viec?task=${other.id}`);
  });

  it("Empty phân biệt chưa được giao việc với không khớp bộ lọc", async () => {
    const actor = user();
    screenRoutes(page([]));
    renderWithProviders(<MyTasksScreen />);

    expect(
      await screen.findByText("Bạn chưa được giao việc nào trong không gian này"),
    ).toBeInTheDocument();

    await actor.selectOptions(screen.getByRole("combobox", { name: /Hạn xử lý/ }), "overdue");
    expect(await screen.findByText("Không có việc nào khớp bộ lọc hiện tại")).toBeInTheDocument();
  });

  it("lỗi hiện chữ của feature, không phải message của server", async () => {
    screenRoutes(failure("forbidden"));
    renderWithProviders(<MyTasksScreen />);

    expect(
      await screen.findByText("Bạn không còn quyền xem danh sách công việc của không gian này."),
    ).toBeInTheDocument();
    // `message` của mock là tiếng Anh; nó không được lọt ra màn hình.
    expect(screen.queryByText(/You do not have permission/)).not.toBeInTheDocument();
  });
});

describe("MYT-01 — cursor bind phạm vi actor nhìn thấy được", () => {
  it("cursor chết giữa chừng thì về trang đầu và NÓI RA, không phải màn lỗi", async () => {
    const actor = user();
    screenRoutes((url) =>
      url.searchParams.get("cursor") === null
        ? page([mine], "cursor-2")
        : failure("validation-failed"),
    );
    renderWithProviders(<MyTasksScreen />);
    await screen.findByRole("table", { name: "Việc được giao cho tôi" });

    await actor.click(screen.getByRole("button", { name: "Tải thêm" }));

    expect(
      await screen.findByText("Danh sách đã thay đổi trong lúc bạn đang xem"),
    ).toBeInTheDocument();
    // Không phải `SYS-03`: không có mã lỗi hệ thống nào trên màn.
    expect(screen.queryByText("Lỗi kết nối")).not.toBeInTheDocument();
    expect(screen.queryByText("403")).not.toBeInTheDocument();
    // Và danh sách quay về trang đầu thay vì đứng ở một trang nửa vời.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: mine.title })).toBeInTheDocument();
    });
  });

  it("400 ở TRANG ĐẦU vẫn là lỗi thật, không phải phạm vi đổi", async () => {
    // Trang đầu không mang cursor, nên một `400` ở đó nói filter sai — gộp hai
    // ca lại sẽ giấu một lỗi lập trình sau một thông báo trấn an.
    screenRoutes(failure("validation-failed"));
    renderWithProviders(<MyTasksScreen />);

    expect(await screen.findByText(/Không tải được danh sách công việc/)).toBeInTheDocument();
    expect(
      screen.queryByText("Danh sách đã thay đổi trong lúc bạn đang xem"),
    ).not.toBeInTheDocument();
  });
});

describe("MYT-01 — không hiển thị con số nào không có trong response", () => {
  it("không có ô thống kê nào: hợp đồng chỉ trả một trang task", async () => {
    screenRoutes(page([mine, other]));
    renderWithProviders(<MyTasksScreen />);
    await screen.findByRole("table", { name: "Việc được giao cho tôi" });

    const body = document.body.textContent ?? "";
    // Artifact vẽ ba ô "Hôm nay / Tuần này / Đã hoàn thành" và một lịch tuần có
    // giờ. Không cái nào có nguồn: endpoint trả một **trang** task, không trả
    // tổng, và task chỉ có ngày chứ không có giờ.
    for (const invented of ["Hôm nay", "Tuần này", "Đã hoàn thành", "% kế hoạch", "09:00"]) {
      expect(body).not.toContain(invented);
    }
    // Con số duy nhất được hiện là số đã nạp — và nó đúng bằng số dòng.
    expect(screen.getByText("Đã nạp 2")).toBeInTheDocument();
  });
});
