"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FbAlert,
  FbButtonPrimary,
  FbButtonSecondary,
  FbSkeleton,
  FbStatePanel,
} from "@flowboard/ui";
import type { Workspace } from "@flowboard/contracts";
import { AuthShell } from "../auth/auth-shell.tsx";
import { useSession } from "../session/session.tsx";
import { acceptInvitation, signOut } from "../../lib/workspace-api.ts";
import type { ApiFailure } from "../../lib/transport.ts";

/**
 * `WSP-05` — chấp nhận lời mời vào không gian làm việc.
 *
 * Ba điều quyết định toàn bộ hình dạng của màn này:
 *
 * 1. **`POST /invitations/accept` tiêu thụ token.** Không có endpoint "chỉ
 *    kiểm token" nào để gọi trước, và không trạng thái nào trong artifact có
 *    nút "Chấp nhận" — nên màn này tự gửi **đúng một lần** khi đã có phiên.
 *    "Đúng một lần" là chuyện sinh tử ở đây: gọi hai lần thì lần thứ hai gặp
 *    token đã dùng, và một lần tham gia thành công sẽ hiện ra thành "lời mời
 *    không dùng được".
 * 2. **Token hỏng chỉ có một thông điệp.** Invalid, hết hạn, đã dùng và đã thu
 *    hồi đều trả cùng một `400 VALIDATION_FAILED`. Tách chúng ra sẽ nói cho
 *    người đang thử token biết token nào từng tồn tại — cùng lý do với
 *    `AUTH-04` và `AUTH-05`.
 * 3. **Lỗi mạng khác hẳn token hỏng.** Lỗi vận chuyển nghĩa là token **chưa**
 *    bị tiêu, nên nó có màn riêng, giữ nguyên token, và có nút thử lại. Gộp nó
 *    vào "không dùng được" là báo tử cho một lời mời còn sống.
 */

/** Câu giới thiệu ở khối thương hiệu của artifact, dùng chung cho mọi trạng thái. */
const PITCH = "Lời mời gắn với đúng địa chỉ email nhận thư và chỉ dùng được một lần.";

/** Đường dẫn của chính màn này; dùng để dựng đích quay lại sau khi đăng nhập. */
export const INVITATION_ACCEPT_PATH = "/loi-moi/chap-nhan";

type Stage =
  | { kind: "loading" }
  | { kind: "accepted"; workspace: Workspace }
  | { kind: "token-unusable" }
  | { kind: "error"; failure: ApiFailure }
  | { kind: "sign-in-required" }
  | { kind: "email-mismatch"; failure: ApiFailure };

/**
 * Xoá token khỏi thanh địa chỉ.
 *
 * Gọi khi token đã **hết giá trị** — đã dùng xong, hoặc đã chết. Từ lúc đó nó
 * chỉ còn là một bí mật nằm trong lịch sử trình duyệt, trong `Referer` của
 * request kế tiếp và trong bất cứ thứ gì đọc URL.
 *
 * **Không** gọi khi lỗi mạng hoặc khi email không khớp: ở hai trường hợp đó
 * token vẫn dùng được, và xoá nó đi là tự tay vứt một lời mời còn hiệu lực.
 */
function stripTokenFromAddress(): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", INVITATION_ACCEPT_PATH);
}

/** Đích quay lại sau khi đăng nhập: đúng lời mời này, kèm token. */
function returnTarget(token: string): string {
  return `${INVITATION_ACCEPT_PATH}?token=${encodeURIComponent(token)}`;
}

function authHref(base: "/dang-nhap" | "/dang-ky", token: string): string {
  return `${base}?next=${encodeURIComponent(returnTarget(token))}`;
}

