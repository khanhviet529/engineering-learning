import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type DatabaseHandle } from "../database/client.ts";
import { idempotencyRecords, users } from "../database/schema.ts";
import {
  TAKEOVER_TTL_MS,
  claim,
  completeInTransaction,
  fingerprintRequest,
  hashIdempotencyKey,
} from "./idempotency.ts";

/**
 * Giao thức idempotency chỉ có ý nghĩa nếu nó đúng **dưới đồng thời**, và điều
 * đó chỉ chứng minh được trên PostgreSQL thật. Một mock repository sẽ vui vẻ
 * cho cả hai request cùng claim.
 */

const url = process.env.DATABASE_URL_HOST ?? process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb("claim → mutation → outcome trên PostgreSQL thật", () => {
  let handle: DatabaseHandle;
  let userId: string;

  beforeAll(async () => {
    handle = createDatabase(url as string, { max: 5 });
    const [user] = await handle.db
      .insert(users)
      .values({
        email: `idem-${crypto.randomUUID()}@example.test`,
        displayName: "Kiem Tra Idempotency",
        passwordHash: "$argon2id$placeholder",
      })
      .returning();
    userId = user!.id;
  });

  afterAll(async () => {
    await handle.db.delete(idempotencyRecords).where(eq(idempotencyRecords.userId, userId));
    await handle.db.delete(users).where(eq(users.id, userId));
    await handle.close();
  });

  const input = (key: string, body: unknown) => ({
    userId,
    useCase: "auth.sign-up",
    keyHash: hashIdempotencyKey(key),
    fingerprint: fingerprintRequest(body),
  });

  it("lần đầu thì giành được quyền chạy mutation", async () => {
    const result = await claim(handle.db, input(crypto.randomUUID(), { email: "a@b.test" }));
    expect(result.kind).toBe("claimed");
  });

  it("retry cùng key và cùng fingerprint khi bản gốc đang chạy trả in_progress", async () => {
    const key = crypto.randomUUID();
    const body = { email: "a@b.test" };
    expect((await claim(handle.db, input(key, body))).kind).toBe("claimed");
    expect((await claim(handle.db, input(key, body))).kind).toBe("in_progress");
  });

  it("cùng key nhưng khác payload là lỗi lập trình client", async () => {
    const key = crypto.randomUUID();
    expect((await claim(handle.db, input(key, { email: "a@b.test" }))).kind).toBe("claimed");
    expect((await claim(handle.db, input(key, { email: "khac@b.test" }))).kind).toBe("key_reused");
  });

  it("sau khi hoàn tất, retry cùng key phát lại outcome đã lưu", async () => {
    const key = crypto.randomUUID();
    const body = { email: "a@b.test" };

    const first = await claim(handle.db, input(key, body));
    expect(first.kind).toBe("claimed");

    await handle.db.transaction(async (tx) => {
      await completeInTransaction(tx, (first as { recordId: string }).recordId, {
        status: 201,
        body: { account: { email: "a@b.test" } },
      });
    });

    const replay = await claim(handle.db, input(key, body));
    expect(replay.kind).toBe("replay");
    expect((replay as { outcome: { status: number } }).outcome.status).toBe(201);
    expect((replay as { outcome: { body: unknown } }).outcome.body).toEqual({
      account: { email: "a@b.test" },
    });
  });

  it("HAI RETRY ĐỒNG THỜI: đúng một cái giành được, cái kia không chạy mutation", async () => {
    const key = crypto.randomUUID();
    const body = { email: `race-${crypto.randomUUID()}@b.test` };

    // Gửi đồng thời thật, trên hai kết nối khác nhau của cùng pool.
    const results = await Promise.all([
      claim(handle.db, input(key, body)),
      claim(handle.db, input(key, body)),
      claim(handle.db, input(key, body)),
    ]);

    const claimed = results.filter((r) => r.kind === "claimed");
    expect(claimed).toHaveLength(1);
    for (const other of results.filter((r) => r.kind !== "claimed")) {
      expect(other.kind).toBe("in_progress");
    }
  });

  it("record in_progress mồ côi quá 60 giây thì được giành lại", async () => {
    const key = crypto.randomUUID();
    const body = { email: "a@b.test" };

    const first = await claim(handle.db, input(key, body));
    expect(first.kind).toBe("claimed");

    // Giả lập request gốc chết: đẩy `updated_at` lùi quá takeover TTL.
    await handle.db
      .update(idempotencyRecords)
      .set({ updatedAt: new Date(Date.now() - TAKEOVER_TTL_MS - 1_000) })
      .where(eq(idempotencyRecords.id, (first as { recordId: string }).recordId));

    const takeover = await claim(handle.db, input(key, body));
    expect(takeover.kind).toBe("claimed");
  });

  it("record hết hạn coi như không tồn tại", async () => {
    const key = crypto.randomUUID();
    const body = { email: "a@b.test" };

    const first = await claim(handle.db, input(key, body));
    await handle.db
      .update(idempotencyRecords)
      .set({ expiresAt: new Date(Date.now() - 1_000), status: "completed", responseStatus: 201 })
      .where(eq(idempotencyRecords.id, (first as { recordId: string }).recordId));

    // Dù đã completed, record hết hạn không được phát lại.
    const again = await claim(handle.db, input(key, body));
    expect(again.kind).toBe("claimed");
  });

  it("outcome và mutation nguyên tử: transaction hỏng thì record vẫn in_progress", async () => {
    const key = crypto.randomUUID();
    const body = { email: "a@b.test" };
    const first = await claim(handle.db, input(key, body));
    const recordId = (first as { recordId: string }).recordId;

    await expect(
      handle.db.transaction(async (tx) => {
        await completeInTransaction(tx, recordId, { status: 201, body: { ok: true } });
        throw new Error("mutation hỏng sau khi ghi outcome");
      }),
    ).rejects.toThrow();

    const [row] = await handle.db
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.id, recordId));
    expect(row!.status).toBe("in_progress");
    expect(row!.responseStatus).toBeNull();
  });

  it("key của actor này không dùng được cho actor khác", async () => {
    const key = crypto.randomUUID();
    const body = { email: "a@b.test" };
    expect((await claim(handle.db, input(key, body))).kind).toBe("claimed");

    const [other] = await handle.db
      .insert(users)
      .values({
        email: `other-${crypto.randomUUID()}@example.test`,
        displayName: "Actor Khac",
        passwordHash: "$argon2id$placeholder",
      })
      .returning();

    const result = await claim(handle.db, {
      userId: other!.id,
      useCase: "auth.sign-up",
      keyHash: hashIdempotencyKey(key),
      fingerprint: fingerprintRequest(body),
    });
    expect(result.kind).toBe("claimed");

    await handle.db.delete(idempotencyRecords).where(eq(idempotencyRecords.userId, other!.id));
    await handle.db.delete(users).where(sql`${users.id} = ${other!.id}`);
  });
});

describe("fingerprint", () => {
  it("không phụ thuộc thứ tự field — đổi thứ tự không phải một ý định mới", () => {
    expect(fingerprintRequest({ a: 1, b: 2 })).toBe(fingerprintRequest({ b: 2, a: 1 }));
  });

  it("đổi giá trị thì đổi fingerprint", () => {
    expect(fingerprintRequest({ a: 1 })).not.toBe(fingerprintRequest({ a: 2 }));
  });

  it("bỏ qua field undefined", () => {
    expect(fingerprintRequest({ a: 1, b: undefined })).toBe(fingerprintRequest({ a: 1 }));
  });

  it("null khác với vắng mặt — gửi null là một ý định rõ ràng", () => {
    expect(fingerprintRequest({ a: null })).not.toBe(fingerprintRequest({}));
  });

  it("key được hash, không lưu thô", () => {
    const key = "khoa-bi-mat-cua-client";
    expect(hashIdempotencyKey(key)).not.toContain(key);
    expect(hashIdempotencyKey(key)).toMatch(/^[0-9a-f]{64}$/);
  });
});
