# Mô hình miền dữ liệu Flowboard

Tài liệu này chuyển các quyết định ở [baseline kiến trúc đã phê duyệt](../superpowers/specs/2026-09-01-flowboard-product-architecture-design.md) thành quy tắc miền cho migration, repository và use case. Nó không định nghĩa generic table API và không mở rộng core MVP.

## Phạm vi và ranh giới sở hữu

`Workspace` là ranh giới tenant cao nhất. `Project` thuộc đúng một workspace và là ranh giới riêng tư thực tế: membership workspace là điều kiện cần để có membership project, nhưng không tự cấp quyền đọc project. Mọi dữ liệu board, task, comment, activity và export đều đi qua một `project_id` đã được giải quyết và kiểm tra quyền trước khi repository đọc hoặc ghi.

```text
User
 ├── AuthSession
 └── WorkspaceMember ── Workspace
                         └── Project
                              ├── ProjectMember
                              ├── BoardColumn ── Task ── Comment
                              ├── ActivityLog
                              └── ReportExport (Phase 1.1)
                              └── Time Tracking (Phase 1.3)
                                   ├── ProjectTimeTrackingSettings
                                   ├── ProjectTimeApprover
                                   ├── WorkLog ── Task
                                   └── WorkLogAccessOverride
```

Authorization không thuộc database một mình. `SessionGuard`, resource/project resolver và `ProjectPermissionGuard` quyết định actor có thể gọi use case; repository sau đó bắt buộc giữ scope project. Các use case dưới đây sở hữu validation nghiệp vụ mà foreign key hoặc UI không thể thay thế.

## Thực thể và trách nhiệm

| Thực thể | Trách nhiệm | Chủ sở hữu dữ liệu / ranh giới |
|---|---|---|
| `User` | Danh tính, email, display name, password hash và metadata xác minh/reset. | Identity; không phải tenant riêng tư. |
| `AuthSession` | Phiên opaque đã hash, thời hạn và trạng thái thu hồi. | Identity, luôn thuộc một User. |
| `Workspace` | Tenant cấp cao nhất. | Workspace; không tự cấp quyền đọc project. |
| `WorkspaceMember` | Quan hệ User–Workspace và role cố định `workspace_admin` hoặc `workspace_member`. | Workspace membership. |
| `Project` | Work container private trong một Workspace; creator trở thành Project Owner. | Project; Settings core MVP chỉ thay đổi `name`; Phase 1.3 thêm settings Time Tracking tách bảng. |
| `ProjectMember` | Quan hệ User–Project và role cố định `owner`, `editor`, `viewer`. | Project access boundary. |
| `BoardColumn` | Cột board, vị trí và trạng thái archive của đúng một Project. | Project board. |
| `Task` | Work item hiện ở một cột, có thứ tự, assignee, priority, hạn ngày và version đồng thời. | Project board. |
| `Comment` | Thảo luận bất biến gắn với một Task. | Project thông qua Task. |
| `ActivityLog` | Lịch sử nghiệp vụ chỉ-ghi-thêm của Project. | Project audit trail. |
| `ReportExport` | Yêu cầu export, filter snapshot, trạng thái, metadata tệp và expiry. | Project; chỉ có từ Phase 1.1. |
| `ProjectTimeTrackingSettings` | Bật/tắt Time Tracking, approval mode và cửa sổ ghi bù của một Project. | Project; chỉ từ Phase 1.3, Owner quản lý. |
| `ProjectTimeApprover` | Editor được Owner chỉ định có thể duyệt WorkLog của member khác. | Project; chỉ từ Phase 1.3. |
| `WorkLog` | Giờ thực tế theo một user–task–ngày, mô tả, status/review/version. | Project qua Task; chỉ từ Phase 1.3. |
| `WorkLogAccessOverride` | Cho một member ghi/sửa log ngày quá backfill window. | Project; Owner-only, chỉ từ Phase 1.3. |

## Quan hệ, ownership và quy tắc miền

