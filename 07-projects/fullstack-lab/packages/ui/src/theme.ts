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

    // Ant Design **suy** hàng chục biến thể từ năm màu gốc ở trên bằng thuật
    // toán palette của nó. Thuật toán đó cần một giá trị màu **thật** để tính;
    // nó không phân tích được chuỗi `var(...)`, nên nó rơi về `#000000` rồi
    // suy ra nền `#404040` cho mọi Alert. Kết quả đo được: chữ
    // `--fb-color-text-primary` (`#182230` ở theme sáng) trên nền `#404040` —
    // khoảng 1,3:1, tức là không đọc được.
    //
    // Vì vậy mọi biến thể mà component Flowboard thật sự render đều được khai
    // **tường minh** ở đây. Khai đủ thì Ant Design không còn gì để suy, và bề
    // mặt của nó đi theo đúng token đã được đo tương phản.
    colorInfoBg: token("color-intent-info-subtle"),
    colorInfoBorder: token("color-intent-info-border"),
    colorInfoText: token("color-intent-info-text"),

    colorSuccessBg: token("color-intent-success-subtle"),
    colorSuccessBorder: token("color-intent-success"),
    colorSuccessText: token("color-intent-success-text"),

    colorWarningBg: token("color-intent-warning-subtle"),
    colorWarningBorder: token("color-intent-warning-border"),
    colorWarningText: token("color-intent-warning-text"),

    colorErrorBg: token("color-intent-danger-subtle"),
    colorErrorBorder: token("color-intent-danger-border"),
    colorErrorText: token("color-intent-danger-text"),

    // Cùng lý do đó, và đây là chỗ dễ bỏ sót hơn: `colorPrimary` cũng là seed,
    // nên hover và active của nút primary cũng bị suy từ đen.
    // Đo được: hover `#0d0d0d`, active `#000000`, bg `#404040` — thay vì
    // `#8769ff`, `#3f29cf`, `#f5f0ff` khi seed là màu thật. Nút primary lúc
    // hover sẽ gần như đen, và không test tương phản nào theo cặp token bắt
    // được, vì bản thân các token đều đúng — antd chỉ không đọc chúng.
    colorPrimaryHover: token("color-brand-surface-hover"),
    colorPrimaryActive: token("color-brand-surface-strong"),
    colorPrimaryBg: token("color-brand-subtle"),
    colorPrimaryText: token("color-brand-text"),

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
