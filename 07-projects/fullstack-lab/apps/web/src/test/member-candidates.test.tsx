import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import {
  actors,
  capabilitiesByRole,
  columns,
  ids,
  memberCandidates,
  members,
  projectB,
  projectHandlers,
} from "@flowboard/mock";
import {
  failure,
  mockRoutes,
  ok,
  renderWithProviders,
  resetNavigation,
  user,
  type RouteHandler,
} from "./harness.tsx";
import { ProjectMembersScreen } from "../features/members/project-members.tsx";

/**
 * `PRM-01` — chọn người, không dán mã.
 *
 * Trước đây màn này có một ô text với hint "Dán UUID của người dùng". Nó
 * **không dùng được**: không màn hình nào trong sản phẩm hiển thị `userId` của
 * ai, nên không có chỗ hợp lệ nào để copy giá trị đó ra. Bộ kiểm này canh ba
 * điều mà một happy-path test sẽ bỏ qua:
 *
 * 1. `userId` đi trong body nhưng **không** hiện ra màn hình.
 * 2. Một trang không phải là hết — cursor phải được đi tiếp.
 * 3. Rỗng là chuyện bình thường của workspace nhỏ, không phải lỗi.
 */

const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });
const DETAIL_PATH = `/projects/${ids.projectB}`;
const CANDIDATES_PATH = `/projects/${ids.projectB}/member-candidates`;
const MEMBERS_PATH = `/projects/${ids.projectB}/members`;

/** Trang ứng viên lấy thẳng từ mock, để test không tự chế hình dạng response. */
function candidatePage(cursor: string | null): RouteHandler {
  const body = projectHandlers.memberCandidates(cursor).body as {
    data: { items: unknown[]; page: { nextCursor: string | null; hasMore: boolean } };
  };
  return ok(body.data);
}

/** Mock chia bảy ứng viên thành hai trang; route đây đi theo đúng `cursor` nhận được. */
const PAGED: RouteHandler = (url) => candidatePage(url.searchParams.get("cursor"));

function screenRoutes(candidates: RouteHandler, addMember?: RouteHandler): void {
  mockRoutes({
    "/auth/session": SESSION,
    [DETAIL_PATH]: ok({
      project: projectB,
      capabilities: capabilitiesByRole.owner,
      columns,
      members,
    }),
    [CANDIDATES_PATH]: candidates,
    ...(addMember === undefined ? {} : { [MEMBERS_PATH]: addMember }),
  });
}

