"use client";

import { useQuery } from "@tanstack/react-query";
import type { Actor } from "@flowboard/contracts";
import { transport } from "../../lib/api.ts";
import { unwrap, toFailure } from "../../lib/query.tsx";
import { readSession } from "../../lib/workspace-api.ts";
import type { ApiFailure } from "../../lib/transport.ts";

/**
 * Phiên hiện tại — actor và CSRF token.
 *
 * `GET /auth/session` là hợp đồng bootstrap: nó trả actor an toàn và CSRF
 * token gắn với phiên. Cả app cần nó, nên nó có **một** query key và mọi nơi
 * đọc từ cùng cache đó thay vì mỗi màn hình gọi lại.
 *
 * Nó **không bao giờ** trả role claim thay cho capability: quyền luôn được hỏi
 * theo từng resource, đúng như hợp đồng ghi.
 */

export const sessionQueryKey = ["session"] as const;

export interface SessionState {
  actor: Actor | undefined;
  loading: boolean;
  /** Có giá trị khi không đọc được phiên; `UNAUTHENTICATED` nghĩa là phải đăng nhập lại. */
  failure: ApiFailure | undefined;
}

export function useSession(): SessionState {
  const query = useQuery({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      const data = await unwrap(readSession());
      // CSRF token gắn với phiên vừa đọc; nạp vào transport ngay để mutation
      // kế tiếp gửi được. Đây là lý do session phải được đọc trước mọi mutation.
      transport.setCsrfToken(data.csrfToken);
      return data;
    },
  });

  return {
    actor: query.data?.actor,
    loading: query.isPending,
    failure: toFailure(query.error),
  };
}

/**
 * Hai chữ cái đầu để hiển thị trong avatar.
 *
 * Avatar là trang trí — tên đầy đủ luôn hiện cạnh nó — nên hàm này chỉ cần
 * ổn định, không cần đúng với mọi quy ước đặt tên trên thế giới.
 */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1] ?? "") : "";
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase() || "?";
}
