import type { Metadata } from "next";
import { AcceptInvitationScreen } from "../../../features/invitations/accept-invitation.tsx";

export const metadata: Metadata = { title: "Lời mời không gian làm việc · Flowboard" };

/**
 * `WSP-05` — chấp nhận lời mời.
 *
 * Đoạn đường dẫn là tiếng Việt không dấu theo
 * [ADR-0014](../../../../../docs/decisions/ADR-0014-vietnamese-url-segments.md),
 * còn khoá query là tiếng Anh: `?token=` là một tham số kỹ thuật, cùng họ với
 * `?cursor=` và `?limit=`.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AcceptInvitationScreen token={token} />;
}
