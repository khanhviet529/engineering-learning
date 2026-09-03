# Bàn giao Pencil cho Flowboard

## Mục tiêu bàn giao

Pencil chuyển hợp đồng UX thành thiết kế trực quan có thể xây được. Frontend chuyển component/variant đã duyệt thành UI. Cả hai không được tự phát minh endpoint, field, quyền hay nhánh lỗi chưa có trong tài liệu này và baseline.

Phiên bản ban đầu của bộ bàn giao là `Flowboard UX v0.1`, phạm vi core MVP. Nó bao gồm authentication, workspace/project private, board, cột, task, comment, activity, membership và system states. Nó không gồm reports, AI, realtime hay các non-goal khác.

## Nguồn chân lý và thứ tự xử lý khác biệt

| Nội dung | Nguồn quyết định | Cách xử lý nếu phát hiện khác biệt |
|---|---|---|
| Bố cục, token, asset, component visual, responsive composition | Pencil | Cập nhật frame/component Pencil và version bàn giao. |
| Luồng, route context, role outcome, Loading/Empty/Error/Forbidden/Conflict, DnD, concurrency | Bộ tài liệu UX và baseline | Cập nhật tài liệu trước; không sửa Pencil để che khác biệt hành vi. |
| Data field, API, validation server, authorization | Baseline và hợp đồng kỹ thuật được phê duyệt | Không thêm vào frame như một giả định. Escalate để có quyết định trước khi xây. |

Pencil biểu diễn role bằng các outcome Owner, Editor, Viewer và Workspace Admin như đã có. Workspace Admin chưa là project member phải có frame Forbidden, không có frame board “Admin read-only”. Tài liệu này không là nguồn định nghĩa quyền chính thức.

## Cấu trúc file Pencil

```text
00 Foundations
├── Color / Typography / Spacing / Elevation / Motion
├── Intent states
└── Responsive tokens

01 Components
├── App shell and navigation
├── Board and task
├── Forms and overlays
├── Membership
└── State panels

02 Screens
├── Authentication
├── Workspace and project list
├── Project Settings
├── Board
├── Task detail and forms
└── System states

03 Flows
├── Owner setup
├── Editor daily work
├── Viewer review
└── Failure and recovery

99 Archive
└── Deprecated frames and components
```

Tên frame bắt buộc:

```text
[Screen ID] / [tên] / [viewport] / [role hoặc capability outcome] / [state]

Ví dụ:
BRD-01 / Project Board / desktop / editor / content
BRD-01 / Project Board / compact / viewer / empty-filtered
TSK-01 / Task Form / desktop / owner / validation-error
PRJ-03 / Project Settings / desktop / owner / saving
SYS-04 / Conflict Resolution / compact / editor / current-version-ready
```

`Screen ID` phải khớp nguyên văn danh mục màn hình. `state` dùng tên rõ như `loading`, `empty`, `error`, `forbidden`, `conflict`, `syncing`, không dùng tên mơ hồ như `final-v2`.

## Thành phần và mapping Pencil → frontend

