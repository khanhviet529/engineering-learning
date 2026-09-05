import { execFileSync } from "node:child_process";
import { POSTGRES_CONTAINER, POSTGRES_DB, POSTGRES_USER } from "./env.ts";

/**
 * Đọc thẳng PostgreSQL, **chỉ để đếm**.
 *
 * Vì sao cần: "giao diện không hiện thêm dòng nào" không chứng minh được rằng
 * server không tạo bản ghi thứ hai. Một `Idempotency-Key` hỏng có thể tạo hai
 * hàng mà danh sách chỉ hiện một, và bug đó sống sót qua mọi bài kiểm nhìn vào
 * màn hình.
 *
 * Chỉ `SELECT`. Bộ E2E **không** ghi thẳng vào database và **không** dọn bảng:
 * dữ liệu phải được tạo qua chính sản phẩm, nếu không thì đường đang được kiểm
 * chính là đường bị bỏ qua.
 */
export function scalar(sql: string): string {
  if (!/^\s*select\b/i.test(sql)) {
    throw new Error(`Chỉ cho phép SELECT ở đây, nhận được: ${sql}`);
  }
  // `timeout` **bắt buộc**, không phải phòng xa. `execFileSync` chặn cả event
  // loop của Node, nên một `docker` không phản hồi làm treo luôn đồng hồ đếm
  // giờ của Playwright: spec không đỏ, không hết giờ, chỉ đứng im vô hạn. Đã
  // gặp đúng cảnh đó khi Docker Desktop kẹt — bộ kiểm treo mười phút mà không
  // in ra một dòng nào. Hết giờ thì ném, và một câu ném đọc được thì tốt hơn
  // một dấu nháy nhấp nháy.
  let output: string;
  try {
    output = execFileSync(
      "docker",
      ["exec", POSTGRES_CONTAINER, "psql", "-U", POSTGRES_USER, "-d", POSTGRES_DB, "-tAc", sql],
      { encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL" },
    );
  } catch (error) {
    throw new Error(
      `không đọc được PostgreSQL qua \`docker exec ${POSTGRES_CONTAINER}\` trong 30 giây. ` +
        `Container còn chạy và Docker daemon còn trả lời chứ? Câu truy vấn: ${sql}`,
      { cause: error },
    );
  }
  return output.trim();
}

export function count(sql: string): number {
  const value = Number.parseInt(scalar(sql), 10);
  if (!Number.isFinite(value)) throw new Error(`Không đọc được số đếm từ: ${sql}`);
  return value;
}

/** Escape một literal cho SQL — chỉ dùng cho giá trị do chính bộ kiểm sinh ra. */
export function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
