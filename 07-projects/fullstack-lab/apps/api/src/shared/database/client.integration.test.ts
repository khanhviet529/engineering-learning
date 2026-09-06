import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase, type DatabaseHandle } from "./client.ts";
import { authSessions, idempotencyRecords, users } from "./schema.ts";

/**
 * Integration test chạy trên **PostgreSQL thật**, không phải repository giả.
 *
 * `docs/operations/testing-strategy.md` nói rõ vì sao: mock repository không
 * chứng minh được tính nguyên tử, phạm vi query, hay việc constraint có thật sự
 * chặn hay không. Những thứ đó chỉ đúng khi database nói chúng đúng.
 *
 * Test tự bỏ qua khi không có `DATABASE_URL_HOST`, để `pnpm test` trên máy chưa
 * bật Compose vẫn chạy được — nhưng CI **phải** có biến đó.
 */

const url = process.env.DATABASE_URL_HOST ?? process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb("database boundary trên PostgreSQL thật", () => {
  let handle: DatabaseHandle;

  beforeAll(() => {
    handle = createDatabase(url as string, { max: 1 });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("ping trả true khi database trả lời", async () => {
    expect(await handle.ping()).toBe(true);
  });

  it("ba bảng của M1 tồn tại", async () => {
    const rows = await handle.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public'
          order by table_name`,
    );
    const names = [...rows].map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(["auth_sessions", "idempotency_records", "users"]),
    );
  });

  it("email là duy nhất — database chặn, không chỉ ứng dụng chặn", async () => {
    const email = `unique-${crypto.randomUUID()}@example.test`;
    const row = { email, displayName: "Kiem Tra", passwordHash: "$argon2id$placeholder" };

    await handle.db.insert(users).values(row);
    await expect(handle.db.insert(users).values(row)).rejects.toThrow();

    await handle.db.delete(users).where(sql`${users.email} = ${email}`);
  });

  it("status của idempotency_records bị CHECK constraint chặn", async () => {
    const email = `idem-${crypto.randomUUID()}@example.test`;
    const [user] = await handle.db
      .insert(users)
      .values({ email, displayName: "Kiem Tra", passwordHash: "$argon2id$placeholder" })
      .returning();

    await expect(
      handle.db.insert(idempotencyRecords).values({
        userId: user!.id,
        useCase: "auth.sign-up",
        keyHash: "hash",
        requestFingerprint: "fp",
        status: "khong-hop-le",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toThrow();

    await handle.db.delete(users).where(sql`${users.id} = ${user!.id}`);
  });

  it("cùng key nhưng khác use case là hai record hợp lệ", async () => {
    const email = `scope-${crypto.randomUUID()}@example.test`;
    const [user] = await handle.db
      .insert(users)
      .values({ email, displayName: "Kiem Tra", passwordHash: "$argon2id$placeholder" })
      .returning();

    const base = {
      userId: user!.id,
      keyHash: "cung-mot-key",
      requestFingerprint: "fp",
      status: "in_progress" as const,
      expiresAt: new Date(Date.now() + 86_400_000),
    };

    await handle.db.insert(idempotencyRecords).values({ ...base, useCase: "auth.sign-up" });
    await handle.db.insert(idempotencyRecords).values({ ...base, useCase: "auth.password.reset" });

    // Nhưng cùng key và cùng use case thì không.
    await expect(
      handle.db.insert(idempotencyRecords).values({ ...base, useCase: "auth.sign-up" }),
    ).rejects.toThrow();

    await handle.db
      .delete(idempotencyRecords)
      .where(sql`${idempotencyRecords.userId} = ${user!.id}`);
    await handle.db.delete(users).where(sql`${users.id} = ${user!.id}`);
  });

  it("transaction rollback thì không để lại gì", async () => {
    const email = `tx-${crypto.randomUUID()}@example.test`;

    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(users).values({
          email,
          displayName: "Se Bi Rollback",
          passwordHash: "$argon2id$placeholder",
        });
        throw new Error("hỏng giữa chừng");
      }),
    ).rejects.toThrow("hỏng giữa chừng");

    const rows = await handle.db
      .select()
      .from(users)
      .where(sql`${users.email} = ${email}`);
    expect(rows).toHaveLength(0);
  });

  it("session tham chiếu user thật — FK chặn ID bịa", async () => {
    await expect(
      handle.db.insert(authSessions).values({
        userId: crypto.randomUUID(),
        sessionTokenHash: `hash-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    ).rejects.toThrow();
  });
});