| Component/Pencil frame | Frontend component mục tiêu | Ant Design primitive bên trong (nếu cần) | Bắt buộc bàn giao |
|---|---|---|---|
| `Fb / App Shell` | `FbAppShell` | Layout, Menu, Dropdown | header desktop/compact, workspace context, focus order. |
| `Fb / Workspace Switcher` | `FbWorkspaceSwitcher` | Select, Dropdown, Skeleton | Loading, Empty, Error; chỉ dữ liệu workspace được phép. |
| `Fb / Project List` | `FbProjectList` | List, Card, Empty, Skeleton | content, Loading, Empty, Error, CTA theo capability. |
| `Fb / Board` | `FbBoard` | Layout, Spin, Empty | desktop, compact horizontal, filter bar, per-column state, Forbidden. |
| `Fb / Board Column` | `FbBoardColumn` | Card, Button, Skeleton | content, Loading, Empty, loading-more, Error-more, drop-target. |
| `Fb / Task Card` | `FbTaskCard` | Card, Tag, Avatar, Button | Owner/Editor drag handle, Viewer readonly, syncing, lifted, Conflict return. |
| `Fb / Task Form` | `FbTaskForm` | Form, Input, Select, DatePicker, Button | create/edit, validation, saving, Error, dirty/unsaved, Conflict entry. |
| `Fb / Project Settings` | `FbProjectSettings` | Form, Input, Button | Owner-only Loading, default, validation, Saving, Error, Forbidden, unsaved; form có duy nhất `name`, gửi `PATCH /projects/:projectId` với `name`. |
| `Fb / Task Detail` | `FbTaskDrawer` | Drawer, Tabs | Loading, content, Viewer readonly, comment/activity Empty, Error, focus return. |
| `Fb / Comment Composer` | `FbCommentComposer` | Form, Input, Button | editor/owner sending, Error retry; viewer readonly/absent. |
| `Fb / Activity List` | `FbActivityList` | Timeline, List, Empty | Loading, Empty, Error, immutable/read-only. |
| `Fb / Column Editor` | `FbColumnEditor` | Drawer/Modal, Form, List | Owner content, Empty, archive-blocked, Error, unsaved. |
| `Fb / Project Members` | `FbMemberManager` | Drawer/Modal, Table/List, Select | Owner content, Loading, Error, workspace-member blocked. |
| `Fb / State Panel` | `FbStatePanel` | Result, Alert, Empty, Skeleton | Loading, Empty, Error, Forbidden, Session expired; action copy. |
| `Fb / Discard Changes` | `FbConfirmDiscardDialog` | Modal | dirty confirmation and focus default. |
| `Fb / Conflict Resolution` | `FbConflictPanel` | Modal/Drawer, Alert, Button | Loading current version, current + draft, Error, Forbidden; no force overwrite. |

Một component Pencil không có mapping frontend là tài sản minh họa và phải ghi rõ `visual-only`. Một wrapper Flowboard không được bị thay bằng primitive Ant Design trong feature chỉ vì frame hiện tại trông giống primitive đó.

## Hợp đồng variant và state

Mỗi component reusable phải có property panel trong Pencil ghi ít nhất: tên variant, role/capability outcome, viewport, data state, mutation state và accessibility note. Ví dụ `FbTaskCard` cần `readonly`, `draggable`, `syncing`, `lifted`, `conflict`; `FbStatePanel` cần Loading, Empty, Error, Forbidden, Session expired và Conflict.

Frame màn hình phải nói rõ dữ liệu nào là ví dụ visual và dữ liệu nào là điều kiện UI. Ví dụ, tên assignee là dữ liệu mẫu; `assignee chỉ chọn từ project member` là điều kiện hành vi. Không đưa labels, checklist, attachment, report, AI summary hoặc control phân quyền tùy biến vào frame MVP.

## Hướng dẫn thiết kế các trạng thái cần có

| State | Frame cần có | Điều phải thấy |
|---|---|---|
| Loading | danh sách, board, task detail, editor | skeleton theo bố cục; không có dữ liệu giả. |
| Empty | workspace/project list, cột, comment, activity | nguyên nhân rỗng và CTA đúng role, nếu có. |
| Error | tải dữ liệu, load more, form mutation, comment | mô tả lỗi, Thử lại; form/bản nháp vẫn còn khi an toàn. |
| Forbidden | project route, panel owner-only, direct URL | không có preview dữ liệu private; đường quay lại an toàn. |
| Session expired | request sau phiên hết hạn | giải thích cần đăng nhập lại; không hứa tự gửi lại thay đổi. |
| Conflict | edit/move task nhận 409 | bản hiện tại/bản nháp khi có, xem lại/chủ động áp dụng lại, không force overwrite. |
| DnD/pending | board card giữa lúc move | source, target, lifted/syncing và rollback Error. |
| Unsaved changes | task/column/project form dirty | dialog tiếp tục chỉnh sửa hoặc bỏ thay đổi; focus mặc định an toàn. |
| Project Settings | `PRJ-03` Owner-only | Loading, default, validation, Saving, Error, Forbidden, unsaved; chỉ một input name và annotation `PATCH /projects/:projectId`. |

