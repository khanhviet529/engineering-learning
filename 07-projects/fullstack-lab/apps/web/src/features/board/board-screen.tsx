"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  FbBadge,
  FbBoardColumn,
  FbBoardScroller,
  FbButtonPrimary,
  FbSkeleton,
  FbStatePanel,
} from "@flowboard/ui";
import type { BoardColumn } from "@flowboard/contracts";
import { AppShell } from "../navigation/app-shell.tsx";
import { FailureState } from "../system/failure-state.tsx";
import { can } from "../authorization/can.ts";
import { useProject } from "../projects/queries.ts";
import { activeColumns } from "./column-order.ts";
import { ColumnEditorPanel } from "./column-editor.tsx";

/**
 * `BRD-01` — bảng công việc của một dự án.
 *
 * Ở mốc M3 màn này là **khung**: nó đọc `columns` từ
 * `GET /projects/:projectId` và dựng dải cột, nhưng chưa có task — không bảng,
 * không endpoint, không projection. Cột rỗng ở đây là trạng thái **đúng**, và
 * nó không được nhầm với `Empty` thật của màn hình:
 *
 * - `Empty` của `BRD-01` nghĩa là **dự án chưa có cột nào**. Nó chiếm cả vùng
 *   nội dung và mang CTA mở `BRD-02` cho người có quyền.
 * - Một cột không có task chỉ là một cột. Nó vẫn có tiêu đề, vẫn có cờ, và chỗ
 *   chứa task của nó nói đúng một câu.
 *
 * Trộn hai thứ đó lại sẽ nói với Owner rằng board của họ chưa được cấu hình,
 * trong khi thật ra nó đã cấu hình xong và chỉ đang chờ công việc đầu tiên.
 */

export function boardPath(projectId: string): string {
  return `/du-an/${projectId}/bang-cong-viec`;
}

/** Query key tiếng Anh theo ADR-0014: segment là chữ người dùng đọc, key thì không. */
export const COLUMN_PANEL = "columns";

export function BoardScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { detail, loading, failure, refetch } = useProject(projectId);

  const manageColumns = can("board-column:manage", { capabilities: detail?.capabilities });
  const panelOpen = searchParams?.get("panel") === COLUMN_PANEL;

  const shell = (children: React.ReactNode) => (
    <AppShell
      title="Bảng công việc"
      breadcrumb={detail?.project.name}
      {...(detail === undefined
        ? {}
        : { project: { id: detail.project.id, capabilities: detail.capabilities } })}
      {...(detail === undefined ? {} : { workspaceId: detail.project.workspaceId })}
    >
      {children}
    </AppShell>
  );

  // `403` và `404` là hai câu trả lời khác nhau và `FailureState` giữ phép ánh
  // xạ đó ở một chỗ: Workspace Admin chưa thuộc dự án nhận `404`, thành viên
  // thiếu action nhận `403`.
  if (failure !== undefined) return shell(<FailureState failure={failure} onRetry={refetch} />);
  if (loading || detail === undefined) return shell(<BoardSkeleton />);

  const columns = activeColumns(detail.columns);

  const openPanel = () => router.push(`${boardPath(projectId)}?panel=${COLUMN_PANEL}`);
  const closePanel = () => router.push(boardPath(projectId));

  return shell(
    <>
      {manageColumns && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          {/* FbModal trả focus về `document.activeElement` lúc mở, tức là
              đúng nút này — không cần ref riêng để làm lại việc đó. */}
          <FbButtonPrimary onClick={openPanel}>Quản lý cột</FbButtonPrimary>
        </div>
      )}

      {columns.length === 0 ? (
        <FbStatePanel
          state="empty"
          title="Bảng công việc chưa có cột nào"
          description={
            manageColumns
              ? "Cột là các bước trong quy trình của dự án. Thêm cột đầu tiên để bảng bắt đầu dùng được."
              : "Owner của dự án chưa cấu hình cột nào cho bảng này."
          }
          {...(manageColumns
            ? { action: <FbButtonPrimary onClick={openPanel}>Thêm cột đầu tiên</FbButtonPrimary> }
            : {})}
        />
      ) : (
        <FbBoardScroller label="Cột của bảng công việc" hint="Cuộn ngang để xem các cột khác">
          {columns.map((column) => (
            <FbBoardColumn
              key={column.id}
              name={column.name}
              badges={<ColumnFlags column={column} />}
            >
              <p
                style={{
                  margin: 0,
                  padding: "var(--fb-space-6) var(--fb-space-3)",
                  textAlign: "center",
                  borderRadius: "var(--fb-radius-md)",
                  border: "1px dashed var(--fb-color-border-default)",
                  fontSize: "var(--fb-font-size-body-sm)",
                  color: "var(--fb-color-text-muted)",
                }}
              >
                Chưa có công việc nào ở cột này
              </p>
            </FbBoardColumn>
          ))}
        </FbBoardScroller>
      )}

      {panelOpen && (
        <ColumnEditorPanel
          projectId={projectId}
          columns={detail.columns}
          canManage={manageColumns}
          onClose={closePanel}
        />
      )}
    </>,
  );
}

/**
 * Cờ cấu hình của cột.
 *
 * Artifact đặt ở đây `Loaded Badge` — số task đã nạp. Ở M3 chưa có task nào để
 * đếm, và `boardColumnSchema` không mang con số đó, nên chỗ này hiển thị hai
 * cờ **có thật trong projection**: `isTerminal` và `requiresReviewer`. Cả hai
 * đổi cách board hoạt động, nên chúng đáng được thấy mà không phải mở
 * `BRD-02`.
 */
function ColumnFlags({ column }: { column: BoardColumn }) {
  return (
    <span style={{ display: "flex", gap: "var(--fb-space-1)" }}>
      {column.isTerminal && <FbBadge tone="success">Cột kết thúc</FbBadge>}
      {column.requiresReviewer && <FbBadge tone="brand">Cần người duyệt</FbBadge>}
    </span>
  );
}

/**
 * Khung chờ của board.
 *
 * Artifact vẽ trạng thái nạp **theo từng cột** (`column-states`), vì ở M4 mỗi
 * cột nạp task bằng cursor riêng. Ở M3 chỉ có một request duy nhất cho cả
 * board, nên khung chờ cũng là một: giả vờ có bốn cột đang nạp độc lập sẽ vẽ
 * ra một cấu trúc mà dữ liệu chưa hề nói tới, kể cả số cột.
 */
function BoardSkeleton() {
  const box: React.CSSProperties = {
    flex: "0 0 auto",
    width: "var(--fb-size-board-column-min)",
    display: "grid",
    gap: "var(--fb-space-3)",
    padding: "var(--fb-space-4)",
    borderRadius: "var(--fb-radius-lg)",
    background: "var(--fb-color-surface-subtle)",
    border: "1px solid var(--fb-color-border-subtle)",
  };

  return (
    <div style={{ display: "flex", gap: "var(--fb-space-4)", overflow: "hidden" }}>
      <div style={box}>
        <FbSkeleton lines={3} label="Đang tải bảng công việc" />
      </div>
      {/* Hai cột còn lại chỉ là hình học. Chúng **không** phải live region thứ
          hai và thứ ba: ba vùng cùng công bố "đang tải" là ba lần đọc cho một
          sự kiện. */}
      {[1, 2].map((index) => (
        <div key={index} style={box} aria-hidden="true">
          {[0, 1, 2].map((line) => (
            <span
              key={line}
              style={{
                display: "block",
                height: 44,
                borderRadius: "var(--fb-radius-md)",
                background: "var(--fb-color-state-loading-track)",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
