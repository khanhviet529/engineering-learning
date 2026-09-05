"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { FbIcon, type FbIconName } from "./icon.tsx";

/**
 * Khối người dùng và menu tài khoản.
 *
 * Chúng đi cùng nhau và tách khỏi topbar vì **cả** topbar (desktop) lẫn
 * `FbMobileHeader` (màn hình hẹp) đều phải có khối người dùng: nó là entry
 * point duy nhất của `USR-01`, nên nếu chỉ topbar có thì trên điện thoại màn
 * hình đó không còn đường vào nào.
 */

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