## Responsive và accessibility handoff

- Mỗi screen có ít nhất desktop và compact frame khi bố cục thay đổi. BRD-01 compact bắt buộc là board ngang có thể cuộn, không phải list cột dọc thay thế.
- `PRJ-03` có frame Owner-only desktop và compact cho Loading, default, validation, Saving, Error, Forbidden và unsaved. Frame chỉ có field `name`; không vẽ description, visibility hoặc destructive project action.
- Drawer/modal compact dùng full-height sheet; ghi vị trí nút đóng, heading, vùng cuộn và focus return.
- Gắn annotation cho thứ tự focus, trigger mở/đóng, keyboard DnD (`Space`, mũi tên, `Escape`), live announcement và reduced-motion behavior.
- Variant role không chỉ ẩn icon. Frame Viewer phải cho thấy bề mặt đọc không có form/drag/comment composer; frame Editor không có cột/thành viên management; frame Owner có các affordance tương ứng.

## Quy trình bàn giao và versioning

1. Designer tạo/cập nhật component trong `01 Components`, gán token semantic và variant/state trước khi compose screen.
2. Designer compose frame theo Screen ID, viewport, role outcome và state. Mọi interaction được annotation đến flow/đặc tả tương ứng bằng tên tài liệu và ID, không cần tạo link tới tài liệu chưa tồn tại.
3. Designer đánh dấu trạng thái `Draft`, `Ready for review`, `Ready for build` hoặc `Deprecated`. Chỉ frame/component `Ready for build` được frontend dùng làm quyết định visual.
4. Khi thay đổi visual không đổi hành vi, tăng bản vá: `v0.1.1`. Khi thêm/đổi variant hay screen trong phạm vi đã phê duyệt, tăng minor: `v0.2`. Thay đổi role outcome, data field, route context, flow, DnD, Error/Conflict/permission behavior phải có quyết định Markdown/baseline trước khi Pencil tăng version.
5. Mỗi bàn giao ghi version, ngày, owner thiết kế, Screen ID/component bị tác động và thay đổi có thể thấy. Frame cũ chuyển `99 Archive`, không ghi đè lịch sử.

Tiến độ dựng canvas theo baseline v0.1 được theo dõi trong [checklist thực thi Pencil](pencil-execution-checklist.md); các đợt refactor control và screen mới theo Phase 1.3 dùng [checklist refactor UI/UX](pencil-refactor-checklist.md).

## Checklist trước khi frontend nhận bàn giao

- [ ] Mỗi frame có Screen ID, viewport, role/capability outcome và state.
- [ ] Có variant Loading, Empty, Error, Forbidden và Conflict ở đúng bề mặt áp dụng.
- [ ] Board có desktop, compact horizontal, DnD, syncing, rollback Error và Conflict.
- [ ] Form có validation, saving, Error, unsaved changes và Conflict entry point.
- [ ] `PRJ-03 Project Settings` có mapping `FbProjectSettings`, chỉ một field `name` và annotation `PATCH /projects/:projectId`.
- [ ] Role Owner, Editor, Viewer và trường hợp Workspace Admin chưa là project member được thể hiện đúng outcome.
- [ ] Component dùng token semantic, có mapping `Fb*` frontend và ghi primitive Ant Design nếu dùng.
- [ ] Annotation có focus return, keyboard path, live announcement và responsive behavior.
- [ ] Không có component/screen/CTA cho report, AI hoặc tính năng ngoài core MVP.
- [ ] Mọi field, endpoint hoặc hành vi chưa được xác định được đánh dấu là blocker để làm rõ, không được tự thiết kế.

