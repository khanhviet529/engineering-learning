# Hệ thống thiết kế Flowboard

## Phạm vi và nguyên tắc sở hữu

Pencil là nguồn chân lý cho bố cục, token đã chọn, component visual, variant responsive và tài sản giao diện. Markdown giữ hành vi sản phẩm, trạng thái dữ liệu và ràng buộc kỹ thuật. Khi hai nguồn khác nhau về hành vi, tài liệu hành vi được cập nhật trước khi frontend thay đổi; khi khác nhau về hình ảnh, frame Pencil được cập nhật.

Ant Design cung cấp primitives và token nền. Flowboard không rải trực tiếp primitive Ant Design vào feature khi sản phẩm cần hành vi hoặc style bền vững. `Fb*` wrapper sở hữu API component, state semantics, accessibility, style SCSS Module và mapping Pencil; wrapper có thể dùng Ant Design bên trong.

## Filter và select contract (Phase 1.3)

`FbSelect` dùng enum/fixed option; `FbAsyncMemberSelect` dùng người thực hiện, người giao và reviewer (avatar + search popup); `FbDateRangePicker` dùng date range; `FbSearchInput` chỉ search tự do. Select luôn có label, placeholder `Tất cả …`, chevron, default/open/selected/disabled/error/focus-visible state và active chip xóa được. Không dùng text giả làm dropdown.

Board, My Tasks, Dashboard, Progress Export, WorkLog, Approval Queue và Monthly Report dùng cùng pattern. `Trạng thái` map Board Column active, `Người giao` map creator, `Quá hạn` là derived due state; đổi filter reset cursor.

Ví dụ: `FbTaskForm` sở hữu validation presentation, unsaved changes và Conflict entry point; `FbProjectSettings` sở hữu Owner-only project-name mutation và dirty state; Ant Design `Form`, `Input`, `Select`, `DatePicker` chỉ là primitive. `FbBoard` sở hữu paging per-column, capability-driven affordance, DnD và mobile horizontal; Ant Design không định nghĩa các hành vi đó.

## Token

Pencil tạo token theo các nhóm và tên semantic sau. Giá trị cụ thể được quản lý trong Pencil/theme implementation, không ghi cứng lại ở từng frame/component.

| Nhóm | Tên semantic mẫu | Dùng cho |
|---|---|---|
| Color | `fb.color.surface.canvas`, `fb.color.surface.raised`, `fb.color.text.primary`, `fb.color.text.muted`, `fb.color.border.default` | Nền, chữ và ranh giới cấu trúc. |
| Intent | `fb.color.intent.success`, `warning`, `danger`, `info`, `focus` cùng các surface/text tương ứng | Success, Error, Forbidden, Conflict, validation và focus. Không chỉ truyền nghĩa bằng màu. |
| Typography | `fb.font.family.base`, `fb.font.size.body`, `fb.font.size.heading-*`, `fb.font.weight.*`, `fb.font.line-height.*` | Tiêu đề, body, metadata task, error text. |
| Spacing | `fb.space.0` đến các nấc tăng đều | Padding component, khoảng giữa section, gutter board. |
| Size | `fb.size.control.*`, `fb.size.icon.*`, `fb.size.avatar.*`, `fb.size.board-column-min` | Vùng chạm, icon, avatar và chiều rộng cột tối thiểu. |
| Shape | `fb.radius.*`, `fb.border.width.*` | Card, input, sheet, focus ring. |
| Elevation | `fb.shadow.raised`, `fb.shadow.drawer`, `fb.shadow.modal` | Cấp nổi của card/lớp phủ. |
| Motion | `fb.motion.duration.*`, `fb.motion.easing.*` | Mở drawer, feedback DnD, toast; tôn trọng reduced motion. |
| Layer | `fb.z.header`, `dropdown`, `drawer`, `modal`, `toast` | Thứ tự lớp phủ, không để toast chặn modal. |
| Breakpoint | `fb.breakpoint.compact`, `tablet`, `desktop` | Variant responsive; board chuyển sang horizontal scroll ở compact. |

