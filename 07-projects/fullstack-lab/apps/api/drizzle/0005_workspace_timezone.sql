-- M5 — `workspaces.timezone`: trả nợ mà M4 ghi lại.
--
-- Năm tài liệu nói `due_date` và `dueState` theo **timezone workspace**, nhưng
-- bảng `workspaces` không có cột nào biểu diễn nó. M4 chạy tạm bằng **một**
-- timezone cho cả ứng dụng (`APP_TIMEZONE`), đặt sau cổng `WorkspaceClock`
-- đúng để chỗ phải đổi khi có cột thật chỉ là một chỗ. Đây là lần đổi đó.
--
-- Additive và có `DEFAULT`, nên không backfill suy đoán: mọi workspace đang tồn
-- tại nhận `Asia/Ho_Chi_Minh` — **đúng** hành vi mà `APP_TIMEZONE` mặc định đã
-- cho chúng từ M4, nên không workspace nào thấy `dueState` đổi vì migration này.
--
-- Không `CHECK` liệt kê tên timezone: danh sách IANA đổi theo bản tzdata, và một
-- `CHECK` ở đây biến mỗi lần cập nhật tzdata thành một migration. Giá trị được
-- validate ở tầng ứng dụng bằng `Intl` — chính thứ sẽ đọc nó.

ALTER TABLE "workspaces" ADD COLUMN "timezone" text DEFAULT 'Asia/Ho_Chi_Minh' NOT NULL;
