"use client";

import { useEffect, useRef, useState } from "react";
import {
  FbAlert,
  FbButtonPrimary,
  FbButtonSecondary,
  FbModal,
  FbStatePanel,
  FbTextField,
  FbToggle,
} from "@flowboard/ui";
import type { BoardColumn } from "@flowboard/contracts";
import { Intent, fieldError, type ApiFailure } from "../../lib/transport.ts";
import { toFailure } from "../../lib/query.tsx";
import { useCreateColumn, useReorderColumns, useUpdateColumn } from "./queries.ts";
import { activeColumns, moveColumn, reconcileOrder, sameOrder } from "./column-order.ts";

/**
 * `BRD-02` — Column Editor, lớp phủ Owner-only trên `BRD-01`.
 *
 * Hình dạng của màn này bị hợp đồng quyết định gần như hoàn toàn:
 *
 * - `PATCH /columns/:columnId` nhận **đúng một** command. Nên đổi tên, cờ kết
 *   thúc, yêu cầu người duyệt và lưu trữ là **bốn nút khác nhau**, mỗi nút một
 *   request. Không có nút "Lưu" gom cả hàng: một form như vậy sẽ gửi một body
 *   mà server chắc chắn trả `400`.
 * - `POST /columns/reorder` nhận **toàn bộ** active column, mỗi ID một lần.
 *   Nên thứ tự được sắp trên một bản nháp rồi gửi **một** lần, chứ không phải
 *   một request cho mỗi lần kéo.
 *
 * Vì thứ tự là bản nháp nên màn này có trạng thái `unsaved changes` — đúng
 * trạng thái mà [screen-inventory](../../../../../docs/design/screen-inventory.md)
 * liệt kê cho `BRD-02`.
 */

const ADD_FORM_ID = "board-column-add-form";

const TERMINAL_HINT =
  "Cột kết thúc đánh dấu công việc đã xong. Đổi cờ này chỉ đổi cách suy trạng thái từ lúc đổi trở đi; công việc đang nằm trong cột không bị viết lại.";

const REVIEWER_HINT =
  "Yêu cầu người duyệt chỉ áp cho các lần tạo và chuyển công việc sau đó. Công việc đang ở trong cột giữ nguyên, kể cả khi chưa có người duyệt.";

const ARCHIVE_BLOCKED =
  "Không thể lưu trữ cột còn công việc. Hãy chuyển hoặc hoàn tất các công việc trước.";

export function ColumnEditorPanel({
  projectId,
  columns,
  canManage,
  onClose,
}: {
  projectId: string;
  columns: readonly BoardColumn[];
  canManage: boolean;
  onClose: () => void;
}) {
  // Deep link tới `?panel=columns` vẫn tới được đây với Editor và Viewer: ẩn
  // CTA không phải là phân quyền. Lớp phủ mở ra và nói `403` — nó không im
  // lặng, và cũng không lộ cấu hình cột cho người không có quyền quản lý.
  if (!canManage) {
    return (
      <FbModal title="Quản lý cột" onRequestClose={onClose}>
        <FbStatePanel
          state="forbidden"
          title="Vai trò hiện tại của bạn không cấu hình được cột"
          description="Chỉ Owner của dự án đổi được cột của bảng. Bảng công việc vẫn mở bình thường phía sau."
          action={<FbButtonSecondary onClick={onClose}>Về bảng công việc</FbButtonSecondary>}
        />
      </FbModal>
    );
  }

  return <ColumnEditorForm projectId={projectId} columns={columns} onClose={onClose} />;
}

