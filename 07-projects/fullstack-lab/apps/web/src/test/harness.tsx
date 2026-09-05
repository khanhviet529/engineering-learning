import { render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { useSyncExternalStore, type ReactElement } from "react";
import { errorFor, type Scenario } from "@flowboard/mock";
import { createQueryClient } from "../lib/query.tsx";
import { ThemePreferenceProvider } from "../features/account/theme-preference.tsx";

/**
 * Bộ đồ nghề dùng chung cho test của `apps/web`.
 *
 * Nó dựng đúng cây provider mà layout gốc dựng, để test chạy trên cùng ngữ
 * cảnh với ứng dụng thật thay vì một ngữ cảnh giả gần giống.
 */

/**
 * Đường điều hướng mà test quan sát được, thay cho router thật của Next.
 *
 * `search` tồn tại vì từ `BRD-01` trở đi, **query state là state của màn
 * hình**: `?panel=columns` mở `BRD-02`, `?task=` mở `TSK-02`. Một router giả
 * chỉ ghi lại lời gọi `push` sẽ không bao giờ đóng được lớp phủ trong test, và
 * ta sẽ phải viết component quanh một prop thay vì quanh URL — tức là kiểm một
 * kiến trúc khác với kiến trúc chạy thật.
 */
export const navigation = {
  pushed: [] as string[],
  pathname: "/khong-gian-lam-viec",
  search: "",
};

const routeListeners = new Set<() => void>();

function subscribeToRoute(listener: () => void): () => void {
  routeListeners.add(listener);
  return () => routeListeners.delete(listener);
}

/** Snapshot phải là **chuỗi**, không phải object mới mỗi lần: object mới ⇒ vòng lặp render. */
function routeSnapshot(): string {
  return `${navigation.pathname}?${navigation.search}`;
}

function navigate(href: string): void {
  navigation.pushed.push(href);
  const [pathname = "", search = ""] = href.split("?");
  navigation.pathname = pathname;
  navigation.search = search;
  for (const listener of routeListeners) listener();
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigate,
    replace: navigate,
    back: () => {},
  }),
  usePathname: () => {
    useSyncExternalStore(subscribeToRoute, routeSnapshot, routeSnapshot);
    return navigation.pathname;
  },
  useSearchParams: () => {
    useSyncExternalStore(subscribeToRoute, routeSnapshot, routeSnapshot);
    return new URLSearchParams(navigation.search);
  },
  redirect: navigate,
}));

export function resetNavigation(pathname = "/khong-gian-lam-viec", search = ""): void {
  navigation.pushed.length = 0;
  navigation.pathname = pathname;
  navigation.search = search;
}

/**
 * `user-event` không có độ trễ nhân tạo.
 *
 * Mặc định nó chèn một khoảng chờ giữa các thao tác để mô phỏng người thật.
 * Với cây component của M2 — app shell cộng `ConfigProvider` của Ant Design —
 * khoảng chờ đó cộng dồn thành hàng giây cho mỗi test mà không kiểm thêm điều gì.
 */
export function user() {
  return userEvent.setup({ delay: null });
}

export function renderWithProviders(ui: ReactElement): RenderResult {
  // Một QueryClient mới cho **mỗi** test: cache dùng chung giữa các test là
  // cách một test bị ảnh hưởng bởi dữ liệu của test trước mà không ai thấy.
  const client = createQueryClient();
  return render(
    <ThemePreferenceProvider>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </ThemePreferenceProvider>,
  );
}

interface RouteResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * Một route: hoặc một response cố định, hoặc một hàm đọc chính request.
 *
 * Dạng hàm có mặt từ M4, khi `BRD-01` phân trang **theo từng cột**: cùng một
 * đường dẫn `/projects/:id/tasks` phải trả kết quả khác nhau theo `columnId`
 * và `cursor` trong query. Một bảng chỉ tra theo pathname không diễn đạt được
 * điều đó, và một test không diễn đạt được nó thì không kiểm được điều quan
 * trọng nhất: cursor của cột này không rơi sang cột kia.
 */
export type RouteHandler = RouteResponse | ((url: URL, init: RequestInit) => RouteResponse);

/**
 * Giả lập HTTP theo **đường dẫn**.
 *
 * Test khai `"/workspaces": ok(...)` thay vì mock từng lần gọi theo thứ tự.
 * Thứ tự gọi là chi tiết cài đặt; khai theo đường dẫn khiến test không vỡ khi
 * một màn hình thêm một request song song.
 */
export function mockRoutes(routes: Record<string, RouteHandler>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, "http://api.test");
      const match = Object.keys(routes).find((path) => url.pathname === path);
      const entry = match === undefined ? undefined : routes[match];
      const route =
        entry === undefined
          ? { status: 404, body: errorFor("not-found").body, headers: {} }
          : typeof entry === "function"
            ? entry(url, init)
            : entry;

      if (route.status === 204) {
        return new Response(null, { status: 204, headers: { "x-request-id": "test" } });
      }
      return new Response(JSON.stringify(route.body), {
        status: route.status,
        headers: { "content-type": "application/json", ...(route.headers ?? {}) },
      });
    }),
  );
}

/** Một response thành công theo envelope của hợp đồng. */
export function ok(data: unknown, status = 200): RouteResponse {
  return { status, body: { data, requestId: "test-request-id" } };
}

/** Một response lỗi lấy thẳng từ 11 kịch bản của mock, không tự chế. */
export function failure(scenario: Exclude<Scenario, "success">): RouteResponse {
  const response = errorFor(scenario);
  return { status: response.status, body: response.body, headers: response.headers };
}

/** Lỗi vận chuyển: fetch ném, chưa biết server đã nhận hay chưa. */
export function mockTransportFailure(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
}
