"use client";

import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { FbIcon, type FbIconName } from "./icon.tsx";

/**
 * App shell — `FbSidebar`, `FbSidebarCollapsed`, `FbTopbar`, `FbMobileHeader`
 * và `FbAccountMenu`, dựng theo hai frame tham chiếu `REF-05` và `REF-06`.
 *
 * Không component nào ở đây biết route, capability hay API. Chúng nhận **dữ
 * liệu đã được quyết định** rồi render. Việc "mục nào được hiện" là quyết định
 * của feature dựa trên capability server trả về; đặt nó ở đây là nhân bản
 * policy xuống tầng trình bày, đúng thứ mà mô hình phân quyền cấm.
 */

/** Ẩn khỏi mắt nhưng **giữ** cho screen reader. */
export const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

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

const ICON_BUTTON: CSSProperties = {
  width: 36,
  height: 36,
  display: "grid",
  placeItems: "center",
  borderRadius: "var(--fb-radius-md)",
  border: "1px solid var(--fb-color-border-default)",
  background: "var(--fb-color-surface-subtle)",
  color: "var(--fb-color-text-secondary)",
  cursor: "pointer",
};

export interface FbTopbarUser {
  displayName: string;
  initials: string;
}

export interface FbTopbarProps {
  title: string;
  breadcrumb?: string | undefined;
  user: FbTopbarUser;
  /** Mở menu tài khoản. Khối người dùng là entry point **duy nhất** của `USR-01`. */
  onOpenAccountMenu: () => void;
  accountMenuOpen: boolean;
  /** Quick toggle sáng ↔ tối. Ba giá trị `light|dark|system` chỉ chọn được ở `USR-01`. */
  onToggleTheme: () => void;
  /** Menu tài khoản do chỗ gọi render, để nó nắm nội dung và việc trả focus. */
  accountMenu?: ReactNode;
  /** Nút mở điều hướng trên màn hình hẹp; bỏ trống thì không render. */
  onOpenNavigation?: (() => void) | undefined;
  /**
   * Ref tới **chính** nút mở menu tài khoản.
   *
   * Chỗ gọi cần nó để trả focus về đúng nút đó sau khi menu đóng. Không phơi
   * ref ra thì chỗ gọi phải đi tìm nút bằng selector trên một cây DOM mà nó
   * không sở hữu, và sẽ vớ nhầm nút đầu tiên của topbar — đúng lỗi đã xảy ra.
   */
  userButtonRef?: RefObject<HTMLButtonElement | null> | undefined;
}

export function FbTopbar({
  title,
  breadcrumb,
  user,
  onOpenAccountMenu,
  accountMenuOpen,
  onToggleTheme,
  accountMenu,
  onOpenNavigation,
  userButtonRef,
}: FbTopbarProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--fb-space-4)",
        minHeight: 64,
        padding: "0 var(--fb-space-6)",
        background: "var(--fb-color-surface-raised)",
        borderBottom: "1px solid var(--fb-color-border-default)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--fb-space-3)", minWidth: 0 }}>
        {onOpenNavigation !== undefined && (
          <button
            type="button"
            onClick={onOpenNavigation}
            aria-label="Mở điều hướng"
            style={ICON_BUTTON}
          >
            <FbIcon name="panel-left-open" size="nav" />
          </button>
        )}
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: "var(--fb-font-size-heading-sm)",
              fontWeight: "var(--fb-font-weight-semibold)",
              color: "var(--fb-color-text-primary)",
            }}
          >
            {title}
          </h1>
          {breadcrumb !== undefined && (
            <span
              style={{
                fontSize: "var(--fb-font-size-body-sm)",
                color: "var(--fb-color-text-muted)",
              }}
            >
              {breadcrumb}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--fb-space-3)" }}>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label="Đổi giao diện sáng tối"
          style={ICON_BUTTON}
        >
          <FbIcon name="sun-moon" size="nav" />
        </button>

        <FbAccountButton
          displayName={user.displayName}
          initials={user.initials}
          onOpen={onOpenAccountMenu}
          open={accountMenuOpen}
          {...(accountMenu === undefined ? {} : { menu: accountMenu })}
          {...(userButtonRef === undefined ? {} : { buttonRef: userButtonRef })}
        />
      </div>
    </header>
  );
}

export interface FbAccountMenuItem {
  id: string;
  label: string;
  icon: FbIconName;
  onSelect: () => void;
  tone?: "default" | "danger";
}

export interface FbAccountMenuProps {
  displayName: string;
  email: string;
  items: readonly FbAccountMenuItem[];
  /** Đóng menu. Chỗ gọi chịu trách nhiệm trả focus về khối người dùng. */
  onDismiss: () => void;
}

/**
 * Menu tài khoản đặt ngay dưới khối người dùng trên topbar.
 *
 * `Escape` đóng menu và chỗ gọi trả focus **về chính khối đó** — đây là hợp
 * đồng trong đặc tả tương tác, không phải chi tiết tuỳ ý.
 */
