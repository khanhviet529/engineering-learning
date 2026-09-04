import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { actors, ids, workspace, type Scenario } from "@flowboard/mock";
import { failure, mockRoutes, ok, renderWithProviders, resetNavigation } from "./harness.tsx";
import { WorkspaceListScreen } from "../features/workspaces/workspace-list.tsx";
import { WorkspaceMembersScreen } from "../features/workspaces/workspace-members.tsx";
import { WorkspaceSettingsScreen } from "../features/workspaces/workspace-settings.tsx";
import { ProjectListScreen } from "../features/projects/project-list.tsx";
import { ProjectSettingsScreen } from "../features/projects/project-settings.tsx";
import { ProjectMembersScreen } from "../features/members/project-members.tsx";

/**
 * Mọi màn hình M2 × mọi kịch bản lỗi của mock.
 *
 * Đây là bước rà soát mà kế hoạch M2 yêu cầu: không chỉ "có hiển thị lỗi", mà
 * **lỗi có nói đúng việc cần làm tiếp theo hay không**. Một trang lỗi chỉ sai
 * đường còn tệ hơn một trang lỗi không nói gì: nó khiến người dùng bấm vào
 * một thứ chắc chắn không có kết quả.
 *
 * Vì vậy mỗi trường hợp phải thoả ba điều:
 *
 * 1. Render ra **đúng một** màn hình hệ thống, không phải hai.
 * 2. Màn hình đó có **một hành động** rời khỏi bế tắc.
 * 3. **Không** rò rỉ dữ liệu private: không tên workspace, không tên dự án.
 */

const SESSION = ok({ actor: actors.ownerB, csrfToken: "csrf" });
const WORKSPACES = ok({ items: [workspace], page: { nextCursor: null, hasMore: false } });

const SCENARIOS: Exclude<Scenario, "success">[] = [
  "unauthenticated",
  "forbidden",
  "not-found",
  "validation-failed",
  "version-conflict",
  "idempotency-reused",
  "idempotency-in-progress",
  "column-not-empty",
  "rate-limited",
  "email-verification-required",
  "internal-error",
];

/** Mỗi màn hình cùng route dữ liệu chính của nó. */
const SCREENS: {
  id: string;
  route: (scenario: Exclude<Scenario, "success">) => Record<string, ReturnType<typeof failure>>;
  render: () => ReactElement;
}[] = [
  {
    id: "WSP-01",
    route: (scenario) => ({ "/workspaces": failure(scenario) }),
    render: () => <WorkspaceListScreen />,
  },
  {
    id: "WSP-03",
    route: (scenario) => ({ [`/workspaces/${ids.workspace}/members`]: failure(scenario) }),
    render: () => <WorkspaceMembersScreen workspaceId={ids.workspace} />,
  },
  {
    id: "WSP-04",
    route: (scenario) => ({ "/workspaces": failure(scenario) }),
    render: () => <WorkspaceSettingsScreen workspaceId={ids.workspace} />,
  },
  {
    id: "PRJ-01",
    route: (scenario) => ({ [`/workspaces/${ids.workspace}/projects`]: failure(scenario) }),
    render: () => <ProjectListScreen workspaceId={ids.workspace} />,
  },
  {
    id: "PRJ-03",
    route: (scenario) => ({ [`/projects/${ids.projectB}`]: failure(scenario) }),
    render: () => <ProjectSettingsScreen projectId={ids.projectB} />,
  },
  {
    id: "PRM-01",
    route: (scenario) => ({ [`/projects/${ids.projectB}`]: failure(scenario) }),
    render: () => <ProjectMembersScreen projectId={ids.projectB} />,
  },
];

/** Mã hiển thị của từng màn hình hệ thống — dùng để đếm xem có đúng một. */
const SYSTEM_CODES = ["401", "403", "404", "503", "Lỗi kết nối"];

beforeEach(() => {
  resetNavigation();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

for (const screenCase of SCREENS) {
  describe(`${screenCase.id} × 11 kịch bản lỗi`, () => {
    for (const scenario of SCENARIOS) {
      it(`${scenario}: nói được việc cần làm tiếp, không rò rỉ dữ liệu`, async () => {
        mockRoutes({
          "/auth/session": SESSION,
          // `WSP-03` và `WSP-04` cần danh sách workspace để biết capability;
          // giữ nó thành công để kịch bản lỗi rơi vào đúng route đang thử.
          ...(screenCase.id === "WSP-03" || screenCase.id === "PRJ-01"
            ? { "/workspaces": WORKSPACES }
            : {}),
          ...screenCase.route(scenario),
        });
        renderWithProviders(screenCase.render());

        // Chờ tới khi một màn hình hệ thống xuất hiện.
        const panel = await screen.findByRole("heading", { level: 3 });
        expect(panel).toBeInTheDocument();

        // 1. Đúng một màn hình hệ thống.
        const codes = SYSTEM_CODES.filter((code) => screen.queryAllByText(code).length > 0);
        expect(codes).toHaveLength(1);

        // 2. Có ít nhất một hành động rời khỏi bế tắc.
        const actions = screen.getAllByRole("button");
        const escapes = actions.filter((button) =>
          /Thử lại|Về không gian làm việc|Đăng nhập lại/.test(button.textContent ?? ""),
        );
        expect(escapes.length).toBeGreaterThan(0);

        // 3. Không rò rỉ dữ liệu private của resource bị từ chối.
        expect(screen.queryByText("Launch")).not.toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
      });
    }
  });
}
