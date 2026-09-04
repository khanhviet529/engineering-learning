import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { actors, workspace } from "@flowboard/mock";
import {
  failure,
  mockRoutes,
  mockTransportFailure,
  navigation,
  ok,
  renderWithProviders,
  resetNavigation,
  user,
} from "./harness.tsx";
import { AcceptInvitationScreen } from "../features/invitations/accept-invitation.tsx";
import { createQueryClient } from "../lib/query.tsx";
import { sessionQueryKey } from "../features/session/session.tsx";
import { ThemePreferenceProvider } from "../features/account/theme-preference.tsx";
import { SignInForm } from "../features/auth/sign-in-form.tsx";

/**
 * `WSP-05` — chấp nhận lời mời.
 *
 * Hai tính chất được kiểm kỹ hơn phần còn lại, vì hỏng chúng là hỏng thật:
 *
 * - **Bốn nguyên nhân token hỏng phải không phân biệt được.** Bộ kiểm so các
 *   lần render **với nhau**, không so từng lần với một chuỗi mong đợi: so với
 *   chuỗi thì bốn nhánh cùng rò rỉ theo cùng một kiểu vẫn xanh.
 * - **Token chỉ được gửi đúng một lần.** Request này tiêu thụ token, nên lần
 *   gọi thứ hai biến một lần tham gia thành công thành "lời mời không dùng được".
 */

const TOKEN = "a".repeat(43);
const ACCEPT_PATH = "/invitations/accept";
const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });

function postsToAccept(): [string, RequestInit][] {
  const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
    .calls;
  return calls.filter(([url]) => url.endsWith(ACCEPT_PATH));
}

