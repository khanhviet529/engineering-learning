import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { actors, capabilitiesByRole, columns, ids, members, projectB } from "@flowboard/mock";
import type { BoardColumn, Permission } from "@flowboard/contracts";
import {
  failure,
  mockRoutes,
  navigation,
  ok,
  renderWithProviders,
  resetNavigation,
  user,
} from "./harness.tsx";
import { BoardScreen } from "../features/board/board-screen.tsx";

/**
 * `BRD-01` khung board và `BRD-02` Column Editor.
 *
 * Ba tính chất được canh chặt hơn phần còn lại, vì hỏng chúng là hỏng dữ liệu
 * chứ không phải hỏng giao diện:
 *
 * 1. **Một `PATCH` mang đúng một command.** Hợp đồng từ chối body trộn, nên
 *    một form gộp sẽ gửi thứ chắc chắn `400`.
 * 2. **Reorder gửi toàn bộ ID, mỗi ID một lần**, và khi thất bại thì màn hình
 *    quay về thứ tự server đang giữ — không hiển thị thứ tự vừa bị từ chối.
 * 3. **`409 COLUMN_NOT_EMPTY` không có đường "thử lại".** Việc cần làm nằm ở
 *    chỗ khác, và một CTA "dời công việc giúp tôi" không có endpoint nào đứng sau.
 */

const BOARD_PATH = `/du-an/${ids.projectB}/bang-cong-viec`;
const DETAIL_PATH = `/projects/${ids.projectB}`;
const CREATE_PATH = `/projects/${ids.projectB}/columns`;
const REORDER_PATH = "/columns/reorder";

const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });

function detail(
  overrides: { capabilities?: readonly Permission[]; columns?: readonly BoardColumn[] } = {},
) {
  return ok({
    project: projectB,
    capabilities: overrides.capabilities ?? capabilitiesByRole.owner,
    columns: overrides.columns ?? columns,
    members,
  });
}

/** Route của board, cộng một entry `PATCH` cho mỗi cột trong fixture. */
function boardRoutes(
  overrides: Record<string, ReturnType<typeof ok> | ReturnType<typeof failure>> = {},
): void {
  const patchRoutes: Record<string, ReturnType<typeof ok>> = {};
  for (const column of columns) {
    patchRoutes[`/columns/${column.id}`] = ok({ column });
  }
  mockRoutes({
    "/auth/session": SESSION,
    [DETAIL_PATH]: detail(),
    [CREATE_PATH]: ok({ column: columns[0] }, 201),
    [REORDER_PATH]: ok({ columns }),
    ...patchRoutes,
    ...overrides,
  });
}

