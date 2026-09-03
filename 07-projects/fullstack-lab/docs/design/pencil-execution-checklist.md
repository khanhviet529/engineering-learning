# Flowboard Pencil Execution Checklist v0.1

## Current canvas progress

- [x] Opened and actively designed in `docs/design/flowboard-v0.1.pen`.
- [x] Foundations, core components, Board, Task Detail, Project Members, Task Form, Project Dashboard, and My Tasks calendar are represented on canvas.
- [x] Responsive variants (12 Screen ID mobile × Light/Dark = 28 frame), authentication pages (20 frame AUTH-01…05) và system-state flows — **đã kiểm chứng trên đĩa** (blob `6acd09ae`); báo cáo Canvas v0.4 đã bị rút lại (xem [pencil-handoff.md](pencil-handoff.md)).
- [x] **Vietnamese copy review — owner đọc và ký 03/09/2026.** Ô này **không** dựa trên phép đo: máy kiểm được tương phản, token và cấu trúc, nhưng không kiểm được câu chữ hiển thị cho người dùng (nhãn nút, tiêu đề, thông báo lỗi, empty state, helper text) có rõ hành động tiếp theo và có nhất quán với bảng "Thuật ngữ chuẩn" hay không. Nó đứng trên chữ ký của owner; khi copy đổi đáng kể thì ô này phải mở lại.
- [ ] Tuyên bố `Ready for build` — artifact và ADR **không còn chặn** (ADR-0007/0008/0009 đã Accepted 03/09; canvas đã kiểm chứng trên đĩa). Vietnamese copy review đã được owner ký 03/09/2026. Hai trong ba việc chặn trước đây **đã đo là xong** (04/09/2026): `SYS-05`/`SYS-06` đã có frame Screen ID riêng cho cả Light và Dark; `FbModal`, `FbDrawer`, `FbActivityItem` đã dựng và có instance thật. Sau lượt đo 04/09/2026, còn chặn bởi bốn thứ: token `drop-target-surface` và cột dựng tay ở frame `dnd-syncing` (ô 47); dòng `work-log` chưa ghi path tường minh trong `REF-16` (ô 57); chữ ký owner cho visual direction (ô 31); và ba việc review của controller — đối chiếu stable ID/route/API theo `screen-inventory.md` (ô 55), review chéo bốn tài liệu (ô 58), đánh dấu `Ready for build` theo từng frame (ô 59).

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
- [x] **Handoff**: mapping Pencil→frontend, API data needs và trạng thái `Ready for build` sống ở [pencil-handoff.md](pencil-handoff.md) chứ không trên canvas. Đo 04/09/2026: **25/25 component trên canvas đều có dòng mapping** (bốn component app shell — `FbTopbar`, `FbSidebar`, `FbSidebarCollapsed`, `FbNavGroupTimeTracking` — nằm ở bảng riêng, cột đầu là tên component Pencil, cột hai là component frontend đích).

## 2. Foundations và component system

- [ ] Áp dụng visual direction: clean, calm, productivity-focused.
- [x] Chốt semantic color, typography, spacing, radius, elevation, breakpoints và focus token — đo 04/09/2026: 199 biến, 168 tiền tố `fb.`, **0 hex ghi cứng**. Trong 31 biến không mang tiền tố `fb.` (`canvas`, `surface`, `ink`, `space-8`… và cả họ `fb-` gạch nối cũ như `fb-bg`, `fb-primary`), **không biến nào còn được node nào tham chiếu** — chúng là rác của lượt thiết kế đầu. Phải xoá trước khi freeze, nếu không người export design token sẽ xuất cả 199; quy tắc token và ramp đã là contract ở [design-system.md](design-system.md); hiện thực trong artifact **chưa có**.
- [x] Dựng `FbButtonPrimary` + `FbButtonSecondary` (hai component tách biệt, không phải một `FbButton` với prop `variant`), `FbTextField`, `FbPasswordField`, `FbSelect`, `FbDateField`, `FbModal`, `FbDrawer`, `FbAlert`, `FbStatePanel` (gánh cả Empty/Forbidden/Conflict thay cho `FbEmptyState`/`FbPermissionState`), `FbTaskCard`, `FbBoardColumn`, `FbActivityItem` — đo 04/09/2026: **13/13 có mặt**, không tồn tại `FbButton` gộp prop `variant`, và mọi component đều có instance thật (thấp nhất là `FbBoardColumn` và `FbActivityItem`, 8 instance mỗi cái).
- [x] Mỗi component có default, hover, focus-visible, disabled, loading, error và responsive rule khi phù hợp. Đo 04/09/2026: `REF-15` (Light và Dark) có **16 section** phủ button, text/password/select/date field, link, list row, task card, board column, nav item trong `FbSidebar`, `FbTopbar`, nút đóng của `FbModal`/`FbDrawer`, kèm annotation đối chiếu [interaction-specifications.md](interaction-specifications.md) §8; `FbChecklistRow` được ghi rõ là chỉ báo trạng thái do client tính, không nhận tương tác. Hai chỗ từng thiếu nay đã vẽ thật: section `FbAccountMenu — hàng menu` có 4 cell (default, hover hàng `Hồ sơ và tùy chọn`, focus-visible, hover `Đăng xuất` dạng danger) trên instance thật; section `FbSidebarCollapsed — icon nav và tooltip` có 3 cell cộng ghi chú, và **tooltip được vẽ ra** (`frame Tooltip` → `Việc của tôi`) cạnh instance `FbSidebarCollapsed`, không còn chỉ là annotation.
- [x] Ant Design chỉ là primitive; component `Fb*` giữ behavior/style ổn định của Flowboard. Ô này **không kiểm được bên trong Pencil** vì Ant Design không tồn tại trong artifact; nó đứng trên hai thứ đo được: ranh giới wrapper là contract ở [design-system.md](design-system.md) (quy tắc wrapper và bảng primitive) cùng [pencil-handoff.md](pencil-handoff.md), và artifact có **0 hex ghi cứng** — mọi màu đọc từ biến `fb.*`.

