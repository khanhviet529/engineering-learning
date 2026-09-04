"use client";

import type { ReactNode } from "react";

/**
 * Bảng thành viên dùng chung cho `WSP-03` và `PRM-01`.
 *
 * Nó nằm ở `features/members/` chứ không ở `components/shared/` vì nó là bề
 * mặt của một use case cụ thể — quản lý membership — và cả hai màn hình dùng
 * nó đều đưa vào những hành động phụ thuộc capability. Đặt ở `shared` sẽ mời
 * gọi việc dùng nó cho một danh sách bất kỳ, và rồi một hôm nào đó nó mọc thêm
 * prop cho một thứ không phải thành viên.
 *
 * Nó là `<table>` thật, không phải lưới div. Screen reader đọc được quan hệ ô
 * ↔ tiêu đề cột, và người dùng bàn phím điều hướng được theo hàng và cột —
 * hai thứ mà một lưới div phải dựng lại bằng ARIA và thường dựng sai.
 */

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  /** Badge vai trò; là ReactNode để chỗ gọi chọn đúng tone. */
  badge: ReactNode;
  /** Cột thứ ba: ngày tham gia, phạm vi, hoặc bất cứ thứ gì hợp đồng cho phép. */
  meta: ReactNode;
}

export interface MemberTableProps {
  caption: string;
  /** Đúng ba tiêu đề; cột hành động chỉ thêm khi `renderActions` có mặt. */
  columns: readonly [string, string, string];
  rows: readonly MemberRow[];
  renderActions?: ((row: MemberRow) => ReactNode) | undefined;
}

const CELL: React.CSSProperties = {
  padding: "13px 14px",
  textAlign: "left",
  fontSize: "var(--fb-font-size-body-sm)",
  color: "var(--fb-color-text-strong)",
  borderTop: "1px solid var(--fb-color-border-subtle)",
  verticalAlign: "middle",
};

const HEAD_CELL: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: "var(--fb-font-size-caption)",
  fontWeight: "var(--fb-font-weight-bold)",
  color: "var(--fb-color-text-muted)",
  background: "var(--fb-color-surface-subtle)",
  whiteSpace: "nowrap",
};

export function MemberTable({ caption, columns, rows, renderActions }: MemberTableProps) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          minWidth: 560,
          borderCollapse: "collapse",
          borderRadius: "var(--fb-radius-md)",
          overflow: "hidden",
          border: "1px solid var(--fb-color-border-default)",
        }}
      >
        {/* Caption là nhãn của bảng cho screen reader. Ẩn khỏi mắt vì tiêu đề
            khối phía trên đã nói điều đó cho người nhìn thấy. */}
        <caption
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
          }}
        >
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" style={HEAD_CELL}>
                {column}
              </th>
            ))}
            {renderActions !== undefined && (
              <th scope="col" style={HEAD_CELL}>
                Thao tác
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" style={{ ...CELL, fontWeight: "var(--fb-font-weight-semibold)" }}>
                <span style={{ display: "grid", gap: 2 }}>
                  {row.name}
                  <span
                    style={{
                      fontWeight: "var(--fb-font-weight-regular)",
                      color: "var(--fb-color-text-muted)",
                    }}
                  >
                    {row.email}
                  </span>
                </span>
              </th>
              <td style={CELL}>{row.badge}</td>
              <td style={{ ...CELL, color: "var(--fb-color-text-muted)" }}>{row.meta}</td>
              {renderActions !== undefined && <td style={CELL}>{renderActions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