Tên token dùng theo ngữ nghĩa, không theo màu vật lý như `blue-500`. Một component không tự tạo hex, khoảng cách hay shadow mới nếu token tương đương đã có.

### Token bắt buộc bổ sung và quy tắc ramp

> Mục này là **quy tắc và tên token bắt buộc**, không phải mô tả trạng thái canvas. Trạng thái artifact nằm ở [pencil-handoff.md](pencil-handoff.md) mục Canvas v0.4.

Ngoài mười nhóm ở bảng trên, các token sau là bắt buộc vì mang ngữ nghĩa riêng mà nhóm chung không diễn đạt được:

- `fb.color.nav.active.surface` / `fb.color.nav.active.text` — trạng thái active của điều hướng; phải theme-aware.
- `fb.color.brand.surface`, `fb.color.brand.on-surface` — brand khi dùng làm nền hoặc chữ theo theme.
- `fb.color.category.{feature,bug,design,research,operations,other}` — khớp đúng sáu category của Task.
- `fb.size.sidebar.expanded`, `fb.size.sidebar.collapsed` — hai bề rộng sidebar của `FbAppShell`.

**Quy tắc ramp và theme (bắt buộc).** Biến màu *phẳng* — một giá trị duy nhất, không theo theme, ví dụ `fb.color.neutral.50` hay `fb.color.intent.warning.100` — là giá trị *nguồn* của ramp và **không được dùng làm fill nền hoặc màu chữ/icon** trong frame thuộc screen có `theme`. Lý do cụ thể: một nền `neutral.50` (`#F9FAFB`) trong screen dark vẫn sáng, trong khi `text.primary` ở dark cũng là `#F9FAFB` — chữ trắng trên nền trắng, không đọc được. Nền dùng `surface.*` hoặc `*.surface`; chữ và icon dùng `text.*`, `*.text` hoặc `brand.on-*`.

**Thư viện icon (bắt buộc).** Lucide là thư viện icon **duy nhất**; không trộn Material Symbols hay bộ khác vào cùng canvas — hai bộ khác nhau về stroke weight, optical size và quy ước tên, trộn vào vừa lệch thị giác vừa không map được sang một icon package duy nhất khi build. Mỗi khái niệm dùng **đúng một** icon, không dùng đồng nghĩa:

| Khái niệm | Icon chốt | Không dùng |
|---|---|---|
| Thành viên, nhóm người | `users` | `group` |
| Ngày và lịch | `calendar-days` | `calendar` |
| Biểu đồ cột, báo cáo | `chart-column` | `chart-bar` |
| Đã xong, đã duyệt, tiêu chí đạt | `circle-check` | `check`, `check-check`, `check_circle` |
| Chuyển theme (chỉ ở topbar) | `sun-moon` | `sun`, `moon` riêng lẻ |
| Tổng quan project (nav `PRJ-04`) | `gauge` | `layout-dashboard` — icon đó là dấu thương hiệu trong `FbBrandMark`, dùng lại cho nav sẽ trùng nghĩa |
| Thu gọn / mở rộng sidebar | `panel-left-close` / `panel-left-open` | chevron đôi, `keyboard_double_arrow_right` |

**Tương phản (bắt buộc).** Mọi cặp chữ/nền đạt tối thiểu 4.5:1, hoặc 3:1 cho chữ từ 24px hoặc từ 19px bold — ở **cả hai** theme, tính trên nền tổ tiên gần nhất có fill đục.

## Quy tắc đặt tên component và variant

- Component product bắt đầu `Fb`: `FbTaskCard`, `FbBoardColumn`, `FbStatePanel`.
- Tên mô tả trách nhiệm người dùng, không mô tả primitive: dùng `FbConflictPanel`, không dùng `FbModal2`.
- Variant dùng props rõ nghĩa: `roleView="owner|editor|viewer"`, `state="loading|empty|error|forbidden|conflict"`, `viewport="compact|tablet|desktop"` khi relevant.
- State mutation tách với data state: `pending`, `syncing`, `disabled`, `dirty`, `invalid`. Không thay `Error` bằng `disabled` chung chung.
- Component Pencil mang cùng tên với frontend khi mapping là 1:1. Nếu frame là composition, tên bắt đầu bằng Screen ID, ví dụ `BRD-01 / Project Board / desktop / content`.

