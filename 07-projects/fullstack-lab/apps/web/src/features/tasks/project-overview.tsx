"use client";

import {
  FbAlert,
  FbBadge,
  FbDataTable,
  FbPageSection,
  FbSkeleton,
  FbStatePanel,
  type FbDataTableRow,
} from "@flowboard/ui";
import type { ProjectOverview } from "@flowboard/contracts";
import { AppShell } from "../navigation/app-shell.tsx";
import { FailureState } from "../system/failure-state.tsx";
import { useProject } from "../projects/queries.ts";
import { useProjectOverview } from "./queries.ts";
import { formatCalendarDate } from "./task-labels.ts";

/**
 * `PRJ-04` — tổng quan dự án, chỉ đọc.
 *
 * **Server trả số đếm, màn này tính phần trăm.** Trả cả hai là hai nguồn cho
 * cùng một sự thật, và chúng lệch ngay ở lần làm tròn đầu tiên.
 *
 * Ba thứ artifact vẽ mà hợp đồng **cố ý** không có, nên chúng không có ở đây
 * và cũng không được thay bằng số tự chế:
 *
 * - `+12% so với tuần trước` cần lịch sử column của từng task; `is_terminal`
 *   đổi được và không hồi tố, nên "đã xong hồi đó" không xác định được.
 * - `Đang bị chặn` cần phụ thuộc blocking — Phase 1.5, chưa có bảng.
 * - `Đang đầy tải` / `Có thể nhận thêm 2` cần một **hạn mức** cho mỗi người, và
 *   khái niệm đó không tồn tại ở đâu trong sản phẩm.
 *
 * Một dashboard hiển thị một con số không có nguồn là một dashboard nói dối, và
 * người ta ra quyết định dựa trên nó.
 */

export function overviewPath(projectId: string): string {
  return `/du-an/${projectId}/tong-quan`;
}

