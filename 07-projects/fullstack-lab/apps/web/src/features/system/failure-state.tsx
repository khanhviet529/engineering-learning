"use client";

import { FbButtonPrimary, FbButtonSecondary, FbStatePanel } from "@flowboard/ui";
import type { ApiFailure } from "../../lib/transport.ts";

/**
 * Ánh xạ **một** `ApiFailure` sang **một** màn hình hệ thống.
 *
 * Đây là chỗ duy nhất biết phép ánh xạ đó. Rải nó ra từng màn hình là cách
 * chắc chắn nhất để một hôm nào đó `404` được render bằng trang `403`.
 *
 * Vì sao `403` và `404` **không** được trộn — đây là quyết định bảo mật, không
 * phải sở thích trình bày, theo
 * [mô hình phân quyền](../../../../../docs/security/authorization-model.md):
 *
 * - `404 NOT_FOUND` nghĩa là resource **không tồn tại hoặc nằm ngoài phạm vi
 *   actor được thấy**. Một Workspace Admin chưa là thành viên project nhận
 *   `404`. Render nó bằng trang `403` sẽ biến một câu trả lời cố tình mơ hồ
 *   thành lời xác nhận rằng project đó có thật.
 * - `403 FORBIDDEN` nghĩa là actor **đã thấy được** resource nhưng thiếu action.
 *   Chỉ dùng cho người đã là thành viên project.
 */
export type SystemScreen =
  | "SYS-01" // Forbidden
  | "SYS-02" // Session expired
  | "SYS-03" // Network / service error
  | "SYS-05" // Not found
  | "SYS-06"; // Service unavailable

export function screenForFailure(failure: ApiFailure): SystemScreen {
  switch (failure.code) {
    case "FORBIDDEN":
      return "SYS-01";
    case "UNAUTHENTICATED":
      return "SYS-02";
    // Nhánh phòng thủ. `EMAIL_VERIFICATION_REQUIRED` chỉ do `POST /auth/sign-in`
    // phát ra, và `features/auth` xử lý nó tại chỗ: xoá mật khẩu rồi chuyển
    // sang `AUTH-05`. Nếu nó tới được đây thì actor **chưa** có phiên hợp lệ,
    // nên đường đúng là quay lại xác thực — không phải một trang lỗi mạng.
    case "EMAIL_VERIFICATION_REQUIRED":
      return "SYS-02";
    case "NOT_FOUND":
      return "SYS-05";
    default:
      // `503` là dịch vụ tạm không phục vụ được; `500` và lỗi vận chuyển
      // (status 0) là lỗi không xác nhận được. Hai thứ này nói hai việc khác
      // nhau cho người dùng, nên không gộp.
      return failure.status === 503 ? "SYS-06" : "SYS-03";
  }
}

interface Copy {
  /** Mã hiển thị cho người dùng nhắc lại khi báo lỗi. */
  code: string;
  title: string;
  description: string;
  /** Nhãn của hành động chính; `undefined` nghĩa là chỉ có đường quay lại. */
  retryLabel?: string;
}

/**
 * Chữ của từng màn.
 *
 * Mỗi dòng phải nói **việc cần làm tiếp theo**. Một trang lỗi nói sai việc cần
 * làm còn tệ hơn một trang lỗi không nói gì, vì nó khiến người dùng thử một
 * cách chắc chắn không có kết quả.
 */
