"use client";

import { useEffect, useRef } from "react";
import { FbBadge, FbDueBadge, FbIcon, FbTaskCard } from "@flowboard/ui";
import type { Task } from "@flowboard/contracts";
import { categoryLabel, PRIORITY_LABEL, PRIORITY_TONE, formatCalendarDate } from "./task-labels.ts";

/**
 * Một task trên board.
 *
 * Component này quyết định **affordance**, còn `FbTaskCard` chỉ vẽ. Ranh giới
 * đó là lý do tay kéo là một prop chứ không phải một cờ `canDrag`: quyết định
 * "ai được kéo" đến từ capability server trả, và một wrapper biết điều đó là
 * một wrapper biết về phân quyền.
 */

export interface TaskCardActor {
  /** Tên hiển thị của thành viên project, tra từ `members` của project detail. */
  nameOf: (userId: string | null) => string | undefined;
}

export interface TaskDragBinding {
  /** Đang được nhấc bằng bàn phím. */
  lifted: boolean;
  /** Đang gửi lệnh move; card khoá lần kéo thứ hai. */
  syncing: boolean;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onToggleLift: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return ((first + last).toUpperCase() || "?").slice(0, 2);
}

export function BoardTaskCard({
  task,
  actor,
  onOpen,
  drag,
  position,
  total,
  columnName,
}: {
  task: Task;
  actor: TaskCardActor;
  onOpen: () => void;
  /** `undefined` khi actor không có `task:move` — Viewer không thấy tay kéo. */
  drag?: TaskDragBinding | undefined;
  position: number;
  total: number;
  columnName: string;
}) {
  const assigneeName = actor.nameOf(task.assigneeId);
  const dueDate = formatCalendarDate(task.dueDate);

  return (
    <FbTaskCard
      title={task.title}
      category={categoryLabel(task.category)}
      onOpen={onOpen}
      due={
        <FbDueBadge state={task.dueState} {...(dueDate === undefined ? {} : { date: dueDate })} />
      }
      badges={
        task.priority === "none" ? undefined : (
          <FbBadge tone={PRIORITY_TONE[task.priority]}>
            {`Ưu tiên ${PRIORITY_LABEL[task.priority].toLowerCase()}`}
          </FbBadge>
        )
      }
      {...(assigneeName === undefined
        ? {}
        : { assigneeInitials: initials(assigneeName), assigneeName })}
      {...(drag === undefined
        ? {}
        : {
            lifted: drag.lifted,
            syncing: drag.syncing,
            dragHandle: (
              <DragHandle
                binding={drag}
                taskTitle={task.title}
                columnName={columnName}
                position={position}
                total={total}
              />
            ),
          })}
    />
  );
}

/**
 * Tay kéo.
 *
 * Nó là một `<button>` thật vì bàn phím là đường **bắt buộc**, không phải một
 * lối đi thay thế: `Space` nhấc, mũi tên trái/phải đổi cột, lên/xuống đổi vị
 * trí, `Space` thả, `Escape` hủy — đúng bảng phím ở `REF-16`.
 *
 * `useEffect` lấy lại focus sau mỗi lần vị trí đổi. React sắp lại danh sách
 * bằng `insertBefore`, tức là gỡ nút ra khỏi cây rồi chèn lại, và một phần tử
 * rời khỏi cây thì mất focus — mũi tên thứ hai sẽ rơi vào `body`. Đây là lỗi
 * đã gặp ở `BRD-02` của M3, và ở đây nó xuất hiện lại với hai trục thay vì một.
 */
function DragHandle({
  binding,
  taskTitle,
  columnName,
  position,
  total,
}: {
  binding: TaskDragBinding;
  taskTitle: string;
  columnName: string;
  position: number;
  total: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (binding.lifted) ref.current?.focus();
  }, [binding.lifted, columnName, position]);

  return (
    <button
      ref={ref}
      type="button"
      draggable={!binding.syncing}
      aria-label={`Di chuyển ${taskTitle}. Đang ở cột ${columnName}, vị trí ${String(position + 1)} trên ${String(total)}`}
      aria-pressed={binding.lifted}
      disabled={binding.syncing}
      onClick={binding.onToggleLift}
      onKeyDown={binding.onKeyDown}
      onDragStart={binding.onDragStart}
      onDragEnd={binding.onDragEnd}
      style={{
        flex: "0 0 auto",
        display: "grid",
        placeItems: "center",
        width: 28,
        height: 28,
        cursor: binding.syncing ? "progress" : "grab",
        borderRadius: "var(--fb-radius-sm)",
        border: "1px solid var(--fb-color-border-default)",
        background: "var(--fb-color-surface-subtle)",
        color: "var(--fb-color-text-muted)",
      }}
    >
      <FbIcon name="grip-vertical" size="sm" />
    </button>
  );
}
