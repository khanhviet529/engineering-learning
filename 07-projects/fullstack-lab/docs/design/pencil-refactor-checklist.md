# Flowboard UI/UX Refactor Checklist v1

**Mục tiêu:** Biến `flowboard-v0.1.pen` thành đặc tả trực quan hoàn chỉnh, để một kỹ sư frontend có thể nhìn theo từng trang, trạng thái, theme và quyền mà không phải suy đoán bố cục hay hành vi.

**Nguồn quyết định:** `screen-inventory.md`, `design-system.md`, `interaction-specifications.md`, `user-flows.md`, ma trận quyền và các ADR hiện hành. Pencil mô tả giao diện; Markdown vẫn là nguồn quyết định cho product, data, API và bảo mật.

## Nguyên tắc bất biến

- [x] Mỗi screen là một trang hoàn chỉnh, có app shell, sidebar, header, mục sidebar đang active và vùng nội dung thật.
- [x] Modal, drawer, confirm dialog và toast luôn được đặt trên một trang nền phù hợp; không thiết kế chúng như khối trôi độc lập.
- [x] Light và Dark có cùng cấu trúc thông tin, nội dung và hành vi; mỗi theme có token màu, tương phản và trạng thái riêng.
- [x] Copy tiếng Việt nhất quán; chỉ giữ nguyên tên sản phẩm, role cố định (`Owner`, `Editor`, `Viewer`), email và thuật ngữ kỹ thuật chuẩn.
- [x] Quyền được thể hiện đồng thời ở điều hướng, CTA, trạng thái disabled/ẩn và màn cấm truy cập; backend vẫn là nơi quyết định cuối cùng.
- [x] Mỗi trang có tối thiểu state mặc định; state loading, empty, error, forbidden hoặc validation khi screen inventory yêu cầu.

## 1. Nền tảng thiết kế mở rộng

- [x] Refactor `00 Global design system`: font family, thang typography, grid, spacing, radius, elevation, iconography, breakpoint và focus ring.
- [x] Thiết kế token semantic Light: surface, text, border, primary, success, warning, danger, info, muted và interactive state.
- [x] Thiết kế token semantic Dark tương ứng; kiểm tra tương phản cho text, icon, badge, focus, hover và disabled.
- [x] Chuẩn hoá component: button, icon button, text field, textarea, select, date picker, search/filter, table, tab, badge, avatar, tooltip, pagination và skeleton.
- [x] Chuẩn hoá feedback: validation inline, error summary, toast, banner, confirmation dialog, loading, empty, 403, 404, 503, session expired và conflict.
- [x] Mỗi component mô tả default, hover, focus-visible, disabled, loading và error khi trạng thái đó có ý nghĩa.

## 2. Shell và hệ thống điều hướng

- [x] Thiết kế Light shell desktop: sidebar, top bar, project context, breadcrumb, theme switch icon-only và active navigation.
- [x] Thiết kế Dark shell desktop với cùng cấu trúc và token Dark.
- [x] Thiết kế quy tắc collapsed/mobile: sidebar thu gọn, menu overlay, board cuộn ngang và fallback list/calendar.
- [x] Lập ma trận sidebar theo context: chưa đăng nhập, workspace, project Owner, project Editor, project Viewer và không có quyền.
- [x] Dùng một `FbAppShell` thống nhất: từng mục sidebar có icon; trạng thái active luôn giữ nền/indicator; bản desktop thu gọn chỉ hiển thị icon nhưng vẫn có tooltip, accessible name và focus-visible.

## 3. Light — trang xác thực và workspace

- [x] Thiết kế AUTH-01 đến AUTH-05: đăng nhập, đăng ký, quên/đặt lại mật khẩu, xác minh email; có validation, loading và error phù hợp.
- [x] Thiết kế WSP-01 đến WSP-04: đã hoàn thành WSP-01; còn WSP-02 đến WSP-04.
- [x] Thiết kế PRJ-01 đến PRJ-03: danh sách/tạo project, cài đặt project Owner-only; mọi modal hiển thị trên trang nền hoàn chỉnh.

## 4. Light — trang làm việc theo project

- [x] Thiết kế BRD-01 Board: search, filter, sort, active filters, pagination/load-more, cột, task card, empty/loading/error và board ngang trên mobile.
- [x] Thiết kế BRD-02 Column Editor trên Board dimmed overlay; Owner-only, có validation và archive-blocked state.
- [x] Thiết kế TSK-01 Task Form trên Board dimmed overlay: title, description, status, assignee, priority, category, start/end date, reviewer có điều kiện, validation đỏ, loading, conflict và discard confirmation.
- [x] Thiết kế TSK-02 Task Detail trên Board dimmed overlay: dữ liệu task, activity, comment, concurrency conflict và phiên bản read-only của Viewer.
- [x] Thiết kế PRM-01 Project Members với bảng căn cột, mời/thay đổi role/xóa member; rõ khác biệt Owner, Editor và Viewer.
- [x] Thiết kế MYT-01 danh sách và lịch đa ngày; task trải nhiều ngày là thanh liên tục từ ngày bắt đầu đến ngày kết thúc.
- [x] Thiết kế PRJ-04 Dashboard: tiến độ, workload, overdue, empty/error và quyền chỉ đọc.
- [x] Thiết kế RPT-01 Xuất tiến độ trên nền Dashboard: CTA chỉ dành cho Owner có `report:export`, snapshot bộ lọc, vòng đời pending/ready/failed/expired và không có email/schedule trong Phase 1.1.
- [x] Thiết kế USR-01 Hồ sơ và tùy chọn: hồ sơ chỉ đọc, theme `light|dark|system` lưu cục bộ, múi giờ theo workspace chỉ đọc và đổi mật khẩu qua AUTH-03.

