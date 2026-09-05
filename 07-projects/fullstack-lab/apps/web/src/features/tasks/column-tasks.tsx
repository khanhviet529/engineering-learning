"use client";

import { useEffect } from "react";
import { FbAlert, FbBoardColumn, FbButtonSecondary, FbSkeleton, FbBadge } from "@flowboard/ui";
import type { BoardColumn, Task } from "@flowboard/contracts";
import { FailureState } from "../system/failure-state.tsx";
import { useColumnTasks } from "./queries.ts";
import { projectColumn, type DragState } from "./board-dnd.ts";
import { BoardTaskCard, type TaskCardActor, type TaskDragBinding } from "./task-card.tsx";
import type { BoardFilters } from "./task-filters.ts";
import { hasActiveFilters } from "./task-filters.ts";

/**
 * Một cột của `BRD-01`, cùng trang task của riêng nó.
 *
 * Mỗi cột là **một query độc lập**: cursor riêng, Loading riêng, Error riêng.
 * Đó là lý do artifact vẽ `column-states` với bốn cột ở bốn trạng thái khác
 * nhau, và là lý do một cột hỏng không được biến cả board thành trang lỗi —
 * "các cột khác vẫn hiển thị dữ liệu đã nạp", đúng như frame đó nói.
 */

export interface ColumnDragApi {
  /** `undefined` khi actor thiếu `task:move`: Viewer không có tay kéo nào cả. */
  bindingFor: (
    task: Task,
    columnId: string,
    index: number,
    total: number,
  ) => TaskDragBinding | undefined;
  /** Chuột thả vào cột này ở chỉ số nào. */
  onDropAt: (columnId: string, index: number) => void;
  drag: DragState | null;
}

export function ColumnTasks({
  projectId,
  column,
  filters,
  actor,
  onOpenTask,
  dragApi,
  reportTasks,
}: {
  projectId: string;
  column: BoardColumn;
  filters: BoardFilters;
  actor: TaskCardActor;
  onOpenTask: (taskId: string) => void;
  dragApi: ColumnDragApi;
  /**
   * Báo danh sách đang hiển thị lên board.
   *
   * Board cần nó ở **event handler** — để kẹp chỉ số khi dùng bàn phím và để
   * lấy `position` của hai hàng xóm làm gợi ý cho lệnh move. Nó đi vào một
   * `ref`, không phải state: đọc trong handler thì không cần render lại, và
   * đưa vào state sẽ tạo một vòng cập nhật giữa cha và con.
   */
  reportTasks: (columnId: string, tasks: readonly Task[]) => void;
}) {
  const { tasks, loading, loadingMore, hasMore, failure, loadMore, retry } = useColumnTasks(
    projectId,
    column.id,
    filters,
  );

  const displayed = projectColumn(tasks, column.id, dragApi.drag);

  useEffect(() => {
    reportTasks(column.id, displayed);
  }, [column.id, displayed, reportTasks]);

  return (
    <FbBoardColumn
      name={column.name}
      badges={
        // Khe `Column Flags Slot` của `FbBoardColumn`, thay cho badge đếm task
        // đã bỏ. Một con số nói *có bao nhiêu*; hai cờ này nói *cột hành xử
        // khác ra sao* — `Cần rà soát` bật một luồng bắt buộc chọn reviewer khi
        // move vào, `Kết thúc` đưa `dueState` về `none` và biến move-ra thành
        // `task.reopened`. Người kéo cần biết điều đó **trước** khi kéo.
        //
        // Chỉ hiện khi cờ bật. Cột thường không có chip nào, và đó là trạng
        // thái phổ biến nhất; một chip `Bình thường` chỉ thêm nhiễu.
        <span style={{ display: "flex", gap: "var(--fb-space-1)" }}>
          {column.requiresReviewer && <FbBadge tone="brand">Cần rà soát</FbBadge>}
          {column.isTerminal && <FbBadge tone="success">Kết thúc</FbBadge>}
        </span>
      }
      state={
        // Khe trạng thái nằm **trên** danh sách, không thay thế nó: một cột
        // đang nạp trang tiếp theo vẫn hiển thị những gì đã nạp.
        loading ? (
          <FbSkeleton lines={2} label={`Đang tải cột ${column.name}`} />
        ) : failure !== undefined ? (
          <FailureState failure={failure} onRetry={retry} />
        ) : undefined
      }
      footer={
        failure === undefined && !loading ? (
          <ColumnFooter
            loaded={displayed.length}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
            columnName={column.name}
          />
        ) : undefined
      }
    >
      {failure === undefined && !loading && (
        <div
          style={{ display: "grid", gap: "var(--fb-space-2)", minHeight: 8 }}
          onDragOver={(event) => {
            if (dragApi.drag === null) return;
            event.preventDefault();
          }}
          onDrop={(event) => {
            if (dragApi.drag === null) return;
            event.preventDefault();
            dragApi.onDropAt(column.id, displayed.length);
          }}
        >
          {displayed.length === 0 ? (
            <ColumnEmpty filtered={hasActiveFilters(filters)} />
          ) : (
            displayed.map((task, index) => (
              <div
                key={task.id}
                onDragOver={(event) => {
                  if (dragApi.drag === null) return;
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  if (dragApi.drag === null) return;
                  event.preventDefault();
                  event.stopPropagation();
                  dragApi.onDropAt(column.id, index);
                }}
              >
                <BoardTaskCard
                  task={task}
                  actor={actor}
                  columnName={column.name}
                  position={index}
                  total={displayed.length}
                  onOpen={() => onOpenTask(task.id)}
                  {...(() => {
                    const binding = dragApi.bindingFor(task, column.id, index, displayed.length);
                    return binding === undefined ? {} : { drag: binding };
                  })()}
                />
              </div>
            ))
          )}
        </div>
      )}
    </FbBoardColumn>
  );
}

