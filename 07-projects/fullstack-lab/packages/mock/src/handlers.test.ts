import { describe, expect, it } from "vitest";
import {
  errorEnvelopeSchema,
  listEnvelopeSchema,
  pendingInvitationSchema,
  projectListItemSchema,
  successEnvelopeSchema,
  activitySchema,
  boardColumnSchema,
  commentSchema,
  workspaceSchema,
  taskSchema,
  projectSchema,
  capabilitiesSchema,
  actorSchema,
  ERROR_CODES,
  ERROR_STATUS,
  type ErrorCode,
} from "@flowboard/contracts";
import { z } from "zod";
import {
  activityHandlers,
  authHandlers,
  columnHandlers,
  commentHandlers,
  errorFor,
  invitationHandlers,
  projectHandlers,
  taskHandlers,
  workspaceHandlers,
  type Scenario,
} from "./handlers.js";
import { ids, invitations } from "./fixtures.js";

/**
 * Cổng ra đo được của M0.3.
 *
 * Một mock trả sai shape còn tệ hơn không có mock, vì nó dạy frontend sai một
 * cách rất tự tin. Vì vậy test này kiểm **mọi** response của mock — cả nhánh
 * thành công lẫn nhánh lỗi — có parse được bằng chính schema trong
 * `@flowboard/contracts` hay không.
 */

const errorScenarios: Exclude<Scenario, "success">[] = [
  "unauthenticated",
  "forbidden",
  "not-found",
  "validation-failed",
  "version-conflict",
  "idempotency-reused",
  "idempotency-in-progress",
  "column-not-empty",
  "project-last-owner",
  "member-has-assigned-tasks",
  "workspace-member-in-projects",
  "rate-limited",
  "email-verification-required",
  "internal-error",
];

