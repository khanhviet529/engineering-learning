"use client";

import { useRef, useState } from "react";
import {
  FbAlert,
  FbButtonPrimary,
  FbButtonSecondary,
  FbDateField,
  FbModal,
  FbSelect,
  FbTextArea,
  FbTextField,
} from "@flowboard/ui";
import type {
  BoardColumn,
  CreateTaskRequest,
  ProjectMember,
  Task,
  UpdateTaskRequest,
} from "@flowboard/contracts";
import { Intent, fieldError, type ApiFailure } from "../../lib/transport.ts";
import { toFailure } from "../../lib/query.tsx";
import { messageFor } from "../system/messages.ts";
import { TASK_SAVE_ERROR } from "./messages.ts";
import { useCreateTask, useUpdateTask } from "./queries.ts";
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS } from "./task-labels.ts";

/**
 * `TSK-01` — biểu mẫu tạo và sửa công việc.
 *
 * Bốn ràng buộc của hợp đồng quyết định hình dạng form:
 *
 * 1. **Sửa luôn kèm `expectedVersion`.** Không có đường nào gửi patch mà không
 *    khai version mình đang thấy, nên `409 TASK_VERSION_CONFLICT` là câu trả
 *    lời bình thường và nó mở `SYS-04` chứ không hiện lỗi đỏ tại field.
 * 2. **Client không gửi `projectId`, `columnId` khi sửa, `position`, `version`,
 *    `createdBy`, `dueState` hay timestamp.** Chúng bị `400` chứ không bị bỏ
 *    qua, nên form không có chỗ nào để lỡ tay gửi chúng.
 * 3. **`evidenceUrl` chỉ nhận `https`.** Client kiểm sớm để phản hồi nhanh;
 *    server vẫn là quyết định cuối.
 * 4. **Reviewer chỉ bắt buộc khi cột đích `requiresReviewer`**, và phải là
 *    thành viên project khác người thực hiện.
 */

const FORM_ID = "task-form";

export interface TaskFormResult {
  task: Task;
}

interface Draft {
  title: string;
  description: string;
  columnId: string;
  assigneeId: string;
  reviewerId: string;
  category: string;
  priority: string;
  startDate: string;
  dueDate: string;
  evidenceUrl: string;
}

function draftFromTask(task: Task | undefined, fallbackColumnId: string): Draft {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    columnId: task?.columnId ?? fallbackColumnId,
    assigneeId: task?.assigneeId ?? "",
    reviewerId: task?.reviewerId ?? "",
    category: task?.category ?? "",
    priority: task?.priority ?? "none",
    startDate: task?.startDate ?? "",
    dueDate: task?.dueDate ?? "",
    evidenceUrl: task?.evidenceUrl ?? "",
  };
}

/** Lỗi client, kiểm sớm. Server vẫn là quyết định cuối cho mọi trường. */
export function validateDraft(
  draft: Draft,
  columns: readonly BoardColumn[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.title.trim() === "") errors["title"] = "Tiêu đề là bắt buộc.";
  if (draft.startDate !== "" && draft.dueDate !== "" && draft.startDate > draft.dueDate) {
    errors["dueDate"] = "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.";
  }
  if (draft.evidenceUrl.trim() !== "") {
    const value = draft.evidenceUrl.trim();
    let parsed: URL | undefined;
    try {
      parsed = new URL(value);
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || parsed.protocol !== "https:") {
      errors["evidenceUrl"] = "Liên kết bằng chứng phải là URL https đầy đủ.";
    } else if (value.length > 2048) {
      errors["evidenceUrl"] = "Liên kết bằng chứng không được dài quá 2048 ký tự.";
    }
  }
  const column = columns.find((item) => item.id === draft.columnId);
  if (column?.requiresReviewer === true && draft.reviewerId === "") {
    errors["reviewerId"] = `Cột “${column.name}” yêu cầu người kiểm duyệt.`;
  }
  if (draft.reviewerId !== "" && draft.reviewerId === draft.assigneeId) {
    errors["reviewerId"] = "Người kiểm duyệt phải khác người thực hiện.";
  }
  return errors;
}

