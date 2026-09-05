/**
 * Cấu hình CORS — **một chỗ**, dùng bởi cả `main.ts` lẫn fixture của test.
 *
 * ## Vì sao nó là một module riêng chứ không phải một object inline
 *
 * Trước M5.5, `main.ts` gọi `app.enableCors({ origin, credentials: true })` và
 * fixture của test **không gọi gì cả**. Hệ quả: lớp CORS không được test nào
 * chạm tới, và hai lỗi dưới đây sống qua năm mốc. Đặt nó ở đây để fixture nạp
 * đúng cấu hình mà production nạp — một cấu hình chỉ có ở `main.ts` là một cấu
 * hình không có test.
 *
 * ## Hai mặc định của `@fastify/cors` đã cắn thật
 *
 * Adapter Fastify uỷ quyền cho `@fastify/cors`, và mặc định của nó **khác** mặc
 * định của Nest/Express. Đọc thẳng `defaultOptions` trong gói đã cài:
 *
 * ```js
 * { origin: '*', methods: 'GET,HEAD,POST', exposedHeaders: null, ... }
 * ```
 *
 * 1. **`methods` thiếu `PATCH` và `DELETE`.** Bảy endpoint đã công bố — toàn bộ
 *    bề mặt sửa và xoá — không gọi được từ browser. Preflight thất bại nghĩa là
 *    browser chặn **trước khi** request rời máy: server không thấy gì, log
 *    trống, client chỉ nhận một `TypeError` của `fetch`. Đó là lý do nó sống
 *    sót: không có dấu vết nào ở phía server để ai đó tình cờ nhìn thấy.
 * 2. **`exposedHeaders` là `null`,** nên browser chỉ cho đọc 6 header
 *    safelisted. Server **gửi** `x-request-id` và `retry-after`; browser
 *    **không cho đọc**. Công cụ truy vết sự cố của sản phẩm vì vậy không hoạt
 *    động ở browser, và client không tôn trọng được `Retry-After` của `429` và
 *    của `409 IDEMPOTENCY_IN_PROGRESS` — trong khi hợp đồng nói rõ *"chờ theo
 *    `Retry-After` rồi gửi lại cùng key"*.
 */

/**
 * Method được phép, khớp **đúng** những gì hợp đồng công bố.
 *
 * Không dùng `*`: nó **không hợp lệ** khi `credentials: true` — spec Fetch nói
 * wildcard không được dùng cho request mang credential, nên một `*` ở đây sẽ
 * hỏng theo cách khó chẩn đoán hơn cả bug nó định sửa.
 *
 * `GET`/`POST`/`PATCH`/`DELETE` là bốn method mà controller thật sự khai (đếm
 * bằng decorator: 11 `@Get`, 17 `@Post`, 4 `@Patch`, 3 `@Delete`, không có
 * `@Put`). `HEAD` đi kèm `GET` vì Fastify tự đăng ký nó; `OPTIONS` là chính
 * preflight.
 */
export const CORS_METHODS = ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"] as const;

/**
 * Header mà client được phép **gửi**.
 *
 * Khai tường minh thay vì để `@fastify/cors` phản chiếu lại
 * `Access-Control-Request-Headers`. Phản chiếu nghĩa là bất kỳ header nào cũng
 * qua được, và ranh giới này tồn tại để **hẹp**. Ba giá trị dưới đây là đúng
 * những gì transport của web gửi; thêm một header mới ở client sẽ hỏng preflight
 * **ngay ở E2E**, chứ không âm thầm nới ranh giới.
 *
 * `accept`, `accept-language`, `content-language` không cần liệt kê: chúng nằm
 * trong danh sách safelisted của CORS. `content-type` **thì cần**, vì
 * `application/json` không thuộc ba giá trị safelisted của nó.
 */
export const CORS_ALLOWED_HEADERS = ["content-type", "x-csrf-token", "idempotency-key"] as const;

/**
 * Header mà client được phép **đọc**.
 *
 * - `x-request-id`: mã tra cứu sự cố. Không có nó, `transport.ts` luôn rơi về
 *   `"unknown"` — với **mọi** response cross-origin, không chỉ nhánh mất kết
 *   nối.
 * - `retry-after`: `429` và `409 IDEMPOTENCY_IN_PROGRESS` đều gửi nó, và hợp
 *   đồng bảo client chờ theo nó rồi gửi lại **cùng** key. Không đọc được thì
 *   client hoặc thử lại ngay (vô ích) hoặc xoay key (sai giao thức).
 */
export const CORS_EXPOSED_HEADERS = ["x-request-id", "retry-after"] as const;

/**
 * Dựng cấu hình CORS cho một origin đã được validate.
 *
 * `origin` là **một giá trị từ config**, không bao giờ là header `Origin` của
 * request. Phản chiếu lại origin mà client gửi là bỏ hẳn ranh giới: mọi trang
 * web đều tự khai được origin của mình.
 *
 * Kiểu trả về được khai tường minh ở đây thay vì mượn `CorsOptions` của Nest:
 * adapter Fastify nhận `FastifyCorsOptions`, một kiểu **khác**, và mượn nhầm
 * kiểu là cách hai bên trông giống nhau trong khi không phải. Khai đúng năm
 * field mà cấu hình này đặt cũng làm rõ nó **không** đặt gì khác.
 */
export interface CorsConfig {
  origin: string;
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
}

export function buildCorsOptions(webOrigin: string): CorsConfig {
  return {
    origin: webOrigin,
    credentials: true,
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
  };
}
