"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FbBoardScroller, FbButtonPrimary, FbSkeleton, FbStatePanel } from "@flowboard/ui";
import type { Task } from "@flowboard/contracts";
import { AppShell } from "../navigation/app-shell.tsx";
import { FailureState } from "../system/failure-state.tsx";
import { can } from "../authorization/can.ts";
import { Intent } from "../../lib/transport.ts";
import { toFailure } from "../../lib/query.tsx";
import { useProject } from "../projects/queries.ts";
import { activeColumns } from "./column-order.ts";
import { ColumnEditorPanel } from "./column-editor.tsx";
import { ColumnTasks, MoveRollbackAlert, type ColumnDragApi } from "../tasks/column-tasks.tsx";
import { BoardToolbar } from "../tasks/board-toolbar.tsx";
import { TaskFormPanel } from "../tasks/task-form.tsx";
import { TaskDetailDrawer } from "../tasks/task-detail.tsx";
import { ConflictDialog } from "../tasks/conflict-dialog.tsx";
import { useMoveTask } from "../tasks/queries.ts";
import { dragAnnouncement, neighbourColumn, type DragState } from "../tasks/board-dnd.ts";
import { positionForIndex } from "../tasks/position.ts";
import { EMPTY_FILTERS, type BoardFilters } from "../tasks/task-filters.ts";

/**
 * `BRD-01` — bảng công việc.
 *
 * Màn này cấp năm vùng mà ["hợp đồng màn hình board"](../../../../../docs/design/screen-inventory.md)
 * quy định: ngữ cảnh project, điều khiển board, dải cột ngang, task card và
 * lớp phủ task. Chỉ vùng điều khiển đổi theo capability — Viewer thấy đủ điều
 * khiển **đọc**, không thấy CTA ghi và không thấy tay kéo.
 *
 * Trạng thái kéo-thả sống ở đây chứ không trong cache, vì **rollback phải
 * chính xác**: hoàn nguyên một biến là một phép gán, còn hoàn nguyên nhiều
 * trang infinite query của hai cột là ghép lại thứ mà ta không sở hữu.
 */

export function boardPath(projectId: string): string {
  return `/du-an/${projectId}/bang-cong-viec`;
}

/** Query key tiếng Anh theo ADR-0014: segment là chữ người dùng đọc, key thì không. */
export const COLUMN_PANEL = "columns";

interface ConflictState {
  taskId: string;
  draftSummary: string;
}

