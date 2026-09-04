import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { actors, ids, invitations, workspace } from "@flowboard/mock";
import { failure, mockRoutes, ok, renderWithProviders, resetNavigation, user } from "./harness.tsx";
import { WorkspaceMembersScreen } from "../features/workspaces/workspace-members.tsx";

/**
 * `WSP-03` — danh sách lời mời đang chờ, theo
 * [ADR-0013](../../../../docs/decisions/ADR-0013-workspace-member-invitation.md).
 *
 * Điều bộ kiểm này bảo vệ không phải là "có hiện ra hay không", mà là **hai
 * danh sách nói hai điều khác nhau**: thành viên đã có quyền, lời mời `pending`
 * chưa cấp gì. Mọi chỗ mà giao diện có thể trộn hai ý đó lại — chữ sau khi mời,
 * cache được làm mới, cột hiển thị — đều có một test riêng ở đây.
 */

const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });
const WORKSPACES = ok({ items: [workspace], page: { nextCursor: null, hasMore: false } });
const MEMBERS = ok({
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
});
const INVITATIONS = ok({ items: invitations, page: { nextCursor: null, hasMore: false } });

const MEMBERS_PATH = `/workspaces/${ids.workspace}/members`;
const INVITATIONS_PATH = `/workspaces/${ids.workspace}/invitations`;

function fetchCalls(): [string, RequestInit][] {
  return (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
}

function callsTo(path: string): [string, RequestInit][] {
  return fetchCalls().filter(([url]) => new URL(url, "http://api.test").pathname === path);
}

beforeEach(() => {
  resetNavigation(`/khong-gian-lam-viec/${ids.workspace}/thanh-vien`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WSP-03 — chiếu lời mời đang chờ", () => {
  it("hiện email, vai trò, người mời, ngày mời và ngày hết hạn", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: INVITATIONS,
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    const invited = invitations[0];
    if (invited === undefined) throw new Error("fixture lời mời rỗng");

    const table = await screen.findByRole("table", { name: "Lời mời đang chờ chấp nhận" });
    const row = within(table).getByRole("rowheader", { name: invited.email }).closest("tr");
    if (row === null) throw new Error("không tìm được hàng của lời mời");

    const cells = within(row as HTMLElement).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("Thành viên");
    expect(cells[1]).toHaveTextContent(invited.invitedBy.displayName);
    expect(cells[2]).toHaveTextContent(new Date(invited.createdAt).toLocaleDateString("vi-VN"));
    expect(cells[3]).toHaveTextContent(new Date(invited.expiresAt).toLocaleDateString("vi-VN"));
  });

  it("là bảng RIÊNG, không phải vài hàng của bảng thành viên", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: INVITATIONS,
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    await screen.findByRole("table", { name: "Lời mời đang chờ chấp nhận" });
    // Hai bảng, hai caption. Một bảng duy nhất nghĩa là hai danh sách đã bị
    // trộn, và khi đó không có chỗ nào để nói "người này chưa có quyền".
    expect(screen.getAllByRole("table")).toHaveLength(2);

    const memberTable = screen.getByRole("table", {
      name: "Thành viên của không gian làm việc",
    });
    const invited = invitations[0];
    if (invited === undefined) throw new Error("fixture lời mời rỗng");
    expect(within(memberTable).queryByText(invited.email)).not.toBeInTheDocument();

    // Không có cột "trạng thái" ở đâu cả: nó chính là cách hai danh sách bị
    // gộp lại thành một, và là điều ADR-0013 dựng ra để tránh.
    expect(screen.queryByRole("columnheader", { name: /Trạng thái/i })).not.toBeInTheDocument();
  });

  it("danh sách rỗng nói rõ nghĩa của rỗng", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: ok({ items: [], page: { nextCursor: null, hasMore: false } }),
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    expect(await screen.findByText("Không có lời mời nào đang chờ")).toBeInTheDocument();
  });

  it("đang tải thì hiện khung chờ, không hiện bảng rỗng", async () => {
    // Một `Promise` không bao giờ hoàn thành: đó là trạng thái Loading thật,
    // không phải một khoảnh khắc thoáng qua khó bắt.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const path = new URL(input, "http://api.test").pathname;
        if (path === INVITATIONS_PATH) return new Promise<Response>(() => {});
        const body =
          path === "/auth/session"
            ? SESSION.body
            : path === "/workspaces"
              ? WORKSPACES.body
              : MEMBERS.body;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    await screen.findByRole("table", { name: "Thành viên của không gian làm việc" });
    expect(screen.getByText("Đang tải dữ liệu")).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: "Lời mời đang chờ chấp nhận" }),
    ).not.toBeInTheDocument();
  });

  it("403 trên riêng danh sách lời mời ra SYS-01, phần thành viên vẫn dùng được", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: failure("forbidden"),
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    expect(await screen.findByText("403")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Thành viên của không gian làm việc" }),
    ).toBeInTheDocument();
  });

  it("404 trên danh sách lời mời ra SYS-05, KHÔNG phải SYS-01", async () => {
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: failure("not-found"),
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    expect(await screen.findByText("404")).toBeInTheDocument();
    expect(screen.queryByText("403")).not.toBeInTheDocument();
  });

  it("lỗi mạng cho nút thử lại, và bấm nó gọi lại đúng route đó", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: failure("internal-error"),
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    const retry = await screen.findByRole("button", { name: "Thử lại" });
    const before = callsTo(INVITATIONS_PATH).length;
    await actor.click(retry);

    await waitFor(() => {
      expect(callsTo(INVITATIONS_PATH).length).toBeGreaterThan(before);
    });
  });
});