| Quan hệ / quy tắc | Bất biến bắt buộc | Chủ sở hữu kiểm tra |
|---|---|---|
| User → WorkspaceMember → Workspace | Không có duplicate workspace membership; role workspace chỉ là `workspace_admin` hoặc `workspace_member`. | Workspace membership use case; `UNIQUE(workspace_id, user_id)`. |
| Workspace → Project | Một Project thuộc đúng một Workspace và mặc định private. Chỉ Workspace Admin của workspace đó được tạo Project; không có cột visibility trong MVP. | Project create/read use case và scoped repository. |
| Project → ProjectMember | Không có duplicate project membership; một ProjectMember phải có WorkspaceMember của workspace chứa project. Workspace Admin chưa có ProjectMember không đọc được project. | Project membership use case; transaction và `UNIQUE(project_id, user_id)`. |
| Project creator → ProjectMember | Tạo project đồng thời tạo ProjectMember role `owner` cho creator. | Project create transaction. |
| Project Settings | Dữ liệu mutable duy nhất của Project Settings **core MVP** là `name`. Phase 1.3 đặt Time Tracking settings trong bảng/use case riêng; không thêm description, visibility, archive/delete. | Project update use case và Time Tracking settings use case sau Owner authorization. |
| Project → BoardColumn | Column thuộc đúng một project; position xác định thứ tự. | Column management use case. |
| BoardColumn → Task | Task thuộc đúng một project và đúng một **active** BoardColumn cùng project. `column_id` và `position` chỉ đổi qua Task move, không qua Task update. | Task create/update/move use case; composite foreign key bảo vệ cùng project, use case bảo vệ active state. |
| ProjectMember → Task assignee | Nếu `assignee_id` có giá trị, user đó phải là ProjectMember của project task. | Task create/update/assignment và project member change transaction. |
| Task → Comment | Comment thuộc đúng một task và một author User. Comment MVP bất biến: không update, delete hay chuyển task. | Comment create use case; không có mutation use case khác. |
| Project → ActivityLog | ActivityLog thuộc project; actor là User thực hiện mutation. Nó không đổi hoặc bị xóa qua public behavior. | Use case mutation; append cùng transaction. |
| Project → ReportExport | Export thuộc một project và requester là Project Owner được kiểm tra tại lúc request/download. | Report export use case, chỉ Phase 1.1. |
| Project → ProjectTimeTrackingSettings | Tối đa một settings row; `enabled`, `approval_mode`, `backfill_days` chỉ Owner thay đổi. | Time Tracking settings use case, chỉ Phase 1.3. |
| Project → ProjectTimeApprover | Approver phải là ProjectMember role Editor hiện hành; Owner là approver ngầm định, không cần row. | Settings/member-management transaction. |
| Task → WorkLog | WorkLog luôn cùng project với Task; một user–task–date chỉ có một entry aggregate. | WorkLog create/update use case và composite FK/unique constraint. |
| ProjectMember → WorkLog | Author là Owner/Editor có capability; Viewer không tạo log. Task không giao cho author cần `supportReason`. | WorkLog create/update use case. |

## Trạng thái và chuyển trạng thái

### Membership và Project

- Workspace membership được tạo hoặc thay đổi chỉ bởi Workspace Admin. Một User phải đang là WorkspaceMember trước khi thêm làm ProjectMember.
- Chỉ Workspace Admin của workspace đích có thể tạo Project. Project creation tạo Project và membership `owner` của creator trong cùng transaction; Workspace Member không thể tạo Project. Project không có trạng thái public/private: mọi project MVP luôn private.
- ProjectMember có thể đổi giữa `owner`, `editor`, `viewer` chỉ qua owner-authorized member-management use case. Project phải luôn còn ít nhất một `owner`; transaction từ chối demote hoặc remove owner cuối cùng. Không có auto-transfer owner hay auto-add Workspace Admin.
- Khi remove ProjectMember, transaction phải giữ bất biến assignee. Không tự unassign hoặc chuyển giao task: nếu user còn là assignee của task trong project, reject thay đổi cho đến khi task được giao lại hoặc unassign tường minh trong mutation Task hợp lệ.
- Project update theo Project Settings chỉ đổi `name`; không có transition archive hoặc delete Project trong MVP.

### Time Tracking (Phase 1.3)

```text
draft --submit--> submitted --approve--> approved
  |                  |                    ^
  +--self close------+--------------------+
                     +--return--> rejected --edit/resubmit--> submitted
```

- Feature chỉ hoạt động khi project có `ProjectTimeTrackingSettings.enabled = true`. Tắt feature chặn create/update/submit/review mới, không xóa WorkLog cũ hay thay đổi result lịch sử.
- `approval_mode = self_close` cho author chuyển WorkLog hợp lệ thành `approved` với `approval_kind = self`. `requires_approval` chỉ cho author chuyển `draft → submitted`; Owner hoặc ProjectTimeApprover khác author chuyển `submitted → approved|rejected`.
- Không ai duyệt WorkLog của chính mình. Khi Owner log giờ trong mode cần duyệt, một Owner/Editor approver khác phải quyết định. Reviewer mất role Editor hoặc bị gỡ khỏi approver list mất capability ngay; audit cũ giữ reviewer history.
- Một WorkLog là aggregate user–task–date: `duration_minutes > 0`, description bắt buộc, `support_reason` bắt buộc nếu task assignee khác author. Tổng duration của author trên một workspace-local day không vượt 1.440 phút; check chạy server-side trong transaction serialized theo project/user/date.
- Author chỉ sửa `draft`/`rejected` trong today + `backfill_days` ngày lịch trước đó hoặc có `WorkLogAccessOverride` còn hiệu lực. Owner mở override theo member/date, có reason và expiry; không có mở lại mơ hồ cho toàn project.