export function FbAccountMenu({ displayName, email, items, onDismiss }: FbAccountMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Mở menu bằng bàn phím mà focus ở lại nút mở thì Tab sẽ đi ra ngoài menu
    // thay vì đi trong nó.
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onDismiss();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Menu tài khoản"
      style={{
        width: 248,
        display: "grid",
        gap: 2,
        padding: 6,
        borderRadius: "var(--fb-radius-lg)",
        background: "var(--fb-color-surface-raised)",
        border: "1px solid var(--fb-color-border-default)",
        boxShadow: "0 12px 32px var(--fb-shadow-color)",
      }}
    >
      <div style={{ display: "grid", gap: 2, padding: 10 }}>
        <span
          style={{
            fontSize: "var(--fb-font-size-body-sm)",
            fontWeight: "var(--fb-font-weight-semibold)",
            color: "var(--fb-color-text-primary)",
          }}
        >
          {displayName}
        </span>
        <span
          style={{ fontSize: "var(--fb-font-size-caption)", color: "var(--fb-color-text-muted)" }}
        >
          {email}
        </span>
      </div>
      <div style={{ height: 1, background: "var(--fb-color-border-default)" }} />
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={item.onSelect}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: 10,
            borderRadius: "var(--fb-radius-md)",
            border: "none",
            background: "transparent",
            textAlign: "left",
            fontSize: "var(--fb-font-size-body-sm)",
            fontWeight: "var(--fb-font-weight-medium)",
            cursor: "pointer",
            color:
              item.tone === "danger"
                ? "var(--fb-color-intent-danger-text)"
                : "var(--fb-color-text-secondary)",
          }}
        >
          <FbIcon name={item.icon} size="sm" />
          {item.label}
        </button>
      ))}
    </div>
  );
}

export interface FbMobileHeaderProps {
  title: string;
  /** Đường lùi; không có nghĩa là đang ở màn hình gốc. */
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  /** Mở điều hướng dạng lớp phủ. Dùng cho trang, không dùng cho sheet. */
  onOpenNavigation?: (() => void) | undefined;
  /**
   * Slot bên phải: khối người dùng, nút hành động chính của trang.
   *
   * Nó tồn tại vì một lý do cụ thể: trên màn hình hẹp, header này **thay** cho
   * topbar, và topbar là entry point duy nhất của `USR-01`. Không có slot này
   * thì bố cục mobile sẽ âm thầm bỏ mất một màn hình — đúng điều mà hệ thống
   * thiết kế cấm ("không dùng bố cục mobile để bỏ bớt CTA, state hay thông tin
   * mà bản desktop có").
   */
  trailing?: ReactNode;
}

export function FbMobileHeader({
  title,
  onBack,
  onClose,
  onOpenNavigation,
  trailing,
}: FbMobileHeaderProps) {
  const bare: CSSProperties = {
    ...ICON_BUTTON,
    width: 32,
    height: 32,
    border: "none",
    background: "transparent",
  };
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--fb-space-3)",
        minHeight: 56,
        padding: "0 var(--fb-space-4)",
        background: "var(--fb-color-surface-raised)",
        borderBottom: "1px solid var(--fb-color-border-default)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {onOpenNavigation !== undefined && (
          <button type="button" onClick={onOpenNavigation} aria-label="Mở điều hướng" style={bare}>
            <FbIcon name="panel-left-open" size="md" />
          </button>
        )}
        {onBack !== undefined && (
          <button type="button" onClick={onBack} aria-label="Quay lại" style={bare}>
            <FbIcon name="chevron-left" size="md" />
          </button>
        )}
        <h1
          style={{
            margin: 0,
            fontSize: "var(--fb-font-size-body-lg)",
            fontWeight: "var(--fb-font-weight-semibold)",
            color: "var(--fb-color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--fb-space-2)" }}>
        {trailing}
        {onClose !== undefined && (
          <button type="button" onClick={onClose} aria-label="Đóng" style={bare}>
            <FbIcon name="x" size="md" />
          </button>
        )}
      </div>
    </header>
  );
}

export interface FbAccountButtonProps {
  displayName: string;
  initials: string;
  onOpen: () => void;
  open: boolean;
  menu?: ReactNode;
  /** Ẩn tên, chỉ để avatar — dùng khi bề ngang hẹp. */
  compact?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null> | undefined;
}

/**
 * Khối người dùng — entry point **duy nhất** của `USR-01`.
 *
 * Nó được tách khỏi `FbTopbar` vì cả topbar (desktop) lẫn `FbMobileHeader`
 * (compact) đều phải có nó. Nếu chỉ topbar có, thì trên điện thoại `USR-01`
 * không còn đường vào nào.
 */
export function FbAccountButton({
  displayName,
  initials,
  onOpen,
  open,
  menu,
  compact = false,
  buttonRef,
}: FbAccountButtonProps) {
  const menuId = useId();
  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef ?? null}
        type="button"
        onClick={onOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        {...(open ? { "aria-controls": menuId } : {})}
        {...(compact ? { "aria-label": displayName } : {})}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--fb-space-2)",
          padding: compact ? 4 : "6px 10px",
          borderRadius: "var(--fb-radius-md)",
          border: "1px solid var(--fb-color-border-default)",
          background: "var(--fb-color-surface-subtle)",
          color: "var(--fb-color-text-strong)",
          fontSize: "var(--fb-font-size-body)",
          fontWeight: "var(--fb-font-weight-medium)",
          cursor: "pointer",
        }}
      >
        {!compact && displayName}
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            display: "grid",
            placeItems: "center",
            borderRadius: "var(--fb-radius-pill)",
            background: "var(--fb-color-brand-subtle)",
            color: "var(--fb-color-brand-text)",
            fontSize: "var(--fb-font-size-body-sm)",
            fontWeight: "var(--fb-font-weight-semibold)",
          }}
        >
          {initials}
        </span>
        {!compact && <FbIcon name="chevron-down" size="sm" />}
      </button>
      {open && menu !== undefined && (
        <div
          id={menuId}
          style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200 }}
        >
          {menu}
        </div>
      )}
    </div>
  );
}