describe("WSP-03 — thu hồi lời mời", () => {
  it("hỏi xác nhận trước khi gửi, và Giữ lời mời thì không gửi gì", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: INVITATIONS,
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    const table = await screen.findByRole("table", { name: "Lời mời đang chờ chấp nhận" });
    await actor.click(within(table).getAllByRole("button", { name: "Thu hồi" })[0] as HTMLElement);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Thu hồi lời mời này\?/)).toBeInTheDocument();

    await actor.click(within(dialog).getByRole("button", { name: "Giữ lời mời" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(fetchCalls().some(([, init]) => init.method === "DELETE")).toBe(false);
  });

  it("xác nhận thì gửi DELETE kèm Idempotency-Key và làm mới danh sách lời mời", async () => {
    const actor = user();
    const invited = invitations[0];
    if (invited === undefined) throw new Error("fixture lời mời rỗng");
    const deletePath = `${INVITATIONS_PATH}/${invited.id}`;

    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: INVITATIONS,
      [deletePath]: { status: 204, body: null },
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    const table = await screen.findByRole("table", { name: "Lời mời đang chờ chấp nhận" });
    await actor.click(within(table).getAllByRole("button", { name: "Thu hồi" })[0] as HTMLElement);

    const dialog = await screen.findByRole("dialog");
    const listCallsBefore = callsTo(INVITATIONS_PATH).length;
    await actor.click(within(dialog).getByRole("button", { name: "Thu hồi lời mời" }));

    await waitFor(() => {
      expect(callsTo(deletePath)).toHaveLength(1);
    });
    const [, init] = callsTo(deletePath)[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe("DELETE");
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);

    // Chỉ danh sách lời mời được làm mới. Thu hồi một lời mời `pending` không
    // đụng tới `workspace_members`, vì nó chưa từng tạo dòng nào ở đó.
    await waitFor(() => {
      expect(callsTo(INVITATIONS_PATH).length).toBeGreaterThan(listCallsBefore);
    });
    expect(callsTo(MEMBERS_PATH)).toHaveLength(1);
  });

  it("kết quả thu hồi được đọc lên qua live region", async () => {
    const actor = user();
    const invited = invitations[0];
    if (invited === undefined) throw new Error("fixture lời mời rỗng");

    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: INVITATIONS,
      [`${INVITATIONS_PATH}/${invited.id}`]: { status: 204, body: null },
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    const table = await screen.findByRole("table", { name: "Lời mời đang chờ chấp nhận" });
    await actor.click(within(table).getAllByRole("button", { name: "Thu hồi" })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "Thu hồi lời mời" }));

    const live = await screen.findByText(new RegExp(`Đã thu hồi lời mời gửi tới ${invited.email}`));
    expect(live.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("Escape đóng hộp thoại và trả focus về đúng nút đã mở nó", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: INVITATIONS,
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    const table = await screen.findByRole("table", { name: "Lời mời đang chờ chấp nhận" });
    const opener = within(table).getAllByRole("button", { name: "Thu hồi" })[0] as HTMLElement;
    await actor.click(opener);

    const dialog = await screen.findByRole("dialog");
    // Focus mặc định rơi vào phương án an toàn, không vào nút phá huỷ.
    expect(within(dialog).getByRole("button", { name: "Giữ lời mời" })).toHaveFocus();

    await actor.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });
});

