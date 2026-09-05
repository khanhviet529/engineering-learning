/**
 * `@flowboard/ui` — UI primitive của Flowboard.
 *
 * Hai thứ package này sở hữu: **token** sinh từ artifact thiết kế đã freeze, và
 * các wrapper `Fb*` bọc quanh primitive Ant Design để token, trạng thái
 * accessibility, copy và variant giữ ổn định.
 *
 * Hai thứ nó **không** được làm: fetch data và kiểm tra quyền. Component cần
 * capability hoặc mutation thì thuộc về feature trong `apps/web`.
 *
 * Token nạp bằng `import "@flowboard/ui/tokens.css"` ở layout gốc — đúng một
 * chỗ, không rải rác.
 */

export * from "./theme.ts";
export * from "./icon.tsx";
export * from "./components.tsx";
export * from "./shell.tsx";
export * from "./overlays.tsx";
export * from "./data-display.tsx";
export * from "./board.tsx";
export * from "./task.tsx";
