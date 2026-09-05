"use client";

import { useRef, useState } from "react";
import {
  FbActivityItem,
  FbAlert,
  FbBadge,
  FbButtonPrimary,
  FbButtonSecondary,
  FbDrawer,
  FbDueBadge,
  FbSkeleton,
  FbTabs,
  FbTextArea,
} from "@flowboard/ui";
import { COMMENT_BODY_MAX_LENGTH, type Comment, type Task } from "@flowboard/contracts";
import { FailureState } from "../system/failure-state.tsx";
import { can } from "../authorization/can.ts";
import { Intent } from "../../lib/transport.ts";
import { toFailure } from "../../lib/query.tsx";
import { useCreateComment, useTaskActivity, useTaskDetail } from "./queries.ts";
import { renderCommentBody, safeLinkHref } from "./markdown.tsx";
import {
  categoryLabel,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  activityIcon,
  formatCalendarDate,
  formatInstant,
} from "./task-labels.ts";

/**
 * `TSK-02` — chi tiết công việc.
 *
 * Ba ranh giới:
 *
 * - **Capability quyết định affordance.** `capabilities` đi kèm chính response
 *   của task, nên `can` đọc từ đó chứ không từ vai trò suy ra ở client. Viewer
 *   đọc được bình luận nhưng không có ô soạn — đúng ma trận vai trò.
 * - **Bình luận là văn bản thuần bất biến.** Nó được render qua allowlist
 *   Markdown; không có `dangerouslySetInnerHTML` ở bất kỳ đâu trong đường này.
 * - **`evidenceUrl` không được tải trước.** Không preview, không thumbnail,
 *   không favicon, không đọc metadata — kể cả ở client.
 */

type TabId = "overview" | "activity" | "comments";

export function TaskDetailDrawer({
  taskId,
  memberName,
  onClose,
  onEdit,
}: {
  taskId: string;
  memberName: (userId: string | null) => string | undefined;
  onClose: () => void;
  /** Mở `TSK-01` trên chính task này; `undefined` khi actor không sửa được. */
  onEdit?: ((task: Task) => void) | undefined;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const { detail, loading, failure, refetch } = useTaskDetail(taskId);
  const holder = { capabilities: detail?.capabilities as never };
  const activity = useTaskActivity(taskId, tab === "activity");

  if (failure !== undefined) {
    return (
      <FbDrawer title="Chi tiết công việc" onRequestClose={onClose}>
        <FailureState failure={failure} onRetry={refetch} />
      </FbDrawer>
    );
  }

  if (loading || detail === undefined) {
    return (
      <FbDrawer title="Đang mở công việc" onRequestClose={onClose}>
        <FbSkeleton lines={5} label="Đang tải chi tiết công việc" />
      </FbDrawer>
    );
  }

  const { task } = detail;
  const dueDate = formatCalendarDate(task.dueDate);
  const canComment = can("comment:create", holder);
  const canUpdate = can("task:update", holder);

  return (
    <FbDrawer
      title={task.title}
      subtitle={`Công việc · phiên bản v${String(task.version)}`}
      onRequestClose={onClose}
      badges={
        <>
          {task.priority !== "none" && (
            <FbBadge tone={PRIORITY_TONE[task.priority]}>
              {`Ưu tiên ${PRIORITY_LABEL[task.priority].toLowerCase()}`}
            </FbBadge>
          )}
          <FbDueBadge state={task.dueState} {...(dueDate === undefined ? {} : { date: dueDate })} />
        </>
      }
      footer={
        canUpdate && onEdit !== undefined ? (
          <FbButtonPrimary onClick={() => onEdit(task)}>Sửa công việc</FbButtonPrimary>
        ) : (
          <FbButtonSecondary onClick={onClose}>Đóng</FbButtonSecondary>
        )
      }
    >
      <FbTabs
        label="Nội dung công việc"
        activeId={tab}
        onSelect={(id) => setTab(id as TabId)}
        items={[
          {
            id: "overview",
            label: "Tổng quan",
            content: <Overview task={task} memberName={memberName} />,
          },
          {
            id: "activity",
            label: "Hoạt động",
            content: (
              <ActivityPanel
                loading={activity.loading}
                failure={activity.failure}
                items={activity.activities}
              />
            ),
          },
          {
            id: "comments",
            label: "Bình luận",
            content: (
              <CommentsPanel taskId={taskId} comments={detail.comments} canComment={canComment} />
            ),
          },
        ]}
      />
    </FbDrawer>
  );
}

function Overview({
  task,
  memberName,
}: {
  task: Task;
  memberName: (userId: string | null) => string | undefined;
}) {
  return (
    <div style={{ display: "grid", gap: "var(--fb-space-4)" }}>
      {task.description !== "" && (
        <p
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            fontSize: "var(--fb-font-size-body-sm)",
            color: "var(--fb-color-text-primary)",
          }}
        >
          {task.description}
        </p>
      )}

      <dl
        style={{
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "var(--fb-space-3)",
        }}
      >
        <Property term="Người tạo" value={task.createdBy.displayName} />
        <Property term="Nhóm công việc" value={categoryLabel(task.category)} />
        <Property term="Người thực hiện" value={memberName(task.assigneeId) ?? "Chưa giao"} />
        <Property term="Người kiểm duyệt" value={memberName(task.reviewerId) ?? "Chưa chọn"} />
        <Property term="Ngày bắt đầu" value={formatCalendarDate(task.startDate) ?? "Chưa đặt"} />
        <Property term="Ngày kết thúc" value={formatCalendarDate(task.dueDate) ?? "Chưa đặt"} />
        <Property term="Phiên bản" value={`v${String(task.version)}`} />
      </dl>

      {task.evidenceUrl !== null && <EvidenceLink url={task.evidenceUrl} />}
    </div>
  );
}