function ColumnEditorForm({
  projectId,
  columns,
  onClose,
}: {
  projectId: string;
  columns: readonly BoardColumn[];
  onClose: () => void;
}) {
  const active = activeColumns(columns);
  const serverIds = active.map((column) => column.id);
  const byId = new Map(active.map((column) => [column.id, column]));

  const [order, setOrder] = useState<string[]>(serverIds);
  const [lifted, setLifted] = useState<string | null>(null);
  const liftSnapshot = useRef<string[] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const reorder = useReorderColumns(projectId);
  const reorderFailure = toFailure(reorder.error);
  // `Intent` của **một ý định sắp xếp**. Gửi lại y nguyên sau lỗi mạng giữ
  // nguyên key; sắp sang thứ tự khác rồi gửi là một ý định mới, nên xoay.
  const reorderIntent = useRef(new Intent());
  const lastSubmitted = useRef<string[] | null>(null);

  const serverKey = serverIds.join("|");
  useEffect(() => {
    setOrder((current) => {
      const next = reconcileOrder(current, serverKey === "" ? [] : serverKey.split("|"));
      return sameOrder(current, next) ? current : next;
    });
  }, [serverKey]);

  const dirty = !sameOrder(order, serverIds);

  function announce(message: string) {
    setAnnouncement(message);
  }

  function applyMove(from: number, to: number) {
    const id = order[from];
    if (id === undefined) return;
    const next = moveColumn(order, from, to);
    if (sameOrder(next, order)) return;
    setOrder(next);
    announce(
      `${byId.get(id)?.name ?? "Cột"} chuyển tới vị trí ${String(to + 1)} trên ${String(next.length)}.`,
    );
  }

  function toggleLift(id: string) {
    const index = order.indexOf(id);
    if (lifted === id) {
      setLifted(null);
      liftSnapshot.current = null;
      announce(
        `Đã đặt ${byId.get(id)?.name ?? "cột"} ở vị trí ${String(index + 1)}. Bấm Lưu thứ tự cột để gửi.`,
      );
      return;
    }
    setLifted(id);
    liftSnapshot.current = [...order];
    announce(
      `Đã nhấc ${byId.get(id)?.name ?? "cột"}. Vị trí ${String(index + 1)} trên ${String(order.length)}. Dùng mũi tên lên xuống để chuyển, Space để đặt, Escape để hủy.`,
    );
  }

  function cancelLift(id: string) {
    const snapshot = liftSnapshot.current;
    setLifted(null);
    liftSnapshot.current = null;
    if (snapshot !== null) setOrder(snapshot);
    announce(`Đã hủy. ${byId.get(id)?.name ?? "Cột"} trở lại vị trí cũ.`);
  }

  function submitOrder() {
    if (!dirty || reorder.isPending) return;
    // Payload đổi so với lần gửi trước ⇒ ý định mới ⇒ key mới. Gửi lại y
    // nguyên (retry vì lỗi vận chuyển) thì giữ key, đó là lý do key tồn tại.
    if (lastSubmitted.current !== null && !sameOrder(lastSubmitted.current, order)) {
      reorderIntent.current.rotate();
    }
    lastSubmitted.current = [...order];

    reorder.mutate(
      { orderedColumnIds: [...order], intent: reorderIntent.current },
      {
        onSuccess: () => announce("Đã lưu thứ tự cột."),
        onError: () => {
          // Không để giao diện hiển thị một thứ tự server đã từ chối: quay về
          // thứ tự server đang giữ, rồi nói ra điều đó.
          setOrder(serverIds);
          announce("Không lưu được thứ tự cột. Danh sách đã trở lại thứ tự đang lưu trên máy chủ.");
        },
      },
    );
  }

  function requestClose() {
    if (dirty) {
      setConfirmingDiscard(true);
      return;
    }
    onClose();
  }

  return (
    <FbModal
      title="Quản lý cột"
      subtitle="Chỉ Owner cấu hình được cột của dự án. Đổi tên, cờ và lưu trữ áp dụng ngay; thứ tự chỉ gửi khi bạn bấm lưu."
      onRequestClose={requestClose}
      // Đang nhấc một cột thì `Escape` thuộc về thao tác đó, không thuộc lớp
      // phủ — đúng quy tắc ở đặc tả tương tác §8: `Escape` chỉ đóng khi nó
      // không bỏ qua một thao tác đã chọn. `FbModal` nhìn cờ này để nhường phím.
      closeDisabled={reorder.isPending || lifted !== null}
      footer={
        confirmingDiscard ? (
          <>
            {/* Phương án an toàn đứng trước và nhận focus mặc định. */}
            <FbButtonSecondary onClick={() => setConfirmingDiscard(false)}>
              Tiếp tục chỉnh sửa
            </FbButtonSecondary>
            <FbButtonPrimary onClick={onClose}>Bỏ thay đổi thứ tự</FbButtonPrimary>
          </>
        ) : (
          <>
            <FbButtonSecondary onClick={requestClose} disabled={reorder.isPending}>
              Hủy
            </FbButtonSecondary>
            <FbButtonPrimary onClick={submitOrder} disabled={!dirty} loading={reorder.isPending}>
              Lưu thứ tự cột
            </FbButtonPrimary>
          </>
        )
      }
    >
      <div style={{ display: "grid", gap: "var(--fb-space-4)" }}>
        {/* Một vùng công bố duy nhất cho cả panel: nhấc, chuyển, đặt, hủy và
            kết quả gửi. Nhiều vùng sẽ đọc chồng lên nhau. */}
        <p
          role="status"
          aria-live="polite"
          style={{
            margin: 0,
            fontSize: "var(--fb-font-size-caption)",
            color: "var(--fb-color-text-muted)",
          }}
        >
          {announcement}
        </p>

        {confirmingDiscard && (
          <FbAlert
            intent="warning"
            title="Thứ tự cột chưa được lưu"
            description="Đóng bây giờ sẽ bỏ thứ tự bạn vừa sắp. Đổi tên, cờ và lưu trữ thì đã được gửi rồi."
          />
        )}

        {reorderFailure !== undefined && (
          <FbAlert
            intent="error"
            title={reorderFailure.message}
            description={`Mã tra cứu: ${reorderFailure.requestId}`}
          />
        )}

        <AddColumnForm projectId={projectId} afterColumnId={order[order.length - 1] ?? null} />

        {order.length === 0 ? (
          <FbAlert
            intent="info"
            title="Chưa có cột nào"
            description="Thêm cột đầu tiên ở trên để bảng công việc bắt đầu dùng được."
          />
        ) : (
          <ol
            aria-label="Thứ tự cột"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "var(--fb-space-3)",
            }}
          >
            {order.map((id, index) => {
              const column = byId.get(id);
              if (column === undefined) return null;
              return (
                <ColumnRow
                  key={id}
                  projectId={projectId}
                  column={column}
                  index={index}
                  total={order.length}
                  lifted={lifted === id}
                  onToggleLift={() => toggleLift(id)}
                  onCancelLift={() => cancelLift(id)}
                  onMove={(to) => applyMove(index, to)}
                />
              );
            })}
          </ol>
        )}
      </div>
    </FbModal>
  );
}

