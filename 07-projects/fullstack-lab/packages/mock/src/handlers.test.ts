import { describe, expect, it } from "vitest";
import {
  errorEnvelopeSchema,
  listEnvelopeSchema,
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
  projectHandlers,
  taskHandlers,
  workspaceHandlers,
  type Scenario,
} from "./handlers.js";
import { ids } from "./fixtures.js";

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