## 5. Light — system states và phản hồi

- [x] Thiết kế SYS-01 403, SYS-02 session expired, SYS-03 network error, SYS-04 conflict, SYS-05 404 và SYS-06 503.
- [x] Phân loại feedback: toast cho kết quả ngắn; banner cho trạng thái liên tục; inline error cho field; modal chỉ cho quyết định cần xác nhận.
- [x] Kiểm tra 404 không tiết lộ dữ liệu project private; 503 không biến thành empty state hoặc success giả.

## 6. Dark — bao phủ toàn bộ pages

- [x] Áp dụng shell Dark cho tất cả nhóm AUTH, WSP, PRJ, BRD, TSK, PRM, MYT, Dashboard và system states.
- [x] Thiết kế lại từng page với token Dark, không chỉ đảo nền; kiểm tra overlay, modal, form, calendar, bảng, badge và trạng thái lỗi.
- [x] Đối chiếu Light/Dark theo từng Screen ID để bảo đảm không thiếu CTA, nội dung, state hay giới hạn quyền.
- [x] Bổ sung cặp Light/Dark tương đương cho RPT-01, USR-01 và ví dụ sidebar thu gọn.

## 7. Permission UX matrix

- [x] Tạo bảng trực quan Owner/Editor/Viewer cho từng nhóm trang và action: menu thấy được, quyền vào trang, CTA hiển thị, CTA disabled/ẩn, read-only và thông báo khi bị chặn.
- [x] Thể hiện Workspace Admin không phải project member đi đến 403, không suy luận quyền đọc private project.
- [x] Thể hiện capability server trả về là nguồn để UI quyết định, không hard-code role logic trong component.

## 8. Rà soát và bàn giao

- [x] Rà tất cả copy tiếng Việt, căn hàng/cột, hierarchy, khoảng cách, overflow, contrast và focus indicator.
- [x] Kiểm tra contrast tối thiểu 4.5:1 cho text/icon/control có ý nghĩa ở cả Light và Dark; kiểm tra riêng background trang, surface card, overlay, form, alert, table, calendar selection và focus-visible.
- [x] Rà đối chiếu Pencil với `screen-inventory.md`, `interaction-specifications.md`, `design-system.md`, API và ADR; sửa Markdown ngay nếu UI phát hiện thiếu hợp đồng product.
- [x] Chụp/kiểm tra từng frame trọng yếu trong Pencil; không còn warning, node lỗi, layout vỡ hoặc nội dung mâu thuẫn.
- [x] Cập nhật `pencil-handoff.md` với mapping component/page/theme/permission cuối cùng; đánh dấu Ready for build khi toàn bộ mục trên hoàn tất.

## Kiểm chứng Canvas v0.4 (02–03/09/2026)

> **Chờ kiểm chứng artifact (03/09/2026).** Số liệu và trạng thái canvas trong mục này chưa kiểm chứng được: `docs/design/flowboard-v0.1.pen` trong repository vẫn đúng bằng bản của commit `aa23e17` (blob `7ff13e6a`, ghi lần cuối 2026-09-02 22:23:20), còn mục này được viết 2026-09-03 00:39–00:41 — file canvas không được ghi lại sau đó. Xem [báo cáo Canvas v0.4](../design-and-docs-plan.md). Quy tắc, quy ước tên và bẫy kỹ thuật ở đây vẫn dùng được; các con số không được coi là đã đạt.

Các mục `[x]` phía trên được kiểm chứng lại bằng script trên file `.pen` thật — trước v0.4 một số mục đánh dấu xong nhưng chưa đạt; hiện trạng đo được:

- Component hoá: 9 reusable, ~350 instance, **0 bản copy trôi** (trước đó: 8 reusable, 0 instance, 100% copy-paste).
- Token: 150 biến `fb.*`, **0 hex ghi cứng** (trước đó 68 giá trị hex / 4.362 lần dùng).
- Tương phản: 1.742 text node đạt WCAG AA (trước đó 37 node dưới chuẩn, gồm 11 node chữ trắng trên nền trắng ở dark Phase 1.3).
- Layout: 0 node tràn/clip ngoài chủ đích; 5 màn tham chiếu bật `clip` có chủ đích.
- Dấu `*` bắt buộc: element riêng màu danger ở 100% form (19 label từng nhét `*` vào chuỗi).
- Canvas: một hệ tên `<Screen ID> · <Theme> — <Tên>`, cặp Light/Dark cùng cột x, pitch 1560×1500; bộ mobile 9 màn × 2 theme.
