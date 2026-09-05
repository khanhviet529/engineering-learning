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
  const output = execFileSync(
    "docker",
    ["exec", POSTGRES_CONTAINER, "psql", "-U", POSTGRES_USER, "-d", POSTGRES_DB, "-tAc", sql],
    { encoding: "utf8" },
  );
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
