"use client";

import { FbThemeProvider } from "@flowboard/ui";
import { SystemState, type SystemScreen } from "./failure-state.tsx";

/**
 * Một màn hình hệ thống đứng độc lập, dùng cho route trực tiếp (`SYS-01`) và
 * cho `not-found` của Next (`SYS-05`).
 *
 * Nó **không** dựng app shell. Shell hiển thị tên workspace, tên dự án và các
 * mục điều hướng suy từ capability; dựng nó ở một trang từ chối truy cập là
 * cách rò rỉ chính thứ mà trang đó tồn tại để không rò rỉ.
 */
export function SystemScreenPage({ screen, title }: { screen: SystemScreen; title: string }) {
  return (
    <FbThemeProvider>
      <main
        style={{
          minHeight: "100dvh",
          display: "grid",
          alignContent: "center",
          justifyItems: "center",
          gap: "var(--fb-space-6)",
          padding: "var(--fb-space-8)",
          background: "var(--fb-color-surface-canvas)",
          color: "var(--fb-color-text-primary)",
          fontFamily: "var(--fb-font-family-base), system-ui, sans-serif",
        }}
      >
        {/* Đúng một `h1` mỗi trang. Ở đây shell không tồn tại nên trang tự
            mang `h1`, và nó là điểm neo mà screen reader nhảy tới. */}
        <h1
          style={{
            margin: 0,
            fontSize: "var(--fb-font-size-heading-md)",
            fontWeight: "var(--fb-font-weight-bold)",
          }}
        >
          {title}
        </h1>
        <SystemState screen={screen} />
      </main>
    </FbThemeProvider>
  );
}
