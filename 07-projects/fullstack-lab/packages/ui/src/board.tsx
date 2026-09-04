"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useId } from "react";

/**
 * Primitive của dải cột board — `FbBoardScroller`, `FbBoardColumn`, `FbToggle`.
 *
 * Chúng không biết Task, Column hay capability nào: nhận nội dung rồi render.
 * Quyết định "cột này có nút lưu trữ không" thuộc về feature.
 *
 * Ba component này tách khỏi `data-display.tsx` vì chúng có một ràng buộc bố
 * cục riêng — cuộn ngang, chiều rộng cột cố định — và cả `BRD-01` lẫn `SPR-01`
 * (Sprint Board) đều dựng trên đúng ràng buộc đó.
 */

// ---------------------------------------------------------------- scroller

export interface FbBoardScrollerProps {
  /** Nhãn của cả dải cột cho screen reader. */
  label: string;
  /**
   * Chữ gợi ý cuộn ngang, chỉ hiện **khi nội dung thật sự tràn**.
   *
   * Hiện nó vô điều kiện là nói sai với người đang thấy đủ cột; giấu nó hoàn
   * toàn là bỏ mất dấu hiệu mà [đặc tả tương tác §9](../../../docs/design/interaction-specifications.md)
   * yêu cầu trên màn hình nhỏ.
   */
  hint?: string | undefined;
  children: ReactNode;
}

export function FbBoardScroller({ label, hint, children }: FbBoardScrollerProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    const node = stripRef.current;
    if (node === null) return;
    setOverflowing(node.scrollWidth > node.clientWidth);
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, children]);

  return (
    <div style={{ display: "grid", gap: "var(--fb-space-2)", minWidth: 0 }}>
      {hint !== undefined && overflowing && (
        <p
          style={{
            margin: 0,
            fontSize: "var(--fb-font-size-caption)",
            color: "var(--fb-color-text-muted)",
          }}
        >
          {hint}
        </p>
      )}
      <div
        ref={stripRef}
        // `tabIndex` để người dùng bàn phím cuộn được vùng này bằng phím mũi
        // tên. Nó là **một** điểm dừng Tab, không phải bẫy: Tab tiếp theo đi
        // ra khỏi dải, đúng như đặc tả tương tác yêu cầu cho board ngang.
        tabIndex={0}
        role="group"
        aria-label={label}
        style={{
          display: "flex",
          gap: "var(--fb-space-4)",
          overflowX: "auto",
          overflowY: "hidden",
          alignItems: "flex-start",
          paddingBottom: "var(--fb-space-2)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ column

export interface FbBoardColumnProps {
  name: string;
  /** Huy hiệu cạnh tên cột: cờ cấu hình ở M3, số task đã nạp ở M4. */
  badges?: ReactNode;
  /**
   * Khe trạng thái của riêng cột — Loading, Error hay Empty.
   *
   * Artifact gọi nó là `Column State Slot`, và nó nằm **trên** danh sách chứ
   * không thay thế danh sách: một cột đang nạp trang tiếp theo vẫn hiển thị
   * những gì đã nạp.
   */
  state?: ReactNode;
  children?: ReactNode;
  /** Chân cột: `Đã nạp n / m` và `Tải thêm` khi có phân trang task. */
  footer?: ReactNode;
}

export function FbBoardColumn({ name, badges, state, children, footer }: FbBoardColumnProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      style={{
        // Cột không co lại: board cuộn ngang thay vì bóp cột đến mức không đọc
        // được, theo đặc tả tương tác §9.
        flex: "0 0 auto",
        width: "var(--fb-size-board-column-min)",
        display: "grid",
        gap: "var(--fb-space-3)",
        alignContent: "start",
        padding: "var(--fb-space-4)",
        borderRadius: "var(--fb-radius-lg)",
        background: "var(--fb-color-surface-subtle)",
        border: "1px solid var(--fb-color-border-subtle)",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "var(--fb-space-2)" }}>
        <h3
          id={headingId}
          style={{
            margin: 0,
            flex: 1,
            minWidth: 0,
            fontSize: "var(--fb-font-size-body)",
            fontWeight: "var(--fb-font-weight-semibold)",
            color: "var(--fb-color-text-strong)",
          }}
        >
          {name}
        </h3>
        {badges}
      </header>

      {state}
      {children}
      {footer}
    </section>
  );
}

// ------------------------------------------------------------------ toggle

export interface FbToggleProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string | undefined;
  disabled?: boolean | undefined;
}

const TRACK: CSSProperties = {
  width: 36,
  height: 20,
  flex: "0 0 auto",
  borderRadius: "var(--fb-radius-pill)",
  position: "relative",
  transition: "background 120ms ease",
};

/**
 * Công tắc bật/tắt cho một cờ boolean.
 *
 * Nó là `<input type="checkbox" role="switch">` thật, không phải một `div` có
 * `onClick`. Nhờ vậy nó có sẵn `Space` để bật/tắt, trạng thái được screen
 * reader đọc là bật/tắt, và nó gắn được vào `<label>` như mọi field khác.
 *
 * Nó **không** dùng `Switch` của Ant Design, và đó là chủ ý: nền của Switch
 * được suy từ seed `colorPrimary`, mà seed của Flowboard là một chuỗi `var()`
 * — thứ mà thuật toán palette của Ant Design không đọc được. Tự vẽ bằng token
 * là cách duy nhất chắc chắn màu công tắc nằm trong phép đo tương phản.
 */
export function FbToggle({ id, label, checked, onChange, hint, disabled = false }: FbToggleProps) {
  const hintId = `${id}-hint`;

  return (
    <div style={{ display: "grid", gap: "var(--fb-space-1)" }}>
      <label
        htmlFor={id}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--fb-space-2)",
          fontSize: "var(--fb-font-size-body-sm)",
          color: disabled ? "var(--fb-color-state-disabled-text)" : "var(--fb-color-text-primary)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <span
          style={{
            ...TRACK,
            background: checked
              ? "var(--fb-color-brand-surface)"
              : "var(--fb-color-border-default)",
          }}
        >
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            {...(hint === undefined ? {} : { "aria-describedby": hintId })}
            // Input phủ kín track và trong suốt: con trỏ, vùng chạm và ring
            // focus của trình duyệt đều rơi đúng vào hình công tắc.
            style={{ position: "absolute", inset: 0, margin: 0, opacity: 0, cursor: "inherit" }}
          />
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 2,
              left: checked ? 18 : 2,
              width: 16,
              height: 16,
              borderRadius: "var(--fb-radius-pill)",
              background: "var(--fb-color-surface-raised)",
              transition: "left 120ms ease",
            }}
          />
        </span>
        {label}
      </label>
      {hint !== undefined && (
        <span
          id={hintId}
          style={{
            fontSize: "var(--fb-font-size-caption)",
            color: "var(--fb-color-text-muted)",
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
