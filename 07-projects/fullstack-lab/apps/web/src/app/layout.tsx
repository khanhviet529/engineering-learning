import type { Metadata, Viewport } from "next";
import "@flowboard/ui/tokens.css";
import { AppProviders } from "../features/app-providers.tsx";

/**
 * Layout gốc.
 *
 * Đây là chỗ **duy nhất** nạp token: mọi màu, khoảng cách và kích thước của ứng
 * dụng đọc từ CSS variable sinh ra từ artifact thiết kế đã freeze. Không route
 * hay component nào được khai màu riêng.
 *
 * Nó cũng là chỗ duy nhất dựng provider: cache server-state và tuỳ chọn theme
 * đều phải là **một** thể hiện cho cả cây, nếu không hai màn hình sẽ đọc hai
 * cache và theme sẽ có hai nguồn quyết định.
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
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
