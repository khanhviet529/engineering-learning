# ADR-0006: Fractional ordering, ngưỡng rebalance và optimistic concurrency

- Status: Accepted
- Date: 2026-09-02
- Accepted: 2026-09-03
- Related docs: [database design](../data/database-design.md) (bảng `tasks`/`board_columns`), [pagination, concurrency và idempotency](../api/pagination-concurrency-idempotency.md), [query and index policy](../data/query-and-index-policy.md), [interaction specifications](../design/interaction-specifications.md) (mục DnD/Conflict)

## Context

Baseline đã chốt: ordering bằng fractional position `numeric(20,10)` với `UNIQUE (project_id, column_id, position)` (task) và `UNIQUE (project_id, position)` (column); concurrency bằng cột `version` + `expectedVersion` → `409 TASK_VERSION_CONFLICT`. "Controlled rebalance" được nhắc ở bốn tài liệu nhưng chưa được lượng hóa: không có spacing ban đầu, không có ngưỡng trigger, không có phân tích giới hạn precision, và không xử lý việc unique constraint có thể bị vi phạm **tạm thời** giữa transaction khi rebalance ghi lại N row.

Phân tích precision (kiểm chứng bằng tính toán): `numeric(20,10)` có 10 chữ số thập phân, bước nhỏ nhất biểu diễn được là 10⁻¹⁰. Chèn liên tiếp vào cùng một khe làm khoảng cách neighbor giảm một nửa mỗi lần: từ gap ban đầu `g`, sau `floor(log2(g/10⁻¹⁰))` lần thì midpoint tròn về trùng neighbor — với `g = 1` là ~33 lần, với `g = 1024` là ~43 lần. Khi đó insert/move vi phạm unique position và mutation thất bại. Không có ngưỡng chủ động thì đây là failure mode thật của drag-and-drop.

## Decision

Giữ fractional `numeric(20,10)` + optimistic `version`, và lượng hóa như sau (áp dụng cho cả task position trong column và column position trong project):

1. **Spacing ban đầu: 1024.** Item đầu tiên nhận `1024`; append nhận `max(position) + 1024`; chèn giữa nhận midpoint hai neighbor. Server tính mọi giá trị; `targetPosition` của client chỉ là gợi ý vị trí đã được server validate lại.
2. **Ngưỡng rebalance: 10⁻⁶.** Trong move/create transaction, nếu khoảng cách giữa hai neighbor tại điểm chèn `< 10⁻⁶`, server chạy rebalance cho column đó **trong cùng transaction** trước khi gán position: ghi lại position của các row trong column thành bội số của 1024 theo thứ tự hiện tại. Với spacing 1024, cần ~29 lần chèn liên tiếp cùng một khe mới chạm ngưỡng; từ ngưỡng 10⁻⁶ tới giới hạn 10⁻¹⁰ còn ~13 lần chia đôi dự phòng cho race/edge case — unique violation do cạn precision trở thành không thể đạt tới trong vận hành bình thường.
3. **Thứ tự update khi rebalance: dùng constraint DEFERRABLE.** `UNIQUE (project_id, column_id, position)` và `UNIQUE (project_id, position)` được khai báo **`DEFERRABLE INITIALLY IMMEDIATE`**; rebalance transaction chạy `SET CONSTRAINTS ... DEFERRED` để trạng thái trung gian được phép trùng và uniqueness chỉ được kiểm tại commit. Lý do chọn thay vì update theo thứ tự an toàn: với giá trị hiện hành tùy ý, không tồn tại một thứ tự update đơn giản đảm bảo không trùng ở mọi bước trung gian mà không dùng mẹo hai lượt (shift sang dải âm rồi ghi lại) — gấp đôi số write và dễ sai. An toàn vì: hai unique constraint này không là target của foreign key nào (FK trỏ `(project_id, id)`) và không endpoint nào dùng chúng làm `ON CONFLICT` arbiter, nên DEFERRABLE không phá behavior khác.
4. **Rebalance là server behavior trong move/create/reorder transaction hiện có**, với row lock trên column bị ảnh hưởng (giữ contract "locks on affected rows"); không có public bulk-reorder API mới, không đổi endpoint shape, không đổi semantics `expectedVersion`/`409`.
5. **Rebalance chỉ ghi `position` — không tăng `version`, không chạm `updated_at`** của các row bị ghi lại (áp dụng cho cả `tasks` và `board_columns`; row được move/tạo trực tiếp vẫn tăng version như contract). Lý do: `position` do server sở hữu tuyệt đối — client bị cấm gửi nó trong update và move là use case riêng — nên `version`, vốn là token optimistic concurrency cho nội dung client sửa được, không có gì để bảo vệ ở đây; tăng version cho N row tạo ra loạt `409 TASK_VERSION_CONFLICT` giả cho mọi client đang mở các task đó — đúng nhược điểm mà ADR này dùng để loại integer+shift. `updated_at` phản ánh thay đổi có ý nghĩa với user; nếu rebalance chạm nó, seek pagination theo `updated_at DESC` bị xáo và user đang cuộn nhận row trùng/mất. Hệ quả được chấp nhận có ghi nhận: `version` không còn là change token cho `position`; client biết position đã đổi ở lần board load/refetch kế tiếp — chấp nhận được vì MVP không có realtime, nên staleness sau rebalance là subset của staleness vốn có (move của user khác cũng vô hình cho tới refetch), và client render theo thứ tự response, không tự suy order từ position.

