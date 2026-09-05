import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { actors, capabilitiesByRole, columns, ids, members, projectB } from "@flowboard/mock";
import type { Permission, ProjectOverview } from "@flowboard/contracts";
import {
  failure,
  mockRoutes,
  ok,
  renderWithProviders,
  resetNavigation,
  type RouteHandler,
} from "./harness.tsx";
import { ProjectOverviewScreen } from "../features/tasks/project-overview.tsx";

/**
 * `PRJ-04` — tổng quan dự án.
 *
 * Điều bộ kiểm này canh gắt nhất không phải bố cục mà là **nguồn của từng con
 * số**: server trả số đếm, client tính phần trăm, và ba thứ artifact vẽ mà hợp
 * đồng cố ý không có thì không được xuất hiện dưới bất kỳ dạng nào. Một
 * dashboard hiển thị một con số không có nguồn là một dashboard nói dối.
 */

const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });
const DETAIL_PATH = `/projects/${ids.projectB}`;
const OVERVIEW_PATH = `/projects/${ids.projectB}/overview`;

const OVERVIEW: ProjectOverview = {
  window: { from: "2026-08-31", to: "2026-09-06" },
  totals: { tasks: 24, createdInWindow: 4 },
  byColumn: [
    { columnId: ids.columnBacklog, name: "Chờ thực hiện", isTerminal: false, taskCount: 6 },
    { columnId: ids.columnInProgress, name: "Đang thực hiện", isTerminal: false, taskCount: 8 },
    { columnId: ids.columnReview, name: "Chờ duyệt", isTerminal: false, taskCount: 4 },
    { columnId: ids.columnDone, name: "Hoàn thành", isTerminal: true, taskCount: 6 },
  ],
  byAssignee: [
    { user: { id: ids.userEditorB, displayName: "An Tran" }, taskCount: 10 },
    { user: { id: ids.userOwnerB, displayName: "Mai" }, taskCount: 8 },
  ],
  unassignedCount: 6,
  dueStates: { overdue: 2, dueToday: 1, dueSoon: 3, none: 18 },
};

function routes(
  overview: RouteHandler = ok(OVERVIEW),
  capabilities: readonly Permission[] = capabilitiesByRole.owner,
): void {
  mockRoutes({
    "/auth/session": SESSION,
    [DETAIL_PATH]: ok({ project: projectB, capabilities, columns, members }),
    [OVERVIEW_PATH]: overview,
  });
}

