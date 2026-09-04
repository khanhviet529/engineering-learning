import { createHash, randomBytes } from "node:crypto";

/**
 * Token dùng một lần: sinh và băm.
 *
 * ## Vì sao ở `shared/` chứ không ở `modules/auth/domain/`
 *
 * Cùng lý do đã đưa `Mailer` ra khỏi `auth`: đồ thị phụ thuộc của ADR-0005
 * **không có** cạnh `workspaces → auth`, và
 * `backend-conventions.md` gọi một import ngoài đồ thị là vi phạm review. Lời
 * mời workspace cần đúng cơ chế token này, nên nó là consumer thứ hai — quy tắc
 * hai consumer ở `shared-helper-policy.md` đã đạt.
 *
 * Đây cũng là loại thứ mà policy đó cho phép vào shared: một **primitive kỹ
 * thuật có contract hẹp**, không mang quyết định nghiệp vụ. Nó không biết token
 * dùng để làm gì, không biết TTL bao lâu, không biết ai được cấp — những thứ đó
 * ở lại module sở hữu use case.
 *
 * ## Vì sao SHA-256 chứ không Argon2
 *
 * Token là 32 byte từ nguồn ngẫu nhiên mật mã, nên **không có gì để
 * brute-force**: không gian khoá 2^256 không thu hẹp được bằng đoán. Argon2 chỉ
 * cần khi đầu vào có entropy thấp do người chọn, như mật khẩu; dùng nó ở đây
 * chỉ làm mỗi lượt tra token chậm đi mà không mua thêm an toàn nào.
 */

/**
 * 32 byte — cùng độ dài với session token.
 *
 * Không dùng UUID v4: nó chỉ có 122 bit ngẫu nhiên và mang cấu trúc nhận ra
 * được, nên nó là một định danh, không phải một bí mật.
 */
const TOKEN_BYTES = 32;

export function generateOneTimeToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Băm token trước khi lưu.
 *
 * Database chỉ giữ hash, nên một bản dump database không cho ai một token dùng
 * được. Giá trị thô chỉ tồn tại đúng hai chỗ: biến trong tiến trình lúc sinh
 * ra, và lá thư gửi đi.
 */
export function hashOneTimeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