## 3. Primary MVP flows và screens

- [x] Authentication: Sign Up, Sign In, Forgot/Reset Password, Email Verification — đo trên đĩa: AUTH-01 ×6, AUTH-02 ×4, AUTH-03 ×4, AUTH-04 ×2, AUTH-05 ×6, đủ cặp Light/Dark kèm biến thể liên kết hết hạn. Checklist mật khẩu đúng [ADR-0007](../decisions/ADR-0007-password-policy.md): hai dòng live, blocklist là field error sau submit, **chưa có trong artifact**; checklist mật khẩu phải dựng lại theo [ADR-0007](../decisions/ADR-0007-password-policy.md) vì policy đã đổi.
- [x] Workspace/project: Workspace List, Project List, Project Create, Project Settings — đo trên đĩa: WSP-01 ×4, WSP-02/03/04 ×2, PRJ-01 ×4, PRJ-02 ×2, PRJ-03 ×2.
- [x] Board: Project Board, Column Editor, Task Form, Task Detail, Comments, Activity History, Project Members — đo trên đĩa: BRD-01 ×8, BRD-02 ×2, TSK-01 ×6, TSK-02 ×8, PRM-01 ×2, PRJ-04 ×8, MYT-01 ×4.
- [x] System: Forbidden, Session Expired, Network Error, Conflict Resolution dùng chung `FbStatePanel` — đo trên đĩa: SYS-01 ×4, SYS-02 ×2, SYS-03 ×2, SYS-04 ×2, cùng REF-12 tổng hợp trạng thái. **Còn nợ:** `SYS-05`/`SYS-06` chỉ nằm bên trong `REF-09`, chưa có frame Screen ID riêng để frontend map 1:1.
- [x] Phản ánh role Owner / Editor / Viewer; Workspace Admin không có implicit access vào private project — role là slot trong tên frame, biến thể ở cột kề nhau: BRD-01 owner/editor/viewer, TSK-02 editor/viewer, PRJ-04 owner/viewer; Editor/Viewer ẩn `Thành viên` và `Cài đặt`.

## 4. Interaction và responsive behavior

- [ ] Drag-and-drop task: optimistic state, server-authoritative ordering, rollback/error state. Đo 04/09/2026 trên `BRD-01 · Light|Dark — … · editor · dnd-syncing`: card lifted (xoay + shadow), placeholder `Vị trí nguồn`, chip `Đang đồng bộ…` và alert rollback ghi rõ thứ tự cuối do server quyết — **đã có**. **Còn hai chỗ lệch:** frame này không dùng token `fb.color.state.drop-target-surface` ở đâu cả (chuỗi `drop-target` không xuất hiện trong frame), trong khi `drop-target` là state bắt buộc của `FbBoardColumn` theo [pencil-handoff.md](pencil-handoff.md) và có cell riêng ở `REF-15`; và các cột trong frame được **dựng bằng tay**, không phải instance `FbBoardColumn` (frame chỉ chứa `FbSidebar`, `FbTopbar`, `FbBadge`, `FbAlert`) — trái với chính nguyên tắc đã áp dụng ở frame `column-states`, nơi 4 cột đều là instance.
- [x] Task mutation: `expectedVersion`; `409 TASK_VERSION_CONFLICT` hiển thị flow resolution. Đo 04/09/2026: `REF-16` ghi `expectedVersion` bắt buộc khi sửa và `409 TASK_VERSION_CONFLICT` mở `SYS-04`, kèm quy tắc kéo-thả `409 giữ bản nháp, không force overwrite`; frame `SYS-04 · Light|Dark — Xử lý xung đột` tồn tại.
- [x] Form: validation, submit loading, error summary, unsaved-changes confirmation. Đo 04/09/2026: `TSK-01 · Light|Dark — … · editor · error-summary` có error summary hai lỗi (`Tiêu đề: bắt buộc, chưa nhập.` và điều kiện `startDate <= dueDate`), nút submit ở trạng thái `Đang lưu…`, và ghi rõ summary trỏ focus tới field chứ không thay lỗi tại field; copy xác nhận `Bỏ thay đổi chưa lưu?` có trên canvas.
- [x] Pagination/load-more, keyboard navigation, focus management và mobile horizontal board. Đo 04/09/2026: `BRD-01 · Light|Dark — … · editor · column-states` có **4 cột độc lập** là instance `FbBoardColumn` (loading skeleton, empty nêu rõ lý do đang lọc, error kèm `Thử lại`, loading-more với cursor theo từng cột) nhờ `Column State Slot` thêm vào component — state là override, không phải cột dựng tay; `REF-16` có 5 dòng về bàn phím, focus và live region; `BRD-01 · Mobile Light|Dark` tồn tại với 6 node cấu hình scroll ngang.
- [x] `403 EMAIL_VERIFICATION_REQUIRED`: clear password, route verification/resend, không retry sign-in tự động. Đo 04/09/2026: `REF-16` ghi đúng ba việc đó cho `POST /auth/sign-in`, cộng một dòng riêng `không auto-retry` áp cho cả `403`, `409` và `503`; frame `AUTH-05` tồn tại 6 bản.

