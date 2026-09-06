"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { FbIcon } from "./icon.tsx";

/**
 * Primitive trình bày dùng lại ở nhiều màn hình: `FbListRow`, `FbBadge`,
 * `FbToast`, `FbSkeleton`, `FbPageSection` và `FbDataTable`.
 *
 * Chúng không biết resource, không fetch và không kiểm quyền — nhận nội dung
 * rồi render. Cái quyết định "hàng này có hiện nút xoá không" nằm ở feature.
 */

export interface FbListRowProps {
  primary: ReactNode;
  secondary?: ReactNode;
  /** Nội dung bên phải trước chevron: badge, nút, trạng thái. */
  trailing?: ReactNode;
  /** Có `href` thì hàng là link và hiện chevron; không có thì là hàng tĩnh. */
  href?: string | undefined;
}

/**
 * Một hàng danh sách.
 *
 * Khi có `href`, **cả hàng** là một link duy nhất — không phải một div bọc
 * ngoài với link nhỏ bên trong. Vùng bấm lớn giúp cả chuột lẫn cảm ứng, và
 * một link duy nhất giúp screen reader đọc ra đúng một đích thay vì hai.
 */
export function FbListRow({ primary, secondary, trailing, href }: FbListRowProps) {
  const body = (
    <>
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: "var(--fb-font-size-body)",
            fontWeight: "var(--fb-font-weight-semibold)",
            color: "var(--fb-color-text-primary)",
          }}
        >
          {primary}
        </span>
        {secondary !== undefined && (
          <span
            style={{
              fontSize: "var(--fb-font-size-body-sm)",
              color: "var(--fb-color-text-muted)",
            }}
          >
            {secondary}
          </span>
        )}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--fb-space-3)" }}>
        {trailing}
        {href !== undefined && (
          <span aria-hidden="true" style={{ color: "var(--fb-color-text-muted)", display: "flex" }}>
            <FbIcon name="chevron-right" size="nav" />
          </span>
        )}
      </span>
    </>
  );

  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--fb-space-3)",
    padding: "var(--fb-space-3) 14px",
    borderRadius: "var(--fb-radius-lg)",
    background: "var(--fb-color-surface-raised)",
    border: "1px solid var(--fb-color-border-default)",
    textDecoration: "none",
    color: "inherit",
  };

  return href === undefined ? (
    <div style={style}>{body}</div>
  ) : (
    <a href={href} style={style}>
      {body}
    </a>
  );
}

export type FbBadgeTone = "brand" | "neutral" | "success" | "warning" | "danger" | "info";

const BADGE_TONE: Record<FbBadgeTone, { background: string; color: string }> = {
  brand: { background: "var(--fb-color-brand-subtle)", color: "var(--fb-color-brand-text)" },
  neutral: { background: "var(--fb-color-surface-muted)", color: "var(--fb-color-text-secondary)" },
  success: {
    background: "var(--fb-color-intent-success-subtle)",
    color: "var(--fb-color-intent-success-text)",
  },
  warning: {
    background: "var(--fb-color-intent-warning-subtle)",
    color: "var(--fb-color-intent-warning-text)",
  },
  danger: {
    background: "var(--fb-color-intent-danger-subtle)",
    color: "var(--fb-color-intent-danger-text)",
  },
  info: {
    background: "var(--fb-color-intent-info-subtle)",
    color: "var(--fb-color-intent-info-text)",
  },
};

export interface FbBadgeProps {
  children: ReactNode;
  tone?: FbBadgeTone;
}

/**
 * Badge chỉ mang **nhãn chữ**.
 *
 * Không có biến thể chỉ-màu: hệ thống thiết kế cấm màu là kênh truyền nghĩa
 * duy nhất, nên một badge không chữ sẽ không nói được gì cho người không phân
 * biệt được màu.
 */
export function FbBadge({ children, tone = "neutral" }: FbBadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: "var(--fb-radius-pill)",
        fontSize: "var(--fb-font-size-caption)",
        fontWeight: "var(--fb-font-weight-semibold)",
        whiteSpace: "nowrap",
        ...BADGE_TONE[tone],
      }}
    >
      {children}
    </span>
  );
}

export interface FbToastProps {
  message: string;
  /** `error` được công bố ngay; `success` không cắt ngang việc người dùng đang làm. */
  intent?: "success" | "error";
}

/**
 * Toast cho kết quả ngắn của một mutation.
 *
 * Nó **không** tự cướp focus — đặc tả tương tác nói rõ vậy — nên nó là live
 * region chứ không phải dialog.
 */
export function FbToast({ message, intent = "success" }: FbToastProps) {
  return (
    <div
      role={intent === "error" ? "alert" : "status"}
      aria-live={intent === "error" ? "assertive" : "polite"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--fb-space-2)",
        padding: "var(--fb-space-3) 14px",
        borderRadius: "var(--fb-radius-md)",
        background: "var(--fb-color-surface-inverse)",
        color: "var(--fb-color-text-on-inverse)",
        fontSize: "var(--fb-font-size-body)",
        boxShadow: "0 12px 32px var(--fb-shadow-color)",
      }}
    >
      <FbIcon name={intent === "error" ? "triangle-alert" : "shield-alert"} size="nav" />
      {message}
    </div>
  );
}

export interface FbSkeletonProps {
  /** Số dòng giả lập; hình học phải giống vùng sắp nạp, không phải một khối chung. */
  lines?: number;
  /** Nhãn cho screen reader; mặc định nói rõ đang tải. */
  label?: string;
}

