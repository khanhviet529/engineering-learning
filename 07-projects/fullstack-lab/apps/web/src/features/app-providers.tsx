"use client";

import type { ReactNode } from "react";
import { QueryProvider } from "../lib/query.tsx";
import { ThemePreferenceProvider } from "./account/theme-preference.tsx";

/**
 * Provider của toàn ứng dụng, đặt ở layout gốc.
 *
 * Thứ tự có ý nghĩa: theme bọc ngoài cùng vì nó tác động lên thẻ gốc và không
 * phụ thuộc dữ liệu; QueryProvider bọc phần còn lại vì mọi feature đọc server
 * state qua nó.
 *
 * Đây là **composition**, không phải nơi chứa logic. Nó không biết resource
 * nào, không gọi API và không quyết định quyền.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemePreferenceProvider>
      <QueryProvider>{children}</QueryProvider>
    </ThemePreferenceProvider>
  );
}