export function BoardScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { detail, loading, failure, refetch } = useProject(projectId);

  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [rollbackColumn, setRollbackColumn] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [formTask, setFormTask] = useState<Task | "new" | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  // Danh sách đang hiển thị của từng cột. `ref` chứ không phải state: nó chỉ
  // được đọc trong event handler — để kẹp chỉ số bàn phím và lấy `position`
  // của hai hàng xóm — nên đưa vào state sẽ tạo một vòng render không đổi gì
  // trên màn hình.
  const columnTasks = useRef<Record<string, readonly Task[]>>({});
  const reportTasks = useCallback((columnId: string, tasks: readonly Task[]) => {
    columnTasks.current[columnId] = tasks;
  }, []);

  // Một `Intent` cho **một ý định di chuyển**. Kéo cùng task tới chỗ khác là ý
  // định khác ⇒ key mới; gửi lại y nguyên sau lỗi mạng thì giữ key, và đó là
  // toàn bộ lý do `Idempotency-Key` tồn tại.
  const moveIntent = useRef(new Intent());
  const lastMovePayload = useRef("");

  const move = useMoveTask(projectId);
  const holder = { capabilities: detail?.capabilities };
  const canMove = can("task:move", holder);
  const canCreate = can("task:create", holder);
  const canUpdate = can("task:update", holder);
  const manageColumns = can("board-column:manage", holder);

  const columns = useMemo(() => activeColumns(detail?.columns ?? []), [detail?.columns]);
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);
  const nameOf = useCallback(
    (userId: string | null) =>
      userId === null
        ? undefined
        : detail?.members.find((member) => member.userId === userId)?.displayName,
    [detail?.members],
  );
  const columnName = useCallback(
    (columnId: string) => columns.find((column) => column.id === columnId)?.name ?? "cột",
    [columns],
  );

  const panelOpen = searchParams?.get("panel") === COLUMN_PANEL;
  const openTaskId = searchParams?.get("task") ?? undefined;

  const setQuery = useCallback(
    (patch: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      router.push(query === "" ? boardPath(projectId) : `${boardPath(projectId)}?${query}`);
    },
    [projectId, router, searchParams],
  );

  const commitMove = useCallback(
    (state: DragState) => {
      setDrag(null);
      setRollbackColumn(null);

      const payload = `${state.task.id}|${state.toColumnId}|${String(state.toIndex)}`;
      if (lastMovePayload.current !== "" && lastMovePayload.current !== payload) {
        moveIntent.current.rotate();
      }
      lastMovePayload.current = payload;

      // Gợi ý vị trí, **không** phải kết quả: ADR-0006 nói server tính lại mọi
      // giá trị và có thể rebalance cả cột. Con số hiển thị luôn là của server.
      const target = positionForIndex(
        columnTasks.current[state.toColumnId] ?? [],
        state.toIndex,
        state.task.id,
      );

      setMovingTaskId(state.task.id);
      move.mutate(
        {
          taskId: state.task.id,
          body: {
            destinationColumnId: state.toColumnId,
            targetPosition: target,
            expectedVersion: state.task.version,
          },
          intent: moveIntent.current,
        },
        {
          onSuccess: () => {
            setMovingTaskId(null);
            setAnnouncement(
              `Đã chuyển ${state.task.title} sang cột ${columnName(state.toColumnId)}.`,
            );
          },
          onError: (error) => {
            setMovingTaskId(null);
            setRollbackColumn(state.toColumnId);
            setAnnouncement(
              `Không chuyển được ${state.task.title}. Thứ tự đã trở lại theo dữ liệu máy chủ.`,
            );
            if (toFailure(error)?.code === "TASK_VERSION_CONFLICT") {
              setConflict({
                taskId: state.task.id,
                draftSummary: `Chuyển sang cột ${columnName(state.toColumnId)}`,
              });
            }
          },
        },
      );
    },
    [columnName, move],
  );

  const dragApi: ColumnDragApi = useMemo(
    () => ({
      drag,
      onDropAt: (columnId, index) => {
        if (drag === null) return;
        commitMove({ ...drag, toColumnId: columnId, toIndex: index, lifted: false });
      },
      bindingFor: (task, columnId, index, total) => {
        // Viewer không có tay kéo. Ẩn nó không phải là phân quyền — server vẫn
        // từ chối — nhưng hiện một affordance chắc chắn bị từ chối thì tệ hơn.
        if (!canMove) return undefined;
        const lifted = drag?.lifted === true && drag.task.id === task.id;
        return {
          lifted,
          syncing: movingTaskId === task.id,
          onToggleLift: () => {
            if (lifted && drag !== null) {
              commitMove(drag);
              return;
            }
            setDrag({
              task,
              fromColumnId: columnId,
              toColumnId: columnId,
              toIndex: index,
              lifted: true,
            });
            setAnnouncement(
              `Đã nhấc ${task.title}. ${dragAnnouncement(task.title, columnName(columnId), index, total)} Mũi tên trái phải đổi cột, lên xuống đổi vị trí, Space để thả, Escape để hủy.`,
            );
          },
          onDragStart: () => {
            setDrag({
              task,
              fromColumnId: columnId,
              toColumnId: columnId,
              toIndex: index,
              lifted: false,
            });
          },
          onDragEnd: () => setDrag(null),
          onKeyDown: (event) => {
            if (drag === null || !drag.lifted || drag.task.id !== task.id) return;

            if (event.key === "Escape") {
              // `Escape` thuộc về thao tác đang dở, không thuộc lớp phủ nào.
              event.preventDefault();
              event.stopPropagation();
              setDrag(null);
              setAnnouncement(`Đã hủy. ${task.title} trở lại vị trí cũ.`);
              return;
            }

            const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
            if (horizontal !== 0) {
              event.preventDefault();
              const nextColumn = neighbourColumn(columnIds, drag.toColumnId, horizontal as -1 | 1);
              if (nextColumn === drag.toColumnId) return;
              const nextTotal = (columnTasks.current[nextColumn] ?? []).length;
              const nextIndex = Math.min(drag.toIndex, nextTotal);
              setDrag({ ...drag, toColumnId: nextColumn, toIndex: nextIndex });
              setAnnouncement(
                dragAnnouncement(task.title, columnName(nextColumn), nextIndex, nextTotal + 1),
              );
              return;
            }

            const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
            if (vertical === 0) return;
            event.preventDefault();
            const currentTotal = Math.max(1, (columnTasks.current[drag.toColumnId] ?? []).length);
            const nextIndex = Math.max(0, Math.min(drag.toIndex + vertical, currentTotal - 1));
            if (nextIndex === drag.toIndex) return;
            setDrag({ ...drag, toIndex: nextIndex });
            setAnnouncement(
              dragAnnouncement(task.title, columnName(drag.toColumnId), nextIndex, currentTotal),
            );
          },
        };
      },
    }),
    [canMove, columnIds, columnName, commitMove, drag, movingTaskId],
  );

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

  const openPanel = () => setQuery({ panel: COLUMN_PANEL });

  return shell(
    <>
      {/* Một vùng công bố cho cả board: nhấc, chuyển, thả, và kết quả mutation.
          Nhiều vùng sẽ đọc chồng lên nhau. */}
      <p
        role="status"
        aria-live="polite"
        style={{
          margin: 0,
          fontSize: "var(--fb-font-size-caption)",
          color: "var(--fb-color-text-muted)",
        }}
      >
        {announcement}
      </p>

      {rollbackColumn !== null && <MoveRollbackAlert columnName={columnName(rollbackColumn)} />}

      <BoardToolbar
        filters={filters}
        onChange={setFilters}
        members={detail.members}
        {...(canCreate
          ? {
              createAction: (
                <FbButtonPrimary onClick={() => setFormTask("new")}>Tạo công việc</FbButtonPrimary>
              ),
            }
          : {})}
      />

      {manageColumns && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
            <ColumnTasks
              key={column.id}
              projectId={projectId}
              column={column}
              filters={filters}
              actor={{ nameOf }}
              dragApi={dragApi}
              reportTasks={reportTasks}
              onOpenTask={(taskId) => setQuery({ task: taskId })}
            />
          ))}
        </FbBoardScroller>
      )}

      {panelOpen && (
        <ColumnEditorPanel
          projectId={projectId}
          columns={detail.columns}
          canManage={manageColumns}
          onClose={() => setQuery({ panel: undefined })}
        />
      )}

      {/* Một lớp phủ tại một thời điểm. Hai focus trap chồng nhau là cách người
          dùng bàn phím bị kẹt ở lớp mình không nhìn thấy. */}
      {openTaskId !== undefined && conflict === null && formTask === null && (
        <TaskDetailDrawer
          taskId={openTaskId}
          memberName={nameOf}
          onClose={() => setQuery({ task: undefined })}
          {...(canUpdate ? { onEdit: (task: Task) => setFormTask(task) } : {})}
        />
      )}

      {formTask !== null && (
        <TaskFormPanel
          projectId={projectId}
          {...(formTask === "new" ? {} : { task: formTask })}
          columns={columns}
          members={detail.members}
          defaultColumnId={columns[0]?.id ?? ""}
          onClose={() => setFormTask(null)}
          onSaved={(task) => {
            setFormTask(null);
            setAnnouncement(`Đã lưu công việc ${task.title}.`);
          }}
          onConflict={(_failure, draftSummary) => {
            const conflicted = formTask;
            setFormTask(null);
            if (conflicted !== "new") setConflict({ taskId: conflicted.id, draftSummary });
          }}
        />
      )}

      {conflict !== null && (
        <ConflictDialog
          taskId={conflict.taskId}
          draftSummary={conflict.draftSummary}
          onDiscardDraft={() => setConflict(null)}
          onEditCurrent={(task) => {
            setConflict(null);
            // Gửi lại trên version mới là một **ý định mới**: key cũ sẽ phát
            // lại đúng cái `409` đã lưu, hoặc bị `IDEMPOTENCY_KEY_REUSED`.
            moveIntent.current.rotate();
            lastMovePayload.current = "";
            setFormTask(task);
          }}
        />
      )}
    </>,
  );
}

/**
 * Khung chờ của board.
 *
 * Artifact vẽ trạng thái nạp **theo từng cột**, và từ M4 điều đó đúng cho mọi
 * lần nạp task. Nhưng ở lần đầu thì chưa biết có bao nhiêu cột —
 * `GET /projects/:projectId` chưa về — nên khung chờ này là khung của cả
 * board, không phải bốn cột giả mà dữ liệu chưa hề nói tới.
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
