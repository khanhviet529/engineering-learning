/**
 * `@flowboard/contracts` — hợp đồng transport dùng chung giữa `apps/web` và
 * `apps/api`.
 *
 * Package này là **đường nối** giữa hai bên. Markdown trong `docs/` vẫn là
 * nguồn quyết định behavior; ở đây là bản dịch máy đọc được của nó, để cả web
 * lẫn API đọc **cùng một** định nghĩa thay vì mỗi bên tự diễn giải tài liệu.
 *
 * Ba ràng buộc không được vi phạm:
 *
 * 1. Không phụ thuộc Drizzle, NestJS, Next.js hay React. Contract diễn đạt use
 *    case (`moveTask`), không diễn đạt bảng database.
 * 2. Mọi schema là `.strict()`. Field lạ là lỗi validation, không phải thứ để
 *    bỏ qua im lặng.
 * 3. Danh mục error code **đóng**. Thêm một code ở đây mà không thêm vào bảng
 *    Markdown, hoặc ngược lại, sẽ làm fail test đối chiếu.
 */

export * from "./error-codes.js";
export * from "./envelope.js";
export * from "./capabilities.js";
export * from "./fields.js";
export * from "./resources.js";
export * from "./auth.js";
export * from "./workspaces.js";
export * from "./invitations.js";
export * from "./projects.js";
export * from "./board-columns.js";
export * from "./tasks.js";
export * from "./comments.js";