function calls(): [string, RequestInit][] {
  return (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
}

function requestsTo(predicate: (pathname: string) => boolean, method: string) {
  return calls()
    .filter(([url]) => predicate(new URL(url, "http://api.test").pathname))
    .filter(([, init]) => (init.method ?? "GET") === method);
}

function bodyOf(entry: [string, RequestInit]): Record<string, unknown> {
  return JSON.parse(String(entry[1].body ?? "{}")) as Record<string, unknown>;
}

function keyOf(entry: [string, RequestInit]): string {
  return (entry[1].headers as Record<string, string>)["idempotency-key"] ?? "";
}

/** Thứ tự tên cột **đang hiển thị** trong panel, đọc từ nhãn của từng ô nhập. */
function renderedOrder(): string[] {
  return screen
    .getAllByRole("textbox", { name: /^Tên cột \d+$/ })
    .map((input) => (input as HTMLInputElement).value);
}

async function openPanel(actor: ReturnType<typeof user>): Promise<HTMLElement> {
  const opener = await screen.findByRole("button", { name: "Quản lý cột" });
  await actor.click(opener);
  await screen.findByRole("dialog");
  return opener;
}

beforeEach(() => {
  resetNavigation(BOARD_PATH);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --------------------------------------------------------------- BRD-01

describe("BRD-01 — khung board", () => {
  it("Loading dựng khung chờ chứ không dựng board rỗng", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.endsWith("/auth/session")) {
          return new Response(JSON.stringify(SESSION.body), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Promise<Response>(() => {});
      }),
    );
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    expect(await screen.findByText("Đang tải bảng công việc")).toBeInTheDocument();
    expect(screen.queryByText("Bảng công việc chưa có cột nào")).not.toBeInTheDocument();
  });

  it("Empty nghĩa là DỰ ÁN chưa có cột nào, và Owner có CTA mở BRD-02", async () => {
    boardRoutes({ [DETAIL_PATH]: detail({ columns: [] }) });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    expect(await screen.findByText("Bảng công việc chưa có cột nào")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thêm cột đầu tiên" })).toBeInTheDocument();
  });

  it("Empty với người không quản lý cột được thì không có CTA nào", async () => {
    boardRoutes({
      [DETAIL_PATH]: detail({ columns: [], capabilities: capabilitiesByRole.editor }),
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    expect(await screen.findByText("Bảng công việc chưa có cột nào")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thêm cột đầu tiên" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quản lý cột" })).not.toBeInTheDocument();
  });

  it("cột KHÔNG có công việc không phải là Empty của màn hình", async () => {
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    await screen.findByRole("heading", { name: "Backlog", level: 3 });
    // Bốn cột, bốn chỗ chứa công việc còn trống — nhưng board thì **không** rỗng.
    expect(screen.getAllByText("Chưa có công việc nào ở cột này")).toHaveLength(columns.length);
    expect(screen.queryByText("Bảng công việc chưa có cột nào")).not.toBeInTheDocument();
  });

  it("cờ của cột hiện ra từ chính projection, không phải từ vai trò", async () => {
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    await screen.findByRole("heading", { name: "Done", level: 3 });
    expect(screen.getByText("Cột kết thúc")).toBeInTheDocument();
    expect(screen.getByText("Cần người duyệt")).toBeInTheDocument();
  });

  it("Error cho một đường thử lại", async () => {
    boardRoutes({ [DETAIL_PATH]: failure("internal-error") });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    expect(await screen.findByText("Lỗi kết nối")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("403 ra SYS-01 còn 404 ra SYS-05 — hai câu trả lời khác nhau", async () => {
    boardRoutes({ [DETAIL_PATH]: failure("forbidden") });
    const view = renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    expect(await screen.findByText("403")).toBeInTheDocument();
    expect(screen.queryByText("404")).not.toBeInTheDocument();
    view.unmount();
    vi.unstubAllGlobals();

    boardRoutes({ [DETAIL_PATH]: failure("not-found") });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    expect(await screen.findByText("404")).toBeInTheDocument();
    expect(screen.queryByText("403")).not.toBeInTheDocument();
  });

  it("Viewer thấy board nhưng không thấy đường vào BRD-02", async () => {
    boardRoutes({ [DETAIL_PATH]: detail({ capabilities: capabilitiesByRole.viewer }) });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    await screen.findByRole("heading", { name: "Backlog", level: 3 });
    expect(screen.queryByRole("button", { name: "Quản lý cột" })).not.toBeInTheDocument();
  });
});

// --------------------------------------------------------------- BRD-02

describe("BRD-02 — mở, đóng và quyền", () => {
  it("CTA đưa panel vào URL bằng khóa query tiếng Anh", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    await openPanel(actor);
    expect(navigation.pushed).toContain(`${BOARD_PATH}?panel=columns`);
    expect(screen.getByRole("heading", { name: "Quản lý cột" })).toBeInTheDocument();
  });

  it("Escape đóng panel và trả focus về đúng nút đã mở nó", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    const opener = await openPanel(actor);
    await actor.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(navigation.pushed).toContain(BOARD_PATH);
    expect(opener).toHaveFocus();
  });

  it("deep link tới ?panel=columns với Editor ra Forbidden, không lộ cấu hình cột", async () => {
    resetNavigation(BOARD_PATH, "panel=columns");
    boardRoutes({ [DETAIL_PATH]: detail({ capabilities: capabilitiesByRole.editor }) });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    await screen.findByRole("dialog");
    expect(
      screen.getByText("Vai trò hiện tại của bạn không cấu hình được cột"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^Tên cột/ })).not.toBeInTheDocument();
  });
});

describe("BRD-02 — bốn command, bốn request", () => {
  it("đổi tên gửi PATCH chỉ với name", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    const field = screen.getByRole("textbox", { name: "Tên cột 1" });
    await actor.clear(field);
    await actor.type(field, "Chờ thực hiện");
    await actor.click(screen.getAllByRole("button", { name: "Đổi tên" })[0] as HTMLElement);

    await waitFor(() => {
      expect(requestsTo((p) => p === `/columns/${ids.columnBacklog}`, "PATCH")).toHaveLength(1);
    });
    const request = requestsTo((p) => p === `/columns/${ids.columnBacklog}`, "PATCH")[0]!;
    expect(bodyOf(request)).toEqual({ name: "Chờ thực hiện" });
  });

  it("cờ kết thúc gửi PATCH chỉ với isTerminal", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    await actor.click(screen.getAllByRole("switch", { name: "Cột kết thúc" })[1] as HTMLElement);

    await waitFor(() => {
      expect(requestsTo((p) => p.startsWith("/columns/"), "PATCH")).toHaveLength(1);
    });
    expect(bodyOf(requestsTo((p) => p.startsWith("/columns/"), "PATCH")[0]!)).toEqual({
      isTerminal: true,
    });
  });

  it("yêu cầu người duyệt gửi PATCH chỉ với requiresReviewer", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    await actor.click(screen.getAllByRole("switch", { name: "Cần người duyệt" })[1] as HTMLElement);

    await waitFor(() => {
      expect(requestsTo((p) => p.startsWith("/columns/"), "PATCH")).toHaveLength(1);
    });
    expect(bodyOf(requestsTo((p) => p.startsWith("/columns/"), "PATCH")[0]!)).toEqual({
      requiresReviewer: true,
    });
  });

  it("lưu trữ hỏi xác nhận rồi gửi PATCH chỉ với archive", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    await actor.click(screen.getAllByRole("button", { name: "Lưu trữ" })[0] as HTMLElement);
    // Bản MVP không có unarchive, nên bước xác nhận là bắt buộc.
    expect(screen.getByText(/chưa có đường hoàn tác/)).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Lưu trữ cột" }));

    await waitFor(() => {
      expect(requestsTo((p) => p === `/columns/${ids.columnBacklog}`, "PATCH")).toHaveLength(1);
    });
    expect(bodyOf(requestsTo((p) => p === `/columns/${ids.columnBacklog}`, "PATCH")[0]!)).toEqual({
      archive: true,
    });
  });

  it("thêm cột gửi POST đúng shape, không có position", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    const nameField = screen.getByRole("textbox", { name: /Tên cột mới/ });
    const addForm = nameField.closest("form") as HTMLElement;
    await actor.type(nameField, "Chờ duyệt");
    await actor.click(within(addForm).getByRole("switch", { name: "Cần người duyệt" }));
    await actor.click(within(addForm).getByRole("button", { name: "Thêm cột" }));

    await waitFor(() => {
      expect(requestsTo((p) => p === CREATE_PATH, "POST")).toHaveLength(1);
    });
    expect(bodyOf(requestsTo((p) => p === CREATE_PATH, "POST")[0]!)).toEqual({
      name: "Chờ duyệt",
      // Cột mới nối vào cuối; client nói "đứng sau cột nào", không nói vị trí.
      afterColumnId: ids.columnDone,
      isTerminal: false,
      requiresReviewer: true,
    });
  });

  it("KHÔNG một PATCH nào mang hai command", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    // Đụng vào cả bốn command trên cùng một hàng, theo thứ tự người dùng thật
    // sẽ làm: sửa tên, bật hai cờ, rồi lưu trữ.
    const field = screen.getByRole("textbox", { name: "Tên cột 1" });
    await actor.clear(field);
    await actor.type(field, "Việc cần làm");
    await actor.click(screen.getAllByRole("button", { name: "Đổi tên" })[0] as HTMLElement);
    await actor.click(screen.getAllByRole("switch", { name: "Cột kết thúc" })[1] as HTMLElement);
    await actor.click(screen.getAllByRole("switch", { name: "Cần người duyệt" })[1] as HTMLElement);
    await actor.click(screen.getAllByRole("button", { name: "Lưu trữ" })[0] as HTMLElement);
    await actor.click(screen.getByRole("button", { name: "Lưu trữ cột" }));

    await waitFor(() => {
      expect(requestsTo((p) => p.startsWith("/columns/"), "PATCH").length).toBeGreaterThanOrEqual(
        4,
      );
    });

    const allowed = ["name", "isTerminal", "requiresReviewer", "archive"];
    for (const request of requestsTo((p) => p.startsWith("/columns/"), "PATCH")) {
      const keys = Object.keys(bodyOf(request));
      expect(keys).toHaveLength(1);
      expect(allowed).toContain(keys[0]);
    }
  });
});