/**
 * Một hàng cột.
 *
 * Mỗi hành động là một request riêng và có `Intent` riêng: đổi tên cột này
 * không phải cùng một ý định với bật cờ của nó, nên chúng không dùng chung
 * `Idempotency-Key`.
 */
function ColumnRow({
  projectId,
  column,
  index,
  total,
  lifted,
  onToggleLift,
  onCancelLift,
  onMove,
}: {
  projectId: string;
  column: BoardColumn;
  index: number;
  total: number;
  lifted: boolean;
  onToggleLift: () => void;
  onCancelLift: () => void;
  onMove: (to: number) => void;
}) {
  const [name, setName] = useState(column.name);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const gripRef = useRef<HTMLButtonElement>(null);

  /**
   * Lấy lại focus sau mỗi lần cột đổi vị trí.
   *
   * React sắp lại danh sách bằng `insertBefore`, tức là gỡ nút ra khỏi cây rồi
   * chèn lại — và một phần tử rời khỏi cây thì mất focus. Không lấy lại thì
   * mũi tên thứ hai rơi vào `body`, và `Escape` rơi xuống lớp phủ: người dùng
   * bàn phím chuyển được đúng **một** bậc rồi mất luôn thao tác đang dở.
   */
  useEffect(() => {
    if (lifted) gripRef.current?.focus();
  }, [lifted, index]);

  const rename = useUpdateColumn(projectId);
  const terminal = useUpdateColumn(projectId);
  const reviewer = useUpdateColumn(projectId);
  const archive = useUpdateColumn(projectId);

  const renameIntent = useRef(new Intent());
  const renameSubmitted = useRef<string | undefined>(undefined);
  const terminalIntent = useRef(new Intent());
  const reviewerIntent = useRef(new Intent());
  const archiveIntent = useRef(new Intent());

  // Server xác nhận tên mới ⇒ đó là giá trị gốc mới của ô nhập.
  useEffect(() => setName(column.name), [column.name]);

  const renameFailure = toFailure(rename.error);
  const archiveFailure = toFailure(archive.error);
  // `409 COLUMN_NOT_EMPTY` không phải version conflict: tải lại rồi gửi lại
  // không giải quyết gì. Việc phải làm nằm ở nơi khác — dời công việc ra khỏi
  // cột — nên nút này bị khóa thay vì mời người dùng thử lại.
  const archiveBlocked = archiveFailure?.code === "COLUMN_NOT_EMPTY";
  const rowFailure = firstFailure([rename, terminal, reviewer, archive]);

  function submitRename() {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === column.name || rename.isPending) return;
    if (renameSubmitted.current !== undefined && renameSubmitted.current !== trimmed) {
      renameIntent.current.rotate();
    }
    renameSubmitted.current = trimmed;
    rename.mutate({
      columnId: column.id,
      command: { name: trimmed },
      intent: renameIntent.current,
    });
  }

  return (
    <li
      style={{
        display: "grid",
        gap: "var(--fb-space-3)",
        padding: "var(--fb-space-4)",
        borderRadius: "var(--fb-radius-md)",
        border: `1px solid ${lifted ? "var(--fb-color-state-focus-ring)" : "var(--fb-color-border-default)"}`,
        background: lifted ? "var(--fb-color-surface-subtle)" : "var(--fb-color-surface-raised)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--fb-space-3)" }}>
        <button
          ref={gripRef}
          type="button"
          aria-label={`Sắp xếp cột ${column.name}, vị trí ${String(index + 1)} trên ${String(total)}`}
          aria-pressed={lifted}
          onClick={onToggleLift}
          onKeyDown={(event) => {
            if (event.key === "Escape" && lifted) {
              // Chặn `Escape` tới lớp phủ: ở đây nó hủy lần nhấc, không đóng
              // panel. Đóng panel giữa một thao tác đang dở là mất cả hai.
              event.stopPropagation();
              event.preventDefault();
              onCancelLift();
              return;
            }
            if (!lifted) return;
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onMove(index - 1);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              onMove(index + 1);
            }
          }}
          style={{
            flex: "0 0 auto",
            width: 32,
            height: 40,
            cursor: "grab",
            borderRadius: "var(--fb-radius-sm)",
            border: "1px solid var(--fb-color-border-default)",
            background: "var(--fb-color-surface-subtle)",
            color: "var(--fb-color-text-muted)",
            fontSize: "var(--fb-font-size-body)",
          }}
        >
          <span aria-hidden="true">⠿</span>
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <FbTextField
            id={`column-name-${column.id}`}
            label={`Tên cột ${String(index + 1)}`}
            value={name}
            onChange={setName}
            disabled={rename.isPending}
            error={renameFailure === undefined ? undefined : fieldError(renameFailure, "name")}
          />
        </div>

        <FbButtonSecondary
          onClick={submitRename}
          loading={rename.isPending}
          disabled={name.trim() === "" || name.trim() === column.name}
        >
          Đổi tên
        </FbButtonSecondary>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--fb-space-4)",
          alignItems: "flex-start",
        }}
      >
        <FbToggle
          id={`column-terminal-${column.id}`}
          label="Cột kết thúc"
          hint={TERMINAL_HINT}
          checked={column.isTerminal}
          disabled={terminal.isPending}
          onChange={(next) => {
            terminalIntent.current.rotate();
            terminal.mutate({
              columnId: column.id,
              command: { isTerminal: next },
              intent: terminalIntent.current,
            });
          }}
        />
        <FbToggle
          id={`column-reviewer-${column.id}`}
          label="Cần người duyệt"
          hint={REVIEWER_HINT}
          checked={column.requiresReviewer}
          disabled={reviewer.isPending}
          onChange={(next) => {
            reviewerIntent.current.rotate();
            reviewer.mutate({
              columnId: column.id,
              command: { requiresReviewer: next },
              intent: reviewerIntent.current,
            });
          }}
        />

        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--fb-space-2)" }}>
          {confirmingArchive ? (
            <>
              <FbButtonSecondary onClick={() => setConfirmingArchive(false)}>
                Giữ cột
              </FbButtonSecondary>
              <FbButtonPrimary
                loading={archive.isPending}
                disabled={archiveBlocked}
                onClick={() =>
                  archive.mutate(
                    {
                      columnId: column.id,
                      command: { archive: true },
                      intent: archiveIntent.current,
                    },
                    { onSuccess: () => setConfirmingArchive(false) },
                  )
                }
              >
                Lưu trữ cột
              </FbButtonPrimary>
            </>
          ) : (
            <FbButtonSecondary onClick={() => setConfirmingArchive(true)} disabled={archiveBlocked}>
              Lưu trữ
            </FbButtonSecondary>
          )}
        </div>
      </div>

      {confirmingArchive && !archiveBlocked && (
        <p style={{ margin: 0, fontSize: "var(--fb-font-size-body-sm)" }}>
          Lưu trữ đưa cột ra khỏi bảng. Bản MVP chưa có đường hoàn tác.
        </p>
      )}

      {archiveBlocked ? (
        // Chữ nói **việc cần làm trước**, và không có nút nào ở đây cả. Một CTA
        // "dời công việc giúp tôi" sẽ là ngõ cụt: server cố ý không làm việc
        // đó, nên không có endpoint nào đứng sau nút ấy.
        <FbAlert intent="warning" title={ARCHIVE_BLOCKED} />
      ) : (
        rowFailure !== undefined &&
        rowFailure.code !== "VALIDATION_FAILED" && (
          <FbAlert
            intent="error"
            title={rowFailure.message}
            description={`Mã tra cứu: ${rowFailure.requestId}`}
          />
        )
      )}
    </li>
  );
}

