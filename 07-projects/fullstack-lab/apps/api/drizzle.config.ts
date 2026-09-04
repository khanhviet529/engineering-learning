import { defineConfig } from "drizzle-kit";

/**
 * Cấu hình Drizzle Kit.
 *
 * Migration được sinh ra và **được đọc như code**, rồi chạy qua một command
 * tường minh — không có `schema push` hay auto-sync ở bất kỳ môi trường nào.
 * Quy tắc đó nằm ở `docs/operations/ci-cd.md`: release không được đổi schema
 * production bằng ORM auto-sync hay boot hook.
 */
export default defineConfig({
  schema: "./src/shared/database/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