describe("WSP-03 — chữ sau khi mời không suy diễn gì", () => {
  async function invite(actor: ReturnType<typeof user>, email: string): Promise<void> {
    await actor.clear(screen.getByRole("textbox", { name: /Email/ }));
    await actor.type(screen.getByRole("textbox", { name: /Email/ }), email);
    await actor.click(screen.getByRole("button", { name: "Gửi lời mời" }));
  }

  it("nói ĐÚNG câu không kết luận gì về việc email có tài khoản hay không", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: INVITATIONS,
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    await screen.findByRole("table", { name: "Lời mời đang chờ chấp nhận" });
    await actor.click(screen.getByRole("button", { name: "Mời thành viên" }));
    await screen.findByRole("dialog");

    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: INVITATIONS,
      [`${MEMBERS_PATH}`]: ok({ accepted: true }, 202),
    });
    await invite(actor, "ai-do@example.test");

    // Khẳng định trên **chuỗi thật**, không trên biểu thức mờ: cả ba câu sai
    // đều khớp một regex kiểu /lời mời/i, nên chỉ so nguyên văn mới bắt được.
    const notice = await screen.findByText(
      "Đã gửi lời mời nếu địa chỉ hợp lệ. Người được mời phải mở thư và chấp nhận thì mới trở thành thành viên.",
    );
    expect(notice).toBeInTheDocument();
    expect(screen.queryByText(/Đã thêm thành viên/)).not.toBeInTheDocument();
    expect(screen.queryByText(/đã là thành viên/i)).not.toBeInTheDocument();
  });

  it("mời KHÔNG làm mới danh sách thành viên, chỉ làm mới danh sách lời mời", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: INVITATIONS,
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    await screen.findByRole("table", { name: "Lời mời đang chờ chấp nhận" });
    expect(callsTo(MEMBERS_PATH)).toHaveLength(1);
    const invitationCallsBefore = callsTo(INVITATIONS_PATH).length;

    await actor.click(screen.getByRole("button", { name: "Mời thành viên" }));
    await screen.findByRole("dialog");
    await invite(actor, "ai-do@example.test");

    await waitFor(() => {
      expect(callsTo(INVITATIONS_PATH).length).toBeGreaterThan(invitationCallsBefore);
    });

    // `GET` danh sách thành viên vẫn đúng **một** lần: lần nạp đầu. Lượt `POST`
    // mời đi cùng đường dẫn nhưng khác method, nên đếm riêng.
    const memberGets = callsTo(MEMBERS_PATH).filter(([, init]) => (init.method ?? "GET") === "GET");
    expect(memberGets).toHaveLength(1);
  });

  it("đổi email thì xoay Idempotency-Key; gửi lại y nguyên thì giữ", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      "/workspaces": WORKSPACES,
      [MEMBERS_PATH]: MEMBERS,
      [INVITATIONS_PATH]: INVITATIONS,
    });
    renderWithProviders(<WorkspaceMembersScreen workspaceId={ids.workspace} />);

    await screen.findByRole("table", { name: "Lời mời đang chờ chấp nhận" });
    await actor.click(screen.getByRole("button", { name: "Mời thành viên" }));
    await screen.findByRole("dialog");

    // Lỗi mạng để hộp thoại không đóng: ba lần gửi phải nằm trong cùng một
    // phiên mở form, vì đó mới là lúc vòng đời key có nghĩa.
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit) => {
        const path = new URL(input, "http://api.test").pathname;
        if (path === MEMBERS_PATH && init.method === "POST") {
          attempts += 1;
          throw new TypeError("Failed to fetch");
        }
        const body =
          path === "/auth/session"
            ? SESSION.body
            : path === "/workspaces"
              ? WORKSPACES.body
              : path === INVITATIONS_PATH
                ? INVITATIONS.body
                : MEMBERS.body;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await invite(actor, "mot@example.test");
    await waitFor(() => {
      expect(attempts).toBe(1);
    });

    // Gửi lại **y nguyên**: đây là retry vì lỗi vận chuyển, key phải giữ.
    await actor.click(screen.getByRole("button", { name: "Gửi lời mời" }));
    await waitFor(() => {
      expect(attempts).toBe(2);
    });

    // Đổi email: một ý định khác, key phải xoay. Không xoay ở đây là cách một
    // lời mời gửi tới địa chỉ thứ hai bị server trả về kết quả của địa chỉ đầu.
    await invite(actor, "hai@example.test");
    await waitFor(() => {
      expect(attempts).toBe(3);
    });

    const keys = fetchCalls()
      .filter(([url, init]) => url.includes("/members") && init.method === "POST")
      .map(([, init]) => (init.headers as Record<string, string>)["idempotency-key"]);

    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
