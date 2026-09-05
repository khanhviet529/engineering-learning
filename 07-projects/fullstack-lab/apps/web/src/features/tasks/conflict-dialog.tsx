"use client";

import { FbAlert, FbButtonPrimary, FbButtonSecondary, FbModal, FbSkeleton } from "@flowboard/ui";
import type { Task } from "@flowboard/contracts";
import { FailureState } from "../system/failure-state.tsx";
import { useTaskDetail } from "./queries.ts";
import { formatCalendarDate, PRIORITY_LABEL } from "./task-labels.ts";

/**
 * `SYS-04` — xử lý `409 TASK_VERSION_CONFLICT`.
 *
 * Quy tắc trung tâm, từ [đặc tả tương tác §5](../../../../../docs/design/interaction-specifications.md):
 * **không có nút ghi đè.** Không phải vì khó làm, mà vì một nút như vậy biến
 * một cảnh báo thành một cú bấm: người dùng thấy "có xung đột", bấm "ghi đè",
 * và thay đổi của người kia biến mất mà không ai đọc nó.
 *
 * Nên màn này chỉ có hai đường: bỏ bản nháp, hoặc nạp bản hiện tại rồi tự
 * quyết. Muốn lưu thì quay lại form trên version mới và gửi lại — và lần gửi
 * đó là một **ý định mới**: `expectedVersion` mới, `Idempotency-Key` mới. Giữ
 * key cũ sẽ phát lại đúng cái `409` đã lưu.
 */

export function ConflictDialog({
  taskId,
  draftSummary,
  onDiscardDraft,
  onEditCurrent,
}: {
  taskId: string;
  /** Tóm tắt những trường người dùng đã sửa, để họ biết mình đang giữ gì. */
  draftSummary: string;
  onDiscardDraft: () => void;
  /** Mở lại form trên bản hiện tại; chỗ gọi chịu trách nhiệm xoay `Intent`. */
  onEditCurrent: (task: Task) => void;
}) {
  const { detail, loading, failure, refetch } = useTaskDetail(taskId);

  return (
    <FbModal
      title="Công việc đã được thay đổi"
      subtitle="Phiên bản hiện tại và bản nháp của bạn"
      onRequestClose={onDiscardDraft}
      initialFocus="footer"
      footer={
        <>
          {/* Phương án an toàn đứng trước và nhận focus: bỏ bản nháp không phá
              dữ liệu của ai, còn mở form trên bản mới là bắt đầu một lần ghi. */}
          <FbButtonSecondary onClick={onDiscardDraft}>Bỏ bản nháp</FbButtonSecondary>
          <FbButtonPrimary
            disabled={detail === undefined}
            onClick={() => {
              if (detail !== undefined) onEditCurrent(detail.task);
            }}
          >
            Sửa trên bản hiện tại
          </FbButtonPrimary>
        </>
      }
    >
      <FbAlert
        intent="warning"
        title="Có người đã cập nhật công việc này."
        description="Bản nháp của bạn chưa được ghi đè lên dữ liệu mới."
      />

      <section style={{ display: "grid", gap: "var(--fb-space-2)" }}>
        <h3
          style={{
            margin: 0,
            fontSize: "var(--fb-font-size-body)",
            fontWeight: "var(--fb-font-weight-semibold)",
          }}
        >
          So sánh an toàn
        </h3>

        {/* Nạp bản hiện tại là một trạng thái **riêng** của SYS-04, không phải
            một khoảnh khắc trống: người dùng cần biết hệ thống đang đi lấy gì. */}
        {failure !== undefined ? (
          <FailureState failure={failure} onRetry={refetch} />
        ) : loading || detail === undefined ? (
          <FbSkeleton lines={2} label="Đang tải bản hiện tại của công việc" />
        ) : (
          <dl style={{ margin: 0, display: "grid", gap: "var(--fb-space-2)" }}>
            <Row
              term="Bản hiện tại"
              detailText={`v${String(detail.task.version)} · ${summarise(detail.task)}`}
            />
            <Row term="Bản nháp của bạn" detailText={draftSummary} />
          </dl>
        )}
      </section>

      <p
        style={{
          margin: 0,
          fontSize: "var(--fb-font-size-body-sm)",
          color: "var(--fb-color-text-muted)",
        }}
      >
        Không có nút ghi đè. Xem bản hiện tại, đối chiếu thay đổi của bạn, rồi lưu một phiên bản mới
        nếu còn quyền.
      </p>
    </FbModal>
  );
}

function Row({ term, detailText }: { term: string; detailText: string }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <dt
        style={{
          fontSize: "var(--fb-font-size-caption)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--fb-color-text-muted)",
        }}
      >
        {term}
      </dt>
      <dd
        style={{
          margin: 0,
          fontSize: "var(--fb-font-size-body-sm)",
          color: "var(--fb-color-text-primary)",
        }}
      >
        {detailText}
      </dd>
    </div>
  );
}

/**
 * Mô tả bản hiện tại bằng những trường **có trong payload**.
 *
 * Không đoán ai đã đổi và đổi gì: `taskSchema` không mang người sửa cuối, và
 * đặc tả tương tác cấm suy diễn field merge khi payload không cung cấp.
 */
function summarise(task: Task): string {
  const parts = [`Ưu tiên ${PRIORITY_LABEL[task.priority].toLowerCase()}`];
  const due = formatCalendarDate(task.dueDate);
  if (due !== undefined) parts.push(`hạn ${due}`);
  return parts.join(" · ");
}
