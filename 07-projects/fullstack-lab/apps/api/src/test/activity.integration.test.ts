import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, createFixture, newKey, type Fixture } from "./fixture.ts";

/**
 * Activity log — nợ của M2, trả ở M3.
 *
 * Ở M2 năm mutation của module `projects` **không** ghi activity, vì bảng
 * `activity_logs` chưa tồn tại. Hệ quả là mọi khẳng định dạng "nhánh bị từ chối
 * không tạo activity row" khi đó đúng **một cách rỗng**: không có bảng nào để
 * ghi vào thì không có gì để sai.
 *
 * File này là mặt còn lại của phép trả nợ. Nó không kiểm "không có gì được
 * ghi"; nó kiểm rằng **có** — từng event, đúng tên, đúng số lượng, cùng
 * transaction với mutation. Một bảng chỉ chứng minh được điều nó nói khi cả hai
 * chiều đều được đo.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

describeIfDb("activity log", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
  });

  afterAll(async () => {
    await f.cleanup();
  });

  it("năm mutation của M2 nay ghi đúng năm event, mỗi cái một dòng", async () => {
    // 1. project.created
    const created = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("act-create"),
      body: { name: `Dự án ghi lịch sử ${crypto.randomUUID().slice(0, 8)}` },
    });
    expect(created.status).toBe(201);
    const projectId = (created.body["data"] as { project: { id: string } }).project.id;
    expect(await f.activity.countForProject(projectId, "project.created")).toBe(1);

    // 2. project.updated
    expect(
      (
        await call(f, "PATCH", `/projects/${projectId}`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("act-rename"),
          body: { name: "Tên đã đổi" },
        })
      ).status,
    ).toBe(200);
    expect(await f.activity.countForProject(projectId, "project.updated")).toBe(1);

    // 3. project_member.added
    expect(
      (
        await call(f, "POST", `/projects/${projectId}/members`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("act-add"),
          body: { userId: f.editor.id, role: "editor" },
        })
      ).status,
    ).toBe(201);
    expect(await f.activity.countForProject(projectId, "project_member.added")).toBe(1);

    // 4. project_member.role_changed
    expect(
      (
        await call(f, "PATCH", `/projects/${projectId}/members/${f.editor.id}`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("act-role"),
          body: { role: "viewer" },
        })
      ).status,
    ).toBe(200);
    expect(await f.activity.countForProject(projectId, "project_member.role_changed")).toBe(1);

    // 5. project_member.removed
    expect(
      (
        await call(f, "DELETE", `/projects/${projectId}/members/${f.editor.id}`, {
          actor: f.wsAdmin,
          idempotencyKey: newKey("act-remove"),
        })
      ).status,
    ).toBe(204);
    expect(await f.activity.countForProject(projectId, "project_member.removed")).toBe(1);

    // Đúng năm dòng, không thừa một event nào không ai khai báo.
    expect(await f.activity.countForProject(projectId)).toBe(5);
  });

  it("payload không mang email hay tên hiển thị của người dùng", async () => {
    const created = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("act-priv"),
      body: { name: `Dự án riêng tư ${crypto.randomUUID().slice(0, 8)}` },
    });
    const projectId = (created.body["data"] as { project: { id: string } }).project.id;

    await call(f, "POST", `/projects/${projectId}/members`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("act-priv-add"),
      body: { userId: f.viewer.id, role: "viewer" },
    });

    const rows = await f.activity.recentForProject(projectId, 10);
    const serialized = JSON.stringify(rows.map((row) => row.payload));

    /**
     * Activity là dữ liệu lưu lâu và đọc lại về sau. Nhét email hay tên hiển
     * thị vào payload là nhân bản thông tin định danh sang một bảng mà không ai
     * nghĩ tới khi rà soát — `userId` đã đủ để dựng lại `summary` lúc đọc.
     */
    expect(serialized).not.toContain(f.viewer.email);
    expect(serialized).not.toContain(f.viewer.displayName);
    expect(serialized).toContain(f.viewer.id);
  });

  it("actor của mỗi dòng là người thật sự gọi, không phải chủ resource", async () => {
    const created = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("act-actor"),
      body: { name: `Dự án actor ${crypto.randomUUID().slice(0, 8)}` },
    });
    const projectId = (created.body["data"] as { project: { id: string } }).project.id;

    // `userB` được thêm làm Owner, rồi **chính userB** đổi tên project.
    await call(f, "POST", `/projects/${projectId}/members`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("act-actor-add"),
      body: { userId: f.userB.id, role: "owner" },
    });
    await call(f, "PATCH", `/projects/${projectId}`, {
      actor: f.userB,
      idempotencyKey: newKey("act-actor-rename"),
      body: { name: "Do userB đổi" },
    });

    const rows = await f.activity.recentForProject(projectId, 10);
    const rename = rows.find((row) => row.action === "project.updated");
    expect(rename?.actorUserId).toBe(f.userB.id);

    const projectCreated = rows.find((row) => row.action === "project.created");
    expect(projectCreated?.actorUserId).toBe(f.wsAdmin.id);
  });

  /**
   * Activity và mutation phải **cùng số phận**.
   *
   * Một recorder tự mở transaction riêng sẽ để lại một dòng lịch sử kể về một
   * việc đã rollback. Cách kiểm là chạy một mutation thất bại **sau** khi phần
   * ghi của nó đã chạy trong cùng transaction: `PROJECT_LAST_OWNER` được phát
   * hiện trước lệnh ghi, nên nhánh chắc chắn hơn là idempotency replay của một
   * business failure — cả hai đều phải để lại đúng 0 dòng.
   */
  it("mutation thất bại không để lại dòng lịch sử nào", async () => {
    const created = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("act-rollback"),
      body: { name: `Dự án một Owner ${crypto.randomUUID().slice(0, 8)}` },
    });
    const projectId = (created.body["data"] as { project: { id: string } }).project.id;
    const before = await f.activity.countForProject(projectId);

    const failed = await call(f, "PATCH", `/projects/${projectId}/members/${f.wsAdmin.id}`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("act-rollback-demote"),
      body: { role: "viewer" },
    });

    expect(failed.status).toBe(409);
    expect(await f.activity.countForProject(projectId)).toBe(before);
    expect(await f.activity.countForProject(projectId, "project_member.role_changed")).toBe(0);
  });
});