beforeEach(() => {
  resetNavigation(`/du-an/${ids.projectB}/tong-quan`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PRJ-04 — phần trăm tính từ số đếm", () => {
  it("hoàn thành là tổng cột isTerminal chia tổng task", async () => {
    routes();
    renderWithProviders(<ProjectOverviewScreen projectId={ids.projectB} />);

    // 6 / 24 = 25%. `isTerminal` do server gửi — không đoán từ tên cột.
    // Chuỗi "25%" xuất hiện nhiều chỗ (cột Backlog, hàng chưa giao), nên neo
    // vào đúng ô chỉ số bằng ghi chú đi kèm nó.
    expect(await screen.findByText("6 / 24 công việc ở cột kết thúc")).toBeInTheDocument();
    const done = screen.getByText("6 / 24 công việc ở cột kết thúc").parentElement;
    expect(within(done as HTMLElement).getByText("25%")).toBeInTheDocument();
    expect(within(done as HTMLElement).getByText("Hoàn thành")).toBeInTheDocument();
  });

  it("mỗi cột hiện số đếm và phần trăm của chính nó", async () => {
    routes();
    renderWithProviders(<ProjectOverviewScreen projectId={ids.projectB} />);

    await screen.findByText("Tiến độ theo trạng thái");
    // Hai cột cùng có 6 việc nên cùng một chuỗi; đếm thay vì đòi duy nhất.
    expect(screen.getAllByText("6 công việc · 25%")).toHaveLength(2);
    expect(screen.getByText("8 công việc · 33%")).toBeInTheDocument();
    expect(screen.getByText("4 công việc · 17%")).toBeInTheDocument();
  });

  it("byColumn giữ NGUYÊN thứ tự server trả — cùng trật tự với board", async () => {
    routes();
    renderWithProviders(<ProjectOverviewScreen projectId={ids.projectB} />);

    await screen.findByText("Tiến độ theo trạng thái");
    const items = screen.getAllByRole("listitem").map((node) => node.textContent ?? "");
    const order = OVERVIEW.byColumn.map((column) =>
      items.findIndex((text) => text.startsWith(column.name)),
    );
    // Sắp lại ở đây sẽ khiến người đọc dashboard và người đọc board thấy hai
    // thứ tự khác nhau cho cùng một bảng.
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
  });

  it("`+N tuần này` lấy thẳng từ totals.createdInWindow", async () => {
    routes();
    renderWithProviders(<ProjectOverviewScreen projectId={ids.projectB} />);

    expect(await screen.findByText("+4 trong cửa sổ này")).toBeInTheDocument();
    // Và cửa sổ được echo lại từ server, không phải client tự tính.
    expect(screen.getByText(/31\/08\/2026 – 06\/09\/2026/)).toBeInTheDocument();
  });

  it("`unassignedCount` là một hàng riêng, không phải một người tên null", async () => {
    routes();
    renderWithProviders(<ProjectOverviewScreen projectId={ids.projectB} />);

    const table = await screen.findByRole("table", { name: "Số việc theo người thực hiện" });
    const row = within(table).getByRole("rowheader", { name: "Chưa giao" }).closest("tr");
    expect(within(row as HTMLElement).getAllByRole("cell")[0]).toHaveTextContent("6");
  });
});

describe("PRJ-04 — ba thứ artifact vẽ mà hợp đồng cố ý không có", () => {
  it("không có delta tuần-so-tuần, không có `đang bị chặn`, không có hạn mức", async () => {
    routes();
    renderWithProviders(<ProjectOverviewScreen projectId={ids.projectB} />);
    await screen.findByText("Tiến độ theo trạng thái");

    const body = document.body.textContent ?? "";
    for (const invented of [
      "so với tuần trước",
      "Đang bị chặn",
      "Đang đầy tải",
      "Có thể nhận thêm",
    ]) {
      expect(body).not.toContain(invented);
    }
  });

  it("mọi con số hiển thị đều truy được về response", async () => {
    routes();
    renderWithProviders(<ProjectOverviewScreen projectId={ids.projectB} />);
    await screen.findByText("Tiến độ theo trạng thái");

    // Tập số hợp lệ: số đếm của server, cộng phần trăm suy từ chúng, cộng ngày
    // của cửa sổ. Bất kỳ con số nào ngoài tập này là số tự chế.
    const allowed = new Set<string>();
    const add = (value: number) => allowed.add(String(value));
    add(OVERVIEW.totals.tasks);
    add(OVERVIEW.totals.createdInWindow);
    add(OVERVIEW.unassignedCount);
    for (const value of Object.values(OVERVIEW.dueStates)) add(value);
    for (const column of OVERVIEW.byColumn) {
      add(column.taskCount);
      add(Math.round((column.taskCount / OVERVIEW.totals.tasks) * 100));
    }
    for (const row of OVERVIEW.byAssignee) {
      add(row.taskCount);
      add(Math.round((row.taskCount / OVERVIEW.totals.tasks) * 100));
    }
    add(Math.round((OVERVIEW.unassignedCount / OVERVIEW.totals.tasks) * 100));
    add(25); // 6 cột kết thúc / 24.
    for (const part of ["31", "08", "2026", "06", "09"]) allowed.add(part);

    // Đọc theo **từng phần tử lá**, không đọc `textContent` của cả vùng: gộp
    // cả vùng sẽ dính hai số cạnh nhau thành một số thứ ba không ai hiển thị.
    const main = screen.getByRole("main");
    const leaves = [...main.querySelectorAll("*")].filter((node) => node.children.length === 0);
    const numbers = leaves.flatMap((node) => (node.textContent ?? "").match(/\d+/g) ?? []);
    const invented = [...new Set(numbers)].filter((value) => !allowed.has(value));
    expect(invented).toEqual([]);
  });
});

describe("PRJ-04 — trạng thái và quyền", () => {
  it("dự án chưa có công việc nào ra Empty, không phải 0%", async () => {
    routes(
      ok({
        ...OVERVIEW,
        totals: { tasks: 0, createdInWindow: 0 },
        byColumn: [],
        byAssignee: [],
        unassignedCount: 0,
        dueStates: { overdue: 0, dueToday: 0, dueSoon: 0, none: 0 },
      } satisfies ProjectOverview),
    );
    renderWithProviders(<ProjectOverviewScreen projectId={ids.projectB} />);

    expect(await screen.findByText("Dự án chưa có công việc nào")).toBeInTheDocument();
  });

  it("Viewer đọc được: cùng quyền với việc đọc task", async () => {
    routes(ok(OVERVIEW), capabilitiesByRole.viewer);
    renderWithProviders(<ProjectOverviewScreen projectId={ids.projectB} />);

    expect(await screen.findByText("Tiến độ theo trạng thái")).toBeInTheDocument();
    expect(screen.getAllByText("25%").length).toBeGreaterThan(0);
  });

  it("403 ra SYS-01 còn 404 ra SYS-05", async () => {
    routes(failure("forbidden"));
    const view = renderWithProviders(<ProjectOverviewScreen projectId={ids.projectB} />);
    expect(await screen.findByText("403")).toBeInTheDocument();
    view.unmount();
    vi.unstubAllGlobals();

    routes(failure("not-found"));
    renderWithProviders(<ProjectOverviewScreen projectId={ids.projectB} />);
    expect(await screen.findByText("404")).toBeInTheDocument();
  });
});
