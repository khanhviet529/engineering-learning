# Flowboard Pencil Execution Checklist v0.1

## Current canvas progress

- [x] Opened and actively designed in `docs/design/flowboard-v0.1.pen`.
- [x] Foundations, core components, Board, Task Detail, Project Members, Task Form, Project Dashboard, and My Tasks calendar are represented on canvas.
- [ ] Vietnamese copy review, responsive variants (desktop + bộ mobile Light/Dark 390×844), authentication pages, system-state flows — **chưa có trong artifact**; báo cáo Canvas v0.4 đã bị rút lại (xem [pencil-handoff.md](pencil-handoff.md)).
- [ ] Tuyên bố `Ready for build` — chặn bởi hai việc: dựng lại artifact theo đặc tả Canvas v0.4, và ADR-0007/0008/0009 được duyệt.

## Mục đích và cổng bắt đầu

Checklist này chuyển Markdown baseline v0.1 thành artefact Pencil. Markdown vẫn là nguồn quyết định cho product, behavior, permission, data và API; Pencil là nguồn chân lý cho bố cục và thiết kế trực quan.

- [x] Markdown baseline v0.1 đã qua acceptance review.
- [x] Tạo và mở `07-projects/fullstack-lab/docs/design/flowboard-v0.1.pen` trong Pencil.
- [x] Không thiết kế AI, export, Redis/BullMQ hoặc các non-goal như màn hình MVP.

## 1. Cấu trúc file Pencil

- [ ] Page `00 Foundations`: visual direction, token reference, responsive reference.
- [ ] Page `01 Components`: component inventory và tất cả variants/states.
- [ ] Page `02 Flows`: primary, permission-denied, session-expired, network-error và conflict flows.
- [ ] Page `03 MVP Screens`: các screen/frame theo stable IDs trong `screen-inventory.md`.
- [ ] Page `04 Handoff`: Pencil-to-frontend mapping, API data needs và trạng thái `Ready for build`.

## 2. Foundations và component system

- [ ] Áp dụng visual direction: clean, calm, productivity-focused.
- [ ] Chốt semantic color, typography, spacing, radius, elevation, breakpoints và focus token — quy tắc token và ramp đã là contract ở [design-system.md](design-system.md); hiện thực trong artifact **chưa có**.
- [ ] Dựng `FbButton`, `FbTextField`, `FbSelect`, `FbDateField`, `FbModal`, `FbDrawer`, `FbAlert`, `FbEmptyState`, `FbPermissionState`, `FbTaskCard`, `FbBoardColumn`, `FbActivityItem`.
- [ ] Mỗi component có default, hover, focus-visible, disabled, loading, error và responsive rule khi phù hợp.
- [ ] Ant Design chỉ là primitive; component `Fb*` giữ behavior/style ổn định của Flowboard.

## 3. Primary MVP flows và screens

- [ ] Authentication: Sign Up, Sign In, Forgot/Reset Password, Email Verification — báo cáo trang đầy đủ Light/Dark kèm biến thể liên kết hết hạn, **chưa có trong artifact**; checklist mật khẩu phải dựng lại theo [ADR-0007](../decisions/ADR-0007-password-policy.md) vì policy đã đổi.
- [ ] Workspace/project: Workspace List, Project List, Project Create, Project Settings (`PRJ-03`, Owner-only rename) — **chưa có trong artifact**.
- [ ] Board: Project Board, Column Editor, Task Form, Task Detail, Comments, Activity History, Project Members — **chưa có trong artifact**.
- [ ] System: Loading, Empty, Network Error, Forbidden, Session Expired, Conflict Resolution — dùng chung `FbStatePanel`, **chưa có trong artifact**.
- [ ] Phản ánh role Owner / Editor / Viewer; Workspace Admin không có implicit access vào private project — **chưa có trong artifact**.

## 4. Interaction và responsive behavior

- [ ] Drag-and-drop task: optimistic state, server-authoritative ordering, rollback/error state.
- [ ] Task mutation: `expectedVersion`; `409 TASK_VERSION_CONFLICT` hiển thị flow resolution.
- [ ] Form: validation, submit loading, error summary, unsaved-changes confirmation.
- [ ] Pagination/load-more, keyboard navigation, focus management và mobile horizontal board.
- [ ] `403 EMAIL_VERIFICATION_REQUIRED`: clear password, route verification/resend, không retry sign-in tự động.

## 5. Handoff và acceptance

- [ ] Mỗi screen dùng stable ID, route/context, role, API data và required states từ `screen-inventory.md`.
- [ ] Mỗi Pencil component map tới frontend `Fb*` component theo `pencil-handoff.md`.
- [ ] Mỗi mutation map đến explicit API use case; không có generic CRUD/table mapping.
- [ ] Review đối chiếu `user-flows.md`, `interaction-specifications.md`, `design-system.md`, `pencil-handoff.md`.
- [ ] Đánh dấu frame/component `Ready for build` chỉ khi visual, behavior, permission và states cùng khớp.
- [ ] Freeze Pencil v0.1 trước khi tạo implementation plan hoặc scaffold ứng dụng.