function calls(): [string, RequestInit][] {
  return (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
}

async function openDialog(): Promise<ReturnType<typeof user>> {
  const actor = user();
  renderWithProviders(<ProjectMembersScreen projectId={ids.projectB} />);
  await actor.click(await screen.findByRole("button", { name: "Thêm thành viên" }));
  return actor;
}

beforeEach(() => {
  resetNavigation(`/du-an/${ids.projectB}/thanh-vien`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PRM-01 — picker thay cho ô dán UUID", () => {
  it("KHÔNG còn ô nhập mã người dùng nào", async () => {
    screenRoutes(PAGED);
    await openDialog();

    await screen.findByRole("radio", { name: /Binh/ });
    expect(screen.queryByLabelText("Mã người dùng")).not.toBeInTheDocument();
    expect(screen.queryByText(/Dán UUID/)).not.toBeInTheDocument();
  });

  it("chọn theo tên và email; UUID không xuất hiện ở đâu trên màn", async () => {
    screenRoutes(PAGED);
    await openDialog();

    const first = memberCandidates[0]!;
    const option = await screen.findByRole("radio", { name: new RegExp(first.displayName) });
    expect(option).toBeInTheDocument();
    // `email` có mặt vì hai người có thể trùng tên hiển thị.
    expect(screen.getByText(first.email)).toBeInTheDocument();

    // Và `userId` — thứ **được gửi lên** — không lọt ra bề mặt người đọc.
    const body = document.body.textContent ?? "";
    for (const candidate of memberCandidates) expect(body).not.toContain(candidate.userId);
  });

  it("gửi `userId` của người được chọn, không phải tên của họ", async () => {
    const created = vi.fn();
    screenRoutes(PAGED, (_url, init) => {
      created(JSON.parse(String(init.body)));
      return ok({ member: members[0] }, 201);
    });
    const actor = await openDialog();

    const target = memberCandidates[1]!;
    await actor.click(await screen.findByRole("radio", { name: new RegExp(target.displayName) }));
    await actor.click(screen.getByRole("button", { name: "Thêm vào dự án" }));

    expect(created).toHaveBeenCalledWith({ userId: target.userId, role: "editor" });
  });
});

describe("PRM-01 — một trang không phải là hết", () => {
  it("`Tải thêm ứng viên` nạp trang sau và giữ lại trang trước", async () => {
    screenRoutes(PAGED);
    const actor = await openDialog();

    // Mock chia bảy người thành 5 + 2.
    await screen.findByRole("radio", { name: /Binh/ });
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.queryByRole("radio", { name: /Quan/ })).not.toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Tải thêm ứng viên" }));

    expect(await screen.findByRole("radio", { name: /Quan/ })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(memberCandidates.length);
    // Người của trang đầu vẫn còn: trang sau **nối vào**, không thay thế.
    expect(screen.getByRole("radio", { name: /Binh/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải thêm ứng viên" })).not.toBeInTheDocument();
  });

  it("cursor gửi lên là cursor server phát, không phải số trang client tự đếm", async () => {
    screenRoutes(PAGED);
    const actor = await openDialog();
    await screen.findByRole("radio", { name: /Binh/ });
    await actor.click(screen.getByRole("button", { name: "Tải thêm ứng viên" }));
    await screen.findByRole("radio", { name: /Quan/ });

    const requested = calls()
      .map(([url]) => new URL(url, "http://api.test"))
      .filter((url) => url.pathname === CANDIDATES_PATH)
      .map((url) => url.searchParams.get("cursor"));

    // Trang đầu **không** mang cursor; trang sau mang đúng giá trị opaque của
    // server. Một `page=2` tự đếm sẽ nhận `400` ở server thật.
    expect(requested).toEqual([null, "mock-candidates-page-2"]);
  });
});

describe("PRM-01 — ba trạng thái, không chỉ happy path", () => {
  it("đang tải: chưa có radio nào và chưa nói là rỗng", async () => {
    // Route không bao giờ trả lời ⇒ query đứng ở `pending`.
    screenRoutes(() => new Promise<never>(() => {}) as never);
    await openDialog();

    expect(
      await screen.findByRole("dialog", { name: "Thêm thành viên dự án" }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(
      screen.queryByText("Mọi thành viên của không gian đã ở trong dự án này"),
    ).not.toBeInTheDocument();
  });

  it("rỗng là chuyện bình thường của workspace nhỏ, không phải lỗi", async () => {
    screenRoutes(ok({ items: [], page: { nextCursor: null, hasMore: false } }));
    await openDialog();

    expect(
      await screen.findByText("Mọi thành viên của không gian đã ở trong dự án này"),
    ).toBeInTheDocument();
    // Không có mã lỗi hệ thống nào, và nút thêm bị khoá vì không có gì để thêm.
    expect(screen.queryByText("403")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thêm vào dự án" })).toBeDisabled();
  });

  it("lỗi hiện chữ của feature, không phải message tiếng Anh của server", async () => {
    screenRoutes(failure("forbidden"));
    await openDialog();

    const dialog = await screen.findByRole("dialog", { name: "Thêm thành viên dự án" });
    expect(
      await within(dialog).findByText(
        "Vai trò hiện tại của bạn không xem được danh sách ứng viên.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/You do not have permission/)).not.toBeInTheDocument();
  });
});

describe("PRM-01 — vòng đời Idempotency-Key giữ nguyên", () => {
  it("đổi người hoặc đổi vai trò là ý định khác, nên key khác", async () => {
    let attempt = 0;
    screenRoutes(PAGED, () => {
      attempt += 1;
      // Hai lần đầu hỏng ở tầng nghiệp vụ để hộp thoại ở lại và cho gửi tiếp.
      return attempt <= 2 ? failure("internal-error") : ok({ member: members[0] }, 201);
    });
    const actor = await openDialog();

    const keys = () =>
      calls()
        .filter(([url]) => new URL(url, "http://api.test").pathname === MEMBERS_PATH)
        .map(([, init]) => (init.headers as Record<string, string>)["idempotency-key"]);

    const first = memberCandidates[0]!;
    const second = memberCandidates[1]!;

    await actor.click(await screen.findByRole("radio", { name: new RegExp(first.displayName) }));
    await actor.click(screen.getByRole("button", { name: "Thêm vào dự án" }));
    await screen.findByText(/Không áp dụng được thay đổi thành viên/);

    // Đổi **người** ⇒ payload khác ⇒ ý định khác.
    await actor.click(screen.getByRole("radio", { name: new RegExp(second.displayName) }));
    await actor.click(screen.getByRole("button", { name: "Thêm vào dự án" }));

    const [keyA, keyB] = keys();
    expect(keyA).toBeTruthy();
    expect(keyB).toBeTruthy();
    expect(keyA).not.toBe(keyB);

    // Đổi **vai trò** cũng vậy, dù vẫn là người đó.
    await actor.selectOptions(screen.getByLabelText("Vai trò trong dự án"), "viewer");
    await actor.click(screen.getByRole("button", { name: "Thêm vào dự án" }));
    const [, , keyC] = keys();
    expect(keyC).toBeTruthy();
    expect(keyC).not.toBe(keyB);
  });
});
