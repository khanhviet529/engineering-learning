/**
 * Kiểm một đích quay lại nhận từ query string.
 *
 * Mọi luồng "đăng nhập rồi quay lại chỗ cũ" đều mở đúng một lỗ: giá trị quyết
 * định điểm đến do **kẻ gửi liên kết** viết, không phải ứng dụng. Nhận nguyên
 * giá trị đó là dựng sẵn một open redirect — một trang đăng nhập thật, trên
 * đúng tên miền thật, ném người dùng sang nơi khác ngay sau khi họ gõ mật khẩu.
 *
 * Nên hàm này chỉ chấp nhận **đường dẫn tương đối cùng origin**, và mọi thứ
 * khác rơi về `fallback` chứ không bao giờ được dùng.
 */

/** Đích mặc định khi không có `next` hợp lệ: danh sách không gian làm việc. */
export const DEFAULT_RETURN_PATH = "/khong-gian-lam-viec";

/** Origin giả để phân giải đường dẫn; không request nào đi tới nó. */
const SENTINEL_ORIGIN = "http://return-check.invalid";

/** Ký tự điều khiển và khoảng trắng: chúng bị cắt bỏ ở một số nơi trước khi dùng. */
// eslint-disable-next-line no-control-regex -- ký tự điều khiển đúng là thứ cần bắt.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\s]/;

const BACKSLASH = String.fromCharCode(92);

/**
 * Trả về `raw` nếu nó là một đường dẫn nội bộ an toàn, ngược lại trả `fallback`.
 *
 * Bị từ chối, và vì sao:
 *
 * - Không bắt đầu bằng `/` — `https://evil.test`, `javascript:alert(1)` và
 *   `mailto:` đều rơi vào đây.
 * - Bắt đầu bằng hai dấu gạch, hoặc một gạch rồi một gạch ngược: trình duyệt
 *   đọc cả hai là **protocol-relative** và đưa sang host khác, dù chúng trông
 *   như đường dẫn nội bộ.
 * - Chứa gạch ngược ở bất kỳ đâu: nhiều bộ phân giải URL quy nó về `/`, nên một
 *   chuỗi qua được phép kiểm nhờ ký tự này có thể mang nghĩa khác lúc điều hướng.
 * - Chứa ký tự điều khiển hoặc khoảng trắng.
 * - Phân giải ra origin khác `SENTINEL_ORIGIN`. Đây là lưới cuối: nó bắt cả
 *   những dạng mà bốn phép kiểm trên chưa nghĩ tới, vì nó hỏi đúng câu hỏi cần
 *   hỏi — chuỗi này rốt cuộc trỏ đi đâu.
 */
export function safeReturnPath(
  raw: string | undefined | null,
  fallback: string = DEFAULT_RETURN_PATH,
): string {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes(BACKSLASH)) return fallback;
  if (UNSAFE_CHARS.test(raw)) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(raw, SENTINEL_ORIGIN);
  } catch {
    return fallback;
  }
  if (resolved.origin !== SENTINEL_ORIGIN) return fallback;

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