Khi checklist đạt, frontend triển khai wrapper Flowboard trước rồi dùng Ant Design primitives bên trong wrapper. Nếu implementation phát hiện một state chưa được thiết kế, trạng thái đó quay lại Pencil và tài liệu UX để làm rõ thay vì tự chọn hành vi.

## Hồ sơ bàn giao theo version

Các mục dưới đây là record bàn giao của từng version canvas theo đúng quy trình versioning ở trên — mỗi version ghi trật tự canvas và mapping thực thi tại thời điểm bàn giao. Version mới thêm mục mới, không ghi đè mục cũ.

### Canvas v0.2 — trật tự và mapping thực thi

Canvas được sắp theo ba hàng để review không bị lẫn theme:

1. **Hàng chung:** Foundations, Components, Feedback/Reference, Responsive/Navigation, workflow, permission matrix, error-page reference.
2. **Hàng Light:** Shell, authentication, WSP-01…04, PRJ-01…03, BRD-01…02, task form/detail, members, permissions, dashboard, My Tasks và SYS-01…06.
3. **Hàng Dark:** đúng thứ tự và phạm vi Screen ID của hàng Light. Dark dùng surface, border, overlay, focus và màu semantic riêng; không phải frame Light đổi nền.

Các frame mới cần được frontend dùng làm mapping trực tiếp:

| Nhóm | Frame/Pencil | Hợp đồng build |
|---|---|---|
| Workspace | `WSP-02`, `WSP-03`, `WSP-04` | Tạo workspace, quản lý member cấp workspace, capability-gated settings. Workspace role không suy ra quyền project private. |
| Project | `PRJ-01`, `PRJ-03` | Danh sách project authorized; Settings Owner-only chỉ có `name` và `PATCH /projects/:projectId`. |
| Board | `BRD-02` | Overlay giữa Board, Owner-only, reorder, archive-blocked và validation inline. |
| System | `SYS-01…04`, `SYS-05/06` | 403 an toàn không render project data; session hết hạn không replay mutation; network error giữ form chưa gửi; conflict không force overwrite. |
| Responsive | `02.1 Navigation — Responsive Rules` | Desktop/sidebar, tablet collapsed, mobile overlay menu; Board mobile cuộn ngang và có fallback List/Calendar. |
| Reporting | `RPT-01` trong `PRJ-04 Dashboard` | Nút `Xuất tiến độ` chỉ hiện với capability `report:export` của Owner trong Phase 1.1; panel tuân theo request/pending/ready/failed/expired, không gửi email hay schedule. |
| Tài khoản | `USR-01` | Footer sidebar mở Hồ sơ & tùy chọn. Theme `light|dark|system` là preference local; display name/email và workspace timezone chỉ đọc; đổi mật khẩu đi qua `AUTH-03`. |

Quy tắc role hiển thị trên frame: `Owner · Chủ sở hữu`, `Editor · Có thể chỉnh sửa`, `Viewer · Chỉ xem`. UI chọn route/CTA từ capability server; backend vẫn bắt buộc kiểm tra authorization ở mọi request.

`FbAppShell` có icon cho từng mục sidebar. Desktop có control thu gọn: khi collapsed chỉ còn icon, tooltip/accessible label hiển thị tên mục khi hover hoặc focus, mục active vẫn có nền/indicator. Không render nhãn ẩn bằng `display: none` mà bỏ accessible name; control giữ `aria-label` và focus-visible.

Time Tracking Phase 1.3 dùng `FbSelect`, `FbAsyncMemberSelect`, `FbDateRangePicker`, `FbSearchInput` và filter chips; không dùng text giả dropdown. Pencil phải có Light/Dark cho `TTS-01`, `WTL-01/02`, `WTA-01`, `WTR-01`; CTA lấy capability server, Owner/assigned Editor review, Viewer read-only.

