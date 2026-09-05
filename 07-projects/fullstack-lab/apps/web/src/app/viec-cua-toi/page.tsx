import { Suspense } from "react";
import type { Metadata } from "next";
import { MyTasksScreen } from "../../features/tasks/my-tasks.tsx";

export const metadata: Metadata = { title: "Việc của tôi · Flowboard" };

/**
 * `MYT-01` — việc được giao cho actor, cắt ngang project.
 *
 * Route không mang `workspaceId`: nó là màn **cấp workspace nhưng không thuộc
 * một project nào**, đúng như information architecture ghi. Không gian đang
 * xem nằm ở `?workspace=` — khóa query tiếng Anh theo ADR-0014 — để một liên
 * kết dán cho đồng nghiệp mở đúng danh sách đó.
 */
export default function Page() {
  // `MyTasksScreen` đọc **và ghi** `?workspace=` nên nó dùng `useSearchParams`,
  // và Next bắt buộc bọc Suspense ở một route được prerender tĩnh — không có nó
  // thì `next build` dừng hẳn ở bước export.
  //
  // Khác `WSP-05`: trang đó chỉ **đọc** `?token=` một lần nên nó nhận
  // `searchParams` ở server và truyền xuống. Ở đây bộ chọn workspace phải ghi
  // lại URL, nên state đó thuộc về client, và Suspense là ranh giới đúng.
  //
  // Fallback để rỗng có chủ đích: nó chỉ hiện trong khoảnh khắc bailout trước
  // hydrate, còn mọi trạng thái chờ thật đã có bên trong màn hình. Một
  // skeleton ở đây sẽ nháy lên rồi bị thay ngay bằng skeleton thứ hai.
  return (
    <Suspense fallback={null}>
      <MyTasksScreen />
    </Suspense>
  );
}