describe("BRD-02 — thứ tự cột", () => {
  async function liftAndMoveDown(actor: ReturnType<typeof user>): Promise<void> {
    const grip = screen.getByRole("button", { name: /^Sắp xếp cột Backlog/ });
    grip.focus();
    await actor.keyboard(" ");
    await actor.keyboard("{ArrowDown}");
    await actor.keyboard(" ");
  }

  it("đường bàn phím sắp lại được thứ tự mà không cần chuột", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    expect(renderedOrder()).toEqual(["Backlog", "In progress", "Review", "Done"]);
    await liftAndMoveDown(actor);
    expect(renderedOrder()).toEqual(["In progress", "Backlog", "Review", "Done"]);
  });

  it("Escape khi đang nhấc thì hủy lần nhấc, KHÔNG đóng panel", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    const grip = screen.getByRole("button", { name: /^Sắp xếp cột Backlog/ });
    grip.focus();
    await actor.keyboard(" ");
    await actor.keyboard("{ArrowDown}");
    expect(renderedOrder()[0]).toBe("In progress");

    await actor.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(renderedOrder()).toEqual(["Backlog", "In progress", "Review", "Done"]);
  });

  it("lưu gửi TOÀN BỘ ID theo thứ tự mới, mỗi ID đúng một lần", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    await liftAndMoveDown(actor);
    await actor.click(screen.getByRole("button", { name: "Lưu thứ tự cột" }));

    await waitFor(() => {
      expect(requestsTo((p) => p === REORDER_PATH, "POST")).toHaveLength(1);
    });
    const body = bodyOf(requestsTo((p) => p === REORDER_PATH, "POST")[0]!);
    expect(body).toEqual({
      projectId: ids.projectB,
      orderedColumnIds: [ids.columnInProgress, ids.columnBacklog, ids.columnReview, ids.columnDone],
    });
    const sent = body["orderedColumnIds"] as string[];
    expect(new Set(sent).size).toBe(columns.length);
  });

  it("nút lưu tắt khi thứ tự chưa đổi", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    expect(screen.getByRole("button", { name: "Lưu thứ tự cột" })).toBeDisabled();
  });

  it("gửi thất bại thì màn hình quay về thứ tự server đang giữ", async () => {
    const actor = user();
    boardRoutes({ [REORDER_PATH]: failure("internal-error") });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    await liftAndMoveDown(actor);
    expect(renderedOrder()).toEqual(["In progress", "Backlog", "Review", "Done"]);

    await actor.click(screen.getByRole("button", { name: "Lưu thứ tự cột" }));

    await waitFor(() => {
      // Không để giao diện khoe một thứ tự mà server vừa từ chối.
      expect(renderedOrder()).toEqual(["Backlog", "In progress", "Review", "Done"]);
    });
    expect(
      await screen.findByText(/Danh sách đã trở lại thứ tự đang lưu trên máy chủ/),
    ).toBeInTheDocument();
  });

  it("Idempotency-Key giữ nguyên khi gửi lại y nguyên, xoay khi thứ tự đổi", async () => {
    const actor = user();
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit) => {
        const path = new URL(input, "http://api.test").pathname;
        if (path === REORDER_PATH) {
          attempts += 1;
          throw new TypeError("Failed to fetch");
        }
        const body = path === "/auth/session" ? SESSION.body : detail().body;
        void init;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    // Lần 1: Backlog xuống một bậc.
    await liftAndMoveDown(actor);
    await actor.click(screen.getByRole("button", { name: "Lưu thứ tự cột" }));
    await waitFor(() => {
      expect(attempts).toBe(1);
    });

    // Lần 2: sắp lại **đúng** thứ tự đó rồi gửi lại. Đây là retry vì lỗi vận
    // chuyển — cùng payload, nên phải cùng key.
    await liftAndMoveDown(actor);
    await actor.click(screen.getByRole("button", { name: "Lưu thứ tự cột" }));
    await waitFor(() => {
      expect(attempts).toBe(2);
    });

    // Lần 3: một thứ tự **khác**. Ý định khác ⇒ key mới. Giữ key ở đây là cách
    // lần gửi thứ ba nhận lại kết quả đã lưu của lần thứ nhất.
    const grip = screen.getByRole("button", { name: /^Sắp xếp cột Done/ });
    grip.focus();
    await actor.keyboard(" ");
    await actor.keyboard("{ArrowUp}");
    await actor.keyboard(" ");
    await actor.click(screen.getByRole("button", { name: "Lưu thứ tự cột" }));
    await waitFor(() => {
      expect(attempts).toBe(3);
    });

    const keys = requestsTo((p) => p === REORDER_PATH, "POST").map(keyOf);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("vùng công bố nói ra từng bước của thao tác bàn phím", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    const dialog = await openPanel(actor).then(() => screen.getByRole("dialog"));

    const live = within(dialog).getAllByRole("status")[0] as HTMLElement;
    expect(live).toHaveAttribute("aria-live", "polite");

    const grip = screen.getByRole("button", { name: /^Sắp xếp cột Backlog/ });
    grip.focus();
    await actor.keyboard(" ");
    expect(live).toHaveTextContent(/Đã nhấc Backlog/);
    await actor.keyboard("{ArrowDown}");
    expect(live).toHaveTextContent(/Backlog chuyển tới vị trí 2 trên 4/);
    await actor.keyboard(" ");
    expect(live).toHaveTextContent(/Đã đặt Backlog ở vị trí 2/);
  });

  it("đóng panel khi thứ tự chưa lưu phải đi qua xác nhận, mặc định là ở lại", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    await liftAndMoveDown(actor);
    await actor.click(screen.getByRole("button", { name: "Hủy" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Thứ tự cột chưa được lưu")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Tiếp tục chỉnh sửa" }));
    expect(renderedOrder()).toEqual(["In progress", "Backlog", "Review", "Done"]);
  });
});