const COPY: Record<SystemScreen, Copy> = {
  "SYS-01": {
    code: "403",
    // `403` **chỉ** đến với người đã nhìn thấy được resource — người ngoài
    // phạm vi nhận `404`. Vì vậy câu chữ ở đây được viết cho một thành viên
    // thiếu đúng một action, không phải cho người lạ: nói "hãy xin vào dự án"
    // với một Editor đang ở trong dự án là chỉ sai việc cần làm.
    title: "Vai trò hiện tại của bạn không có thao tác này",
    description:
      "Nội dung không được hiển thị. Owner của dự án có thể đổi vai trò cho bạn nếu bạn cần quyền này.",
  },
  "SYS-02": {
    code: "401",
    title: "Phiên làm việc đã kết thúc",
    description:
      "Hãy đăng nhập lại để tiếp tục. Thay đổi chưa gửi sẽ không được tự động gửi lại sau khi bạn đăng nhập.",
  },
  "SYS-03": {
    code: "Lỗi kết nối",
    title: "Không xác nhận được dữ liệu",
    description:
      "Chưa rõ máy chủ đã nhận yêu cầu hay chưa. Kiểm tra kết nối rồi thử lại; dữ liệu bạn đã nhập vẫn được giữ.",
    retryLabel: "Thử lại",
  },
  "SYS-05": {
    code: "404",
    title: "Không tìm thấy trang này",
    description:
      "Đường dẫn có thể không còn tồn tại hoặc đã đổi. Trang này không cho biết bạn thiếu quyền, và cũng không cho biết có nội dung nào ở đây.",
  },
  "SYS-06": {
    code: "503",
    title: "Dịch vụ tạm thời không khả dụng",
    description:
      "Máy chủ chưa phục vụ được yêu cầu này. Thay đổi của bạn chưa được ghi nhận; hãy thử lại sau ít phút.",
    retryLabel: "Thử lại",
  },
};

const PANEL_STATE = {
  "SYS-01": "forbidden",
  "SYS-02": "session-expired",
  "SYS-03": "error",
  "SYS-05": "empty",
  "SYS-06": "error",
} as const;

export interface SystemStateProps {
  screen: SystemScreen;
  /** Hiện khi hành động có thể thử lại được; `undefined` thì không render nút. */
  onRetry?: (() => void) | undefined;
  /** `requestId` an toàn để người dùng báo lại. Chỉ hiện khi có. */
  requestId?: string | undefined;
  /** Đích quay lại an toàn; mặc định về danh sách workspace. */
  backHref?: string;
}

/**
 * Render một màn hình hệ thống.
 *
 * Nó **không bao giờ** render dữ liệu private phía sau: chỗ gọi đã dừng render
 * nội dung trước khi tới đây, và component này không nhận dữ liệu resource nào.
 */
export function SystemState({
  screen,
  onRetry,
  requestId,
  backHref = "/khong-gian-lam-viec",
}: SystemStateProps) {
  const copy = COPY[screen];
  const retryable = copy.retryLabel !== undefined && onRetry !== undefined;

  return (
    <div
      data-screen={screen}
      style={{ display: "grid", justifyItems: "center", gap: "var(--fb-space-4)" }}
    >
      <span
        style={{
          fontSize: "var(--fb-font-size-body-sm)",
          fontWeight: "var(--fb-font-weight-bold)",
          color: "var(--fb-color-text-muted)",
          letterSpacing: "0.04em",
        }}
      >
        {copy.code}
      </span>

      <FbStatePanel
        state={PANEL_STATE[screen]}
        title={copy.title}
        description={copy.description}
        action={
          <div style={{ display: "flex", gap: "var(--fb-space-2)", justifyContent: "center" }}>
            {retryable && <FbButtonPrimary onClick={onRetry}>{copy.retryLabel}</FbButtonPrimary>}
            <FbButtonSecondary
              onClick={() => {
                window.location.assign(screen === "SYS-02" ? "/dang-nhap" : backHref);
              }}
            >
              {screen === "SYS-02" ? "Đăng nhập lại" : "Về không gian làm việc"}
            </FbButtonSecondary>
          </div>
        }
      />

      {requestId !== undefined && requestId !== "unknown" && (
        <p
          style={{
            margin: 0,
            fontSize: "var(--fb-font-size-caption)",
            color: "var(--fb-color-text-muted)",
          }}
        >
          {`Mã tra cứu: ${requestId}`}
        </p>
      )}
    </div>
  );
}

/** Dựng màn hình hệ thống thẳng từ một `ApiFailure`. */
export function FailureState({
  failure,
  onRetry,
}: {
  failure: ApiFailure;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <SystemState
      screen={screenForFailure(failure)}
      onRetry={onRetry}
      requestId={failure.requestId}
    />
  );
}