/**
 * Hai câu khác nhau cho hai nghĩa của "rỗng".
 *
 * [Đặc tả tương tác §6](../../../../../docs/design/interaction-specifications.md)
 * yêu cầu tách chúng: "cột chưa có task" là trạng thái của dự án, còn "không
 * có task khớp filter" là hệ quả của thứ người dùng vừa bấm — và chỉ câu thứ
 * hai mới nói được việc cần làm tiếp theo.
 */
function ColumnEmpty({ filtered }: { filtered: boolean }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "var(--fb-space-5) var(--fb-space-3)",
        textAlign: "center",
        borderRadius: "var(--fb-radius-md)",
        border: "1px dashed var(--fb-color-border-default)",
        fontSize: "var(--fb-font-size-body-sm)",
        color: "var(--fb-color-text-muted)",
      }}
    >
      {filtered
        ? "Không có công việc nào khớp bộ lọc hiện tại."
        : "Chưa có công việc nào ở cột này"}
    </p>
  );
}

/**
 * Chân cột.
 *
 * Artifact ghi `Đã nạp 6 / 18` — một mẫu số. Không projection nào mang tổng số
 * task: `pageSchema` chỉ có `nextCursor` và `hasMore`. Nên chân cột nói đúng
 * thứ nó biết: đã nạp bao nhiêu, và còn nữa hay không.
 */
function ColumnFooter({
  loaded,
  hasMore,
  loadingMore,
  onLoadMore,
  columnName,
}: {
  loaded: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  columnName: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--fb-space-2)",
      }}
    >
      <span
        style={{ fontSize: "var(--fb-font-size-caption)", color: "var(--fb-color-text-muted)" }}
      >
        {hasMore ? `Đã nạp ${String(loaded)} · còn nữa` : `Đã nạp ${String(loaded)}`}
      </span>
      {hasMore && (
        <FbButtonSecondary onClick={onLoadMore} loading={loadingMore}>
          {`Tải thêm ${columnName}`}
        </FbButtonSecondary>
      )}
    </div>
  );
}

/** Cảnh báo hoàn nguyên sau khi một lệnh move thất bại, đúng frame `dnd-syncing`. */
export function MoveRollbackAlert({ columnName }: { columnName: string }) {
  return (
    <FbAlert
      intent="error"
      title={`Không chuyển được công việc sang “${columnName}”.`}
      description="Thay đổi đã được trả về cột cũ; thứ tự cuối cùng do server quyết định."
    />
  );
}
