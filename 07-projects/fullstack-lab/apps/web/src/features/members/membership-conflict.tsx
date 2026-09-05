"use client";

import { FbAlert } from "@flowboard/ui";
import type { ErrorCode } from "@flowboard/contracts";
import type { ApiFailure } from "../../lib/transport.ts";
import { MEMBERSHIP_CONFLICT_TITLE } from "./messages.ts";

/**
 * Ba xung đột trạng thái của membership: `PROJECT_LAST_OWNER`,
 * `MEMBER_HAS_ASSIGNED_TASKS`, `WORKSPACE_MEMBER_IN_PROJECTS`.
 *
 * Chúng là `409` nhưng **không phải** optimistic concurrency. Với một
 * `*_VERSION_CONFLICT`, việc đúng là tải lại rồi gửi lại — bản ghi đã đổi ở nơi
 * khác. Với ba code này, tải lại không đổi được gì: server đang từ chối vì một
 * **bất biến** của dữ liệu, và người dùng phải **đổi thứ tự thao tác** trước.
 *
 * Vì vậy UI ở đây tuyệt đối không có nút `Thử lại`. Một nút thử lại ở đây là
 * lời chỉ đường sai: người dùng bấm, nhận đúng lỗi cũ, và không học được gì về
 * việc thật sự cần làm.
 *
 * Ba code này **không có** `details`, nên lỗi hiện ở **cấp form**, không phải
 * cạnh một field — không field nào của form là nguyên nhân.
 */

export const MEMBERSHIP_CONFLICT_CODES = [
  "PROJECT_LAST_OWNER",
  "MEMBER_HAS_ASSIGNED_TASKS",
  "WORKSPACE_MEMBER_IN_PROJECTS",
] as const;

export type MembershipConflictCode = (typeof MEMBERSHIP_CONFLICT_CODES)[number];

export function isMembershipConflict(
  failure: ApiFailure | undefined,
): failure is ApiFailure & { code: MembershipConflictCode } {
  return (
    failure !== undefined &&
    (MEMBERSHIP_CONFLICT_CODES as readonly ErrorCode[]).includes(failure.code)
  );
}

/**
 * Việc phải làm **trước**, viết cho người dùng.
 *
 * Mỗi câu nói ba điều theo đúng thứ tự: hiện trạng là gì, phải làm gì trước,
 * và hệ thống **không** tự làm hộ. Câu cuối quan trọng nhất — nếu thiếu nó,
 * người dùng sẽ chờ hệ thống dọn giúp rồi thử lại.
 */
const NEXT_STEP: Record<MembershipConflictCode, string> = {
  PROJECT_LAST_OWNER:
    "Dự án phải luôn còn ít nhất một Owner. Hãy nâng một thành viên khác lên Owner trước, rồi quay lại thao tác này. Hệ thống không tự chuyển quyền sở hữu.",
  MEMBER_HAS_ASSIGNED_TASKS:
    "Người này vẫn đang được giao việc. Hãy giao những việc đó cho người khác trước, rồi quay lại. Hệ thống không tự bỏ gán việc.",
  WORKSPACE_MEMBER_IN_PROJECTS:
    "Người này vẫn là thành viên của ít nhất một dự án trong không gian. Hãy gỡ họ khỏi từng dự án trước, rồi quay lại. Hệ thống không tự gỡ hộ.",
};

/**
 * Thông báo cấp form cho một xung đột membership.
 *
 * `message` của server là tiêu đề — nó là câu nói của bên ra quyết định.
 * Phần mô tả là việc cần làm tiếp, do client viết bằng tiếng Việt, để người
 * dùng luôn có hướng đi kể cả khi thông điệp server ngắn gọn hoặc tiếng Anh.
 */
export function MembershipConflictNotice({
  failure,
}: {
  failure: ApiFailure & { code: MembershipConflictCode };
}) {
  return (
    <FbAlert
      intent="warning"
      title={MEMBERSHIP_CONFLICT_TITLE[failure.code]}
      description={
        <span>
          {NEXT_STEP[failure.code]}
          <br />
          {`Mã tra cứu: ${failure.requestId}`}
        </span>
      }
    />
  );
}
