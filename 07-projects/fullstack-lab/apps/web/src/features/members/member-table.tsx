"use client";

import type { ReactNode } from "react";
import { FbDataTable, type FbDataTableColumn, type FbDataTableRow } from "@flowboard/ui";

/**
 * Bảng thành viên dùng chung cho `WSP-03` và `PRM-01`.
 *
 * Nó nằm ở `features/members/` chứ không ở `components/shared/` vì nó là bề
 * mặt của một use case cụ thể — quản lý membership — và cả hai màn hình dùng
 * nó đều đưa vào những hành động phụ thuộc capability. Đặt ở `shared` sẽ mời
 * gọi việc dùng nó cho một danh sách bất kỳ, và rồi một hôm nào đó nó mọc thêm
 * prop cho một thứ không phải thành viên.
 *
 * Phần `<table>` — ngữ nghĩa bảng, tiêu đề hàng, cuộn ngang — nằm ở
 * `FbDataTable` trong `@flowboard/ui`, vì đó là thứ không biết gì về thành
 * viên và các màn hình khác cũng cần. Tệp này chỉ còn giữ **hình dạng một
 * hàng thành viên**.
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

export function MemberTable({ caption, columns, rows, renderActions }: MemberTableProps) {
  const tableColumns: FbDataTableColumn[] = columns.map((header, index) => ({
    key: `col-${String(index)}`,
    header,
  }));
  if (renderActions !== undefined) tableColumns.push({ key: "actions", header: "Thao tác" });

  const tableRows: FbDataTableRow[] = rows.map((row) => ({
    id: row.id,
    cells: [
      <span key="who" style={{ display: "grid", gap: 2 }}>
        {row.name}
        <span
          style={{
            fontWeight: "var(--fb-font-weight-regular)",
            color: "var(--fb-color-text-muted)",
          }}
        >
          {row.email}
        </span>
      </span>,
      row.badge,
      <span key="meta" style={{ color: "var(--fb-color-text-muted)" }}>
        {row.meta}
      </span>,
      ...(renderActions === undefined ? [] : [renderActions(row)]),
    ],
  }));

  return <FbDataTable caption={caption} columns={tableColumns} rows={tableRows} />;
}
