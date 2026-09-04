import type { ThemeConfig } from "antd";

/**
 * Cầu nối giữa token Flowboard và theme của Ant Design.
 *
 * Ant Design đọc token của **nó**, không đọc CSS variable của chúng ta. Nếu
 * không bắc cầu, mọi primitive sẽ mang màu mặc định của Ant Design, và toàn bộ
 * công kiểm tương phản ở giai đoạn thiết kế mất hiệu lực ngay ở component đầu
 * tiên.
 *
 * Giá trị dưới đây trỏ tới `var(--fb-*)` sinh ra từ artifact, nên chúng tự đổi
 * theo theme sáng/tối mà không cần hai cấu hình riêng.
 */

const token = (name: string) => `var(--fb-${name})`;

export const flowboardTheme: ThemeConfig = {
  token: {
    colorPrimary: token("color-brand-surface"),
    colorInfo: token("color-intent-info"),
    colorSuccess: token("color-intent-success"),
    colorWarning: token("color-intent-warning"),
    colorError: token("color-intent-danger"),

    colorText: token("color-text-primary"),
    colorTextSecondary: token("color-text-secondary"),
    colorTextTertiary: token("color-text-muted"),
    colorTextPlaceholder: token("color-text-placeholder"),
    colorTextDisabled: token("color-state-disabled-text"),

    colorBgBase: token("color-surface-canvas"),
    colorBgContainer: token("color-surface-raised"),
    colorBgElevated: token("color-surface-raised"),
    colorBorder: token("color-border-default"),
    colorBorderSecondary: token("color-border-subtle"),

    fontFamily: `${token("font-family-base")}, system-ui, -apple-system, sans-serif`,
    borderRadius: 8,

    // Ring focus là một cam kết về accessibility, không phải trang trí: nó
    // dùng đúng token đã được kiểm tương phản.
    colorPrimaryBorder: token("color-state-focus-ring"),
  },
  components: {
    Button: {
      // Vùng chạm tối thiểu; giá trị lấy từ token kích thước control.
      controlHeight: 40,
    },
    Input: {
      controlHeight: 40,
    },
  },
};