function Property({ term, value }: { term: string; value: string }) {
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
        {value}
      </dd>
    </div>
  );
}

/**
 * Liên kết bằng chứng: **host hiện thành chữ**, và không có gì được tải trước.
 *
 * Hiển thị host là để người đọc thấy đích **trước** khi bấm — một liên kết
 * mang nhãn tự do thì nhãn không nói gì về nơi nó dẫn tới. Còn việc không tải
 * preview là một ranh giới riêng: một cú fetch phía client cũng đủ để lộ cho
 * chủ URL biết ai đang mở task nào, và nó xảy ra mà người dùng không bấm gì.
 */
export function EvidenceLink({ url }: { url: string }) {
  // `evidenceUrl` hẹp hơn liên kết trong bình luận: hợp đồng chỉ nhận `https`.
  // Server đã cưỡng chế, nhưng nếu một giá trị cũ lọt qua thì client không
  // được biến nó thành một thứ bấm được.
  const parsed = safeLinkHref(url);
  const href = parsed !== undefined && new URL(parsed).protocol === "https:" ? parsed : undefined;
  if (href === undefined) {
    return <FbAlert intent="warning" title="Liên kết bằng chứng không hợp lệ" description={url} />;
  }
  const host = new URL(href).host;

  return (
    <p style={{ margin: 0, fontSize: "var(--fb-font-size-body-sm)" }}>
      <span style={{ color: "var(--fb-color-text-muted)" }}>Bằng chứng: </span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--fb-color-brand-text)", textDecoration: "underline" }}
      >
        {url}
      </a>
      <span style={{ color: "var(--fb-color-text-muted)" }}>{` (${host})`}</span>
    </p>
  );
}

function ActivityPanel({
  loading,
  failure,
  items,
}: {
  loading: boolean;
  failure: ReturnType<typeof toFailure>;
  items: readonly { id: string; action: string; summary: string; createdAt: string }[] | undefined;
}) {
  if (failure !== undefined) return <FailureState failure={failure} />;
  if (loading || items === undefined) {
    return <FbSkeleton lines={3} label="Đang tải hoạt động của công việc" />;
  }
  if (items.length === 0) {
    return (
      <FbAlert
        intent="info"
        title="Chưa có hoạt động nào"
        description="Mọi thay đổi trên công việc này sẽ xuất hiện ở đây."
      />
    );
  }

  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "grid",
        gap: "var(--fb-space-3)",
      }}
    >
      {items.map((item) => (
        <FbActivityItem
          key={item.id}
          icon={activityIcon(item.action)}
          message={item.summary}
          meta={`${formatInstant(item.createdAt)} · ${item.action}`}
        />
      ))}
    </ul>
  );
}

function CommentsPanel({
  taskId,
  comments,
  canComment,
}: {
  taskId: string;
  comments: readonly Comment[];
  canComment: boolean;
}) {
  const [body, setBody] = useState("");
  const intent = useRef(new Intent());
  const lastSent = useRef("");
  const mutation = useCreateComment(taskId);
  const failure = toFailure(mutation.error);

  return (
    <div style={{ display: "grid", gap: "var(--fb-space-4)" }}>
      {comments.length === 0 ? (
        <FbAlert
          intent="info"
          title="Chưa có bình luận nào"
          description="Bình luận đã gửi không sửa hay xoá được, nên hãy viết đủ ý ngay từ đầu."
        />
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: "var(--fb-space-4)",
          }}
        >
          {comments.map((comment) => (
            <li key={comment.id} style={{ display: "grid", gap: "var(--fb-space-1)" }}>
              <span
                style={{
                  fontSize: "var(--fb-font-size-caption)",
                  color: "var(--fb-color-text-muted)",
                }}
              >
                {`${comment.author.displayName} · ${formatInstant(comment.createdAt)}`}
              </span>
              <div
                style={{
                  display: "grid",
                  gap: "var(--fb-space-2)",
                  fontSize: "var(--fb-font-size-body-sm)",
                  color: "var(--fb-color-text-primary)",
                }}
              >
                {renderCommentBody(comment.body)}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = body.trim();
            if (trimmed === "" || mutation.isPending) return;
            // Sửa nội dung rồi gửi lại là một ý định khác: xoay key. Gửi lại y
            // nguyên sau lỗi mạng thì giữ, để không có bình luận thứ hai.
            if (lastSent.current !== "" && lastSent.current !== trimmed) intent.current.rotate();
            lastSent.current = trimmed;
            mutation.mutate(
              { body: trimmed, intent: intent.current },
              {
                onSuccess: () => {
                  setBody("");
                  intent.current.rotate();
                  lastSent.current = "";
                },
              },
            );
          }}
          style={{ display: "grid", gap: "var(--fb-space-2)" }}
        >
          {failure !== undefined && (
            <FbAlert
              intent="error"
              title={failure.message}
              description={`Mã tra cứu: ${failure.requestId}`}
            />
          )}
          <FbTextArea
            id="comment-body"
            label="Bình luận"
            value={body}
            onChange={setBody}
            rows={3}
            maxLength={COMMENT_BODY_MAX_LENGTH}
            placeholder="Viết bình luận…"
            hint="Hỗ trợ **đậm**, *nghiêng*, `code`, danh sách và liên kết. Bình luận đã gửi là bất biến."
            disabled={mutation.isPending}
          />
          <div>
            <FbButtonPrimary
              type="submit"
              loading={mutation.isPending}
              disabled={body.trim() === ""}
            >
              Gửi bình luận
            </FbButtonPrimary>
          </div>
        </form>
      )}
    </div>
  );
}
