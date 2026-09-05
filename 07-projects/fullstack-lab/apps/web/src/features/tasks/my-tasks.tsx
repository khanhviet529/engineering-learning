"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FbAlert,
  FbBadge,
  FbButtonSecondary,
  FbDataTable,
  FbDueBadge,
  FbSelect,
  FbSkeleton,
  FbStatePanel,
  type FbDataTableColumn,
  type FbDataTableRow,
} from "@flowboard/ui";
import { DUE_STATES, type Task } from "@flowboard/contracts";
import { AppShell } from "../navigation/app-shell.tsx";
import { FailureState } from "../system/failure-state.tsx";
import { messageFor } from "../system/messages.ts";
import { useSession } from "../session/session.tsx";
import { useWorkspaces } from "../workspaces/queries.ts";
import { useMyTasks } from "./queries.ts";
import { MY_TASKS_ERROR } from "./messages.ts";
import { EMPTY_FILTERS, type BoardFilters } from "./task-filters.ts";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  formatCalendarDate,
} from "./task-labels.ts";

/**
 * `MYT-01` — việc của tôi, cắt ngang mọi project trong một workspace.
 *
 * Hai điều làm màn này khác `BRD-01`:
 *
 * 1. **Nó không thuộc project nào**, nên mỗi dòng phải nói việc đó nằm ở dự án
 *    nào — và tên dự án lấy từ **bảng tra cứu** `projects` của trang, không
 *    phải từ một field lặp trên từng task. Đổi tên một dự án giữa chừng thì
 *    một bản sao lặp hai mươi lần sẽ lệch; một bảng tra thì không.
 * 2. **Mở một việc phải mở đúng dự án của nó.** Đường dẫn dựng từ `projectId`
 *    của chính task, và `TSK-02` ở đầu kia vẫn kiểm cả project lẫn task.
 */

export const MY_TASKS_PATH = "/viec-cua-toi";

/** Khóa query tiếng Anh theo ADR-0014; segment mới là chữ người dùng đọc. */
const WORKSPACE_PARAM = "workspace";

const DUE_STATE_LABEL: Readonly<Record<(typeof DUE_STATES)[number], string>> = {
  none: "Không có hạn",
  scheduled: "Đã lên lịch",
  due_soon: "Sắp đến hạn",
  due_today: "Đến hạn hôm nay",
  overdue: "Quá hạn",
};

const COLUMNS: FbDataTableColumn[] = [
  { key: "title", header: "Công việc" },
  { key: "project", header: "Dự án" },
  { key: "priority", header: "Ưu tiên" },
  { key: "due", header: "Hạn xử lý" },
];

