# Flowboard Pencil Execution Checklist v0.1

## Current canvas progress

- [x] Opened and actively designed in `docs/design/flowboard-v0.1.pen`.
- [x] Foundations, core components, Board, Task Detail, Project Members, Task Form, Project Dashboard, and My Tasks calendar are represented on canvas.
- [x] Responsive variants (12 Screen ID mobile × Light/Dark = 28 frame), authentication pages (20 frame AUTH-01…05) và system-state flows — **đã kiểm chứng trên đĩa** (blob `6acd09ae`); báo cáo Canvas v0.4 đã bị rút lại (xem [pencil-handoff.md](pencil-handoff.md)).
- [x] **Vietnamese copy review — owner đọc và ký 03/09/2026.** Ô này **không** dựa trên phép đo: máy kiểm được tương phản, token và cấu trúc, nhưng không kiểm được câu chữ hiển thị cho người dùng (nhãn nút, tiêu đề, thông báo lỗi, empty state, helper text) có rõ hành động tiếp theo và có nhất quán với bảng "Thuật ngữ chuẩn" hay không. Nó đứng trên chữ ký của owner; khi copy đổi đáng kể thì ô này phải mở lại.
- [ ] Tuyên bố `Ready for build` — artifact và ADR **không còn chặn** (ADR-0007/0008/0009 đã Accepted 03/09; canvas đã kiểm chứng trên đĩa). Vietnamese copy review đã được owner ký 03/09/2026. Hai trong ba việc chặn trước đây **đã đo là xong** (04/09/2026): `SYS-05`/`SYS-06` đã có frame Screen ID riêng cho cả Light và Dark; `FbModal`, `FbDrawer`, `FbActivityItem` đã dựng và có instance thật. Còn chặn bởi: hai cell state thiếu ở ô 32; các ô §4 interaction; các ô §5 handoff; và chữ ký owner cho visual direction (ô 29).

## Mục đích và cổng bắt đầu

Checklist này chuyển Markdown baseline v0.1 thành artefact Pencil. Markdown vẫn là nguồn quyết định cho product, behavior, permission, data và API; Pencil là nguồn chân lý cho bố cục và thiết kế trực quan.

- [x] Markdown baseline v0.1 đã qua acceptance review.
- [x] Tạo và mở `07-projects/fullstack-lab/docs/design/flowboard-v0.1.pen` trong Pencil.
- [x] Không thiết kế AI, export, Redis/BullMQ hoặc các non-goal như màn hình MVP.

## 1. Cấu trúc file Pencil

Artifact **không có khái niệm page**: `.pen` là một canvas phẳng, mọi thứ là frame ở depth 0 (đo 04/09/2026: 163 frame depth 0, không có API `Pages`). Năm mục dưới đây vì vậy được kiểm theo frame `REF-*` và frame Screen ID thật trên canvas, không theo page.

- [x] **Nền tảng**: `REF-01` (nền tảng thiết kế), `REF-04` (quy tắc điều hướng responsive) — mang visual direction, token reference và responsive reference.
- [x] **Component**: 25 frame định nghĩa `Fb*` ở depth 0, `REF-02` (danh mục component), `REF-03` (feedback và tham chiếu), `REF-15` (bảng trạng thái tương tác); component đã loại bỏ nằm trong `99 Archive`.
- [x] **Flow**: `REF-07` (quy trình review và trạng thái), `REF-09` và `REF-12` (trang lỗi và tổng hợp trạng thái hệ thống), `REF-08` và `REF-13` (quyền theo vai trò), `REF-10` (bộ lọc và chip).
- [x] **Screen**: frame đặt tên theo stable ID trong [screen-inventory.md](screen-inventory.md) — AUTH, WSP, PRJ, BRD, TSK, PRM, MYT, RPT, SYS, USR, TTS, WTL, WTA, WTR.
- [ ] **Handoff**: mapping Pencil→frontend, API data needs và trạng thái `Ready for build` sống ở [pencil-handoff.md](pencil-handoff.md) chứ không trên canvas; ô này đạt khi bảng mapping ở đó phủ đủ 25 component đang tồn tại.

## 2. Foundations và component system