## Alternatives

| Phương án | Ưu điểm | Hạn chế hoặc lý do không chọn |
|---|---|---|
| Fractional `numeric(20,10)` + rebalance có ngưỡng (chọn) | Drag-and-drop bình thường ghi đúng 1 row; rebalance hiếm (~29 lần chèn cùng khe), có kiểm soát, trong transaction; sort/seek pagination dùng index position trực tiếp. | Cần ngưỡng + DEFERRABLE + phân tích precision (chính ADR này); position là numeric "xấu" khi debug bằng mắt. |
| Integer position + shift rows | Đơn giản, dễ đọc. | Mỗi chèn giữa ghi O(n) row trong column, lock contention trên hot column, khuếch đại xung đột `version` của các task không liên quan; chi phí thường trực để tránh một rebalance hiếm. |
| LexoRank / chuỗi base-62 | Không cạn precision theo cách tuyến tính; phổ biến (Jira). | Chuỗi dài dần không giới hạn, vẫn cần rebalancing định kỳ; so sánh/collation chuỗi dễ sai giữa DB và app; seek pagination trên text kém tự nhiên hơn numeric; độ phức tạp không đổi nhưng khó giải thích hơn cho lab. |
| Linked list (prev/next pointer) | Chèn O(1) về mặt dữ liệu. | Đọc theo thứ tự cần recursive CTE, không index-sort/seek được; toàn vẹn con trỏ khó bảo vệ khi concurrent move; pagination theo position bất khả thi với contract hiện có. |

## Consequences

- `data/database-design.md` cập nhật: hai unique position constraint ghi rõ `DEFERRABLE INITIALLY IMMEDIATE`, spacing/ngưỡng được tham chiếu về ADR này.
- `api/pagination-concurrency-idempotency.md` cập nhật đoạn rebalance với con số cụ thể (1024, 10⁻⁶) thay cho "too dense" định tính.
- Failure experiment (delivery roadmap): chèn N task liên tiếp vào cùng một khe vượt ngưỡng — rebalance chạy trong transaction, thứ tự giữ nguyên, không có unique violation ở mọi mức N.
- Test: integration test rebalance đồng thời với move khác (row lock + version), test chèn tới ngưỡng, và test khẳng định rebalance không đổi `version`/`updated_at` của row không được move (không 409 giả, thứ tự `updatedAt` sort không xáo).
- Chi phí: migration khai báo constraint DEFERRABLE ngay từ đầu (rẻ); rebalance ghi O(n) row của một column nhưng chỉ khi chạm ngưỡng.

## Revisit When

- Telemetry cho thấy rebalance xảy ra thường xuyên (spacing/ngưỡng sai với hành vi thật) — điều chỉnh hằng số bằng ADR ngắn mới.
- Phase realtime/multi-client làm tần suất chèn cùng khe tăng bậc — cân nhắc lại LexoRank hoặc CRDT ordering.
- PostgreSQL numeric precision hoặc constraint semantics thay đổi (không dự kiến).
