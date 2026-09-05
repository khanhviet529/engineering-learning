import type { CSSProperties } from "react";

/**
 * Kiểu dùng chung cho accessibility.
 *
 * Nó ở riêng một tệp vì nó thuộc về **mọi** nhóm component, không thuộc nhóm
 * nào: sidebar giấu nhãn khi thu gọn, bảng giấu caption, và cả hai cần cùng
 * một định nghĩa. Đặt nó trong một trong hai nhóm sẽ tạo ra một phụ thuộc
 * ngược chiều ý nghĩa.
 */

/** Ẩn khỏi mắt nhưng **giữ** cho screen reader. */
export const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};
