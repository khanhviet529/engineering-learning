"use client";

import { useEffect, useState } from "react";
import { FbButtonSecondary, FbSelect, FbTextField } from "@flowboard/ui";
import { DUE_STATES, type ProjectMember } from "@flowboard/contracts";
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS } from "./task-labels.ts";
import type { BoardFilters } from "./task-filters.ts";
import { canonicalFilters } from "./task-filters.ts";

/**
 * Điều khiển của `BRD-01`: tìm kiếm, lọc và sắp xếp.
 *
 * Mọi trục ở đây đều nằm trong allowlist của
 * `listTasksQuerySchema`. Không có ô "lọc nâng cao", không có toán tử, không
 * có tên trường do người dùng gõ — một trục lọc không có trong hợp đồng là một
 * `400` mà người dùng không hiểu, và về lâu dài là một đường dò dữ liệu.
 *
 * Viewer thấy đủ các điều khiển **đọc** này: lọc không phải là ghi. Cái Viewer
 * không thấy là CTA tạo công việc, và quyết định đó đến từ capability.
 */

const DUE_STATE_LABEL: Readonly<Record<(typeof DUE_STATES)[number], string>> = {
  none: "Không có hạn",
  scheduled: "Đã lên lịch",
  due_soon: "Sắp đến hạn",
  due_today: "Đến hạn hôm nay",
  overdue: "Quá hạn",
};

const SORT_OPTIONS = [
  { value: "position:asc", label: "Thứ tự thủ công" },
  { value: "dueDate:asc", label: "Hạn gần nhất trước" },
  { value: "dueDate:desc", label: "Hạn xa nhất trước" },
  { value: "createdAt:desc", label: "Mới tạo trước" },
  { value: "updatedAt:desc", label: "Vừa cập nhật trước" },
];

/** Nhãn của từng chip "đang lọc", để người dùng biết mình đang bỏ điều kiện nào. */
function chipLabel(
  key: keyof BoardFilters,
  value: string,
  members: readonly ProjectMember[],
): string {
  switch (key) {
    case "search":
      return `Tìm: ${value}`;
    case "assigneeId":
      return `Người thực hiện: ${members.find((m) => m.userId === value)?.displayName ?? value}`;
    case "createdById":
      return `Người tạo: ${members.find((m) => m.userId === value)?.displayName ?? value}`;
    case "category":
      return CATEGORY_OPTIONS.find((o) => o.value === value)?.label ?? value;
    case "priority":
      return `Ưu tiên: ${PRIORITY_OPTIONS.find((o) => o.value === value)?.label ?? value}`;
    case "dueState":
      return DUE_STATE_LABEL[value as (typeof DUE_STATES)[number]] ?? value;
    default:
      return SORT_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }
}

export function BoardToolbar({
  filters,
  onChange,
  members,
  createAction,
}: {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  members: readonly ProjectMember[];
  /** CTA tạo công việc; `undefined` khi actor thiếu `task:create`. */
  createAction?: React.ReactNode;
}) {
  // Ô tìm kiếm có state cục bộ và **debounce**: mỗi ký tự tạo một fingerprint
  // mới, tức là một query mới. Không hoãn lại thì một người gõ nhanh tự tạo ra
  // một vòng `429`, đúng thứ mà đặc tả tương tác §7 dặn tránh.
  const [search, setSearch] = useState(filters.search ?? "");
  useEffect(() => setSearch(filters.search ?? ""), [filters.search]);
  useEffect(() => {
    const current = filters.search ?? "";
    if (search === current) return;
    const timer = setTimeout(() => onChange({ ...filters, search }), 300);
    return () => clearTimeout(timer);
  }, [search, filters, onChange]);

  const memberOptions = [
    { value: "", label: "Tất cả" },
    ...members.map((member) => ({ value: member.userId, label: member.displayName })),
  ];

  const active = Object.entries(canonicalFilters(filters)).filter(([key]) => key !== "sort") as [
    keyof BoardFilters,
    string,
  ][];

  return (
    <div style={{ display: "grid", gap: "var(--fb-space-3)" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--fb-space-3)",
          alignItems: "flex-end",
        }}
      >
        <div style={{ minWidth: 220, flex: "1 1 220px" }}>
          <FbTextField
            id="board-search"
            label="Tìm công việc"
            value={search}
            onChange={setSearch}
            hint="Tìm trong tiêu đề hoặc mô tả công việc."
          />
        </div>

        <FbSelect
          id="filter-assignee"
          label="Người thực hiện"
          value={filters.assigneeId ?? ""}
          onChange={(value) => onChange({ ...filters, assigneeId: value })}
          options={memberOptions}
        />
        <FbSelect
          id="filter-created-by"
          label="Người tạo"
          value={filters.createdById ?? ""}
          onChange={(value) => onChange({ ...filters, createdById: value })}
          options={memberOptions}
        />
        <FbSelect
          id="filter-priority"
          label="Ưu tiên"
          value={filters.priority ?? ""}
          onChange={(value) =>
            onChange({ ...filters, priority: value === "" ? undefined : (value as never) })
          }
          options={[{ value: "", label: "Tất cả" }, ...PRIORITY_OPTIONS]}
        />
        <FbSelect
          id="filter-category"
          label="Nhóm công việc"
          value={filters.category ?? ""}
          onChange={(value) =>
            onChange({ ...filters, category: value === "" ? undefined : (value as never) })
          }
          options={[{ value: "", label: "Tất cả" }, ...CATEGORY_OPTIONS]}
        />
        <FbSelect
          id="filter-due-state"
          label="Hạn xử lý"
          value={filters.dueState ?? ""}
          onChange={(value) =>
            onChange({ ...filters, dueState: value === "" ? undefined : (value as never) })
          }
          options={[
            { value: "", label: "Tất cả" },
            ...DUE_STATES.map((value) => ({ value, label: DUE_STATE_LABEL[value] })),
          ]}
        />
        <FbSelect
          id="filter-sort"
          label="Sắp xếp"
          value={filters.sort ?? "position:asc"}
          onChange={(value) => onChange({ ...filters, sort: value as never })}
          options={SORT_OPTIONS}
        />

        {createAction !== undefined && <div style={{ marginLeft: "auto" }}>{createAction}</div>}
      </div>

      {active.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "var(--fb-space-2)",
          }}
        >
          <span
            style={{ fontSize: "var(--fb-font-size-caption)", color: "var(--fb-color-text-muted)" }}
          >
            Đang lọc:
          </span>
          {active.map(([key, value]) => (
            <FbButtonSecondary key={key} onClick={() => onChange({ ...filters, [key]: undefined })}>
              {`Bỏ lọc — ${chipLabel(key, value, members)}`}
            </FbButtonSecondary>
          ))}
        </div>
      )}
    </div>
  );
}