### BoardColumn và Task

```text
active BoardColumn --archive (không còn Task)--> archived BoardColumn
```

- Archive là transition một chiều của MVP. Cột đã archive không nhận task mới hoặc task move; unarchive không phải hành vi core đã được định nghĩa.
- Column chỉ archive được khi không còn Task. Task phải được di chuyển trước, không bị delete hay chuyển âm thầm bởi archive.
- `position` của BoardColumn và Task xác định thứ tự ổn định. Giá trị dùng gap/fractional ordering; khi mật độ giá trị quá cao, controlled rebalance là một transaction có khóa các hàng bị ảnh hưởng.
- Task create đặt `version = 1`. Mỗi task update hoặc move thành công tăng `version` đúng một lần. Client gửi `expectedVersion`; mismatch trả `409 Conflict` **kèm current version** và không ghi Task hay ActivityLog.
- Task update chỉ đổi field content/assignment được cho phép; nó từ chối `column_id` và `position`. Move là use case riêng: destination column phải active và thuộc cùng project, target position hợp lệ, và việc đổi column/position không được ghi đè update mới hơn.

### AuthSession, Comment, ActivityLog và ReportExport

- AuthSession chuyển từ active sang revoked khi logout, password reset hoặc server-side revocation; request chỉ xác thực session chưa hết hạn và chưa revoked. Password change trong authenticated account settings không thuộc MVP. Session token chỉ tồn tại dạng hash.
- Comment và ActivityLog là append-only trong MVP. Không có transition edit/delete.
- `ReportExport` chỉ tồn tại từ Phase 1.1, với lifecycle `requested → ready | failed`, và `ready → expired` khi hết `expires_at`. Generation/delivery queue, retry và email không thuộc core MVP; Phase 1.2 mới thêm worker/queue behavior.

## Bất biến bảo mật và thời gian

- Mọi định danh persistent là UUID; thời điểm persistent dùng UTC `TIMESTAMPTZ`; `due_date` là `DATE` nullable, được diễn giải theo workspace timezone, không có giờ, recurrence hay notification.
- `work_date` của WorkLog là `DATE` theo workspace timezone, còn `submitted_at`, `reviewed_at`, override expiry và audit timestamps là UTC `TIMESTAMPTZ`. Task start/due date không được dùng để sinh hay suy ra WorkLog.
- Password, opaque session ID, password-reset token và email-verification token chỉ lưu hash, không lưu plaintext hoặc giá trị cookie.
- `version` là integer dương; không do client cập nhật trực tiếp. `project_id`, `column_id`, `position`, timestamps và audit fields không là editable fields của Task update; `column_id`/`position` thuộc dedicated Task move.
- Mọi query nhận project/task/comment/column/report ID phải resolve resource, kiểm tra object-level permission, rồi dùng project-scoped repository query. Ẩn action ở UI không phải quyết định authorization.
- Một activity record mô tả mutation chỉ được ghi khi mutation commit thành công, trong chính transaction của mutation. Không có activity record mồ côi hoặc mutation quan trọng không có record.

## Ownership của business rule

| Business rule | Lớp chịu trách nhiệm cuối | Phòng vệ bổ sung |
|---|---|---|
| Actor được phép action/resource | Authorization service và ProjectPermissionGuard | UI capabilities; project-scoped repository. |
| Membership workspace trước membership project | Project membership use case | Foreign keys và query khóa trong transaction. |
| Creator là Owner; không mất Owner cuối cùng | Project create/member-management use case | `UNIQUE` membership; transaction/row lock. |
| Task cùng project với column; assignee là member | Task use case | Composite foreign keys. |
| Column active và không còn task trước archive | Task move/column archive use case | Transaction, row locks và existence check. |
| Ordering deterministic, move/rebalance nhất quán | Task/BoardColumn ordering use case | `position` keys, unique ordering constraint, row locks. |
| Optimistic concurrency | Task update/move use case | `version` conditional update. |
| Comment/activity immutable; activity atomic | Comment/activity use case và mọi mutation use case | Không có public update/delete path; append trong transaction. |
| Export Owner-only, scoped snapshot và expiry | Report export use case (Phase 1.1) | Project scope, `report_exports` foreign keys. |
| Time Tracking settings/approver validity | Time Tracking settings use case (Phase 1.3) | Project-scoped role check, `UNIQUE(project_id, user_id)`. |
| WorkLog status/daily total/backfill/self-review | WorkLog/review/override use cases (Phase 1.3) | Same-project FKs, daily unique, advisory lock, version conditional update. |

Chi tiết cột và ràng buộc migration nằm ở [thiết kế database](database-design.md); pagination, index và transaction repository nằm ở [query và index policy](query-and-index-policy.md).