## Danh mục component MVP

| Flowboard component | Primitive Ant Design có thể dùng | Variant và state bắt buộc | Sở hữu bền vững của Flowboard |
|---|---|---|---|
| `FbAppShell` | Layout, Menu, Dropdown | authenticated, compact | context workspace, header responsive, điểm điều hướng. |
| `FbWorkspaceSwitcher` | Select, Dropdown | loading, empty, error | chỉ hiện workspace API trả; không suy ra project access. |
| `FbProjectList` | List, Card, Empty, Skeleton | loading, empty, error, forbidden | CTA tạo project theo capability server. |
| `FbBoard` | Layout, Spin, Empty | loading, empty, error, forbidden, compact-horizontal | query state, per-column paging, capability UI, DnD integration. |
| `FbBoardColumn` | Card, Button, Skeleton | loading, empty, loading-more, error-more, drop-target | title, task count đã nạp, `Tải thêm`, target DnD. |
| `FbTaskCard` | Card, Tag, Avatar, Button | default, syncing, lifted, conflict, readonly | metadata được phép, open detail, drag handle theo role. |
| `FbTaskForm` | Form, Input, Select, DatePicker, Button | create, edit, invalid, saving, error, conflict, dirty | schema presentation, assignee scope, unsaved changes, version handling. |
| `FbProjectSettings` | Form, Input, Button | loading, default, invalid, saving, error, forbidden, dirty | Mapping cho `PRJ-03`; form Owner-only có duy nhất `name`, gửi `PATCH /projects/:projectId` với `name`, đồng bộ tên server xác nhận; không có description, visibility hay destructive project action. |
| `FbTaskDrawer` | Drawer, Tabs | loading, content, error, forbidden, compact-sheet | giữ board context, focus return, comment/activity zones. |
| `FbCommentComposer` | Form, Input, Button | readonly, dirty, sending, error | immutable comment flow, idempotent retry presentation. |
| `FbActivityList` | Timeline, List, Empty, Skeleton | loading, empty, error, readonly | append-only activity presentation. |
| `FbColumnEditor` | Drawer/Modal, Form, List, Button | loading, empty, dirty, saving, error, archive-blocked | Owner-only column management and unsaved behavior. |
| `FbMemberManager` | Drawer/Modal, Table/List, Select, Button | loading, empty, pending, error, blocked-workspace-member | role selector, project scope, condition chặn membership workspace. |
| `FbStatePanel` | Result, Empty, Alert, Skeleton | Loading, Empty, Error, Forbidden, Session expired, Conflict | text/action semantics không để primitive tự quyết định. |
| `FbConfirmDiscardDialog` | Modal | default, confirm-pending | form dirty protection, focus mặc định an toàn. |
| `FbConflictPanel` | Modal/Drawer, Alert, Button | loading-current, current-ready, error, forbidden | xem bản hiện tại/bản nháp, không force overwrite. |

`FbStatePanel` có thể compose trong các component khác nhưng không thay thế Screen ID. Ví dụ BRD-01 Error vẫn là frame của `BRD-01` với `FbStatePanel state="error"`.

### Phân rã component trong Pencil

> Mục này là **yêu cầu phân rã**, không phải mô tả trạng thái canvas.

Pencil không cần một reusable cho mỗi dòng trong catalog trên. Yêu cầu là: mọi phần **lặp lại trên nhiều screen** phải là một reusable và mọi chỗ dùng phải là instance của nó — không copy-paste, vì bản copy trôi độc lập và là nguyên nhân cơ học của việc hai screen có header khác nhau.

