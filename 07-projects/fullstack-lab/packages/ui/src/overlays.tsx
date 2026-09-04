"use client";

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { FbIcon } from "./icon.tsx";

/**
 * `FbModal` — lớp phủ có focus trap, `Escape` và **trả focus** khi đóng.
 *
 * Ba hành vi đó là lý do component này thuộc `packages/ui` chứ không phải viết
 * lại ở từng feature: chúng là hợp đồng accessibility ở
 * [đặc tả tương tác §8](../../../docs/design/interaction-specifications.md),
 * giống nhau ở mọi lớp phủ, và viết sai thì người dùng bàn phím bị kẹt trong
 * hoặc bị văng khỏi ngữ cảnh.
 *
 * Nó **không** biết resource, capability hay mutation. Quyết định "được mở hay
 * không" thuộc về feature.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface FbModalProps {
  title: string;
  subtitle?: string | undefined;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Yêu cầu đóng: bấm `Escape`, bấm nút đóng, hoặc bấm ra ngoài.
   *
   * Chỗ gọi quyết định đóng thật hay mở xác nhận bỏ thay đổi — form bẩn không
   * được đóng thẳng, và đó là quyết định của feature sở hữu form.
   */
  onRequestClose: () => void;
  /** Chặn đóng khi đang gửi, để không làm mất trạng thái của một request đang chạy. */
  closeDisabled?: boolean;
  /**
   * Nơi focus rơi vào khi mở.
   *
   * `"auto"` lấy phần tử focus được đầu tiên, tức là nút đóng ở header — đúng
   * cho hộp thoại có form, vì người dùng đọc tiêu đề rồi đi xuống nội dung.
   *
   * `"footer"` lấy nút **đầu tiên trong footer**. Đây là lựa chọn bắt buộc cho
   * hộp thoại xác nhận: đặc tả tương tác yêu cầu focus mặc định rơi vào phương
   * án an toàn nhất ("Tiếp tục chỉnh sửa", "Giữ nguyên"), và quy ước của
   * Flowboard là đặt phương án đó ở đầu footer. Một `Enter` theo phản xạ khi
   * đó giữ nguyên dữ liệu thay vì vứt nó đi.
   */
  initialFocus?: "auto" | "footer";
}

export function FbModal({
  title,
  subtitle,
  children,
  footer,
  onRequestClose,
  closeDisabled = false,
  initialFocus = "auto",
}: FbModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  // Phần tử đã mở lớp phủ. Đóng xong phải trả focus về đúng nó, nếu không
  // người dùng bàn phím bị đưa về đầu trang và mất chỗ đang làm.
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const scope = initialFocus === "footer" ? footerRef.current : dialogRef.current;
    const target =
      scope?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialogRef.current;
    target?.focus();

    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);

  const requestClose = useCallback(() => {
    if (!closeDisabled) onRequestClose();
  }, [closeDisabled, onRequestClose]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;

      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (nodes === undefined || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (first === undefined || last === undefined) return;

      // Vòng focus khép kín: đây là điều biến một lớp phủ thành lớp phủ thật
      // thay vì một khối trôi mà Tab đi xuyên qua xuống trang nền.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [requestClose]);

  return (
    <div
      // Backdrop. Bấm ra ngoài đi qua cùng một `onRequestClose` như `Escape`,
      // nên feature chỉ phải xử lý một đường thoát.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        display: "grid",
        placeItems: "center",
        padding: "var(--fb-space-4)",
        background: "var(--fb-color-overlay-dim)",
        overflowY: "auto",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        {...(subtitle === undefined ? {} : { "aria-describedby": descriptionId })}
        tabIndex={-1}
        style={{
          width: "100%",
          maxWidth: 620,
          display: "grid",
          gap: "var(--fb-space-4)",
          padding: "var(--fb-space-6)",
          borderRadius: "var(--fb-radius-xl)",
          background: "var(--fb-color-surface-raised)",
          border: "1px solid var(--fb-color-border-default)",
          boxShadow: "0 24px 64px var(--fb-shadow-color)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "var(--fb-space-3)",
          }}
        >
          <div style={{ display: "grid", gap: 2 }}>
            <h2
              id={headingId}
              style={{
                margin: 0,
                fontSize: "var(--fb-font-size-heading-sm)",
                fontWeight: "var(--fb-font-weight-bold)",
                color: "var(--fb-color-text-primary)",
              }}
            >
              {title}
            </h2>
            {subtitle !== undefined && (
              <p
                id={descriptionId}
                style={{
                  margin: 0,
                  fontSize: "var(--fb-font-size-body-sm)",
                  color: "var(--fb-color-text-muted)",
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={closeDisabled}
            aria-label="Đóng hộp thoại"
            style={{
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              borderRadius: "var(--fb-radius-md)",
              border: "1px solid var(--fb-color-border-default)",
              background: "var(--fb-color-surface-subtle)",
              color: "var(--fb-color-text-secondary)",
              cursor: closeDisabled ? "not-allowed" : "pointer",
            }}
          >
            <FbIcon name="x" size="sm" />
          </button>
        </div>

        <div style={{ display: "grid", gap: "var(--fb-space-4)" }}>{children}</div>

        {footer !== undefined && (
          <div
            ref={footerRef}
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--fb-space-2)",
              flexWrap: "wrap",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
