/**
 * Biến một lần **bỏ qua im lặng** thành một lần đỏ ồn ào, ở đúng nơi việc bỏ
 * qua là không chấp nhận được.
 *
 * 18 file test khai `describeIfDb = url ? describe : describe.skip`, và cách đó
 * đúng cho máy phát triển: không có PostgreSQL thì bỏ qua integration test còn
 * hơn là đỏ một cách vô nghĩa.
 *
 * Nhưng cùng cơ chế đó làm **job `integration` của CI có thể xanh mà không
 * chạy một integration test nào**. Đo được trên lượt CI thật: job `quality`
 * chạy `pnpm test` không có biến database và báo `434 passed | 334 skipped
 * (768)` — xanh. Nếu job `integration` mất `DATABASE_URL_HOST`, nó sẽ báo đúng
 * con số đó và cũng xanh, trong khi một phần ba bộ test đã ngừng kiểm.
 *
 * Backend nêu ra chỗ này mà không kiểm được (họ không chạm `.github/`), và họ
 * gọi đúng tên: *"xanh 5/5 sẽ có nghĩa hẹp hơn bạn tưởng"*.
 *
 * Nên: nơi nào **bắt buộc** phải có database thì đặt `REQUIRE_DB=1`, và thiếu
 * URL trở thành lỗi lúc khởi động thay vì một dòng `skipped` không ai đọc.
 * Cùng khuôn mẫu với mọi guard khác trong repo này — nó đọc **thực tại**
 * (`process.env` mà runtime thật sự thấy), không đọc một hằng số khác.
 */
const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];

if (process.env["REQUIRE_DB"] === "1" && (url === undefined || url === "")) {
  throw new Error(
    "REQUIRE_DB=1 nhưng không có DATABASE_URL_HOST lẫn DATABASE_URL.\n" +
      "Môi trường này khai rằng nó phải chạy integration test, nên thiếu database\n" +
      "là một lỗi cấu hình — không phải một lý do để bỏ qua 334 test và báo xanh.\n" +
      "Giá trị cố ý không được in ra.",
  );
}