Các phần sau bắt buộc là reusable dùng chung: shell (sidebar mở rộng, sidebar thu gọn, topbar, khối account controls, header mobile), header cột board (gồm badge số task đã nạp), task card, state panel và text field (gồm dấu `*` là element danger riêng).

Các mục còn lại của catalog chỉ dùng ở một hoặc hai screen; chúng là **composition theo Screen ID** compose từ các reusable trên, và vẫn là component ở frontend theo bảng catalog.

**Liên kết bằng chứng và định dạng comment (đã là contract theo [ADR-0009](../decisions/ADR-0009-task-evidence-and-comment-formatting.md), Accepted 2026-09-03):** `FbTaskForm` và Task Detail có trường `evidenceUrl` — một URL `https` duy nhất, tối đa 2048 ký tự, optional ở mọi cột kể cả cột yêu cầu review. UI hiển thị host dạng text và **không** fetch preview/thumbnail/favicon. `FbCommentComposer` có thể có toolbar nhưng chỉ chèn cú pháp Markdown thuộc subset allowlist (bold, italic, inline code, code block, list, link); body vẫn là plain text bất biến, không có HTML thô, không image/table/heading/embed, không mention.

### Task planning và due state

- `FbTaskForm` có title required, description, assignee, category, priority, start/end date và reviewer conditionally visible. Dấu `*` riêng có màu danger; field chỉ dùng border/help danger sau validation failure.
- `FbPriority` dùng năm giá trị `none|low|medium|high|urgent`. `FbDueState` chỉ render đúng năm giá trị server-derived của `dueState`: scheduled neutral, due-soon warning, due-today/overdue danger, và `none` thì không render pill. Task ở cột `isTerminal = true` luôn có `dueState = none` nên không bao giờ render overdue.
- Affordance hoàn thành là biểu diễn của **cột**, lấy từ `column.isTerminal` trong projection, **không** phải một giá trị `dueState` thứ sáu. `FbDueState` không được thêm variant `success`; dấu hiệu hoàn thành trên card là element/token riêng gắn với cột.
- `FbReviewHandoff` chỉ xuất hiện khi destination column `requiresReviewer`; chọn reviewer ProjectMember khác assignee trước mutation.
- `FbToast` là overlay góc trên phải cho outcome ngắn; form error nằm tại field; destructive action dùng confirm dialog. Không tạo page product riêng cho validation/toast.

## Quy tắc hình ảnh cho state và role

| Tình huống | Yêu cầu visual và hành vi |
|---|---|
| Loading | Skeleton giữ hình học chính của vùng sắp nạp; không dùng spinner toàn trang khi card/cột có thể skeleton. |
| Empty | Nêu rõ phạm vi rỗng; CTA chỉ có khi role/capability hiện tại được phép. |
| Error | Mô tả không thể xác nhận dữ liệu, CTA thử lại và giữ input chưa gửi khi phù hợp. |
| Forbidden | Không đặt preview dữ liệu private phía sau overlay; hành động quay lại an toàn. |
| Conflict | Khác Error bằng intent riêng, giải thích task thay đổi nơi khác và dẫn tới xem bản hiện tại. |
| Owner | Hiện affordance quản lý cột/thành viên và các action task. |
| Editor | Hiện action task/comment, không có affordance cấu hình cột/thành viên. |
| Viewer | Nội dung chỉ đọc, không có CTA, drag handle, form ghi hay composer comment. |
| Pending/syncing | Card/hàng cho biết đang chờ server, khóa thao tác mâu thuẫn nhưng không che nội dung. |
| Disabled | Chỉ dùng khi người dùng biết lý do và có text giải thích; không dùng để thay cho Forbidden. |

Icon, màu hoặc tooltip không được là kênh duy nhất truyền trạng thái. Mọi control tương tác có nhãn truy cập được, focus visible và target chạm phù hợp token size.

Light/dark dùng semantic token chung. Mỗi route có giao diện Light phải có frame Dark tương ứng với cùng information architecture, CTA, capability và state; Dark thay đổi surface, contrast, border, overlay, focus và semantic color, không chỉ đảo nền.