describe("BRD-02 — archive bị chặn và chữ về hai cờ", () => {
  it("409 COLUMN_NOT_EMPTY nói việc cần làm trước, và không mời thử lại", async () => {
    const actor = user();
    boardRoutes({ [`/columns/${ids.columnBacklog}`]: failure("column-not-empty") });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    await actor.click(screen.getAllByRole("button", { name: "Lưu trữ" })[0] as HTMLElement);
    await actor.click(screen.getByRole("button", { name: "Lưu trữ cột" }));

    expect(
      await screen.findByText(
        "Không thể lưu trữ cột còn công việc. Hãy chuyển hoặc hoàn tất các công việc trước.",
      ),
    ).toBeInTheDocument();

    // Không có nút nào hứa làm hộ, và không có "Thử lại": gửi lại cùng request
    // cho cùng câu trả lời.
    expect(screen.queryByRole("button", { name: /dời/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /chuyển công việc/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lưu trữ cột" })).toBeDisabled();
  });

  it("chữ của hai cờ nói rõ chúng KHÔNG hồi tố", async () => {
    const actor = user();
    boardRoutes();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await openPanel(actor);

    // Khẳng định trên chuỗi thật: một regex kiểu /người duyệt/ sẽ khớp cả câu
    // sai lẫn câu đúng, nên nó không chứng minh gì.
    expect(
      screen.getAllByText(
        "Yêu cầu người duyệt chỉ áp cho các lần tạo và chuyển công việc sau đó. Công việc đang ở trong cột giữ nguyên, kể cả khi chưa có người duyệt.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Cột kết thúc đánh dấu công việc đã xong. Đổi cờ này chỉ đổi cách suy trạng thái từ lúc đổi trở đi; công việc đang nằm trong cột không bị viết lại.",
      ).length,
    ).toBeGreaterThan(0);

    // Và không có câu nào hứa áp cho việc đang có sẵn.
    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    for (const claim of [
      "áp dụng cho tất cả công việc",
      "áp cho công việc hiện có",
      "hồi tố",
      "sẽ cập nhật các công việc",
    ]) {
      expect(text).not.toContain(claim);
    }
  });
});