## 5. Handoff và acceptance

- [ ] Mỗi screen dùng stable ID, route/context, role, API data và required states từ [screen-inventory.md](screen-inventory.md). Đo 04/09/2026: canvas có **32 Screen ID**, bảng inventory có **37 dòng**; mọi frame trên canvas đều khớp một dòng inventory (không có frame lạ), và role là slot trong tên frame (`owner`, `editor`, `viewer`, `ws-admin`, `guest`, `any`) đúng cột role của inventory. **Còn ba khoảng trống:**

  1. **5 dòng inventory chưa có frame nào:** `SPR-01`, `SPR-02`, `SPR-03`, `SPR-04` (Sprint — Phase 1.4, [ADR-0010](../decisions/ADR-0010-sprint-scope-and-invariants.md)) và `TSK-03` (quan hệ task — Phase 1.5, [ADR-0011](../decisions/ADR-0011-task-relations-subtask-and-dependency.md)). Hai phase này được thêm vào tài liệu ngày 03/09 và **chưa hề được thiết kế**. Đây là quyết định phạm vi của owner, không phải lỗi của design: hoặc dựng chúng trước khi freeze, hoặc ghi rõ v0.1 chỉ phủ core MVP cộng Phase 1.1 và 1.3.
  2. **`PRJ-04` thiếu biến thể Editor** — inventory ghi Owner, Editor, Viewer; canvas chỉ có `owner` và `viewer`.
  3. **`WTA-01` và `WTR-01` thiếu biến thể assigned Editor** — inventory ghi `Owner, assigned Editor`; canvas chỉ có `owner`. Đây đúng là trạng thái quyền đáng vẽ nhất của Time Tracking, vì [ma trận test phân quyền](../security/authorization-test-matrix.md) đã tách riêng hai actor Editor có và không phải `ProjectTimeApprover`.
- [x] Mỗi Pencil component map tới frontend `Fb*` component theo [pencil-handoff.md](pencil-handoff.md) — đo 04/09/2026: 25/25 component trên canvas có dòng mapping, không còn component nào thiếu.
- [ ] Mỗi mutation map đến explicit API use case; không có generic CRUD/table mapping. Đo 04/09/2026: `REF-16 · Mutation → API use case, bàn phím và live region` có bảng 12 dòng; **13/13 endpoint trong đó tồn tại nguyên văn** ở [endpoint-contracts.md](../api/endpoint-contracts.md), và mọi error code được nhắc (`EMAIL_VERIFICATION_REQUIRED`, `COLUMN_NOT_EMPTY`, `TASK_VERSION_CONFLICT`, `WORK_LOG_SELF_REVIEW_FORBIDDEN`) đều có trong danh mục error code — không có endpoint bịa. **Còn một dòng chưa tường minh:** hàng `WTL-02 ghi giờ` ghi `POST/PATCH work-log (Phase 1.3)`, không phải path thật; hợp đồng có `POST /projects/:projectId/work-logs` và `PATCH /work-logs/:workLogId`. Ô này đạt khi dòng đó ghi đúng hai path.
- [ ] Review đối chiếu `user-flows.md`, `interaction-specifications.md`, `design-system.md`, `pencil-handoff.md`.
- [ ] Đánh dấu frame/component `Ready for build` chỉ khi visual, behavior, permission và states cùng khớp.
- [ ] Freeze Pencil v0.1 trước khi tạo implementation plan hoặc scaffold ứng dụng.
