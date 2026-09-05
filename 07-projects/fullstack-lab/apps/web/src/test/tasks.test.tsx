import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import {
  actors,
  capabilitiesByRole,
  columns,
  ids,
  members,
  projectB,
  tasks,
} from "@flowboard/mock";
import type { Permission, Task } from "@flowboard/contracts";
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
import { BoardScreen } from "../features/board/board-screen.tsx";

/**
 * `BRD-01`, `TSK-01`, `TSK-02` và `SYS-04`.
 *
 * Bốn tính chất được canh chặt hơn phần còn lại, vì hỏng chúng là hỏng **dữ
 * liệu** chứ không phải hỏng giao diện:
 *
 * 1. **Cursor của một cột không rơi sang cột khác.**
 * 2. **Response của filter cũ không ghi vào query của filter mới.**
 * 3. **Refetch trả version thấp hơn không ghi đè bản server đã xác nhận.**
 * 4. **Move thất bại thì thứ tự quay về dữ liệu server**, và `409` mở `SYS-04`
 *    chứ không ghi đè âm thầm.
 */

const BOARD_PATH = `/du-an/${ids.projectB}/bang-cong-viec`;
const DETAIL_PATH = `/projects/${ids.projectB}`;
const TASKS_PATH = `/projects/${ids.projectB}/tasks`;
const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });

const BACKLOG = ids.columnBacklog;
const IN_PROGRESS = ids.columnInProgress;

const base = tasks[0] as Task;

function task(overrides: Partial<Task> & { id: string }): Task {
  return { ...base, ...overrides };
}

const alpha = task({
  id: "11111111-1111-4111-8111-aaaaaaaaaaaa",
  title: "Alpha",
  columnId: BACKLOG,
  position: "1024",
  version: 2,
  assigneeId: ids.userEditorB,
  priority: "high",
  dueState: "overdue",
  dueDate: "2026-08-31",
});
const beta = task({
  id: "22222222-2222-4222-8222-bbbbbbbbbbbb",
  title: "Beta",
  columnId: BACKLOG,
  position: "2048",
  version: 1,
  // Chưa giao: giữ đúng một avatar trong cột để phép kiểm không mơ hồ, và để
  // có một card ở trạng thái "chưa có người thực hiện".
  assigneeId: null,
  priority: "none",
  dueState: "none",
  dueDate: null,
});
const gamma = task({
  id: "33333333-3333-4333-8333-cccccccccccc",
  title: "Gamma",
  columnId: IN_PROGRESS,
  position: "1024",
  version: 1,
});

function detail(capabilities: readonly Permission[] = capabilitiesByRole.owner) {
  return ok({ project: projectB, capabilities, columns, members });
}

interface BoardOptions {
  capabilities?: readonly Permission[];
  /** Trả trang task cho một cột; mặc định Backlog có Alpha + Beta. */
  tasksFor?: (url: URL) => RouteHandler;
  extra?: Record<string, RouteHandler>;
}

function page(items: readonly Task[], nextCursor: string | null = null) {
  return ok({ items, page: { nextCursor, hasMore: nextCursor !== null } });
}

function defaultTasks(url: URL) {
  const columnId = url.searchParams.get("columnId");
  if (columnId === BACKLOG) return page([alpha, beta]);
  if (columnId === IN_PROGRESS) return page([gamma]);
  return page([]);
}

function board(options: BoardOptions = {}): void {
  mockRoutes({
    "/auth/session": SESSION,
    [DETAIL_PATH]: detail(options.capabilities),
    [TASKS_PATH]: options.tasksFor ?? defaultTasks,
    ...(options.extra ?? {}),
  });
}