- [ ] Áp dụng visual direction: clean, calm, productivity-focused.
- [x] Chốt semantic color, typography, spacing, radius, elevation, breakpoints và focus token — đo 04/09/2026: 199 biến, 168 tiền tố `fb.`, **0 hex ghi cứng**; quy tắc token và ramp đã là contract ở [design-system.md](design-system.md); hiện thực trong artifact **chưa có**.
- [x] Dựng `FbButtonPrimary` + `FbButtonSecondary` (hai component tách biệt, không phải một `FbButton` với prop `variant`), `FbTextField`, `FbPasswordField`, `FbSelect`, `FbDateField`, `FbModal`, `FbDrawer`, `FbAlert`, `FbStatePanel` (gánh cả Empty/Forbidden/Conflict thay cho `FbEmptyState`/`FbPermissionState`), `FbTaskCard`, `FbBoardColumn`, `FbActivityItem` — đo 04/09/2026: **13/13 có mặt**, không tồn tại `FbButton` gộp prop `variant`, và mọi component đều có instance thật (thấp nhất là `FbBoardColumn` và `FbActivityItem`, 8 instance mỗi cái).
- [ ] Mỗi component có default, hover, focus-visible, disabled, loading, error và responsive rule khi phù hợp. Đo 04/09/2026: `REF-15` (Light và Dark) có **15 section** phủ button, text/password/select/date field, link, list row, task card, board column, nav item trong `FbSidebar`, `FbTopbar`, nút đóng của `FbModal`/`FbDrawer`, kèm annotation đối chiếu [interaction-specifications.md](interaction-specifications.md) §8; `FbChecklistRow` được ghi rõ là chỉ báo trạng thái do client tính, không nhận tương tác. **Còn thiếu:** cell state cho `FbAccountMenu` (hover và focus-visible trên hàng menu) và `FbSidebarCollapsed` (hover và focus-visible trên icon, kèm hình của tooltip) — hai chỗ này hiện chỉ được mô tả bằng annotation, chưa vẽ ra, nên frontend không có tham chiếu hình.
- [x] Ant Design chỉ là primitive; component `Fb*` giữ behavior/style ổn định của Flowboard. Ô này **không kiểm được bên trong Pencil** vì Ant Design không tồn tại trong artifact; nó đứng trên hai thứ đo được: ranh giới wrapper là contract ở [design-system.md](design-system.md) (quy tắc wrapper và bảng primitive) cùng [pencil-handoff.md](pencil-handoff.md), và artifact có **0 hex ghi cứng** — mọi màu đọc từ biến `fb.*`.

## 3. Primary MVP flows và screens

- [x] Authentication: Sign Up, Sign In, Forgot/Reset Password, Email Verification — đo trên đĩa: AUTH-01 ×6, AUTH-02 ×4, AUTH-03 ×4, AUTH-04 ×2, AUTH-05 ×6, đủ cặp Light/Dark kèm biến thể liên kết hết hạn. Checklist mật khẩu đúng [ADR-0007](../decisions/ADR-0007-password-policy.md): hai dòng live, blocklist là field error sau submit, **chưa có trong artifact**; checklist mật khẩu phải dựng lại theo [ADR-0007](../decisions/ADR-0007-password-policy.md) vì policy đã đổi.
- [x] Workspace/project: Workspace List, Project List, Project Create, Project Settings — đo trên đĩa: WSP-01 ×4, WSP-02/03/04 ×2, PRJ-01 ×4, PRJ-02 ×2, PRJ-03 ×2.
- [x] Board: Project Board, Column Editor, Task Form, Task Detail, Comments, Activity History, Project Members — đo trên đĩa: BRD-01 ×8, BRD-02 ×2, TSK-01 ×6, TSK-02 ×8, PRM-01 ×2, PRJ-04 ×8, MYT-01 ×4.
- [x] System: Forbidden, Session Expired, Network Error, Conflict Resolution dùng chung `FbStatePanel` — đo trên đĩa: SYS-01 ×4, SYS-02 ×2, SYS-03 ×2, SYS-04 ×2, cùng REF-12 tổng hợp trạng thái. **Còn nợ:** `SYS-05`/`SYS-06` chỉ nằm bên trong `REF-09`, chưa có frame Screen ID riêng để frontend map 1:1.
- [x] Phản ánh role Owner / Editor / Viewer; Workspace Admin không có implicit access vào private project — role là slot trong tên frame, biến thể ở cột kề nhau: BRD-01 owner/editor/viewer, TSK-02 editor/viewer, PRJ-04 owner/viewer; Editor/Viewer ẩn `Thành viên` và `Cài đặt`.

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