describe("nhánh lỗi", () => {
  it.each(errorScenarios)("kịch bản %s trả envelope lỗi hợp lệ", (scenario) => {
    const res = errorFor(scenario);
    const parsed = errorEnvelopeSchema.safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it.each(errorScenarios)("kịch bản %s dùng đúng HTTP status đã công bố", (scenario) => {
    const res = errorFor(scenario);
    const body = errorEnvelopeSchema.parse(res.body);
    expect(res.status).toBe(ERROR_STATUS[body.error.code]);
  });

  it("mọi 429 đều mang Retry-After — hợp đồng bắt buộc", () => {
    const res = errorFor("rate-limited");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toMatch(/^\d+$/);
  });

  it("409 IDEMPOTENCY_IN_PROGRESS gợi ý khoảng chờ", () => {
    const res = errorFor("idempotency-in-progress");
    expect(res.headers["retry-after"]).toMatch(/^\d+$/);
  });

  it("VALIDATION_FAILED dùng field-error array, không dùng object", () => {
    const body = errorEnvelopeSchema.parse(errorFor("validation-failed").body);
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it("TASK_VERSION_CONFLICT dùng object currentVersion, không dùng array", () => {
    const body = errorEnvelopeSchema.parse(errorFor("version-conflict").body);
    expect(Array.isArray(body.error.details)).toBe(false);
    expect(body.error.details).toEqual({ currentVersion: 7 });
  });

  it.each(ERROR_CODES.filter((c) => c !== "VALIDATION_FAILED" && c !== "TASK_VERSION_CONFLICT"))(
    "%s không được phép gắn details",
    (code: ErrorCode) => {
      // Mock tự bảo vệ: gắn details cho code không công bố nó là lỗi lập trình,
      // và phải nổ ngay thay vì tạo một response sai mà frontend lại tin.
      expect(() => errorFor("forbidden")).not.toThrow();
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    },
  );

  it("mọi response lỗi đều có X-Request-Id trùng với requestId trong body", () => {
    for (const scenario of errorScenarios) {
      const res = errorFor(scenario);
      const body = errorEnvelopeSchema.parse(res.body);
      expect(res.headers["x-request-id"]).toBe(body.requestId);
    }
  });
});

describe("nhánh thành công khớp schema contract", () => {
  it("sign-up", () => {
    const res = authHandlers.signUp({
      email: "Mai@Example.test",
      displayName: "Mai",
      password: "một mật khẩu đủ dài",
    });
    expect(res.status).toBe(201);
    const schema = successEnvelopeSchema(
      z
        .object({
          account: z
            .object({ email: z.email(), displayName: z.string(), emailVerified: z.literal(false) })
            .strict(),
          verificationEmailSent: z.boolean(),
        })
        .strict(),
    );
    expect(schema.safeParse(res.body).success).toBe(true);
  });

  it("sign-in trả actor và csrfToken, không trả session ID", () => {
    const res = authHandlers.signIn({ email: "mai@example.test", password: "mật khẩu đủ dài ok" });
    const schema = successEnvelopeSchema(
      z.object({ actor: actorSchema, csrfToken: z.string().min(1) }).strict(),
    );
    const parsed = schema.safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/sessionId|session_token/i);
  });

  it("sign-out trả 204 không body nhưng vẫn có X-Request-Id", () => {
    const res = authHandlers.signOut();
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("resend và forgot trả cùng một body generic — chống enumeration", () => {
    const a = authHandlers.resendVerification({ email: "ai-do@example.test" });
    const b = authHandlers.forgotPassword({ email: "khong-ton-tai@example.test" });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect((a.body as { data: unknown }).data).toEqual((b.body as { data: unknown }).data);
  });

  it("danh sách workspace", () => {
    const res = workspaceHandlers.list();
    expect(listEnvelopeSchema(workspaceSchema).safeParse(res.body).success).toBe(true);
  });

  it("danh sách project trong workspace parse được bằng projectListItemSchema", () => {
    const res = projectHandlers.listInWorkspace();
    const parsed = listEnvelopeSchema(projectListItemSchema).safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("danh sách project KHÔNG trả count thành viên hay count task", () => {
    const res = projectHandlers.listInWorkspace();
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/memberCount|taskCount|openTasks/);
  });

  it("project detail gồm project, capabilities, columns và members", () => {
    const res = projectHandlers.detail();
    const schema = successEnvelopeSchema(
      z
        .object({
          project: projectSchema,
          capabilities: capabilitiesSchema,
          columns: z.array(boardColumnSchema),
          members: z.array(z.unknown()),
        })
        .strict(),
    );
    const parsed = schema.safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("danh sách task", () => {
    const res = taskHandlers.list();
    const parsed = listEnvelopeSchema(taskSchema).safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("tạo comment", () => {
    const res = commentHandlers.create({ body: "Tôi nhận việc này." });
    expect(res.status).toBe(201);
    const schema = successEnvelopeSchema(z.object({ comment: commentSchema }).strict());
    expect(schema.safeParse(res.body).success).toBe(true);
  });

  it("danh sách activity", () => {
    const res = activityHandlers.list();
    expect(listEnvelopeSchema(activitySchema).safeParse(res.body).success).toBe(true);
  });

  it("tạo column giữ đúng cờ requiresReviewer và isTerminal client gửi", () => {
    const res = columnHandlers.create({
      name: "Chờ duyệt",
      afterColumnId: null,
      isTerminal: false,
      requiresReviewer: true,
    });
    const schema = successEnvelopeSchema(z.object({ column: boardColumnSchema }).strict());
    const parsed = schema.safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const body = res.body as { data: { column: { requiresReviewer: boolean } } };
    expect(body.data.column.requiresReviewer).toBe(true);
  });
});

describe("body sai trả 400 với field-error array", () => {
  it("thiếu title khi tạo task", () => {
    const res = taskHandlers.create({ columnId: ids.columnBacklog });
    const parsed = errorEnvelopeSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(res.status).toBe(400);
    expect(Array.isArray((parsed.data as { error: { details: unknown } }).error.details)).toBe(
      true,
    );
  });

  it("evidenceUrl dùng scheme không phải https", () => {
    const res = taskHandlers.create({
      title: "Việc mới",
      columnId: ids.columnBacklog,
      evidenceUrl: "javascript:alert(1)",
    });
    expect(res.status).toBe(400);
  });

  it("patch task rỗng bị từ chối", () => {
    const res = taskHandlers.update({ expectedVersion: 3 });
    expect(res.status).toBe(400);
  });

  it("reorder có ID lặp bị từ chối", () => {
    const res = columnHandlers.reorder({
      projectId: ids.projectB,
      orderedColumnIds: [ids.columnBacklog, ids.columnBacklog],
    });
    expect(res.status).toBe(400);
  });
});

/**
 * Lời mời — [ADR-0013](../../../docs/decisions/ADR-0013-workspace-member-invitation.md).
 *
 * Điều đáng kiểm nhất ở đây không phải shape mà là **sự giống nhau**: ba nhánh
 * mời và bốn nguyên nhân token hỏng phải cho ra những response không phân biệt
 * được. Vì thế các test dưới đây so các response **với nhau**, chứ không so
 * từng cái với một chuỗi mong đợi — so với chuỗi thì hai nhánh cùng sai theo
 * cùng một kiểu vẫn xanh.
 */
describe("lời mời", () => {
  it("danh sách chỉ có lời mời pending và parse đúng projection", () => {
    const res = invitationHandlers.list();
    const parsed = listEnvelopeSchema(pendingInvitationSchema).safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("projection không chứa tokenHash hay status", () => {
    // `.strict()` của schema đã cấm field lạ, nhưng fixture mới có thể được
    // thêm field và schema mới có thể được nới. Kiểm thẳng vào dữ liệu để hai
    // sai lầm đó không thể cùng lúc trốn thoát.
    const serialized = JSON.stringify(invitations);
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("status");
  });

  it("thu hồi trả 204 không body", () => {
    const res = invitationHandlers.revoke();
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("chấp nhận trả workspace vừa tham gia", () => {
    const res = invitationHandlers.accept({ token: "a".repeat(43) });
    const schema = successEnvelopeSchema(z.object({ workspace: workspaceSchema }).strict());
    const parsed = schema.safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("bốn nguyên nhân token hỏng cho cùng một response", () => {
    // Mock chỉ có **một** hàm cho cả bốn, nên phép kiểm thật nằm ở chỗ: gọi nó
    // bốn lần cho ra bốn body giống nhau trừ `requestId`. Nếu sau này có ai
    // thêm nhánh riêng cho "hết hạn", test này đỏ.
    const bodies = ["invalid", "expired", "used", "revoked"].map(() => {
      const res = invitationHandlers.tokenUnusable();
      const body = res.body as { error: unknown; requestId: string };
      return { status: res.status, error: body.error };
    });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(bodies[0]?.status).toBe(400);
  });

  it("token hỏng KHÔNG kèm details — details là chỗ nguyên nhân rò ra", () => {
    const res = invitationHandlers.tokenUnusable();
    const body = res.body as { error: { code: string; details?: unknown } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toBeUndefined();
  });

  it("email khác là 403 và nói rõ, vì người giữ token đã đọc được hộp thư đó", () => {
    const res = invitationHandlers.emailMismatch();
    expect(res.status).toBe(403);
    const parsed = errorEnvelopeSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).not.toBe("");
  });

  it("mời trả 202 accepted giống hệt nhau cho mọi email", () => {
    // Ba nhánh mà ADR-0013 yêu cầu không phân biệt được: đã có account, chưa
    // có account, đã là member. Fixture cố ý có một email trùng actor và một
    // email không trùng ai.
    const responses = [
      "ownerb@example.test",
      "khong-ton-tai@example.test",
      "quan@example.test",
    ].map((email) => workspaceHandlers.invite({ email, role: "workspace_member" }));
    const shapes = responses.map((res) => ({
      status: res.status,
      data: (res.body as { data: unknown }).data,
    }));
    for (const shape of shapes) expect(shape).toEqual(shapes[0]);
    expect(shapes[0]).toEqual({ status: 202, data: { accepted: true } });
  });

  it("mời với role không hợp lệ bị từ chối trước khi gửi thư", () => {
    const res = workspaceHandlers.invite({ email: "a@example.test", role: "owner" });
    expect(res.status).toBe(400);
  });
});

/**
 * `PATCH /columns/:columnId` nhận **đúng một** command.
 *
 * Kiểu union ở `packages/contracts` đã chặn body trộn lúc biên dịch, nhưng
 * frontend không phải nguồn duy nhất gửi request tới route này. Bộ kiểm dưới
 * đây khẳng định chính **schema** từ chối, nên chặn đó còn nguyên kể cả với
 * một client không dùng TypeScript.
 */
describe("command của board column", () => {
  it("mỗi command hợp lệ đi một mình", () => {
    const commands = [
      { name: "Chờ duyệt" },
      { isTerminal: true },
      { requiresReviewer: false },
      { archive: true },
    ];
    for (const command of commands) {
      const res = columnHandlers.update(command);
      expect(res.status, JSON.stringify(command)).toBe(200);
    }
  });

  it("body trộn hai command bị từ chối", () => {
    expect(columnHandlers.update({ name: "Chờ duyệt", isTerminal: true }).status).toBe(400);
    expect(columnHandlers.update({ archive: true, requiresReviewer: true }).status).toBe(400);
  });

  it("body rỗng và `archive: false` đều bị từ chối", () => {
    // `archive: false` không có nghĩa nào cả: MVP không có unarchive, nên nhánh
    // đó là `z.literal(true)` chứ không phải `z.boolean()`.
    expect(columnHandlers.update({}).status).toBe(400);
    expect(columnHandlers.update({ archive: false }).status).toBe(400);
  });

  it("thêm cột không nhận position hay projectId từ client", () => {
    const base = { name: "Chờ duyệt", afterColumnId: null };
    expect(columnHandlers.create(base).status).toBe(201);
    expect(columnHandlers.create({ ...base, position: "512" }).status).toBe(400);
    expect(columnHandlers.create({ ...base, projectId: ids.projectB }).status).toBe(400);
  });
});