### Canvas v0.3 — Time Tracking Phase 1.3

Time Tracking là section riêng trong Project Settings, không mở rộng form `PRJ-03` core MVP vốn chỉ sửa `name`. Các frame sau là nguồn mapping visual cho Phase 1.3; tên Light/Dark phải luôn đi theo cặp.

| Screen ID | Frame Pencil | Contract build |
|---|---|---|
| `TTS-01` | `TTS-01 Light/Dark — Cài đặt chấm công` | Owner-only: enable, `self_close|requires_approval`, 0–31 ngày ghi bù, `FbAsyncMemberSelect` chỉ chọn active Editor approver; cảnh báo không hồi tố. |
| `WTL-01` | `WTL-01 Light/Dark — Nhật ký giờ` | Day list, daily total và status Draft/Submitted/Approved/Rejected. Chỉ Owner/Editor có CTA ghi giờ. |
| `WTL-02` | `WTL-02 Light/Dark — Ghi giờ`; `WTL-02 Mobile Light — Ghi giờ` | Modal desktop, full-height sheet mobile; task async select, date picker, duration select, description, support-reason inline error, draft/submit. |
| `WTA-01` | `WTA-01 Light/Dark — Phê duyệt giờ`; `WTA-01 Light/Dark — Trả lại nhật ký` | Owner/assigned Editor. Queue filter, selected summary, per-record result and rejection reason required. Self-review CTA không xuất hiện; bulk không được hiển thị như all-or-nothing. |
| `WTR-01` | `WTR-01 Light/Dark — Báo cáo giờ` | Month/member select, final/self-closed/pending/rejected breakdown and accessible member drilldown. Không có CTA time-export. |
| `TSK-02` | `TSK-02 Light/Dark — Chi tiết công việc` | Read-only time-log extension, scope theo task; CTA ghi giờ chỉ khi có server capability. |

Responsive reference `WTA-01 Mobile Dark — Bộ lọc` minh hoạ filter drawer; finite filter phải có label/value/icon (`chevron`, `calendar` hoặc search) và trạng thái active chip. Khi thay filter, frontend reset cursor theo API contract. Tất cả text/icon meaningful của các frame này dùng tối thiểu 11 px và color pairing đạt contrast 4.5:1.

### Canvas v0.4 — Component hoá, token hoá, auth/mobile hoàn chỉnh

> **Chờ kiểm chứng artifact (03/09/2026).** Số liệu và trạng thái canvas trong mục này chưa kiểm chứng được: `docs/design/flowboard-v0.1.pen` trong repository vẫn đúng bằng bản của commit `aa23e17` (blob `7ff13e6a`, ghi lần cuối 2026-09-02 22:23:20), còn mục này được viết 2026-09-03 00:39–00:41 — file canvas không được ghi lại sau đó. Xem [báo cáo Canvas v0.4](../design-and-docs-plan.md). Quy tắc, quy ước tên và bẫy kỹ thuật ở đây vẫn dùng được; các con số không được coi là đã đạt.

Version này đổi cấu trúc file từ copy-paste sang component-instance và chuẩn hoá lại toàn bộ canvas. Số liệu kiểm chứng tại thời điểm bàn giao: **113 root frame, 9 reusable component, ~350 instance, 150 biến token (0 hex ghi cứng), 0 lỗi layout, 1.742 text node đạt WCAG AA**.

#### Trật tự canvas (pitch 1560 × 1500)

