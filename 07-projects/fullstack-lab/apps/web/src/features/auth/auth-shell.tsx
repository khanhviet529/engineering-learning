"use client";

import type { ReactNode } from "react";
import { FbBrandMark, FbThemeProvider } from "@flowboard/ui";

/**
 * Khung chung của các màn hình `AUTH-01`…`AUTH-05`.
 *
 * Nó giữ đúng một trách nhiệm: bố cục và theme. Không màn hình nào tự khai theme
 * riêng, vì hai nguồn theme là hai bộ màu sẽ lệch nhau ngay lần sửa đầu tiên.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <FbThemeProvider>
      <main
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "var(--fb-space-6)",
          background: "var(--fb-color-surface-canvas)",
          color: "var(--fb-color-text-primary)",
          fontFamily: "var(--fb-font-family-base), system-ui, sans-serif",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            display: "grid",
            gap: "var(--fb-space-5)",
            padding: "var(--fb-space-6)",
            background: "var(--fb-color-surface-raised)",
            border: "1px solid var(--fb-color-border-default)",
            borderRadius: "var(--fb-radius-lg)",
          }}
        >
          <FbBrandMark />

          <div style={{ display: "grid", gap: "var(--fb-space-1)" }}>
            {/* Đúng một `h1` mỗi trang: đó là điểm neo mà screen reader dùng. */}
            <h1
              style={{
                margin: 0,
                fontSize: "var(--fb-font-size-heading-sm)",
                fontWeight: "var(--fb-font-weight-bold)",
              }}
            >
              {title}
            </h1>
            {description !== undefined && (
              <p
                style={{
                  margin: 0,
                  fontSize: "var(--fb-font-size-body-sm)",
                  color: "var(--fb-color-text-secondary)",
                }}
              >
                {description}
              </p>
            )}
          </div>

          {children}

          {footer !== undefined && (
            <div
              style={{
                fontSize: "var(--fb-font-size-body-sm)",
                color: "var(--fb-color-text-secondary)",
              }}
            >
              {footer}
            </div>
          )}
        </div>
      </main>
    </FbThemeProvider>
  );
}