export function AcceptInvitationScreen({ token }: { token: string | undefined }) {
  const router = useRouter();
  const { actor, loading: sessionLoading, failure: sessionFailure } = useSession();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  // Chốt chặn cho một hiệu ứng chạy hai lần: React 19 StrictMode gọi effect
  // hai lượt ở môi trường dev. Với một request tiêu thụ token, lượt thứ hai
  // biến thành công thành `token-unusable`. Đặt cờ **trước** khi gọi, đồng bộ.
  const attempted = useRef(false);

  const send = useCallback(async (value: string): Promise<void> => {
    setStage({ kind: "loading" });
    const result = await acceptInvitation(value);

    if (result.ok) {
      stripTokenFromAddress();
      setStage({ kind: "accepted", workspace: result.data.workspace });
      return;
    }

    // Rẽ theo `error.code`, không theo HTTP status: cùng một `400` có thể tới
    // từ nhiều nguyên nhân khác nhau, và status không nói được nguyên nhân nào.
    if (result.code === "VALIDATION_FAILED") {
      stripTokenFromAddress();
      setStage({ kind: "token-unusable" });
      return;
    }
    if (result.code === "FORBIDDEN") {
      setStage({ kind: "email-mismatch", failure: result });
      return;
    }
    if (result.code === "UNAUTHENTICATED") {
      setStage({ kind: "sign-in-required" });
      return;
    }
    setStage({ kind: "error", failure: result });
  }, []);

  useEffect(() => {
    if (token === undefined || token === "") {
      setStage({ kind: "token-unusable" });
      return;
    }
    if (sessionLoading) return;

    if (sessionFailure !== undefined) {
      // Chưa đăng nhập là một nhánh riêng, không phải lỗi: người dùng vừa mở
      // thư trên một trình duyệt chưa có phiên, và đó là đường vào phổ biến nhất.
      if (sessionFailure.code === "UNAUTHENTICATED") {
        setStage({ kind: "sign-in-required" });
        return;
      }
      setStage({ kind: "error", failure: sessionFailure });
      return;
    }
    if (actor === undefined) return;

    if (attempted.current) return;
    attempted.current = true;
    void send(token);
  }, [token, sessionLoading, sessionFailure, actor, send]);

  if (token === undefined || token === "") {
    return <UnusableView onGo={(href) => router.push(href)} />;
  }

  switch (stage.kind) {
    case "loading":
      return (
        <AuthShell title="Đang mở lời mời" description={PITCH}>
          <div style={{ display: "grid", gap: "var(--fb-space-3)" }}>
            <FbSkeleton lines={3} label="Đang kiểm tra lời mời" />
            <p
              style={{
                margin: 0,
                fontSize: "var(--fb-font-size-body-sm)",
                color: "var(--fb-color-text-secondary)",
              }}
            >
              Đang kiểm tra lời mời…
            </p>
          </div>
        </AuthShell>
      );

    case "accepted":
      return (
        <AuthShell title="Đã vào không gian làm việc" description={PITCH}>
          <FbStatePanel
            state="success"
            title={`Bạn đã là thành viên của ${stage.workspace.name}`}
            description="Lời mời đã dùng xong và không dùng lại được. Là thành viên không gian không tự cấp cho bạn quyền đọc dự án riêng tư nào — Owner của từng dự án vẫn phải thêm bạn vào dự án đó."
            action={
              <FbButtonPrimary
                onClick={() => {
                  router.push("/khong-gian-lam-viec");
                }}
              >
                Vào danh sách không gian làm việc
              </FbButtonPrimary>
            }
          />
        </AuthShell>
      );

    case "token-unusable":
      return <UnusableView signedIn={actor !== undefined} onGo={(href) => router.push(href)} />;

    case "error":
      return (
        <AuthShell title="Không kiểm được lời mời" description={PITCH}>
          <div style={{ display: "grid", gap: "var(--fb-space-4)" }}>
            <FbAlert
              intent="error"
              title="Không kết nối được máy chủ để xác nhận lời mời. Lời mời chưa bị dùng."
              description={
                stage.failure.requestId === "unknown"
                  ? undefined
                  : `Mã tra cứu: ${stage.failure.requestId}`
              }
            />
            <FbButtonPrimary
              block
              onClick={() => {
                void send(token);
              }}
            >
              Thử lại
            </FbButtonPrimary>
          </div>
        </AuthShell>
      );

    case "sign-in-required":
      return (
        <AuthShell title="Đăng nhập để nhận lời mời" description={PITCH}>
          <div style={{ display: "grid", gap: "var(--fb-space-4)" }}>
            <FbAlert
              intent="info"
              title="Lời mời gắn với email nhận thư. Đăng nhập hoặc đăng ký bằng đúng email đó rồi bạn sẽ quay lại đây."
            />
            <FbButtonPrimary
              block
              onClick={() => {
                router.push(authHref("/dang-nhap", token));
              }}
            >
              Đăng nhập rồi tiếp tục
            </FbButtonPrimary>
            <FbButtonSecondary
              block
              onClick={() => {
                router.push(authHref("/dang-ky", token));
              }}
            >
              Đăng ký bằng email được mời
            </FbButtonSecondary>
          </div>
        </AuthShell>
      );

    case "email-mismatch":
      return (
        <AuthShell title="Lời mời thuộc về địa chỉ email khác" description={PITCH}>
          <div style={{ display: "grid", gap: "var(--fb-space-4)" }}>
            {/* Đây là **ngoại lệ duy nhất** của nguyên tắc "một thông điệp cho
                mọi token không dùng được": người đang giữ token đã đọc được
                hộp thư đó, nên họ đã biết địa chỉ rồi. Nói mơ hồ ở đây không
                giấu được gì, chỉ làm họ không biết phải đăng nhập bằng tài
                khoản nào. Vì vậy hiện đúng thông điệp của server. */}
            <FbAlert intent="warning" title={stage.failure.message} />
            <p
              style={{
                margin: 0,
                fontSize: "var(--fb-font-size-body-sm)",
                color: "var(--fb-color-text-secondary)",
              }}
            >
              {actor === undefined
                ? "Lời mời vẫn còn hiệu lực."
                : `Bạn đang đăng nhập bằng ${actor.email}. Lời mời vẫn còn hiệu lực — nó chưa bị dùng.`}
            </p>
            <FbButtonPrimary
              block
              onClick={() => {
                // Đăng xuất **trước**, rồi mới quay lại đây kèm token: nếu chỉ
                // chuyển sang trang đăng nhập, phiên cũ vẫn còn và lần chấp
                // nhận kế tiếp lại rơi đúng vào `403` này.
                void signOut().then(() => {
                  router.push(authHref("/dang-nhap", token));
                });
              }}
            >
              Đăng xuất rồi đăng nhập bằng địa chỉ được mời
            </FbButtonPrimary>
          </div>
        </AuthShell>
      );
  }
}

/**
 * Token không dùng được.
 *
 * Artifact vẽ nút chính là "Yêu cầu lời mời mới", nhưng không có endpoint nào
 * để tự yêu cầu: lời mời mới chỉ do một Quản trị viên không gian gửi. Một nút
 * mang nhãn đó sẽ là ngõ cụt, nên việc cần làm được nói bằng chữ, còn nút dẫn
 * tới nơi người dùng thật sự đi tiếp được.
 */
function UnusableView({
  signedIn = false,
  onGo,
}: {
  signedIn?: boolean;
  onGo: (href: string) => void;
}) {
  return (
    <AuthShell title="Lời mời không dùng được" description={PITCH}>
      <FbStatePanel
        state="error"
        title="Lời mời này không dùng được"
        description="Liên kết có thể đã hết hạn, đã được dùng, hoặc không hợp lệ. Hãy nhờ người đã mời bạn gửi một lời mời mới."
        action={
          <FbButtonPrimary
            onClick={() => {
              onGo(signedIn ? "/khong-gian-lam-viec" : "/dang-nhap");
            }}
          >
            {signedIn ? "Về không gian làm việc" : "Đăng nhập"}
          </FbButtonPrimary>
        }
      />
    </AuthShell>
  );
}