function calls(): [string, RequestInit][] {
  return (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
}

function requestsTo(pathname: string, method = "GET") {
  return calls()
    .filter(([url]) => new URL(url, "http://api.test").pathname === pathname)
    .filter(([, init]) => (init.method ?? "GET") === method);
}

function bodyOf(entry: [string, RequestInit]): Record<string, unknown> {
  return JSON.parse(String(entry[1].body ?? "{}")) as Record<string, unknown>;
}

function keyOf(entry: [string, RequestInit]): string {
  return (entry[1].headers as Record<string, string>)["idempotency-key"] ?? "";
}

async function boardReady(): Promise<void> {
  await screen.findByRole("button", { name: /^Alpha$/ });
}

beforeEach(() => {
  resetNavigation(BOARD_PATH);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ------------------------------------------------- năm vùng của BRD-01

describe("BRD-01 — năm vùng theo hợp đồng màn hình board", () => {
  it("1. ngữ cảnh project, 2. điều khiển board, 3. dải cột, 4. task card", async () => {
    board();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    // 1. Ngữ cảnh project: tên dự án hiện ra ở khung ứng dụng.
    expect(screen.getAllByText(projectB.name).length).toBeGreaterThan(0);

    // 2. Điều khiển board: tìm kiếm, lọc, sắp xếp.
    expect(screen.getByRole("textbox", { name: /Tìm công việc/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Người thực hiện/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Sắp xếp/ })).toBeInTheDocument();

    // 3. Dải cột ngang là một nhóm có tên, cuộn ngang.
    const strip = screen.getByRole("group", { name: "Cột của bảng công việc" });
    expect(strip).toHaveStyle({ overflowX: "auto" });
    expect(within(strip).getAllByRole("region")).toHaveLength(columns.length);

    // 4. Task card: tiêu đề, hạn xử lý, người thực hiện. Tìm **trong cột**:
    // chữ "Quá hạn" cũng là một tuỳ chọn của bộ lọc hạn xử lý.
    const backlog = within(strip).getByRole("region", { name: "Backlog" });
    expect(within(backlog).getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(within(backlog).getByText(/Quá hạn/)).toBeInTheDocument();
    expect(
      within(backlog).getByRole("img", { name: /Người thực hiện: An Tran/ }),
    ).toBeInTheDocument();
  });

  it("5. lớp phủ task mở từ card và đưa taskId vào URL", async () => {
    const actor = user();
    board({
      extra: {
        [`/tasks/${alpha.id}`]: ok({
          task: alpha,
          comments: { items: [], page: { nextCursor: null, hasMore: false } },
          capabilities: capabilitiesByRole.owner,
        }),
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    await actor.click(screen.getByRole("button", { name: "Alpha" }));
    expect(navigation.pushed.some((href) => href.includes(`task=${alpha.id}`))).toBe(true);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("cột rỗng vì bộ lọc nói khác với cột chưa có công việc", async () => {
    const actor = user();
    board({ tasksFor: () => page([]) });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    await waitFor(() => {
      expect(screen.getAllByText("Chưa có công việc nào ở cột này").length).toBe(columns.length);
    });

    await actor.selectOptions(screen.getByRole("combobox", { name: /Ưu tiên/ }), "high");
    await waitFor(() => {
      expect(screen.getAllByText("Không có công việc nào khớp bộ lọc hiện tại.").length).toBe(
        columns.length,
      );
    });
  });

  it("một cột hỏng không kéo theo cột khác", async () => {
    board({
      tasksFor: (url) => {
        const columnId = url.searchParams.get("columnId");
        if (columnId === BACKLOG) return failure("internal-error");
        return columnId === IN_PROGRESS ? page([gamma]) : page([]);
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);

    // Cột Backlog báo lỗi, nhưng In progress vẫn hiển thị dữ liệu đã nạp.
    expect(await screen.findByText("Lỗi kết nối")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Gamma" })).toBeInTheDocument();
  });
});

// ------------------------------------------------------- ma trận vai trò

describe("ma trận vai trò", () => {
  it("Owner có CTA tạo, tay kéo và quản lý cột", async () => {
    board();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    expect(screen.getByRole("button", { name: "Tạo công việc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Di chuyển Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quản lý cột" })).toBeInTheDocument();
  });

  it("Editor tạo và kéo được, nhưng không quản lý cột", async () => {
    board({ capabilities: capabilitiesByRole.editor });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    expect(screen.getByRole("button", { name: "Tạo công việc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Di chuyển Alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quản lý cột" })).not.toBeInTheDocument();
  });

  it("Viewer chỉ có điều khiển đọc: không CTA tạo, không tay kéo", async () => {
    board({ capabilities: capabilitiesByRole.viewer });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    expect(screen.queryByRole("button", { name: "Tạo công việc" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Di chuyển/ })).not.toBeInTheDocument();
    // Nhưng lọc và tìm là thao tác **đọc**, nên Viewer vẫn có.
    expect(screen.getByRole("textbox", { name: /Tìm công việc/ })).toBeInTheDocument();
  });

  it("Viewer mở chi tiết được nhưng không có ô soạn bình luận và không sửa", async () => {
    const actor = user();
    board({
      capabilities: capabilitiesByRole.viewer,
      extra: {
        [`/tasks/${alpha.id}`]: ok({
          task: alpha,
          comments: { items: [], page: { nextCursor: null, hasMore: false } },
          capabilities: capabilitiesByRole.viewer,
        }),
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();
    await actor.click(screen.getByRole("button", { name: "Alpha" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Sửa công việc" })).not.toBeInTheDocument();
    await actor.click(within(dialog).getByRole("tab", { name: "Bình luận" }));
    expect(within(dialog).queryByRole("textbox", { name: /Bình luận/ })).not.toBeInTheDocument();
  });
});

// ------------------------------------------------ phân trang theo từng cột

describe("phân trang theo từng cột", () => {
  it("mỗi cột hỏi bằng columnId của chính nó", async () => {
    board();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    const columnIds = requestsTo(TASKS_PATH).map(([url]) =>
      new URL(url, "http://api.test").searchParams.get("columnId"),
    );
    expect(new Set(columnIds)).toEqual(new Set(columns.map((column) => column.id)));
  });

  it("cursor của một cột KHÔNG rơi sang cột khác", async () => {
    const actor = user();
    board({
      tasksFor: (url) => {
        const columnId = url.searchParams.get("columnId");
        const cursor = url.searchParams.get("cursor");
        if (columnId !== BACKLOG) return page([gamma]);
        return cursor === null ? page([alpha], "cursor-backlog-2") : page([beta]);
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    await actor.click(await screen.findByRole("button", { name: /^Tải thêm Backlog/ }));
    await screen.findByRole("button", { name: "Beta" });

    for (const [url] of requestsTo(TASKS_PATH)) {
      const params = new URL(url, "http://api.test").searchParams;
      if (params.get("cursor") === null) continue;
      // Một cursor chỉ hợp lệ với đúng cột đã phát hành nó; gửi nó cho cột
      // khác là `400`, và tệ hơn là một trang task của cột sai.
      expect(params.get("columnId")).toBe(BACKLOG);
    }
  });

  it("tải thêm nối vào cột đó, không thay cả cột bằng skeleton", async () => {
    const actor = user();
    board({
      tasksFor: (url) => {
        const columnId = url.searchParams.get("columnId");
        const cursor = url.searchParams.get("cursor");
        if (columnId !== BACKLOG) return page([]);
        return cursor === null ? page([alpha], "next") : page([beta]);
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    await actor.click(screen.getByRole("button", { name: /^Tải thêm Backlog/ }));
    await screen.findByRole("button", { name: "Beta" });
    // Card đã nạp vẫn còn nguyên: không có "nhảy vị trí" và không có skeleton
    // toàn cột khi nạp trang tiếp theo.
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
  });
});

// -------------------------------------------------------- đua giữa filter

describe("đổi filter", () => {
  it("response của filter CŨ về sau không ghi đè kết quả của filter mới", async () => {
    const actor = user();
    let releaseOld: ((value: Response) => void) | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "http://api.test");
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });

        if (url.pathname === "/auth/session") return json(SESSION.body);
        if (url.pathname === DETAIL_PATH) return json(detail().body);
        if (url.pathname !== TASKS_PATH) return json(failure("not-found").body, 404);

        const priority = url.searchParams.get("priority");
        const columnId = url.searchParams.get("columnId");
        if (columnId !== BACKLOG) return json(page([]).body);

        if (priority === null) {
          // Filter cũ: giữ lại, thả ra **sau** khi filter mới đã về.
          return new Promise<Response>((resolve) => {
            releaseOld = resolve;
          });
        }
        return json(page([beta]).body);
      }),
    );

    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    // Filter cũ đang treo, chưa có card nào.
    await screen.findByRole("combobox", { name: /Ưu tiên/ });

    await actor.selectOptions(screen.getByRole("combobox", { name: /Ưu tiên/ }), "high");
    await screen.findByRole("button", { name: "Beta" });

    // Bây giờ mới thả filter cũ ra. Nó không có key để ghi vào, nên nó biến mất.
    releaseOld?.(
      new Response(JSON.stringify(page([alpha]).body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Alpha" })).not.toBeInTheDocument();
  });
});

// ------------------------------------------------------------ version guard

describe("version guard", () => {
  it("refetch trả version thấp hơn KHÔNG ghi đè bản server đã xác nhận", async () => {
    const actor = user();
    let listCalls = 0;
    const updated: Task = { ...alpha, title: "Alpha v9", version: 9 };

    board({
      tasksFor: (url) => {
        if (url.searchParams.get("columnId") !== BACKLOG) return page([]);
        listCalls += 1;
        // Lần nạp lại sau mutation trả về bản **cũ hơn** — đúng ca mà đặc tả
        // tương tác mô tả: response được đọc trước khi mutation commit.
        return page([alpha]);
      },
      extra: {
        [`/tasks/${alpha.id}`]: ok({
          task: alpha,
          comments: { items: [], page: { nextCursor: null, hasMore: false } },
          capabilities: capabilitiesByRole.owner,
        }),
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    // Sửa task: server xác nhận v9.
    mockRoutes({
      "/auth/session": SESSION,
      [DETAIL_PATH]: detail(),
      [TASKS_PATH]: (url) =>
        url.searchParams.get("columnId") === BACKLOG ? page([alpha]) : page([]),
      [`/tasks/${alpha.id}`]: (_url, init) =>
        (init.method ?? "GET") === "PATCH"
          ? ok({ task: updated, capabilities: capabilitiesByRole.owner })
          : ok({
              task: alpha,
              comments: { items: [], page: { nextCursor: null, hasMore: false } },
              capabilities: capabilitiesByRole.owner,
            }),
    });

    await actor.click(screen.getByRole("button", { name: "Alpha" }));
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "Sửa công việc" }));

    const titleField = await screen.findByRole("textbox", { name: /Tiêu đề/ });
    await actor.clear(titleField);
    await actor.type(titleField, "Alpha v9");
    await actor.click(screen.getByRole("button", { name: "Lưu công việc" }));

    // Danh sách được nạp lại và trả về v2 — nhưng sổ đã ghi v9, nên card giữ
    // tiêu đề mới. Đây là điều phân biệt "cũ" với "mới": version, không phải
    // thời điểm response về.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Alpha v9" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /^Alpha$/ })).not.toBeInTheDocument();
    expect(listCalls).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------- DnD

describe("kéo-thả", () => {
  async function liftAlpha(actor: ReturnType<typeof user>): Promise<HTMLElement> {
    const handle = screen.getByRole("button", { name: /^Di chuyển Alpha/ });
    handle.focus();
    await actor.keyboard(" ");
    return handle;
  }

  it("đường bàn phím chuyển được task sang cột khác mà không cần chuột", async () => {
    const actor = user();
    board({
      extra: {
        [`/tasks/${alpha.id}/move`]: ok({
          task: { ...alpha, columnId: IN_PROGRESS, version: 3 },
          capabilities: capabilitiesByRole.owner,
        }),
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    await liftAlpha(actor);
    await actor.keyboard("{ArrowRight}");
    await actor.keyboard(" ");

    await waitFor(() => {
      expect(requestsTo(`/tasks/${alpha.id}/move`, "POST")).toHaveLength(1);
    });
    const body = bodyOf(requestsTo(`/tasks/${alpha.id}/move`, "POST")[0] as [string, RequestInit]);
    expect(body["destinationColumnId"]).toBe(IN_PROGRESS);
    expect(body["expectedVersion"]).toBe(alpha.version);
    // `targetPosition` là gợi ý — nhưng nó vẫn phải đúng dạng hợp đồng.
    expect(String(body["targetPosition"])).toMatch(/^\d+(\.\d+)?$/);
  });

  it("focus ở lại tay kéo sau khi đổi cột — mũi tên thứ hai vẫn tới đúng chỗ", async () => {
    const actor = user();
    board();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    await liftAlpha(actor);
    await actor.keyboard("{ArrowRight}");
    // React sắp lại danh sách bằng `insertBefore`; không lấy lại focus thì phím
    // kế tiếp rơi vào `body` và thao tác chết giữa chừng.
    expect(document.activeElement).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/^Di chuyển Alpha/),
    );
  });

  it("Escape hủy và trả task về chỗ cũ", async () => {
    const actor = user();
    board();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    await liftAlpha(actor);
    await actor.keyboard("{ArrowRight}");
    await actor.keyboard("{Escape}");

    expect(requestsTo(`/tasks/${alpha.id}/move`, "POST")).toHaveLength(0);
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent(/Đã hủy/);
  });

  it("thất bại thì hiện cảnh báo hoàn nguyên và nạp lại theo dữ liệu server", async () => {
    const actor = user();
    board({ extra: { [`/tasks/${alpha.id}/move`]: failure("internal-error") } });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    await liftAlpha(actor);
    await actor.keyboard("{ArrowRight}");
    await actor.keyboard(" ");

    expect(await screen.findByText(/Không chuyển được công việc sang/)).toBeInTheDocument();
    expect(screen.getByText(/thứ tự cuối cùng do server quyết định/i)).toBeInTheDocument();
    // Alpha vẫn ở Backlog: giao diện không giữ một thứ tự mà server đã từ chối.
    const backlog = screen.getByRole("region", { name: "Backlog" });
    await waitFor(() => {
      expect(within(backlog).getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    });
  });

  it("Idempotency-Key giữ khi gửi lại y nguyên, xoay khi vị trí đổi", async () => {
    const actor = user();
    let attempts = 0;
    board({
      extra: {
        [`/tasks/${alpha.id}/move`]: () => {
          attempts += 1;
          return failure("internal-error");
        },
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    // Lần 1 và lần 2: cùng đích ⇒ cùng key (retry vì lỗi vận chuyển).
    await liftAlpha(actor);
    await actor.keyboard("{ArrowRight}");
    await actor.keyboard(" ");
    await waitFor(() => expect(attempts).toBe(1));

    await liftAlpha(actor);
    await actor.keyboard("{ArrowRight}");
    await actor.keyboard(" ");
    await waitFor(() => expect(attempts).toBe(2));

    // Lần 3: đích khác ⇒ ý định khác ⇒ key mới.
    await liftAlpha(actor);
    await actor.keyboard("{ArrowDown}");
    await actor.keyboard(" ");
    await waitFor(() => expect(attempts).toBe(3));

    const keys = requestsTo(`/tasks/${alpha.id}/move`, "POST").map(keyOf);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});

// ---------------------------------------------------------------- SYS-04

describe("SYS-04 — xung đột phiên bản", () => {
  it("409 khi sửa mở SYS-04, có đường xem bản hiện tại và KHÔNG có nút ghi đè", async () => {
    const actor = user();
    const conflictResponse = {
      status: 409,
      body: {
        error: {
          code: "TASK_VERSION_CONFLICT",
          message: "Công việc đã được thay đổi.",
          details: { currentVersion: 7 },
        },
        requestId: "test-request-id",
      },
    };

    board({
      extra: {
        [`/tasks/${alpha.id}`]: (_url, init) =>
          (init.method ?? "GET") === "PATCH"
            ? conflictResponse
            : ok({
                task: { ...alpha, version: 7 },
                comments: { items: [], page: { nextCursor: null, hasMore: false } },
                capabilities: capabilitiesByRole.owner,
              }),
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    await actor.click(screen.getByRole("button", { name: "Alpha" }));
    const drawer = await screen.findByRole("dialog");
    await actor.click(within(drawer).getByRole("button", { name: "Sửa công việc" }));

    const titleField = await screen.findByRole("textbox", { name: /Tiêu đề/ });
    await actor.type(titleField, " sửa");
    await actor.click(screen.getByRole("button", { name: "Lưu công việc" }));

    expect(await screen.findByText("Công việc đã được thay đổi")).toBeInTheDocument();
    expect(screen.getByText(/Bản nháp của bạn chưa được ghi đè/)).toBeInTheDocument();
    // Đường xem lại dữ liệu hiện tại là bắt buộc; nút ghi đè thì tuyệt đối không.
    expect(await screen.findByText(/^v7/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sửa trên bản hiện tại" })).toBeInTheDocument();
    for (const label of [/ghi đè/i, /force/i, /vẫn lưu/i]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });
});

// -------------------------------------------------- bình luận và bằng chứng

describe("TSK-02 — bình luận và evidenceUrl", () => {
  const hostile = "<script>alert(1)</script> và [bấm](javascript:alert(1))";

  it("bình luận đi qua allowlist: không thẻ script nào thành DOM", async () => {
    const actor = user();
    board({
      extra: {
        [`/tasks/${alpha.id}`]: ok({
          task: alpha,
          comments: {
            items: [
              {
                id: "c1",
                taskId: alpha.id,
                author: { id: ids.userOwnerB, displayName: "Mai" },
                body: hostile,
                createdAt: "2026-09-01T08:30:00Z",
              },
            ],
            page: { nextCursor: null, hasMore: false },
          },
          capabilities: capabilitiesByRole.owner,
        }),
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();
    await actor.click(screen.getByRole("button", { name: "Alpha" }));

    const drawer = await screen.findByRole("dialog");
    await actor.click(within(drawer).getByRole("tab", { name: "Bình luận" }));

    // Khẳng định bằng cách **tìm phần tử**: một `<script>` nằm trong
    // `textContent` là kết quả đúng, thứ phải chứng minh là nó không thành nút.
    expect(drawer.querySelector("script")).toBeNull();
    expect(drawer.querySelector("a")).toBeNull();
    expect(drawer).toHaveTextContent("<script>alert(1)</script>");
  });

  it("evidenceUrl hiện host dạng text và KHÔNG có request nào tới host đó", async () => {
    const actor = user();
    const evidence = "https://bang-chung.example.test/tai-lieu.pdf";
    board({
      extra: {
        [`/tasks/${alpha.id}`]: ok({
          task: { ...alpha, evidenceUrl: evidence },
          comments: { items: [], page: { nextCursor: null, hasMore: false } },
          capabilities: capabilitiesByRole.owner,
        }),
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();
    await actor.click(screen.getByRole("button", { name: "Alpha" }));

    const drawer = await screen.findByRole("dialog");
    const link = within(drawer).getByRole("link", { name: evidence });
    // Host hiện thành **chữ** cạnh liên kết, để người đọc thấy đích trước khi bấm.
    expect(within(drawer).getByText(`(${new URL(evidence).host})`)).toBeInTheDocument();
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    // Không preview, không thumbnail, không favicon, không metadata.
    const hosts = calls().map(([url]) => new URL(url, "http://api.test").host);
    expect(hosts.some((host) => host.includes("bang-chung.example.test"))).toBe(false);
  });

  it("evidenceUrl không phải https thì KHÔNG thành liên kết bấm được", async () => {
    const actor = user();
    board({
      extra: {
        [`/tasks/${alpha.id}`]: ok({
          // Hợp đồng chỉ nhận `https`. Server cưỡng chế, nhưng client không
          // được biến một giá trị cũ hoặc sai thành một thứ bấm được.
          task: { ...alpha, evidenceUrl: "http://khong-an-toan.example.test/a" },
          comments: { items: [], page: { nextCursor: null, hasMore: false } },
          capabilities: capabilitiesByRole.owner,
        }),
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();
    await actor.click(screen.getByRole("button", { name: "Alpha" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).queryByRole("link")).not.toBeInTheDocument();
    expect(within(drawer).getByText(/Liên kết bằng chứng không hợp lệ/)).toBeInTheDocument();
  });

  it("gửi bình luận rồi làm mới; chữ nhắc rằng bình luận là bất biến", async () => {
    const actor = user();
    board({
      extra: {
        [`/tasks/${alpha.id}`]: ok({
          task: alpha,
          comments: { items: [], page: { nextCursor: null, hasMore: false } },
          capabilities: capabilitiesByRole.owner,
        }),
        [`/tasks/${alpha.id}/comments`]: ok(
          {
            comment: {
              id: "c2",
              taskId: alpha.id,
              author: { id: ids.userOwnerB, displayName: "Mai" },
              body: "xong rồi",
              createdAt: "2026-09-01T09:00:00Z",
            },
          },
          201,
        ),
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();
    await actor.click(screen.getByRole("button", { name: "Alpha" }));

    const drawer = await screen.findByRole("dialog");
    await actor.click(within(drawer).getByRole("tab", { name: "Bình luận" }));
    expect(within(drawer).getByText(/bình luận là bất biến|không sửa hay xoá được/i)).toBeTruthy();

    await actor.type(within(drawer).getByRole("textbox", { name: /Bình luận/ }), "xong rồi");
    await actor.click(within(drawer).getByRole("button", { name: "Gửi bình luận" }));

    await waitFor(() => {
      expect(requestsTo(`/tasks/${alpha.id}/comments`, "POST")).toHaveLength(1);
    });
    expect(
      bodyOf(requestsTo(`/tasks/${alpha.id}/comments`, "POST")[0] as [string, RequestInit]),
    ).toEqual({
      body: "xong rồi",
    });
  });
});

// ------------------------------------------------------------ khả năng dùng

describe("accessibility", () => {
  it("Escape đóng lớp phủ task và trả focus về đúng card đã mở nó", async () => {
    const actor = user();
    board({
      extra: {
        [`/tasks/${alpha.id}`]: ok({
          task: alpha,
          comments: { items: [], page: { nextCursor: null, hasMore: false } },
          capabilities: capabilitiesByRole.owner,
        }),
      },
    });
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    const card = screen.getByRole("button", { name: "Alpha" });
    await actor.click(card);
    await screen.findByRole("dialog");

    await actor.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveFocus();
  });

  it("live region công bố từng bước của thao tác bàn phím", async () => {
    const actor = user();
    board();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");

    const handle = screen.getByRole("button", { name: /^Di chuyển Alpha/ });
    handle.focus();
    await actor.keyboard(" ");
    expect(live).toHaveTextContent(/Đã nhấc Alpha/);
    await actor.keyboard("{ArrowRight}");
    expect(live).toHaveTextContent(/cột In progress/);
  });

  it("form tạo công việc chặn submit thiếu tiêu đề và trỏ focus tới field lỗi", async () => {
    const actor = user();
    board();
    renderWithProviders(<BoardScreen projectId={ids.projectB} />);
    await boardReady();

    await actor.click(screen.getByRole("button", { name: "Tạo công việc" }));
    const dialog = await screen.findByRole("dialog");
    // Trong hộp thoại: CTA trên thanh công cụ mang **cùng** nhãn.
    await actor.click(within(dialog).getByRole("button", { name: "Tạo công việc" }));

    expect(await screen.findByText(/1 trường cần sửa/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Tiêu đề/ })).toHaveFocus();
    expect(requestsTo(TASKS_PATH, "POST")).toHaveLength(0);
  });
});