/**
 * Skeleton giữ **hình học** của vùng sắp nạp.
 *
 * Nó là một live region lịch sự: người dùng screen reader cần biết trang đang
 * tải, còn người nhìn thấy đã biết điều đó qua khối xám.
 */
export function FbSkeleton({ lines = 3, label = "Đang tải dữ liệu" }: FbSkeletonProps) {
  return (
    <div role="status" aria-live="polite" style={{ display: "grid", gap: "var(--fb-space-3)" }}>
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
      >
        {label}
      </span>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          style={{
            display: "block",
            height: 44,
            borderRadius: "var(--fb-radius-md)",
            background: "var(--fb-color-state-loading-track)",
          }}
        />
      ))}
    </div>
  );
}

export interface FbPageSectionProps {
  heading: string;
  description?: ReactNode;
  /** Hành động ở góc phải tiêu đề; feature quyết định nó có được render không. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * Khối nội dung có tiêu đề của một trang, theo bố cục chung mà mọi màn hình
 * `WSP-*`, `PRJ-*` và `USR-01` trong artifact đều dùng.
 *
 * Tiêu đề là `h2` vì `h1` thuộc về topbar — mỗi trang đúng một `h1`, và đó là
 * điểm neo mà screen reader dùng.
 */
export function FbPageSection({ heading, description, action, children }: FbPageSectionProps) {
  const headingId = useId();
  return (
    <section
      // Một `<section>` chỉ trở thành landmark `region` khi nó **có tên**. Nối
      // vào tiêu đề để screen reader liệt kê được các khối của trang và nhảy
      // thẳng tới khối cần đọc, thay vì phải cuộn tuần tự qua tất cả.
      aria-labelledby={headingId}
      style={{
        display: "grid",
        gap: "var(--fb-space-4)",
        padding: "var(--fb-space-6)",
        borderRadius: 14,
        background: "var(--fb-color-surface-raised)",
        border: "1px solid var(--fb-color-border-default)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--fb-space-3)",
        }}
      >
        <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <h2
            id={headingId}
            style={{
              margin: 0,
              fontSize: "var(--fb-font-size-heading-sm)",
              fontWeight: "var(--fb-font-weight-bold)",
              color: "var(--fb-color-text-primary)",
            }}
          >
            {heading}
          </h2>
          {description !== undefined && (
            <p
              style={{
                margin: 0,
                fontSize: "var(--fb-font-size-body-sm)",
                color: "var(--fb-color-text-muted)",
              }}
            >
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export interface FbDataTableColumn {
  /** Khoá ổn định cho React; không hiển thị. */
  key: string;
  header: string;
  /** Cột hành động không có nhãn nhìn thấy được thì vẫn cần tên cho screen reader. */
  headerHidden?: boolean;
}

export interface FbDataTableRow {
  id: string;
  /** Đúng một ô cho mỗi cột. Ô đầu tiên là **tiêu đề hàng**. */
  cells: readonly ReactNode[];
}

export interface FbDataTableProps {
  /** Nhãn của bảng cho screen reader; ẩn khỏi mắt vì tiêu đề khối đã nói rồi. */
  caption: string;
  columns: readonly FbDataTableColumn[];
  rows: readonly FbDataTableRow[];
  /** Bề rộng tối thiểu trước khi bảng cuộn ngang. */
  minWidth?: number;
}

const TABLE_CELL: CSSProperties = {
  padding: "13px 14px",
  textAlign: "left",
  fontSize: "var(--fb-font-size-body-sm)",
  color: "var(--fb-color-text-strong)",
  borderTop: "1px solid var(--fb-color-border-subtle)",
  verticalAlign: "middle",
};

const TABLE_HEAD_CELL: CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: "var(--fb-font-size-caption)",
  fontWeight: "var(--fb-font-weight-bold)",
  color: "var(--fb-color-text-muted)",
  background: "var(--fb-color-surface-subtle)",
  whiteSpace: "nowrap",
};

/** Ẩn khỏi mắt nhưng vẫn đọc được bằng screen reader. */
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
};

/**
 * Bảng dữ liệu dạng `<table>` thật.
 *
 * Nó là `<table>` chứ không phải lưới div vì screen reader đọc được quan hệ
 * ô ↔ tiêu đề cột, và người dùng bàn phím điều hướng được theo hàng và cột —
 * hai thứ mà lưới div phải dựng lại bằng ARIA và thường dựng sai.
 *
 * Ô đầu mỗi hàng là `<th scope="row">`: nó là thứ định danh hàng, nên khi con
 * trỏ screen reader nhảy sang ô khác cùng hàng, nó được đọc kèm để người nghe
 * biết đang ở hàng nào.
 *
 * Component này **không** biết dữ liệu là thành viên, lời mời hay việc cần làm.
 * Quyết định "hàng này có nút nào" thuộc về feature gọi nó.
 */
export function FbDataTable({ caption, columns, rows, minWidth = 560 }: FbDataTableProps) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          minWidth,
          borderCollapse: "collapse",
          borderRadius: "var(--fb-radius-md)",
          overflow: "hidden",
          border: "1px solid var(--fb-color-border-default)",
        }}
      >
        <caption style={VISUALLY_HIDDEN}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" style={TABLE_HEAD_CELL}>
                {column.headerHidden === true ? (
                  <span style={VISUALLY_HIDDEN}>{column.header}</span>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {row.cells.map((cell, index) =>
                index === 0 ? (
                  <th
                    key={columns[index]?.key ?? String(index)}
                    scope="row"
                    style={{ ...TABLE_CELL, fontWeight: "var(--fb-font-weight-semibold)" }}
                  >
                    {cell}
                  </th>
                ) : (
                  <td key={columns[index]?.key ?? String(index)} style={TABLE_CELL}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
