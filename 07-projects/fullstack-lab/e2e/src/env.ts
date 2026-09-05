/**
 * Địa chỉ của stack đang chạy.
 *
 * Cổng ở đây là cổng **host đã publish** trong `infra/compose/compose.yaml`, và
 * chúng cố ý không phải cổng mặc định: 5433 chứ không 5432, 1026 chứ không
 * 1025, 8026 chứ không 8025. Một máy đang chạy PostgreSQL khác thì không bị bộ
 * này ghi đè nhầm.
 *
 * Mọi giá trị đều cho phép ghi đè bằng biến môi trường để CI trỏ sang service
 * container của nó mà không phải sửa code.
 */

function fromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const WEB_BASE_URL = fromEnv("E2E_WEB_URL", "http://localhost:3000");
export const API_BASE_URL = fromEnv("E2E_API_URL", "http://localhost:3001");
export const MAILPIT_URL = fromEnv("E2E_MAILPIT_URL", "http://localhost:8026");

/**
 * Lệnh đọc PostgreSQL.
 *
 * Hai bài kiểm — replay của `Idempotency-Key` và số hàng sau khi ghi — phải
 * **đếm hàng trong bảng**, vì "UI không hiện thêm dòng nào" chưa chứng minh
 * được rằng server không tạo bản ghi thứ hai. Đếm qua `docker exec` là đường
 * duy nhất không cần thêm một dependency database vào workspace này.
 */
export const POSTGRES_CONTAINER = fromEnv("E2E_POSTGRES_CONTAINER", "flowboard-postgres-1");
export const POSTGRES_USER = fromEnv("E2E_POSTGRES_USER", "flowboard");
export const POSTGRES_DB = fromEnv("E2E_POSTGRES_DB", "flowboard");

/**
 * Ngân sách đăng ký mà bộ kiểm tự cho phép mình tiêu trong một cửa sổ.
 *
 * Mặc định `4` khớp bảng production của server (`auth.sign-up`: 5 lần mỗi 60
 * giây mỗi IP), chừa một token cho người khác. CI nới **cả hai phía cùng lúc**:
 * `RATE_LIMIT_OVERRIDES` cho server và biến này cho client. Nới một phía thôi
 * thì phía kia vẫn là nút thắt — và đó chính là lỗi làm lượt chạy M5.5 mất
 * mười bảy phút.
 */
export const SIGN_UP_BUDGET = Number.parseInt(fromEnv("E2E_SIGN_UP_BUDGET", "4"), 10);
export const SIGN_UP_WINDOW_MS = Number.parseInt(fromEnv("E2E_SIGN_UP_WINDOW_MS", "60000"), 10);