beforeEach(() => {
  resetNavigation("/loi-moi/chap-nhan");
  window.history.replaceState(null, "", `/loi-moi/chap-nhan?token=${TOKEN}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("WSP-05 — năm trạng thái", () => {
  it("loading: chưa có kết luận nào, và không có nút hành động nào để bấm nhầm", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.endsWith("/auth/session")) {
          return new Response(JSON.stringify(SESSION.body), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        // Request chấp nhận không bao giờ xong: đây là trạng thái đang kiểm.
        return new Promise<Response>(() => {});
      }),
    );
    renderWithProviders(<AcceptInvitationScreen token={TOKEN} />);

    expect(await screen.findByText("Đang kiểm tra lời mời…")).toBeInTheDocument();
    expect(screen.queryByText("Lời mời này không dùng được")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("accepted: nói tên không gian và nhắc quyền dự án vẫn cấp riêng", async () => {
    mockRoutes({ "/auth/session": SESSION, [ACCEPT_PATH]: ok({ workspace }) });
    renderWithProviders(<AcceptInvitationScreen token={TOKEN} />);

    expect(
      await screen.findByText(`Bạn đã là thành viên của ${workspace.name}`),
    ).toBeInTheDocument();
    expect(screen.getByText(/quyền đọc dự án riêng tư/)).toBeInTheDocument();
  });

  it("accepted: nút chính đưa về WSP-01", async () => {
    const actor = user();
    mockRoutes({ "/auth/session": SESSION, [ACCEPT_PATH]: ok({ workspace }) });
    renderWithProviders(<AcceptInvitationScreen token={TOKEN} />);

    await screen.findByText(`Bạn đã là thành viên của ${workspace.name}`);
    await actor.click(screen.getByRole("button", { name: "Vào danh sách không gian làm việc" }));
    expect(navigation.pushed).toContain("/khong-gian-lam-viec");
  });

  it("token-unusable: một thông điệp, và nói việc cần làm là xin lời mời mới", async () => {
    mockRoutes({ "/auth/session": SESSION, [ACCEPT_PATH]: failure("validation-failed") });
    renderWithProviders(<AcceptInvitationScreen token={TOKEN} />);

    expect(await screen.findByText("Lời mời này không dùng được")).toBeInTheDocument();
    expect(screen.getByText(/nhờ người đã mời bạn gửi một lời mời mới/)).toBeInTheDocument();
  });

  it("error: nói rõ lời mời CHƯA bị dùng, và có nút thử lại gọi lại đúng route", async () => {
    const actor = user();
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.endsWith("/auth/session")) {
          return new Response(JSON.stringify(SESSION.body), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        attempts += 1;
        throw new TypeError("Failed to fetch");
      }),
    );
    renderWithProviders(<AcceptInvitationScreen token={TOKEN} />);

    expect(await screen.findByText(/Lời mời chưa bị dùng/)).toBeInTheDocument();
    // Trạng thái này **không** được nói token đã hỏng: chưa có gì bị tiêu.
    expect(screen.queryByText("Lời mời này không dùng được")).not.toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => {
      expect(attempts).toBe(2);
    });
  });

  it("sign-in-required: giữ token trong đích quay lại của cả đăng nhập lẫn đăng ký", async () => {
    const actor = user();
    mockRoutes({ "/auth/session": failure("unauthenticated") });
    renderWithProviders(<AcceptInvitationScreen token={TOKEN} />);

    await screen.findByText(/Lời mời gắn với email nhận thư/);
    // Chưa có phiên thì tuyệt đối không được gửi request tiêu thụ token.
    expect(postsToAccept()).toHaveLength(0);

    await actor.click(screen.getByRole("button", { name: "Đăng nhập rồi tiếp tục" }));
    await actor.click(screen.getByRole("button", { name: "Đăng ký bằng email được mời" }));

    const expected = encodeURIComponent(`/loi-moi/chap-nhan?token=${TOKEN}`);
    expect(navigation.pushed).toContain(`/dang-nhap?next=${expected}`);
    expect(navigation.pushed).toContain(`/dang-ky?next=${expected}`);
  });

  it("không có token thì là token-unusable, và không gọi server", async () => {
    mockRoutes({ "/auth/session": SESSION });
    renderWithProviders(<AcceptInvitationScreen token={undefined} />);

    expect(await screen.findByText("Lời mời này không dùng được")).toBeInTheDocument();
    expect(postsToAccept()).toHaveLength(0);
  });
});

describe("WSP-05 — bốn nguyên nhân token hỏng không phân biệt được", () => {
  /**
   * Server trả cùng một `400 VALIDATION_FAILED` cho cả bốn. Bộ kiểm này đi xa
   * hơn một bước: kể cả khi server **có** rò một chi tiết phân biệt, giao diện
   * cũng không được hiện nó ra. Nên bốn lần dựng dưới đây mang bốn `details`
   * khác nhau, và phần chữ hiển thị vẫn phải giống hệt nhau.
   */
  const leaks = ["invalid", "expired", "already_used", "revoked"];

  it("bốn lần render cho ra cùng một nội dung hiển thị", async () => {
    const rendered: string[] = [];

    for (const leak of leaks) {
      mockRoutes({
        "/auth/session": SESSION,
        [ACCEPT_PATH]: {
          status: 400,
          body: {
            error: {
              code: "VALIDATION_FAILED",
              message: `Invitation token is ${leak}.`,
              details: [{ field: "token", code: leak, message: `Token is ${leak}.` }],
            },
            requestId: "test-request-id",
          },
        },
      });
      const view = renderWithProviders(<AcceptInvitationScreen token={TOKEN} />);
      await screen.findByText("Lời mời này không dùng được");
      rendered.push(view.container.textContent ?? "");
      view.unmount();
      vi.unstubAllGlobals();
    }

    expect(rendered).toHaveLength(4);
    for (const text of rendered) expect(text).toBe(rendered[0]);
    // Và không bản nào mang theo chữ mà server đã rò.
    for (const leak of leaks) expect(rendered[0]).not.toContain(leak);
  });
});

describe("WSP-05 — vòng đời của token", () => {
  it("chấp nhận xong thì token biến khỏi thanh địa chỉ", async () => {
    mockRoutes({ "/auth/session": SESSION, [ACCEPT_PATH]: ok({ workspace }) });
    expect(window.location.search).toContain("token=");

    renderWithProviders(<AcceptInvitationScreen token={TOKEN} />);
    await screen.findByText(`Bạn đã là thành viên của ${workspace.name}`);

    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/loi-moi/chap-nhan");
  });

  it("token hỏng cũng bị dọn khỏi thanh địa chỉ", async () => {
    mockRoutes({ "/auth/session": SESSION, [ACCEPT_PATH]: failure("validation-failed") });
    renderWithProviders(<AcceptInvitationScreen token={TOKEN} />);

    await screen.findByText("Lời mời này không dùng được");
    expect(window.location.search).toBe("");
  });

  it("lỗi mạng thì GIỮ token: nó chưa bị tiêu, và lần thử lại cần nó", async () => {
    mockTransportFailure();
    renderWithProviders(<AcceptInvitationScreen token={TOKEN} />);

    await screen.findByText(/Lời mời chưa bị dùng/);
    expect(window.location.search).toContain(`token=${TOKEN}`);
  });

  it("gửi ĐÚNG MỘT lần, dù effect có chạy lại", async () => {
    // Phiên đã nằm sẵn trong cache — đúng tình huống thật: người dùng đang
    // đăng nhập, mở liên kết trong thư, và `WSP-05` mount khi `useSession()`
    // đã có dữ liệu ngay từ lượt render đầu. Chỉ trong tình huống đó, lượt
    // gọi effect thứ hai của StrictMode mới thấy `actor` và gửi lần thứ hai.
    // Với một `QueryClient` trắng, effect lượt đầu thoát sớm vì còn đang tải,
    // nên bài kiểm sẽ xanh một cách vô nghĩa.
    mockRoutes({ "/auth/session": SESSION, [ACCEPT_PATH]: ok({ workspace }) });
    const client = createQueryClient();
    client.setQueryData(sessionQueryKey, { actor: actors.ownerB, csrfToken: "csrf" });

    render(
      <ThemePreferenceProvider>
        <QueryClientProvider client={client}>
          <StrictMode>
            <AcceptInvitationScreen token={TOKEN} />
          </StrictMode>
        </QueryClientProvider>
      </ThemePreferenceProvider>,
    );

    await screen.findByText(`Bạn đã là thành viên của ${workspace.name}`);

    // Và một lượt làm mới phiên: `useSession()` trả ra một `actor` **mới về
    // định danh đối tượng**, nên effect chạy lại. Đây mới là đường thật sự dẫn
    // tới lần gửi thứ hai, và nó không cần StrictMode để xảy ra.
    // Đổi cả nội dung, không chỉ định danh đối tượng: TanStack Query dùng
    // structural sharing, nên một bản sao **giống hệt** vẫn trả về đúng tham
    // chiếu cũ và effect sẽ không chạy lại. Muốn dựng đúng tình huống cần
    // kiểm thì dữ liệu phải thật sự khác.
    client.setQueryData(sessionQueryKey, {
      actor: { ...actors.ownerB, displayName: "Tên vừa đổi" },
      csrfToken: "csrf",
    });
    await waitFor(() => {
      expect(screen.getByText(`Bạn đã là thành viên của ${workspace.name}`)).toBeInTheDocument();
    });

    // Lần gọi thứ hai gặp token đã dùng và sẽ biến thành công thành
    // "không dùng được" — đúng thứ người dùng không bao giờ nên thấy.
    expect(postsToAccept()).toHaveLength(1);
  });
});

describe("WSP-05 — đăng nhập bằng email khác", () => {
  it("hiện thông điệp của server và mở đường đổi tài khoản", async () => {
    const actor = user();
    mockRoutes({
      "/auth/session": SESSION,
      [ACCEPT_PATH]: {
        status: 403,
        body: {
          error: {
            code: "FORBIDDEN",
            message: "Lời mời này thuộc về một địa chỉ email khác.",
          },
          requestId: "test-request-id",
        },
      },
      "/auth/sign-out": { status: 204, body: null },
    });
    renderWithProviders(<AcceptInvitationScreen token={TOKEN} />);

    // Ngoại lệ duy nhất của quy tắc "một thông điệp": ở đây nói rõ là đúng.
    expect(
      await screen.findByText("Lời mời này thuộc về một địa chỉ email khác."),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(actors.ownerB.email))).toBeInTheDocument();

    // Token chưa bị tiêu, nên nó phải còn nguyên cho lần đăng nhập đúng địa chỉ.
    expect(window.location.search).toContain(`token=${TOKEN}`);

    await actor.click(
      screen.getByRole("button", { name: "Đăng xuất rồi đăng nhập bằng địa chỉ được mời" }),
    );
    await waitFor(() => {
      expect(navigation.pushed).toContain(
        `/dang-nhap?next=${encodeURIComponent(`/loi-moi/chap-nhan?token=${TOKEN}`)}`,
      );
    });
  });
});

describe("AUTH-01 — đích quay lại sau khi đăng nhập", () => {
  async function signIn(actor: ReturnType<typeof user>): Promise<void> {
    await actor.type(screen.getByRole("textbox", { name: /Email/ }), "ai-do@example.test");
    await actor.type(screen.getByLabelText(/Mật khẩu/), "MotMatKhauDuDai123");
    await actor.click(screen.getByRole("button", { name: "Đăng nhập" }));
  }

  it("token sống sót qua đăng nhập và quay lại đúng lời mời", async () => {
    const actor = user();
    mockRoutes({ "/auth/sign-in": ok({ actor: actors.ownerB, csrfToken: "csrf" }) });
    const next = `/loi-moi/chap-nhan?token=${TOKEN}`;
    renderWithProviders(<SignInForm next={next} />);

    await signIn(actor);
    await waitFor(() => {
      expect(navigation.pushed).toContain(next);
    });
  });

  it("đích ngoài miền bị từ chối, người dùng về đích mặc định", async () => {
    const actor = user();
    mockRoutes({ "/auth/sign-in": ok({ actor: actors.ownerB, csrfToken: "csrf" }) });
    renderWithProviders(<SignInForm next="https://evil.test/thu-hoach" />);

    await signIn(actor);
    await waitFor(() => {
      expect(navigation.pushed).toContain("/khong-gian-lam-viec");
    });
    expect(navigation.pushed.some((href) => href.includes("evil.test"))).toBe(false);
  });

  it("protocol-relative cũng bị từ chối", async () => {
    const actor = user();
    mockRoutes({ "/auth/sign-in": ok({ actor: actors.ownerB, csrfToken: "csrf" }) });
    renderWithProviders(<SignInForm next="//evil.test" />);

    await signIn(actor);
    await waitFor(() => {
      expect(navigation.pushed).toContain("/khong-gian-lam-viec");
    });
    expect(navigation.pushed.some((href) => href.includes("evil.test"))).toBe(false);
  });
});