/** Làm tròn tới số nguyên; `0` khi mẫu số bằng 0 thay vì `NaN`. */
export function percentOf(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

/** Số task ở các cột kết thúc — `isTerminal` do server gửi, không đoán từ tên cột. */
export function doneCount(overview: ProjectOverview): number {
  return overview.byColumn
    .filter((column) => column.isTerminal)
    .reduce((sum, column) => sum + column.taskCount, 0);
}

export function ProjectOverviewScreen({ projectId }: { projectId: string }) {
  const { detail, failure: projectFailure } = useProject(projectId);
  const { overview, loading, failure, refetch } = useProjectOverview(projectId);

  const shell = (children: React.ReactNode) => (
    <AppShell
      title="Tổng quan dự án"
      breadcrumb={detail?.project.name}
      {...(detail === undefined
        ? {}
        : { project: { id: detail.project.id, capabilities: detail.capabilities } })}
      {...(detail === undefined ? {} : { workspaceId: detail.project.workspaceId })}
    >
      {children}
    </AppShell>
  );

  if (projectFailure !== undefined) return shell(<FailureState failure={projectFailure} />);
  if (failure !== undefined) return shell(<FailureState failure={failure} onRetry={refetch} />);
  if (loading || overview === undefined) return shell(<FbSkeleton lines={6} />);

  const total = overview.totals.tasks;
  if (total === 0) {
    return shell(
      <FbStatePanel
        state="empty"
        title="Dự án chưa có công việc nào"
        description="Số liệu tổng quan xuất hiện ngay khi công việc đầu tiên được tạo."
      />,
    );
  }

  const done = doneCount(overview);

  return shell(
    <>
      <p
        style={{
          margin: 0,
          fontSize: "var(--fb-font-size-body-sm)",
          color: "var(--fb-color-text-muted)",
        }}
      >
        {/* Cửa sổ do server chốt và echo lại; hiển thị đúng nó để người đọc
            biết `+N tuần này` đang đếm trong khoảng nào. */}
        {`Cửa sổ thống kê: ${formatCalendarDate(overview.window.from) ?? overview.window.from} – ${
          formatCalendarDate(overview.window.to) ?? overview.window.to
        }`}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "var(--fb-space-4)",
        }}
      >
        <Metric
          label="Tổng công việc"
          value={String(total)}
          note={`+${String(overview.totals.createdInWindow)} trong cửa sổ này`}
        />
        <Metric
          label="Hoàn thành"
          value={`${String(percentOf(done, total))}%`}
          note={`${String(done)} / ${String(total)} công việc ở cột kết thúc`}
        />
        <Metric
          label="Quá hạn"
          value={String(overview.dueStates.overdue)}
          note={`${String(overview.dueStates.dueToday)} việc đến hạn hôm nay`}
        />
        <Metric
          label="Sắp đến hạn"
          value={String(overview.dueStates.dueSoon)}
          note={`${String(overview.dueStates.none)} việc không đặt hạn`}
        />
      </div>

      <FbPageSection
        heading="Tiến độ theo trạng thái"
        description={`${String(total)} công việc, chia theo cột của bảng.`}
      >
        {/* Giữ nguyên thứ tự server trả — cùng trật tự với board. Sắp lại ở đây
            sẽ khiến người đọc dashboard và người đọc board thấy hai thứ tự. */}
        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: "var(--fb-space-3)",
          }}
        >
          {overview.byColumn.map((column) => (
            <li key={column.columnId} style={{ display: "grid", gap: "var(--fb-space-1)" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--fb-space-2)",
                  fontSize: "var(--fb-font-size-body-sm)",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "var(--fb-space-2)" }}>
                  {column.name}
                  {column.isTerminal && <FbBadge tone="success">Kết thúc</FbBadge>}
                </span>
                <span style={{ color: "var(--fb-color-text-muted)" }}>
                  {`${String(column.taskCount)} công việc · ${String(percentOf(column.taskCount, total))}%`}
                </span>
              </div>
              <Bar percent={percentOf(column.taskCount, total)} />
            </li>
          ))}
        </ol>
      </FbPageSection>

      <FbPageSection
        heading="Tải công việc theo thành viên"
        description="Số việc đang thuộc về mỗi người. Flowboard không có khái niệm hạn mức, nên đây là số đếm chứ không phải một ngưỡng."
      >
        {overview.byAssignee.length === 0 && overview.unassignedCount === 0 ? (
          <FbAlert intent="info" title="Chưa có công việc nào được giao" />
        ) : (
          <FbDataTable
            caption="Số việc theo người thực hiện"
            minWidth={420}
            columns={[
              { key: "person", header: "Thành viên" },
              { key: "count", header: "Số việc" },
              { key: "share", header: "Tỉ lệ" },
            ]}
            rows={[
              ...overview.byAssignee.map<FbDataTableRow>((row) => ({
                id: row.user.id,
                cells: [
                  row.user.displayName,
                  String(row.taskCount),
                  `${String(percentOf(row.taskCount, total))}%`,
                ],
              })),
              // `unassignedCount` tách riêng trong hợp đồng, và giữ nguyên như
              // vậy ở đây: một hàng "chưa giao" không phải một người.
              ...(overview.unassignedCount > 0
                ? [
                    {
                      id: "unassigned",
                      cells: [
                        "Chưa giao",
                        String(overview.unassignedCount),
                        `${String(percentOf(overview.unassignedCount, total))}%`,
                      ],
                    } satisfies FbDataTableRow,
                  ]
                : []),
            ]}
          />
        )}
      </FbPageSection>
    </>,
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div
      style={{
        display: "grid",
        gap: "var(--fb-space-1)",
        padding: "var(--fb-space-4)",
        borderRadius: "var(--fb-radius-lg)",
        background: "var(--fb-color-surface-raised)",
        border: "1px solid var(--fb-color-border-default)",
      }}
    >
      <span
        style={{ fontSize: "var(--fb-font-size-caption)", color: "var(--fb-color-text-muted)" }}
      >
        {label}
      </span>
      <strong
        style={{
          fontSize: "var(--fb-font-size-heading-md)",
          color: "var(--fb-color-text-primary)",
        }}
      >
        {value}
      </strong>
      <span
        style={{ fontSize: "var(--fb-font-size-caption)", color: "var(--fb-color-text-muted)" }}
      >
        {note}
      </span>
    </div>
  );
}

function Bar({ percent }: { percent: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        height: 6,
        borderRadius: "var(--fb-radius-pill)",
        background: "var(--fb-color-surface-muted)",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          display: "block",
          width: `${String(percent)}%`,
          height: "100%",
          background: "var(--fb-color-brand-surface)",
        }}
      />
    </span>
  );
}