export function MyTasksScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { actor } = useSession();
  const { workspaces, loading: loadingWorkspaces, failure: workspacesFailure } = useWorkspaces();
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);

  const chosen = searchParams?.get(WORKSPACE_PARAM) ?? undefined;
  // Route `/viec-cua-toi` không mang `workspaceId`, nhưng endpoint thì cần một
  // cái. Chọn workspace là **query state chia sẻ được**, nên nó nằm ở URL chứ
  // không ở state cục bộ: dán link cho đồng nghiệp là mở đúng danh sách đó.
  const workspaceId = chosen ?? workspaces?.[0]?.id ?? "";
  const workspace = workspaces?.find((item) => item.id === workspaceId);

  const list = useMyTasks(workspaceId, filters);

  const shell = (children: React.ReactNode) => (
    <AppShell
      title="Việc của tôi"
      breadcrumb={workspace?.name}
      {...(workspaceId === "" ? {} : { workspaceId })}
      {...(workspace === undefined ? {} : { workspaceCapabilities: workspace.capabilities })}
      {...(workspace === undefined ? {} : { workspaceName: workspace.name })}
    >
      {children}
    </AppShell>
  );

  if (workspacesFailure !== undefined) {
    return shell(<FailureState failure={workspacesFailure} />);
  }
  if (loadingWorkspaces || workspaces === undefined) return shell(<FbSkeleton lines={4} />);
  if (workspaces.length === 0) {
    return shell(
      <FbStatePanel
        state="empty"
        title="Bạn chưa thuộc không gian làm việc nào"
        description="Việc được giao sẽ xuất hiện ở đây sau khi bạn tham gia một không gian."
      />,
    );
  }

  return shell(
    <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--fb-space-3)",
          alignItems: "flex-end",
        }}
      >
        <FbSelect
          id="my-tasks-workspace"
          label="Không gian làm việc"
          value={workspaceId}
          onChange={(value) => router.push(`${MY_TASKS_PATH}?${WORKSPACE_PARAM}=${value}`)}
          options={workspaces.map((item) => ({ value: item.id, label: item.name }))}
          hint="Danh sách chỉ gồm việc được giao cho bạn trong không gian đang chọn."
        />
        <FbSelect
          id="my-tasks-due-state"
          label="Hạn xử lý"
          value={filters.dueState ?? ""}
          onChange={(value) =>
            setFilters({ ...filters, dueState: value === "" ? undefined : (value as never) })
          }
          options={[
            { value: "", label: "Tất cả" },
            ...DUE_STATES.map((value) => ({ value, label: DUE_STATE_LABEL[value] })),
          ]}
        />
        <FbSelect
          id="my-tasks-sort"
          label="Sắp xếp"
          value={filters.sort ?? "dueDate:asc"}
          onChange={(value) => setFilters({ ...filters, sort: value as never })}
          options={[
            { value: "dueDate:asc", label: "Hạn gần nhất trước" },
            { value: "dueDate:desc", label: "Hạn xa nhất trước" },
            { value: "updatedAt:desc", label: "Vừa cập nhật trước" },
          ]}
        />
      </div>

      {/* Cursor bind cả phạm vi actor nhìn thấy được. Mất quyền ở một dự án
          giữa hai trang là danh sách **đã đổi**, không phải hệ thống hỏng —
          nên nó nói ra bằng một thông báo, không phải một trang lỗi. */}
      {list.scopeChanged && (
        <FbAlert
          intent="info"
          title="Danh sách đã thay đổi trong lúc bạn đang xem"
          description="Quyền của bạn ở một dự án vừa đổi, nên trang tiếp theo không còn dùng được. Danh sách đã quay về trang đầu với đúng bộ lọc hiện tại."
        />
      )}

      {list.failure !== undefined ? (
        <FbStatePanel
          state="error"
          title={messageFor(MY_TASKS_ERROR, list.failure)}
          description={`Mã tra cứu: ${list.failure.requestId}`}
          action={<FbButtonSecondary onClick={list.retry}>Thử lại</FbButtonSecondary>}
        />
      ) : list.loading ? (
        <FbSkeleton lines={5} label="Đang tải việc của bạn" />
      ) : list.tasks.length === 0 ? (
        <FbStatePanel
          state="empty"
          title={
            filters.dueState === undefined
              ? "Bạn chưa được giao việc nào trong không gian này"
              : "Không có việc nào khớp bộ lọc hiện tại"
          }
          description={
            actor === undefined
              ? undefined
              : `Danh sách chỉ gồm việc có người thực hiện là ${actor.displayName}.`
          }
        />
      ) : (
        <>
          <FbDataTable
            caption="Việc được giao cho tôi"
            minWidth={720}
            columns={COLUMNS}
            rows={list.tasks.map<FbDataTableRow>((task) => ({
              id: task.id,
              cells: [
                <button
                  key="open"
                  type="button"
                  onClick={() =>
                    router.push(`/du-an/${task.projectId}/bang-cong-viec?task=${task.id}`)
                  }
                  style={{
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    textAlign: "left",
                    cursor: "pointer",
                    font: "inherit",
                    fontWeight: "var(--fb-font-weight-semibold)",
                    color: "var(--fb-color-text-primary)",
                  }}
                >
                  {task.title}
                </button>,
                // Tên dự án tra từ bảng của trang, không phải một field lặp
                // trên từng task.
                list.projectName(task.projectId) ?? "Dự án khác",
                task.priority === "none" || task.priority === null ? (
                  task.category === null ? (
                    "—"
                  ) : (
                    CATEGORY_LABEL[task.category]
                  )
                ) : (
                  <FbBadge key="priority" tone={PRIORITY_TONE[task.priority]}>
                    {`Ưu tiên ${PRIORITY_LABEL[task.priority].toLowerCase()}`}
                  </FbBadge>
                ),
                <DueCell key="due" task={task} />,
              ],
            }))}
          />

          <div style={{ display: "flex", alignItems: "center", gap: "var(--fb-space-3)" }}>
            <span
              style={{
                fontSize: "var(--fb-font-size-caption)",
                color: "var(--fb-color-text-muted)",
              }}
            >
              {list.hasMore
                ? `Đã nạp ${String(list.tasks.length)} · còn nữa`
                : `Đã nạp ${String(list.tasks.length)}`}
            </span>
            {list.hasMore && (
              <FbButtonSecondary onClick={list.loadMore} loading={list.loadingMore}>
                Tải thêm
              </FbButtonSecondary>
            )}
          </div>
        </>
      )}
    </>,
  );
}

/** Ô hạn xử lý: `dueState` do server suy, ngày chỉ để đọc kèm. */
function DueCell({ task }: { task: Task }) {
  const date = formatCalendarDate(task.dueDate);
  return <FbDueBadge state={task.dueState} {...(date === undefined ? {} : { date })} />;
}
