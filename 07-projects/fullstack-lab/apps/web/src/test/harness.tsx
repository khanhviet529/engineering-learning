import { render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import type { ReactElement } from "react";
import { errorFor, type Scenario } from "@flowboard/mock";
import { createQueryClient } from "../lib/query.tsx";
import { ThemePreferenceProvider } from "../features/account/theme-preference.tsx";

/**
 * Bộ đồ nghề dùng chung cho test của `apps/web`.
 *
 * Nó dựng đúng cây provider mà layout gốc dựng, để test chạy trên cùng ngữ
 * cảnh với ứng dụng thật thay vì một ngữ cảnh giả gần giống.
 */

/** Đường điều hướng mà test quan sát được, thay cho router thật của Next. */
export const navigation = {
  pushed: [] as string[],
  pathname: "/khong-gian-lam-viec",
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => navigation.pushed.push(href),
    replace: (href: string) => navigation.pushed.push(href),
    back: () => {},
  }),
  usePathname: () => navigation.pathname,
  redirect: (href: string) => navigation.pushed.push(href),
}));

export function resetNavigation(pathname = "/khong-gian-lam-viec"): void {
  navigation.pushed.length = 0;
  navigation.pathname = pathname;
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
 * Giả lập HTTP theo **đường dẫn**.
 *
 * Test khai `"/workspaces": ok(...)` thay vì mock từng lần gọi theo thứ tự.
 * Thứ tự gọi là chi tiết cài đặt; khai theo đường dẫn khiến test không vỡ khi
 * một màn hình thêm một request song song.
 */
export function mockRoutes(routes: Record<string, RouteResponse>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://api.test");
      const match = Object.keys(routes).find((path) => url.pathname === path);
      const route =
        match === undefined
          ? { status: 404, body: errorFor("not-found").body, headers: {} }
          : routes[match];

      if (route === undefined || route.status === 204) {
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
