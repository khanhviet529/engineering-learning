"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { FbIcon, type FbIconName } from "./icon.tsx";

/**
 * Primitive của task — `FbDueBadge`, `FbTaskCard`, `FbActivityItem`, `FbTabs`.
 *
 * Không component nào ở đây fetch, kiểm quyền hay suy ra trạng thái. `dueState`
 * là **enum server tính**, `syncing` là cờ do feature bật, và "card này có tay
 * kéo không" là quyết định của feature dựa trên capability. Wrapper chỉ vẽ.
 *
 * Chúng không dựng trên Ant Design. Lý do là màu: thuật toán palette của Ant
 * Design cần một màu **thật** để suy biến thể, còn seed của Flowboard là chuỗi
 * `var()`. `theme.test.ts` canh được những seed ta khai, nhưng một component
 * antd đọc một token chưa khai thì nó im lặng — và card là bề mặt dày đặc màu
 * nhất của sản phẩm.
 */

// ---------------------------------------------------------------- due badge

/** Năm giá trị của `DUE_STATES`; `none` không render gì. */
export type FbDueState = "none" | "scheduled" | "due_soon" | "due_today" | "overdue";

interface DueLook {
  label: string;
  fg: string;
  bg: string;
}

/**
 * Chữ và màu của từng `dueState`.
 *
 * `none` **không** có mục ở đây: nó nghĩa là "không có gì để nói" — task không
 * đặt hạn, hoặc đang ở cột kết thúc — và một chip màu xám ghi "Không có hạn"
 * chiếm chỗ của thông tin thật mà không thêm gì.
 */
const DUE_LOOK: Readonly<Record<Exclude<FbDueState, "none">, DueLook>> = {
  scheduled: {
    label: "Đã lên lịch",
    fg: "var(--fb-color-text-secondary)",
    bg: "var(--fb-color-surface-muted)",
  },
  due_soon: {
    label: "Sắp đến hạn",
    fg: "var(--fb-color-intent-info-text)",
    bg: "var(--fb-color-intent-info-subtle)",
  },
  due_today: {
    label: "Đến hạn hôm nay",
    fg: "var(--fb-color-intent-warning-text)",
    bg: "var(--fb-color-intent-warning-subtle)",
  },
  overdue: {
    label: "Quá hạn",
    fg: "var(--fb-color-intent-danger-text)",
    bg: "var(--fb-color-intent-danger-subtle)",
  },
};

export interface FbDueBadgeProps {
  state: FbDueState;
  /** Ngày hiển thị cạnh nhãn, đã định dạng sẵn bởi chỗ gọi. */
  date?: string | undefined;
}

export function FbDueBadge({ state, date }: FbDueBadgeProps) {
  if (state === "none") return null;
  const look = DUE_LOOK[state];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--fb-space-1)",
        padding: "2px var(--fb-space-2)",
        borderRadius: "var(--fb-radius-pill)",
        fontSize: "var(--fb-font-size-caption)",
        fontWeight: "var(--fb-font-weight-medium)",
        color: look.fg,
        background: look.bg,
        whiteSpace: "nowrap",
      }}
    >
      <FbIcon name="calendar-days" size="sm" />
      {date === undefined ? look.label : `${look.label} · ${date}`}
    </span>
  );
}

// ---------------------------------------------------------------- task card

export interface FbTaskCardProps {
  title: string;
  /** Nhóm công việc đã dịch sẵn; `undefined` thì hàng nhóm không render. */
  category?: string | undefined;
  /** Huy hiệu ưu tiên và các chip khác do feature quyết định. */
  badges?: ReactNode;
  due?: ReactNode;
  /** Chữ viết tắt của người thực hiện; `undefined` nghĩa là chưa giao. */
  assigneeInitials?: string | undefined;
  assigneeName?: string | undefined;
  /** Mở `TSK-02`. Tiêu đề là một nút thật, không phải `div` có `onClick`. */
  onOpen: () => void;
  /**
   * Tay kéo. `undefined` thì card không có affordance di chuyển — đúng những gì
   * Viewer thấy, theo ma trận vai trò.
   */
  dragHandle?: ReactNode;
  /** Đang gửi lệnh move; card khoá lần kéo thứ hai và nói ra điều đó. */
  syncing?: boolean;
  /** Đang được nhấc bằng bàn phím hoặc chuột. */
  lifted?: boolean;
}