| Hàng (y) | Nội dung |
|---|---|
| `-4000…-420` | Dải **FB COMPONENTS**: các reusable (`FbSidebar`, `FbSidebarCollapsed`, `FbTopbar`, `FbHeaderAccountControls`, `FbBoardColumnHeader`, `FbTaskCard`, `FbStatePanel`, `FbTextField`, `FbMobileHeader`). Chỉ sửa ở đây; mọi màn nhận thay đổi qua instance. |
| `0` | Tham chiếu: `REF-01…08` + `SYS-05/06 · Light/Dark — Trang lỗi` (light/dark đứng cạnh nhau). |
| `1500` / `3000` | Hàng Light / hàng Dark của màn desktop chính — **cùng x là một cặp Light/Dark**. |
| `4500` / `6000` | Phase 1.3 Light / Dark (`TTS-01`, `WTL-01/02`, `WTA-01`, `WTR-01`, `TSK-02 (Giờ)`, `WTA-01 (Trả lại)`). |
| `7500` / `9000` | `AUTH-01…05` Light / Dark — trang đầy đủ (panel brand trái + form phải), không còn dạng card nổi. |
| `10500` / `11700` | Bộ **mobile 390×844** Light / Dark: `AUTH-01`, `PRJ-01`, `BRD-01` (board ngang + cột peek), `TSK-01` (sheet), `TSK-02` (sheet), `MYT-01`, `PRJ-04`, `WTL-02`, `WTA-01`. |

Quy ước đặt tên frame màn hình (một hệ duy nhất): `<Screen ID> · <Light|Dark|Mobile Light|Mobile Dark> — <Tên tiếng Việt>`; tham chiếu dùng `REF-NN`. Không còn hậu tố `Copy`, không còn node không tên, dấu `×` của chip/nút đóng là element icon riêng (gắn handler được), 5 màn tham chiếu tràn chủ đích đã bật `clip`.

#### Những gì frontend có thể tin

- Header/topbar mọi màn là **một** `FbTopbar` (breadcrumb + spacer + account controls, tự co 1112/1304/1376); sidebar mọi màn là **một** `FbSidebar` 264px (3 nhóm nav; nhóm `CHẤM CÔNG` chỉ bật ở màn Phase 1.3 và shell tham chiếu vì `project_time_tracking_settings` mặc định disabled) hoặc `FbSidebarCollapsed` 72px.
- Badge số lượng ở header cột board = **số task đã nạp** (đúng câu chữ design-system), không phải tổng server.
- Due-state trên `FbTaskCard` chỉ dùng vocabulary `FbDueState`: neutral (scheduled/chưa đặt hạn), warning (hôm nay/ngày mai), danger (quá hạn), success (hoàn thành) — không còn màu brand cho hạn.
- Sơ đồ trong `PRJ-04`, `RPT-01`, `WTR-01`, `PRJ-04 Mobile` là stacked-bar + legend chữ (không truyền nghĩa chỉ bằng màu); không dùng line/sparkline vì Pencil không vẽ cung/đường tin cậy.
- `AUTH-02/04` render checklist mật khẩu (≥8 ký tự, hoa, thường, số, ký tự đặc biệt) khớp password policy trong `security/authentication.md`; `AUTH-03` ghi rõ thông báo không tiết lộ email tồn tại; `AUTH-04` cảnh báo revoke mọi phiên; `AUTH-05` là **trang đích của liên kết** xác minh (không phải màn nhập mã) kèm biến thể liên kết hết hạn.

#### Bẫy kỹ thuật Pencil (bắt buộc biết khi sửa file)

1. **Biến number không resolve trong `width`/`height`** — component sẽ collapse về 0×0. Biến number chỉ dùng an toàn cho `gap`; `padding` bằng biến cũng từng làm collapse. Ghi số literal cho hình học, biến cho màu.
2. `theme` chỉ có tác dụng ở **root frame**; đặt trên frame lồng sẽ bị bỏ qua im lặng.
3. Screenshot bản định nghĩa `reusable` có thể trắng — luôn chụp **instance** đặt trong ngữ cảnh thật.
4. `ctx.problems` tính trong cùng lượt `execute` với mutation cho false-positive; kiểm lại ở lượt kế tiếp trước khi tin.
5. Token phẳng (ramp) làm nền/chữ trong màn có theme là bug tiềm ẩn — xem quy tắc ramp trong `design-system.md`.
