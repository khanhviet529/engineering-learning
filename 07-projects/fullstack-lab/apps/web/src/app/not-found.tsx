import type { Metadata } from "next";
import { SystemScreenPage } from "../features/system/system-screen-page.tsx";

export const metadata: Metadata = { title: "Không tìm thấy trang · Flowboard" };

/**
 * `SYS-05` — không tìm thấy.
 *
 * Đây là **màn hình khác** với `SYS-01`, và sự khác biệt là một quyết định bảo
 * mật chứ không phải trình bày. Một Workspace Admin chưa là thành viên của một
 * dự án riêng tư nhận `404` từ server, và client phải render đúng `SYS-05`:
 * render nó bằng trang `403` sẽ biến một câu trả lời cố tình mơ hồ thành lời
 * xác nhận rằng dự án đó có thật.
 */
export default function NotFound() {
  return <SystemScreenPage screen="SYS-05" title="Không tìm thấy trang" />;
}