export function FbTaskCard({
  title,
  category,
  badges,
  due,
  assigneeInitials,
  assigneeName,
  onOpen,
  dragHandle,
  syncing = false,
  lifted = false,
}: FbTaskCardProps) {
  return (
    <article
      style={{
        display: "grid",
        gap: "var(--fb-space-2)",
        padding: "var(--fb-space-3)",
        borderRadius: "var(--fb-radius-md)",
        background: "var(--fb-color-surface-raised)",
        border: `1px solid ${
          lifted ? "var(--fb-color-state-focus-ring)" : "var(--fb-color-border-default)"
        }`,
        opacity: syncing ? 0.7 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--fb-space-2)" }}>
        <div style={{ flex: 1, minWidth: 0, display: "grid", gap: "var(--fb-space-1)" }}>
          {category !== undefined && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--fb-space-1)",
                fontSize: "var(--fb-font-size-caption)",
                color: "var(--fb-color-text-muted)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "var(--fb-radius-pill)",
                  background: "var(--fb-color-brand-surface)",
                }}
              />
              {category}
            </span>
          )}
          <button
            type="button"
            onClick={onOpen}
            style={{
              padding: 0,
              border: "none",
              background: "transparent",
              textAlign: "left",
              cursor: "pointer",
              font: "inherit",
              fontSize: "var(--fb-font-size-body-sm)",
              fontWeight: "var(--fb-font-weight-medium)",
              color: "var(--fb-color-text-primary)",
            }}
          >
            {title}
          </button>
        </div>
        {dragHandle}
      </div>

      {(due !== undefined || badges !== undefined || assigneeInitials !== undefined) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--fb-space-2)",
            flexWrap: "wrap",
          }}
        >
          {due}
          {badges}
          {assigneeInitials !== undefined && (
            // Avatar là chữ viết tắt, nên tên đầy đủ phải đi kèm dưới dạng tên
            // truy cập được — "KN" một mình không nói được ai đang làm việc này.
            <span
              role="img"
              aria-label={`Người thực hiện: ${assigneeName ?? assigneeInitials}`}
              title={assigneeName ?? assigneeInitials}
              style={{
                marginLeft: "auto",
                display: "grid",
                placeItems: "center",
                width: "var(--fb-size-avatar-sm)",
                height: "var(--fb-size-avatar-sm)",
                borderRadius: "var(--fb-radius-pill)",
                background: "var(--fb-color-brand-subtle)",
                color: "var(--fb-color-brand-text)",
                fontSize: "var(--fb-font-size-caption)",
                fontWeight: "var(--fb-font-weight-bold)",
              }}
            >
              {assigneeInitials}
            </span>
          )}
        </div>
      )}

      {syncing && (
        <p
          style={{
            margin: 0,
            fontSize: "var(--fb-font-size-caption)",
            color: "var(--fb-color-text-muted)",
          }}
        >
          Đang đồng bộ vị trí mới…
        </p>
      )}
    </article>
  );
}

// ------------------------------------------------------------ activity item

export interface FbActivityItemProps {
  icon: FbIconName;
  message: string;
  /** Thời điểm và mã action, ví dụ `10:12 · task.reopened`. */
  meta: string;
}

export function FbActivityItem({ icon, message, meta }: FbActivityItemProps) {
  return (
    <li style={{ display: "flex", gap: "var(--fb-space-3)", alignItems: "flex-start" }}>
      <span
        aria-hidden="true"
        style={{
          flex: "0 0 auto",
          display: "grid",
          placeItems: "center",
          width: "var(--fb-size-avatar-sm)",
          height: "var(--fb-size-avatar-sm)",
          borderRadius: "var(--fb-radius-pill)",
          background: "var(--fb-color-surface-subtle)",
          color: "var(--fb-color-text-muted)",
        }}
      >
        <FbIcon name={icon} size="sm" />
      </span>
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span
          style={{ fontSize: "var(--fb-font-size-body-sm)", color: "var(--fb-color-text-primary)" }}
        >
          {message}
        </span>
        <span
          style={{ fontSize: "var(--fb-font-size-caption)", color: "var(--fb-color-text-muted)" }}
        >
          {meta}
        </span>
      </span>
    </li>
  );
}

// -------------------------------------------------------------------- tabs

export interface FbTabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface FbTabsProps {
  label: string;
  items: readonly FbTabItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

const TAB_BASE: CSSProperties = {
  padding: "var(--fb-space-2) var(--fb-space-3)",
  border: "none",
  borderBottom: "2px solid transparent",
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  fontSize: "var(--fb-font-size-body-sm)",
};

/**
 * Tab theo đúng mẫu ARIA: `tablist` → `tab` → `tabpanel`, mũi tên trái/phải để
 * chuyển, và chỉ tab đang chọn nằm trong thứ tự Tab.
 *
 * Panel không được chọn **không render** thay vì bị ẩn bằng CSS: nội dung của
 * `TSK-02` gồm cả danh sách bình luận và hoạt động, và giữ chúng trong cây khi
 * không nhìn thấy sẽ đưa chúng vào cả thứ tự đọc lẫn thứ tự Tab.
 */
export function FbTabs({ label, items, activeId, onSelect }: FbTabsProps) {
  const baseId = useId();
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === activeId),
  );
  const active = items[activeIndex];

  return (
    <div style={{ display: "grid", gap: "var(--fb-space-4)" }}>
      <div
        role="tablist"
        aria-label={label}
        style={{
          display: "flex",
          gap: "var(--fb-space-1)",
          borderBottom: "1px solid var(--fb-color-border-subtle)",
        }}
        onKeyDown={(event) => {
          const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (delta === 0) return;
          event.preventDefault();
          const next = items[(activeIndex + delta + items.length) % items.length];
          if (next === undefined) return;
          onSelect(next.id);
          document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
        }}
      >
        {items.map((item) => {
          const selected = item.id === active?.id;
          return (
            <button
              key={item.id}
              id={`${baseId}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              // Một điểm dừng Tab cho cả nhóm: người dùng Tab vào tablist rồi
              // dùng mũi tên, thay vì phải Tab qua từng tab một.
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(item.id)}
              style={{
                ...TAB_BASE,
                borderBottomColor: selected ? "var(--fb-color-brand-surface)" : "transparent",
                color: selected ? "var(--fb-color-brand-text)" : "var(--fb-color-text-secondary)",
                fontWeight: selected
                  ? "var(--fb-font-weight-semibold)"
                  : "var(--fb-font-weight-regular)",
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {active !== undefined && (
        <div
          id={`${baseId}-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${active.id}`}
          tabIndex={0}
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