/** Lỗi đầu tiên trong số các mutation của một hàng; hàng chỉ hiện một lỗi. */
function firstFailure(mutations: readonly { error: unknown }[]): ApiFailure | undefined {
  for (const mutation of mutations) {
    const failure = toFailure(mutation.error);
    if (failure !== undefined) return failure;
  }
  return undefined;
}

/**
 * Thêm cột.
 *
 * `afterColumnId` là cột cuối cùng đang hoạt động: cột mới nối vào cuối quy
 * trình. Client không gửi `position` — server tính fractional position, và đó
 * là lý do reorder không thể trở thành một bulk update.
 */
function AddColumnForm({
  projectId,
  afterColumnId,
}: {
  projectId: string;
  afterColumnId: string | null;
}) {
  const [name, setName] = useState("");
  const [isTerminal, setIsTerminal] = useState(false);
  const [requiresReviewer, setRequiresReviewer] = useState(false);
  const submitted = useRef<string | undefined>(undefined);
  const intent = useRef(new Intent());
  const create = useCreateColumn(projectId);
  const failure = toFailure(create.error);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || create.isPending) return;

    const payload = `${trimmed}|${String(isTerminal)}|${String(requiresReviewer)}|${afterColumnId ?? ""}`;
    if (submitted.current !== undefined && submitted.current !== payload) intent.current.rotate();
    submitted.current = payload;

    create.mutate(
      {
        body: { name: trimmed, afterColumnId, isTerminal, requiresReviewer },
        intent: intent.current,
      },
      {
        onSuccess: () => {
          setName("");
          setIsTerminal(false);
          setRequiresReviewer(false);
          intent.current.rotate();
          submitted.current = undefined;
        },
      },
    );
  }

  return (
    <form
      id={ADD_FORM_ID}
      onSubmit={handleSubmit}
      noValidate
      style={{
        display: "grid",
        gap: "var(--fb-space-3)",
        padding: "var(--fb-space-4)",
        borderRadius: "var(--fb-radius-md)",
        border: "1px dashed var(--fb-color-border-default)",
      }}
    >
      {failure !== undefined && failure.code !== "VALIDATION_FAILED" && (
        <FbAlert
          intent="error"
          title={failure.message}
          description={`Mã tra cứu: ${failure.requestId}`}
        />
      )}

      <FbTextField
        id="new-column-name"
        label="Tên cột mới"
        value={name}
        onChange={setName}
        required
        hint="Cột mới được thêm vào cuối quy trình."
        error={failure === undefined ? undefined : fieldError(failure, "name")}
        disabled={create.isPending}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--fb-space-4)" }}>
        <FbToggle
          id="new-column-terminal"
          label="Cột kết thúc"
          hint={TERMINAL_HINT}
          checked={isTerminal}
          onChange={setIsTerminal}
          disabled={create.isPending}
        />
        <FbToggle
          id="new-column-reviewer"
          label="Cần người duyệt"
          hint={REVIEWER_HINT}
          checked={requiresReviewer}
          onChange={setRequiresReviewer}
          disabled={create.isPending}
        />
      </div>

      <div>
        <FbButtonPrimary type="submit" loading={create.isPending} disabled={name.trim() === ""}>
          Thêm cột
        </FbButtonPrimary>
      </div>
    </form>
  );
}
