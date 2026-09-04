import type { Metadata } from "next";
import { BoardScreen } from "../../../../features/board/board-screen.tsx";

export const metadata: Metadata = { title: "Bảng công việc · Flowboard" };

/**
 * `BRD-01` — bảng công việc của dự án.
 *
 * Segment tiếng Việt không dấu theo
 * [ADR-0014](../../../../../../docs/decisions/ADR-0014-route-language.md);
 * `?panel=columns` mở `BRD-02` và giữ khóa query bằng tiếng Anh.
 *
 * Panel đọc trạng thái từ `useSearchParams` chứ không nhận qua prop: nó là
 * **query state chia sẻ được** — dán link vào chat là mở đúng lớp phủ đó — nên
 * URL phải là nguồn duy nhất, và nút Back của trình duyệt phải đóng được panel.
 */
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <BoardScreen projectId={projectId} />;
}