const FIELD_LABEL: Readonly<Record<string, string>> = {
  title: "Tiêu đề",
  description: "Mô tả",
  columnId: "Trạng thái ban đầu",
  assigneeId: "Người thực hiện",
  reviewerId: "Người kiểm duyệt",
  category: "Nhóm công việc",
  priority: "Độ ưu tiên",
  startDate: "Ngày bắt đầu",
  dueDate: "Ngày kết thúc",
  evidenceUrl: "Liên kết bằng chứng",
};

export function TaskFormPanel({
  projectId,
  task,
  columns,
  members,
  defaultColumnId,
  onClose,
  onSaved,
  onConflict,
}: {
  projectId: string;
  /** `undefined` ⇒ tạo mới. Có giá trị ⇒ sửa, và `expectedVersion` đi kèm. */
  task?: Task | undefined;
  columns: readonly BoardColumn[];
  members: readonly ProjectMember[];
  defaultColumnId: string;
  onClose: () => void;
  onSaved: (task: Task) => void;
  /** `409`: giữ bản nháp và mở `SYS-04`. */
  onConflict: (failure: ApiFailure, draftSummary: string) => void;
}) {
  const editing = task !== undefined;
  const [draft, setDraft] = useState<Draft>(() => draftFromTask(task, defaultColumnId));
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const initial = useRef(draftFromTask(task, defaultColumnId));
  const intent = useRef(new Intent());
  const lastPayload = useRef("");

  const create = useCreateTask(projectId);
  const update = useUpdateTask(projectId);
  const mutation = editing ? update : create;
  const failure = toFailure(mutation.error);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  function errorFor(field: string): string | undefined {
    return clientErrors[field] ?? (failure === undefined ? undefined : fieldError(failure, field));
  }

  const summaryFields = Object.keys(clientErrors);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;

    const errors = validateDraft(draft, columns);
    setClientErrors(errors);
    setSubmitted(true);
    if (Object.keys(errors).length > 0) {
      document.getElementById(`task-${Object.keys(errors)[0] ?? "title"}`)?.focus();
      return;
    }

    const payload = JSON.stringify(draft);
    // Payload đổi ⇒ ý định mới ⇒ key mới. Gửi lại y nguyên vì lỗi mạng thì giữ
    // key: đó là toàn bộ lý do `Idempotency-Key` tồn tại.
    if (lastPayload.current !== "" && lastPayload.current !== payload) intent.current.rotate();
    lastPayload.current = payload;

    // `description` và `priority` **không** đi qua `orNull`: hai cột đó là
    // `NOT NULL` trong database và `taskSchema` trả chúng non-nullable, nên
    // `null` là một giá trị không đường nào tạo ra được. Trước đây client đổi
    // `"" → null` rồi server đổi ngược `null → ""` — hai phép quy đổi triệt
    // tiêu nhau, và chỗ nào phải quy đổi thầm là chỗ hợp đồng đang mô tả sai.
    // `priority` đã có `"none"` làm giá trị "chưa đặt".
    const orNull = (value: string) => (value === "" ? null : value);

    if (editing) {
      const body: UpdateTaskRequest = {
        expectedVersion: task.version,
        title: draft.title.trim(),
        description: draft.description,
        assigneeId: orNull(draft.assigneeId),
        reviewerId: orNull(draft.reviewerId),
        category: orNull(draft.category) as never,
        priority: draft.priority as never,
        startDate: orNull(draft.startDate),
        dueDate: orNull(draft.dueDate),
        evidenceUrl: orNull(draft.evidenceUrl.trim()),
      };
      update.mutate(
        { taskId: task.id, body, intent: intent.current },
        {
          onSuccess: (data) => onSaved(data.task),
          onError: (error) => {
            const apiFailure = toFailure(error);
            if (apiFailure?.code === "TASK_VERSION_CONFLICT") {
              onConflict(apiFailure, describeDraft(draft, initial.current));
            }
          },
        },
      );
      return;
    }

    const body: CreateTaskRequest = {
      title: draft.title.trim(),
      description: draft.description,
      columnId: draft.columnId,
      assigneeId: orNull(draft.assigneeId),
      reviewerId: orNull(draft.reviewerId),
      category: orNull(draft.category) as never,
      priority: draft.priority as never,
      startDate: orNull(draft.startDate),
      dueDate: orNull(draft.dueDate),
      evidenceUrl: orNull(draft.evidenceUrl.trim()),
    };
    create.mutate({ body, intent: intent.current }, { onSuccess: (data) => onSaved(data.task) });
  }

  function requestClose() {
    if (dirty && !mutation.isPending) {
      setConfirmingDiscard(true);
      return;
    }
    if (!mutation.isPending) onClose();
  }

  const memberOptions = [
    { value: "", label: "Chưa giao" },
    ...members.map((member) => ({ value: member.userId, label: member.displayName })),
  ];
  const selectedColumn = columns.find((column) => column.id === draft.columnId);

  return (
    <FbModal
      title={editing ? "Sửa công việc" : "Tạo công việc"}
      subtitle={
        editing
          ? `Phiên bản hiện tại v${String(task.version)} · lưu sẽ tạo phiên bản mới`
          : "Công việc mới được thêm vào cột bạn chọn"
      }
      onRequestClose={requestClose}
      closeDisabled={mutation.isPending}
      {...(confirmingDiscard ? { initialFocus: "footer" as const } : {})}
      footer={
        confirmingDiscard ? (
          <>
            <FbButtonSecondary onClick={() => setConfirmingDiscard(false)}>
              Tiếp tục chỉnh sửa
            </FbButtonSecondary>
            <FbButtonPrimary onClick={onClose}>Bỏ thay đổi</FbButtonPrimary>
          </>
        ) : (
          <>
            <FbButtonSecondary onClick={requestClose} disabled={mutation.isPending}>
              Hủy
            </FbButtonSecondary>
            <FbButtonPrimary type="submit" form={FORM_ID} loading={mutation.isPending}>
              {editing ? "Lưu công việc" : "Tạo công việc"}
            </FbButtonPrimary>
          </>
        )
      }
    >
      {confirmingDiscard && (
        <FbAlert
          intent="warning"
          title="Thay đổi chưa được lưu"
          description="Đóng bây giờ sẽ bỏ những gì bạn vừa nhập. Không có tự động lưu."
        />
      )}

      <form
        id={FORM_ID}
        onSubmit={handleSubmit}
        noValidate
        style={{ display: "grid", gap: "var(--fb-space-4)" }}
      >
        {/* Tóm tắt lỗi: liên kết đưa focus tới đúng field, và **không** thay
            thế lỗi tại từng field — đúng ghi chú trên frame `error-summary`. */}
        {submitted && summaryFields.length > 0 && (
          <div
            role="alert"
            style={{
              display: "grid",
              gap: "var(--fb-space-1)",
              padding: "var(--fb-space-3)",
              borderRadius: "var(--fb-radius-md)",
              border: "1px solid var(--fb-color-intent-danger-border)",
              background: "var(--fb-color-intent-danger-subtle)",
              color: "var(--fb-color-intent-danger-text)",
            }}
          >
            <strong style={{ fontSize: "var(--fb-font-size-body-sm)" }}>
              {`Không gửi được biểu mẫu — ${String(summaryFields.length)} trường cần sửa`}
            </strong>
            <ul style={{ margin: 0, paddingLeft: "var(--fb-space-5)" }}>
              {summaryFields.map((field) => (
                <li key={field} style={{ fontSize: "var(--fb-font-size-body-sm)" }}>
                  <button
                    type="button"
                    onClick={() => document.getElementById(`task-${field}`)?.focus()}
                    style={{
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      font: "inherit",
                      color: "inherit",
                      textDecoration: "underline",
                    }}
                  >
                    {`${FIELD_LABEL[field] ?? field}: ${clientErrors[field] ?? ""}`}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {failure !== undefined &&
          failure.code !== "VALIDATION_FAILED" &&
          failure.code !== "TASK_VERSION_CONFLICT" && (
            <FbAlert
              intent="error"
              title={messageFor(TASK_SAVE_ERROR, failure)}
              description={`Mã tra cứu: ${failure.requestId}`}
            />
          )}

        <FbTextField
          id="task-title"
          label={FIELD_LABEL["title"] as string}
          value={draft.title}
          onChange={(value) => set({ title: value })}
          required
          error={errorFor("title")}
          disabled={mutation.isPending}
        />

        <FbTextArea
          id="task-description"
          label={FIELD_LABEL["description"] as string}
          value={draft.description}
          onChange={(value) => set({ description: value })}
          rows={3}
          maxLength={10_000}
          error={errorFor("description")}
          disabled={mutation.isPending}
        />

        {!editing && (
          // Cột chỉ chọn được lúc **tạo**: `PATCH /tasks/:taskId` từ chối
          // `columnId`, vì đổi cột là `POST /tasks/:taskId/move` — một use case
          // riêng có concurrency check của nó.
          <FbSelect
            id="task-columnId"
            label={FIELD_LABEL["columnId"] as string}
            value={draft.columnId}
            onChange={(value) => set({ columnId: value })}
            options={columns.map((column) => ({ value: column.id, label: column.name }))}
            error={errorFor("columnId")}
            disabled={mutation.isPending}
          />
        )}

        <FbSelect
          id="task-assigneeId"
          label={FIELD_LABEL["assigneeId"] as string}
          value={draft.assigneeId}
          onChange={(value) => set({ assigneeId: value })}
          options={memberOptions}
          error={errorFor("assigneeId")}
          disabled={mutation.isPending}
        />

        <FbSelect
          id="task-priority"
          label={FIELD_LABEL["priority"] as string}
          value={draft.priority}
          onChange={(value) => set({ priority: value })}
          options={PRIORITY_OPTIONS}
          error={errorFor("priority")}
          disabled={mutation.isPending}
        />

        <FbSelect
          id="task-category"
          label={FIELD_LABEL["category"] as string}
          value={draft.category}
          onChange={(value) => set({ category: value })}
          options={[{ value: "", label: "Chưa phân nhóm" }, ...CATEGORY_OPTIONS]}
          error={errorFor("category")}
          disabled={mutation.isPending}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--fb-space-3)" }}>
          <div style={{ flex: "1 1 160px" }}>
            <FbDateField
              id="task-startDate"
              label={FIELD_LABEL["startDate"] as string}
              value={draft.startDate}
              onChange={(value) => set({ startDate: value })}
              error={errorFor("startDate")}
              disabled={mutation.isPending}
            />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <FbDateField
              id="task-dueDate"
              label={FIELD_LABEL["dueDate"] as string}
              value={draft.dueDate}
              onChange={(value) => set({ dueDate: value })}
              error={errorFor("dueDate")}
              disabled={mutation.isPending}
            />
          </div>
        </div>

        <FbSelect
          id="task-reviewerId"
          label={FIELD_LABEL["reviewerId"] as string}
          value={draft.reviewerId}
          onChange={(value) => set({ reviewerId: value })}
          options={memberOptions}
          hint={
            selectedColumn?.requiresReviewer === true
              ? `Cột “${selectedColumn.name}” yêu cầu người kiểm duyệt, và người đó phải khác người thực hiện.`
              : "Chỉ bắt buộc khi công việc vào một cột yêu cầu kiểm duyệt."
          }
          error={errorFor("reviewerId")}
          disabled={mutation.isPending}
        />

        <FbTextField
          id="task-evidenceUrl"
          label={FIELD_LABEL["evidenceUrl"] as string}
          value={draft.evidenceUrl}
          onChange={(value) => set({ evidenceUrl: value })}
          hint="Chỉ nhận liên kết https. Flowboard không tải trước nội dung của liên kết."
          error={errorFor("evidenceUrl")}
          disabled={mutation.isPending}
        />
      </form>
    </FbModal>
  );
}

/** Mô tả ngắn bản nháp, để `SYS-04` nói được người dùng đang giữ thay đổi gì. */
function describeDraft(draft: Draft, initial: Draft): string {
  const changes: string[] = [];
  for (const key of Object.keys(draft) as (keyof Draft)[]) {
    if (draft[key] === initial[key]) continue;
    changes.push(FIELD_LABEL[key] ?? key);
  }
  return changes.length === 0 ? "Không có thay đổi nào" : changes.join(", ");
}