## Responsive

- Desktop ưu tiên board đa cột nhìn cùng lúc, cột không co đến mức task card khó đọc.
- Tablet có thể giảm gutter và gom control phụ nhưng không thay đổi thứ tự/ý nghĩa hành động.
- Compact dùng board ngang native; `fb.size.board-column-min` bảo vệ chiều rộng đọc được. Drawer/modal trở thành sheet toàn chiều cao khi cần.
- Không tạo UI mobile-only có quy tắc sản phẩm khác desktop. Owner/Editor/Viewer, Loading/Empty/Error/Forbidden/Conflict và keyboard/focus semantics giữ nguyên.
- Reduced motion giảm hoặc bỏ animation không thiết yếu; pending, target DnD và focus vẫn có dấu hiệu không phụ thuộc chuyển động.
- `MYT-01` hiển thị task nhiều ngày bằng một bar span từ start đến due; khi màn hình hẹp, chuyển sang danh sách theo ngày, không co bar đến mức không đọc được.

## Accessibility và nội dung

- Dùng heading theo cấu trúc screen, landmark cho header/main/board và label rõ cho controls.
- Dialog/drawer quản lý focus; đóng trả focus nguồn. Form lỗi chuyển focus đến trường lỗi đầu tiên.
- DnD có keyboard path và live announcement; không bắt buộc thao tác chuột/cảm ứng.
- Nội dung action dùng động từ cụ thể: `Tải thêm`, `Thử lại`, `Xem bản hiện tại`, `Tiếp tục chỉnh sửa`, `Bỏ thay đổi`.
- Text mẫu trong Pencil là placeholder visual trừ khi được đánh dấu là copy sản phẩm đã duyệt. Nó không được sinh thêm field, role hoặc hành vi.

### Contrast rule (Light/Dark)

- Normal text, meaningful icons, badges, input values, validation messages and interactive controls must meet a minimum contrast ratio of **4.5:1** against their immediate background in both Light and Dark themes.
- Large text (at least 24 px regular or 18.66 px bold) may use 3:1 only when it is not the sole carrier of essential information.
- Disabled and purely decorative content may use lower contrast, but must not communicate status, validation, permission or a required action on its own.
- A selected calendar day in Dark mode uses a dark selected surface with light/violet text; it must never reuse the white selected surface from Light mode.
- Every new or changed Pencil page must be checked for contrast on page background, card surface, overlay, form field, alert/banner, table row, calendar selection and focus-visible state before it is marked ready for build.

### Minimum readable scale và approved contrast pairs

- Dùng `Inter` qua token `fb.font.family.base`. Cỡ chữ nội dung và metadata có ý nghĩa không nhỏ hơn `11px`; body và control mặc định là `13–14px`; heading screen từ `18px` trở lên.
- Light: `#182230` trên `#FFFFFF`/`#F6F7FB`, `#344054` trên surface, và `#B42318` trên `#FEF3F2` là các cặp nội dung chính. Dark: `#F9FAFB`/`#E4E7EC` trên `#111827`/`#1F2937`, muted `#98A2B3`, link/info `#84ADFF`, danger `#FDA29B`.
- Các cặp đã kiểm tra: `#182230/#FFFFFF` 16.03:1, `#344054/#FFFFFF` 10.46:1, `#B42318/#FEF3F2` 6.05:1, `#F9FAFB/#1F2937` 14.05:1, `#E4E7EC/#1F2937` 11.84:1, `#98A2B3/#1F2937` 5.70:1, `#84ADFF/#1E3A5F` 5.15:1 và `#FDA29B/#4A1D1C` 7.29:1.
- Chữ trắng chỉ dùng trên primary/semantic surface đủ tối; không đổi chữ của CTA sang màu Dark khi chuyển theme. Icon switch theme là icon-only, có accessible label/tooltip, không thêm text hiển thị cạnh icon.
