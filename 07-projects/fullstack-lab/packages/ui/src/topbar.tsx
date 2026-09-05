"use client";

import type { CSSProperties, ReactNode, RefObject } from "react";
import { FbIcon } from "./icon.tsx";
import { FbAccountButton } from "./account-menu.tsx";

/**
 * Thanh trên cùng — `FbTopbar` cho màn hình rộng và `FbMobileHeader` cho màn
 * hình hẹp.
 *
 * Hai component ở chung một tệp vì chúng là **hai biến thể của một vai trò**:
 * trên màn hình hẹp, header mobile *thay* topbar chứ không đứng cạnh nó. Tách
 * chúng ra hai tệp sẽ giấu mất ràng buộc "cái nào cũng phải có khối người
 * dùng", và đó chính là ràng buộc đã từng bị bỏ sót một lần.
 */

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
