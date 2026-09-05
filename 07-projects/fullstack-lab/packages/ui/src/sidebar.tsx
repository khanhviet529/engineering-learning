"use client";

import type { ReactNode } from "react";
import { FbIcon, type FbIconName } from "./icon.tsx";
import { VISUALLY_HIDDEN } from "./a11y.ts";

/**
 * Sidebar của app shell — `FbSidebar` và `FbSidebarCollapsed`, dựng theo hai
 * frame tham chiếu `REF-05` và `REF-06`.
 *
 * Không component nào ở đây biết route, capability hay API. Chúng nhận **dữ
 * liệu đã được quyết định** rồi render. Việc "mục nào được hiện" là quyết định
 * của feature dựa trên capability server trả về; đặt nó ở đây là nhân bản
 * policy xuống tầng trình bày, đúng thứ mà mô hình phân quyền cấm.
 */

export interface FbSidebarItem {
  /** Khóa ổn định cho `key` và cho test; không phải nhãn hiển thị. */
  id: string;
  label: string;
  icon: FbIconName;
  href: string;
  active?: boolean;
}

export interface FbSidebarProps {
  /** Tên workspace hiện tại; bỏ trống khi chưa chọn hoặc chưa tải xong. */
  workspaceName?: string | undefined;
  items: readonly FbSidebarItem[];
  onToggleCollapse?: (() => void) | undefined;
  /** Slot cho nhóm nav của phase sau (`FbNavGroupTimeTracking`); MVP để trống. */
  extraGroup?: ReactNode;
}

function NavItem({ item, collapsed }: { item: FbSidebarItem; collapsed: boolean }) {
  const active = item.active === true;
  return (
    <a
      href={item.href}
      // `aria-current` là cách duy nhất screen reader biết mục nào đang mở.
      // Nền và màu chữ chỉ nói điều đó với người nhìn thấy được.
      {...(active ? { "aria-current": "page" as const } : {})}
      {...(collapsed ? { title: item.label } : {})}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: "var(--fb-radius-md)",
        fontSize: "var(--fb-font-size-body)",
        textDecoration: "none",
        justifyContent: collapsed ? "center" : "flex-start",
        fontWeight: active ? "var(--fb-font-weight-semibold)" : "var(--fb-font-weight-medium)",
        background: active ? "var(--fb-color-nav-active-surface)" : "transparent",
        color: active ? "var(--fb-color-nav-active-text)" : "var(--fb-color-text-secondary)",
      }}
    >
      <FbIcon name={item.icon} size="nav" />
      {/* Ở trạng thái thu gọn, nhãn vẫn tồn tại cho screen reader. Ẩn bằng
          `display: none` sẽ lấy mất accessible name — đúng lỗi mà bàn giao
          Pencil cảnh báo. */}
      <span style={collapsed ? VISUALLY_HIDDEN : undefined}>{item.label}</span>
    </a>
  );
}

function SidebarFrame({ width, children }: { width: string; children: ReactNode }) {
  return (
    <nav
      aria-label="Điều hướng chính"
      style={{
        width,
        flex: "0 0 auto",
        display: "flex",
        flexDirection: "column",
        background: "var(--fb-color-surface-raised)",
        borderRight: "1px solid var(--fb-color-border-default)",
      }}
    >
      {children}
    </nav>
  );
}

function SidebarBrand({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--fb-space-2)",
        fontSize: "var(--fb-font-size-body-lg)",
        fontWeight: "var(--fb-font-weight-bold)",
        color: "var(--fb-color-text-primary)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          display: "grid",
          placeItems: "center",
          borderRadius: "var(--fb-radius-md)",
          background: "var(--fb-color-brand-surface)",
          color: "var(--fb-color-brand-on-surface)",
        }}
      >
        <FbIcon name="layout-dashboard" size="md" />
      </span>
      {markOnly ? <span style={VISUALLY_HIDDEN}>Flowboard</span> : "Flowboard"}
    </span>
  );
}

function CollapseControl({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle?: (() => void) | undefined;
}) {
  // Footer bắt buộc có ở **cả hai** trạng thái và chứa đúng một thứ: control
  // thu gọn. Nếu chỉ bản thu gọn có control mở lại thì không tồn tại đường đi
  // vào trạng thái thu gọn ngay từ đầu.
  return (
    <div
      style={{
        borderTop: "1px solid var(--fb-color-border-default)",
        padding: "var(--fb-space-3) var(--fb-space-4)",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
        aria-pressed={collapsed}
        style={{
          width: 32,
          height: 32,
          display: "grid",
          placeItems: "center",
          borderRadius: "var(--fb-radius-md)",
          border: "1px solid var(--fb-color-border-default)",
          background: "var(--fb-color-surface-subtle)",
          color: "var(--fb-color-text-secondary)",
          cursor: "pointer",
        }}
      >
        <FbIcon name={collapsed ? "panel-left-open" : "panel-left-close"} size="nav" />
      </button>
    </div>
  );
}

export function FbSidebar({ workspaceName, items, onToggleCollapse, extraGroup }: FbSidebarProps) {
  return (
    <SidebarFrame width="var(--fb-size-sidebar-expanded)">
      <div
        style={{
          display: "grid",
          gap: "var(--fb-space-1)",
          padding: "var(--fb-space-5) var(--fb-space-4)",
        }}
      >
        <SidebarBrand />
        {workspaceName !== undefined && (
          <span
            style={{
              fontSize: "var(--fb-font-size-body-sm)",
              color: "var(--fb-color-text-muted)",
            }}
          >
            {workspaceName}
          </span>
        )}
      </div>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          display: "grid",
          gap: "var(--fb-space-1)",
          padding: "0 var(--fb-space-4)",
        }}
      >
        {items.map((item) => (
          <li key={item.id}>
            <NavItem item={item} collapsed={false} />
          </li>
        ))}
      </ul>

      {extraGroup}
      <div style={{ flex: 1 }} />
      <CollapseControl collapsed={false} onToggle={onToggleCollapse} />
    </SidebarFrame>
  );
}

/**
 * Bản thu gọn 72px của `REF-06`.
 *
 * Nó là component riêng theo đúng tên trong artifact và trong kế hoạch, nhưng
 * dùng chung một hiện thực nav với bản mở rộng — hai bản sao markup sẽ trôi
 * khỏi nhau ngay lần sửa nav đầu tiên.
 */
export function FbSidebarCollapsed({
  items,
  onToggleCollapse,
}: Pick<FbSidebarProps, "items" | "onToggleCollapse">) {
  return (
    <SidebarFrame width="var(--fb-size-sidebar-collapsed)">
      <div style={{ display: "grid", placeItems: "center", padding: "var(--fb-space-5) 0" }}>
        <SidebarBrand markOnly />
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          display: "grid",
          gap: "var(--fb-space-1)",
          padding: "0 var(--fb-space-3)",
        }}
      >
        {items.map((item) => (
          <li key={item.id}>
            <NavItem item={item} collapsed />
          </li>
        ))}
      </ul>
      <div style={{ flex: 1 }} />
      <CollapseControl collapsed onToggle={onToggleCollapse} />
    </SidebarFrame>
  );
}
