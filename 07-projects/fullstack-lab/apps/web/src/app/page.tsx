import { redirect } from "next/navigation";

/**
 * Trang gốc.
 *
 * Từ M2, điểm đến đầu tiên của một phiên hợp lệ là `WSP-01` — chọn không gian
 * làm việc. Nó **không** tự chọn hộ một workspace: danh sách có thể rỗng, có
 * thể có nhiều, và đoán hộ sẽ đưa người dùng vào một nơi họ không định tới.
 *
 * Chuyển hướng ở đây thay vì render: một trang trung gian chỉ để bấm tiếp là
 * một bước thừa trong mọi lần đăng nhập.
 */
export default function Page() {
  redirect("/khong-gian-lam-viec");
}
