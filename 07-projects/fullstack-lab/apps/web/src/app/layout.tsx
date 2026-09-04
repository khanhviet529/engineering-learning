import type { Metadata, Viewport } from "next";
import "@flowboard/ui/tokens.css";

/**
 * Layout gốc.
 *
 * Đây là chỗ **duy nhất** nạp token: mọi màu, khoảng cách và kích thước của ứng
 * dụng đọc từ CSS variable sinh ra từ artifact thiết kế đã freeze. Không route
 * hay component nào được khai màu riêng.
 */

export const metadata: Metadata = {
  title: "Flowboard",
  description: "Workspace quản lý công việc riêng tư theo project cho nhóm nhỏ.",
};

export const viewport: Viewport = {
  // Theme của trình duyệt đi theo cùng một nguồn quyết định với token.
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
