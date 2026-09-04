import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema.ts";

/**
 * Database boundary — `docs/engineering/backend-conventions.md`.
 *
 * Đây là **nơi duy nhất** biết tới Drizzle và PostgreSQL. Use case không import
 * table để tự viết query; nó gọi repository, và repository sống trong tầng
 * infrastructure của module sở hữu nó.
 *
 * Transaction helper ở đây chỉ điều phối tính nguyên tử. Nó **không** chứa quy
 * tắc nghiệp vụ của Task hay Project: thứ tự resolve → authorize → khoá →
 * mutation → activity là việc của use case, và để helper biết thứ tự đó là
 * cách nhanh nhất biến nó thành một God object.
 */

/**
 * Kiểu database lấy **thẳng** từ Drizzle, không suy ngược từ `createDatabase`:
 * suy ngược tạo ra một vòng tham chiếu, vì `createDatabase` trả về kiểu có chứa
 * chính `Database`.
 */
export type Database = PostgresJsDatabase<typeof schema>;

/** Handle transaction truyền vào các bước trong cùng một transaction. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DatabaseHandle {
  db: Database;
  /** Đóng pool. Gọi khi tắt process hoặc khi test kết thúc. */
  close: () => Promise<void>;
  /** Probe cho readiness: trả `true` khi database trả lời được. */
  ping: () => Promise<boolean>;
}

export interface DatabaseOptions {
  /** Số kết nối tối đa. Test dùng 1 để không giữ pool sau khi chạy xong. */
  max?: number;
}

export function createDatabase(url: string, options: DatabaseOptions = {}): DatabaseHandle {
  const client = postgres(url, {
    max: options.max ?? 10,
    // Không in câu query có tham số ra log: tham số có thể chứa email, tiêu đề
    // task, hay nội dung comment.
    onnotice: () => {},
  });

  const db = drizzle(client, { schema });

  return {
    db,
    close: async () => {
      await client.end({ timeout: 5 });
    },
    ping: async () => {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
  };
}
