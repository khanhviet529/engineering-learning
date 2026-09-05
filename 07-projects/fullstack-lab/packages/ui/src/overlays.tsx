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

/**
 * Hành vi chung của mọi lớp phủ: focus vào trong khi mở, giữ focus bên trong,
 * `Escape` để yêu cầu đóng, và **trả focus** về phần tử đã mở khi đóng.
 *
 * Nó là một hook chứ không phải hai bản sao trong `FbModal` và `FbDrawer`: hợp
 * đồng accessibility ở [đặc tả tương tác §8](../../../docs/design/interaction-specifications.md)
 * giống hệt nhau cho cả hai, và hai bản sao là hai chỗ để một bản trôi đi.
 */
function useOverlayBehaviour({
  dialogRef,
  initialFocusRef,
  closeDisabled,
  onRequestClose,
}: {
  dialogRef: React.RefObject<HTMLDivElement | null>;
  initialFocusRef: React.RefObject<HTMLDivElement | null>;
  closeDisabled: boolean;
  onRequestClose: () => void;
}) {
  // Phần tử đã mở lớp phủ. Đóng xong phải trả focus về đúng nó, nếu không
  // người dùng bàn phím bị đưa về đầu trang và mất chỗ đang làm.
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const target =
      initialFocusRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialogRef.current;
    target?.focus();

    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Khi lớp phủ **không** được phép đóng, `Escape` không phải của nó:
        // để nguyên cho widget bên trong xử lý. Nuốt phím ở đây là cách một
        // thao tác đang dở bên trong — kéo một task bằng bàn phím chẳng hạn —
        // mất mất phím hủy của chính nó, vì listener này chạy ở pha capture
        // trên `document`, tức là **trước** mọi handler của phần tử con.
        if (closeDisabled) return;
        event.stopPropagation();
        onRequestClose();
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
  }, [closeDisabled, onRequestClose]);
}

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

  useOverlayBehaviour({
    dialogRef,
    initialFocusRef: initialFocus === "footer" ? footerRef : dialogRef,
    closeDisabled,
    onRequestClose,
  });

  const requestClose = useCallback(() => {
    if (!closeDisabled) onRequestClose();
  }, [closeDisabled, onRequestClose]);

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

export interface FbDrawerProps {
  title: string;
  subtitle?: string | undefined;
  /** Huy hiệu cạnh tiêu đề: trạng thái cột, ưu tiên, hạn xử lý. */
  badges?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onRequestClose: () => void;
  closeDisabled?: boolean;
}

/**
 * `FbDrawer` — lớp phủ trượt từ cạnh phải, dùng cho `TSK-02 Chi tiết công việc`.
 *
 * Nó khác `FbModal` ở **bố cục và cách cuộn**, không ở hợp đồng accessibility:
 * cả hai dùng chung `useOverlayBehaviour`. Drawer chiếm hết chiều cao và cuộn
 * độc lập với trang nền, vì nội dung của nó — thuộc tính, bình luận, hoạt động
 * — dài hơn một màn hình, còn modal thì luôn vừa một khung.
 *
 * Trên màn hình hẹp nó trải hết chiều ngang, đúng "full-height sheet" mà
 * [đặc tả tương tác §9](../../../docs/design/interaction-specifications.md)
 * yêu cầu cho task detail.
 */
export function FbDrawer({
  title,
  subtitle,
  badges,
  children,
  footer,
  onRequestClose,
  closeDisabled = false,
}: FbDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const descriptionId = useId();

  useOverlayBehaviour({
    dialogRef,
    initialFocusRef: dialogRef,
    closeDisabled,
    onRequestClose,
  });

  const requestClose = useCallback(() => {
    if (!closeDisabled) onRequestClose();
  }, [closeDisabled, onRequestClose]);

  return (
    <div
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        display: "flex",
        justifyContent: "flex-end",
        background: "var(--fb-color-overlay-dim)",
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
          width: "min(560px, 100%)",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "var(--fb-color-surface-raised)",
          borderLeft: "1px solid var(--fb-color-border-default)",
          boxShadow: "0 0 64px var(--fb-shadow-color)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "var(--fb-space-3)",
            padding: "var(--fb-space-5) var(--fb-space-6)",
            borderBottom: "1px solid var(--fb-color-border-subtle)",
          }}
        >
          <div style={{ display: "grid", gap: "var(--fb-space-2)", minWidth: 0 }}>
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
            {badges !== undefined && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--fb-space-1)" }}>
                {badges}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={closeDisabled}
            aria-label="Đóng chi tiết công việc"
            style={{
              flex: "0 0 auto",
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

        {/* Chỉ phần thân cuộn: tiêu đề và chân luôn nhìn thấy được, nên người
            dùng không phải cuộn ngược lên để tìm nút đóng. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "var(--fb-space-6)",
            display: "grid",
            gap: "var(--fb-space-5)",
            alignContent: "start",
          }}
        >
          {children}
        </div>

        {footer !== undefined && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--fb-space-2)",
              flexWrap: "wrap",
              padding: "var(--fb-space-4) var(--fb-space-6)",
              borderTop: "1px solid var(--fb-color-border-subtle)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
