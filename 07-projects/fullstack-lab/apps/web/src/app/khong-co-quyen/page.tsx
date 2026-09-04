import type { Metadata } from "next";
import { SystemScreenPage } from "../../features/system/system-screen-page.tsx";

export const metadata: Metadata = { title: "Không có quyền truy cập · Flowboard" };

/**
 * `SYS-01` — không có quyền, dưới dạng một route riêng.
 *
 * Phần lớn trường hợp `403` được render **tại chỗ** trong màn hình đã yêu cầu,
 * để người dùng giữ ngữ cảnh. Route này dành cho lối vào trực tiếp và cho các
 * chỗ chuyển hướng, và nó cố tình **không** nhận tham số nào mô tả resource bị
 * từ chối: một mã dự án trong URL của trang từ chối cũng là một tín hiệu tồn tại.
 */
export default function Page() {
  return <SystemScreenPage screen="SYS-01" title="Không thể truy cập" />;
}
