import { createHash } from "node:crypto";
import { and, eq, lt, or } from "drizzle-orm";
import type { Database } from "../database/client.ts";
import { idempotencyRecords } from "../database/schema.ts";

/**
 * Giao thức idempotency claim → mutation → outcome.
 *
 * Nguồn: `docs/data/database-design.md` mục `idempotency_records`, và
 * `docs/api/api-conventions.md` mục Idempotency key.
 *
 * Điều làm giao thức này khó hơn vẻ ngoài của nó là **retry đồng thời**: hai
 * request cùng key có thể tới cùng lúc, và cả hai không được cùng chạy mutation.
 * Cách giải là claim `in_progress` **commit trước** mutation, trong một
 * transaction riêng. Nếu claim nằm trong cùng transaction với mutation thì
 * request đến sau không nhìn thấy nó cho tới lúc commit — đúng lúc đã quá muộn.
 *
 * Đường thành công vì vậy là **hai** transaction, không phải một:
 *
 *   T1: INSERT in_progress, commit ngay
 *   T2: mutation + activity + UPDATE completed, cùng một transaction
 *
 * Vì `completed` và mutation nguyên tử với nhau, không tồn tại trạng thái
 * "mutation đã commit nhưng record chưa completed" — tức là không có cửa sổ nào
 * để một retry chạy mutation lần hai.
 */

/** 24 giờ, theo hợp đồng. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Sau 60 giây, một record `in_progress` được coi là mồ côi và có thể bị giành
 * lại.
 *
 * An toàn vì T1 commit trước T2: nếu request gốc chết giữa hai transaction thì
 * mutation **chưa từng** commit, nên chạy lại không tạo hiệu ứng thứ hai.
 */
export const TAKEOVER_TTL_MS = 60 * 1000;

/** Hash key trước khi lưu: key là bí mật của client, gần với bearer token. */
export function hashIdempotencyKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * Fingerprint của request đã chuẩn hoá.
 *
 * Dùng `JSON.stringify` trên object đã sắp key, để hai request giống nhau về
 * nội dung nhưng khác thứ tự field vẫn cho cùng fingerprint — nếu không, một
 * client đổi thứ tự field sẽ bị `409 IDEMPOTENCY_KEY_REUSED` một cách vô lý.
 */
export function fingerprintRequest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export interface StoredOutcome {
  status: number;
  body: unknown;
}

/** Kết quả của bước claim — năm nhánh mà hợp đồng liệt kê, không ít hơn. */
export type ClaimResult =
  /** Giành được quyền chạy mutation. */
  | { kind: "claimed"; recordId: string }
  /** Cùng key, cùng fingerprint, đã xong: phát lại outcome đã lưu. */
  | { kind: "replay"; outcome: StoredOutcome }
  /** Cùng key, khác fingerprint: lỗi lập trình của client. */
  | { kind: "key_reused" }
  /** Cùng key, cùng fingerprint, request gốc đang chạy. */
  | { kind: "in_progress" };

export interface ClaimInput {
  userId: string;
  useCase: string;
  keyHash: string;
  fingerprint: string;
}

/**
 * T1 — claim và commit ngay.
 *
 * Hàm nhận `now` để test kiểm được ranh giới hết hạn và takeover mà không phải
 * giả lập đồng hồ toàn cục.
 */
export async function claim(
  db: Database,
  input: ClaimInput,
  now: Date = new Date(),
): Promise<ClaimResult> {
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);

  // Chèn có điều kiện: nếu đã tồn tại thì chỉ giành lại khi record đã hết hạn
  // **hoặc** đang `in_progress` quá takeover TTL. Cả hai điều kiện nằm trong
  // một câu lệnh nguyên tử, nên hai request đồng thời không thể cùng giành.
  const takeoverBefore = new Date(now.getTime() - TAKEOVER_TTL_MS);

  const taken = await db
    .insert(idempotencyRecords)
    .values({
      userId: input.userId,
      useCase: input.useCase,
      keyHash: input.keyHash,
      requestFingerprint: input.fingerprint,
      status: "in_progress",
      expiresAt,
    })
    // Drizzle khai các property của config này là optional nhưng **không** kèm
    // `| undefined`, nên `exactOptionalPropertyTypes` từ chối object hợp lệ. Đây
    // là khoảng trống trong kiểu của thư viện, không phải lỗi của chỗ này — mọi
    // giá trị ở đây đều được truyền tường minh và không cái nào là `undefined`.
    .onConflictDoUpdate({
      target: [idempotencyRecords.userId, idempotencyRecords.useCase, idempotencyRecords.keyHash],
      set: {
        requestFingerprint: input.fingerprint,
        status: "in_progress",
        responseStatus: null,
        responseBody: null,
        expiresAt,
        updatedAt: now,
      },
      // Dùng operator có kiểu thay vì `sql` thô: một `Date` nhét thẳng vào
      // template không được gắn kiểu timestamptz, và driver từ chối nó.
      setWhere: or(
        lt(idempotencyRecords.expiresAt, now),
        and(
          eq(idempotencyRecords.status, "in_progress"),
          lt(idempotencyRecords.updatedAt, takeoverBefore),
        ),
      ),
    } as never)
    .returning({ id: idempotencyRecords.id });

  if (taken.length > 0) return { kind: "claimed", recordId: taken[0]!.id };

  // Không giành được: đọc record hiện có để rẽ nhánh.
  const [existing] = await db
    .select()
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.userId, input.userId),
        eq(idempotencyRecords.useCase, input.useCase),
        eq(idempotencyRecords.keyHash, input.keyHash),
      ),
    );

  // Biến mất giữa hai câu lệnh (bị purge): coi như chưa tồn tại và thử lại.
  if (!existing) return claim(db, input, now);

  if (existing.requestFingerprint !== input.fingerprint) return { kind: "key_reused" };

  if (existing.status === "completed") {
    return {
      kind: "replay",
      outcome: { status: existing.responseStatus ?? 200, body: existing.responseBody },
    };
  }

  return { kind: "in_progress" };
}

/**
 * T2 — ghi outcome **trong cùng transaction với mutation**.
 *
 * Nhận handle transaction chứ không nhận database: nếu hàm này tự mở
 * transaction riêng thì mutation và outcome không còn nguyên tử, và toàn bộ
 * giao thức mất ý nghĩa.
 */
export async function completeInTransaction(
  tx: Pick<Database, "update">,
  recordId: string,
  outcome: StoredOutcome,
  now: Date = new Date(),
): Promise<void> {
  await tx
    .update(idempotencyRecords)
    .set({
      status: "completed",
      responseStatus: outcome.status,
      responseBody: outcome.body as never,
      updatedAt: now,
    })
    .where(eq(idempotencyRecords.id, recordId));
}

/**
 * Ghi outcome của một **business failure xác định** bằng transaction riêng.
 *
 * Ví dụ: validation miền, version cũ. Mutation đã rollback, nhưng kết quả vẫn
 * phải lưu — nếu không, retry cùng key sẽ chạy lại mutation và có thể cho một
 * kết quả khác, đúng thứ mà idempotency hứa sẽ không xảy ra.
 */
export const recordFailureOutcome = completeInTransaction;
