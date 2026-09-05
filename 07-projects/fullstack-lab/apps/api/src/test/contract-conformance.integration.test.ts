import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptedResponseSchema,
  activitySchema,
  capabilitiesSchema,
  commentResponseSchema,
  commentSchema,
  errorEnvelopeSchema,
  listEnvelopeSchema,
  pageSchema,
  projectDetailSchema,
  projectMemberResponseSchema,
  projectResponseSchema,
  successEnvelopeSchema,
  taskResponseSchema,
  taskSchema,
  workspaceMemberListItemSchema,
  workspaceResponseSchema,
  workspaceSchema,
} from "@flowboard/contracts";
import { z } from "zod";
import { call, createFixture, newKey, type Fixture } from "./fixture.ts";

/**
 * Response thật phải parse được bằng **chính schema** của
 * `@flowboard/contracts`.
 *
 * Đây là đường nối giữa hai bên đang làm song song. Frontend viết theo mock, và
 * mock được kiểm bằng cùng bộ schema này; nếu API trả một hình dạng khác thì
 * hai bên sẽ chỉ phát hiện lúc ghép — muộn nhất có thể.
 *
 * Mọi schema là `.strict()`, nên test này bắt **cả hai** chiều: thiếu field, và
 * thừa field. Thừa field mới là thứ nguy hiểm hơn — nó thường là dữ liệu rò rỉ
 * ra ngoài projection đã duyệt.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

describeIfDb("response khớp hợp đồng của @flowboard/contracts", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
  });

  afterAll(async () => {
    await f.cleanup();
  });

  it("GET /workspaces khớp list envelope của workspace", async () => {
    const response = await call(f, "GET", "/workspaces", { actor: f.wsAdmin });
    const schema = listEnvelopeSchema(workspaceSchema);
    expect(() => schema.parse(response.body)).not.toThrow();
  });

  it("POST /workspaces khớp workspaceResponseSchema", async () => {
    const response = await call(f, "POST", "/workspaces", {
      actor: f.editor,
      idempotencyKey: newKey("conf-ws"),
      body: { name: "Kiểm hợp đồng" },
    });
    const schema = successEnvelopeSchema(workspaceResponseSchema);
    expect(() => schema.parse(response.body)).not.toThrow();
  });

  it("GET /workspaces/:id/members khớp list envelope của workspace member", async () => {
    const response = await call(f, "GET", `/workspaces/${f.workspaceId}/members`, {
      actor: f.wsAdmin,
    });
    const schema = listEnvelopeSchema(workspaceMemberListItemSchema);
    expect(() => schema.parse(response.body)).not.toThrow();
  });

  /**
   * `POST /workspaces/:id/members` — chờ hiện thực của
   * [ADR-0013](../../../../docs/decisions/ADR-0013-workspace-member-invitation.md).
   *
   * Route nay nhận `{ email, role }` và trả `202 { accepted: true }`, không còn
   * trả member projection. Khi hiện thực xong, test này khẳng định:
   * `acceptedResponseSchema` parse được, **và** ba nhánh — email có account,
   * email không có account, email đã là member — cho body **giống hệt nhau**.
   * Nhánh thứ ba là nhánh dễ bị làm sai nhất, vì nó có vẻ vô hại khi trả một
   * thông điệp khác.
   */
  it("POST /workspaces/:id/members trả 202 giống nhau ở cả ba nhánh (ADR-0013)", async () => {
    f.limiter.reset();

    // Nhánh 1: địa chỉ chưa từng có account.
    const stranger = await call(f, "POST", `/workspaces/${f.workspaceId}/members`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("conf-inv-1"),
      body: {
        email: `khong-ton-tai-${crypto.randomUUID().slice(0, 8)}@example.test`,
        role: "workspace_member",
      },
    });

    // Nhánh 2: có account, chưa thuộc workspace này.
    const withAccount = await call(f, "POST", `/workspaces/${f.workspaceId}/members`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("conf-inv-2"),
      body: { email: f.outsider.email, role: "workspace_member" },
    });

    // Nhánh 3: đã là member của chính workspace này.
    const alreadyMember = await call(f, "POST", `/workspaces/${f.workspaceId}/members`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("conf-inv-3"),
      body: { email: f.editor.email, role: "workspace_member" },
    });

    const schema = successEnvelopeSchema(acceptedResponseSchema);
    for (const response of [stranger, withAccount, alreadyMember]) {
      expect(response.status).toBe(202);
      expect(() => schema.parse(response.body)).not.toThrow();
    }

    /**
     * So **chéo** ba response với nhau, không so từng cái với một hằng số.
     *
     * Ba lần `expect(body).toEqual({ accepted: true })` đều pass ngay cả khi một
     * nhánh thêm một field mà hằng số cũng thêm — hoặc khi tác giả test sửa
     * hằng số cho khớp thứ đang chạy. So chéo thì không có chỗ nào để sửa cho
     * khớp: hai response phải giống nhau, chấm hết.
     */
    const comparable = (body: Record<string, unknown>) => ({ ...body, requestId: "<redacted>" });
    expect(comparable(withAccount.body)).toEqual(comparable(stranger.body));
    expect(comparable(alreadyMember.body)).toEqual(comparable(stranger.body));

    // Và không response nào nhắc lại địa chỉ đã nhập.
    expect(JSON.stringify(alreadyMember.body)).not.toContain(f.editor.email);
  });

  it("POST /workspaces/:id/projects khớp projectResponseSchema", async () => {
    const response = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("conf-proj"),
      body: { name: "Dự án kiểm hợp đồng" },
    });
    const schema = successEnvelopeSchema(projectResponseSchema);
    expect(() => schema.parse(response.body)).not.toThrow();
  });

  it("GET /projects/:id khớp projectDetailSchema, kể cả phần columns", async () => {
    /**
     * Tạo một cột **trước** khi đọc.
     *
     * `columns: []` khớp schema một cách rỗng — mảng rỗng không kiểm được hình
     * dạng phần tử nào. Cho tới M2 đó là tất cả những gì có thể; từ M3 thì
     * không, và một test vẫn hài lòng với mảng rỗng sẽ bỏ qua đúng phần vừa
     * được thêm.
     */
    const created = await call(f, "POST", `/projects/${f.projectBId}/columns`, {
      actor: f.owner,
      idempotencyKey: newKey("conformance-col"),
      body: { name: "Cần làm", afterColumnId: null },
    });
    expect(created.status).toBe(201);

    const response = await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.owner });
    const schema = successEnvelopeSchema(projectDetailSchema);
    expect(() => schema.parse(response.body)).not.toThrow();

    const data = response.body["data"] as { columns: unknown[] };
    expect(data.columns.length).toBeGreaterThan(0);
  });

  it("PATCH /projects/:id khớp projectResponseSchema", async () => {
    const response = await call(f, "PATCH", `/projects/${f.projectBId}`, {
      actor: f.owner,
      idempotencyKey: newKey("conf-rename"),
      body: { name: "Tên đã đổi" },
    });
    const schema = successEnvelopeSchema(projectResponseSchema);
    expect(() => schema.parse(response.body)).not.toThrow();
  });

  it("POST và PATCH project member khớp projectMemberResponseSchema", async () => {
    /**
     * Test này thêm User A vào Project B, nên nó **phải trả fixture về nguyên
     * trạng** trước khi kết thúc.
     *
     * Lý do không phải là gọn gàng: "User A không có membership Project B" là
     * một **tiền đề của fixture chuẩn**, và nhiều test khác dựa vào đó để chứng
     * minh `404`. Một test để lại User A trong project sẽ làm các test đó pass
     * vì lý do sai — chúng vẫn xanh, nhưng không còn kiểm điều chúng nói. Đó
     * đúng là kiểu phụ thuộc thứ tự mà `docs/operations/testing-strategy.md`
     * cấm.
     */
    const added = await call(f, "POST", `/projects/${f.projectBId}/members`, {
      actor: f.owner,
      idempotencyKey: newKey("conf-pm"),
      body: { userId: f.userA.id, role: "viewer" },
    });
    const changed = await call(f, "PATCH", `/projects/${f.projectBId}/members/${f.userA.id}`, {
      actor: f.owner,
      idempotencyKey: newKey("conf-pmr"),
      body: { role: "editor" },
    });

    const schema = successEnvelopeSchema(projectMemberResponseSchema);
    expect(() => schema.parse(added.body)).not.toThrow();
    expect(() => schema.parse(changed.body)).not.toThrow();

    const removed = await call(f, "DELETE", `/projects/${f.projectBId}/members/${f.userA.id}`, {
      actor: f.owner,
      idempotencyKey: newKey("conf-pmd"),
    });
    expect(removed.status).toBe(204);

    // Khẳng định tiền đề đã trở lại: User A ở ngoài Project B.
    const denied = await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.userA });
    expect(denied.status).toBe(404);
  });

  /**
   * Bảy route của M4.
   *
   * Mỗi response được parse bằng **chính** schema mà `@flowboard/contracts`
   * công bố, không phải một bản chép tay: một field thừa, thiếu, hay sai kiểu
   * đều làm `.strict()` từ chối.
   */
  it("bảy route của M4 khớp schema của hợp đồng", async () => {
    const project = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("conf-m4-project"),
      body: { name: `Hợp đồng M4 ${crypto.randomUUID().slice(0, 8)}` },
    });
    const projectId = (project.body["data"] as { project: { id: string } }).project.id;

    const columnIds: string[] = [];
    for (const name of ["Đang làm", "Đã xong"]) {
      const column = await call(f, "POST", `/projects/${projectId}/columns`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("conf-m4-col"),
        body: { name, afterColumnId: null },
      });
      columnIds.push((column.body["data"] as { column: { id: string } }).column.id);
    }

    // 1. POST /projects/:projectId/tasks
    const created = await call(f, "POST", `/projects/${projectId}/tasks`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("conf-m4-task"),
      body: {
        title: "Task hợp đồng",
        columnId: columnIds[0] as string,
        description: "Có mô tả",
        category: "feature",
        priority: "medium",
        dueDate: "2026-12-01",
        evidenceUrl: "https://example.test/bang-chung",
      },
    });
    expect(created.status).toBe(201);
    const taskResponse = successEnvelopeSchema(taskResponseSchema);
    expect(() => taskResponse.parse(created.body)).not.toThrow();
    const taskId = (created.body["data"] as { task: { id: string } }).task.id;

    // 2. GET /projects/:projectId/tasks
    const list = await call(f, "GET", `/projects/${projectId}/tasks`, { actor: f.wsAdmin });
    expect(() => listEnvelopeSchema(taskSchema).parse(list.body)).not.toThrow();

    // 3. POST /tasks/:taskId/comments
    const comment = await call(f, "POST", `/tasks/${taskId}/comments`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("conf-m4-comment"),
      body: { body: "Bình luận hợp đồng" },
    });
    expect(comment.status).toBe(201);
    expect(() => successEnvelopeSchema(commentResponseSchema).parse(comment.body)).not.toThrow();

    /**
     * 4. `GET /tasks/:taskId` — **hợp đồng không có schema cho response này**.
     *
     * `packages/contracts` công bố `taskResponseSchema` (`{ task, capabilities }`)
     * và `commentResponseSchema`, nhưng không có schema nào cho hình dạng
     * `{ task, comments: { items, page }, capabilities }` mà
     * `endpoint-contracts.md` mô tả cho route này. Đây là một lỗ hổng của hợp
     * đồng được **báo cáo**, không tự vá — `packages/contracts` không thuộc lane
     * này. Ở đây từng mảnh được parse bằng schema có thật.
     */
    const detail = await call(f, "GET", `/tasks/${taskId}`, { actor: f.wsAdmin });
    expect(detail.status).toBe(200);
    const detailData = detail.body["data"] as {
      task: unknown;
      comments: { items: unknown[]; page: unknown };
      capabilities: unknown;
    };
    expect(() => taskSchema.parse(detailData.task)).not.toThrow();
    expect(() => z.array(commentSchema).parse(detailData.comments.items)).not.toThrow();
    expect(() => pageSchema.parse(detailData.comments.page)).not.toThrow();
    expect(() => capabilitiesSchema.parse(detailData.capabilities)).not.toThrow();

    // 5. PATCH /tasks/:taskId
    const patched = await call(f, "PATCH", `/tasks/${taskId}`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("conf-m4-patch"),
      body: { title: "Đã đổi tên", expectedVersion: 1 },
    });
    expect(() => taskResponse.parse(patched.body)).not.toThrow();

    // 6. POST /tasks/:taskId/move
    const moved = await call(f, "POST", `/tasks/${taskId}/move`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("conf-m4-move"),
      body: {
        destinationColumnId: columnIds[1] as string,
        targetPosition: "1024.0000000000",
        expectedVersion: 2,
      },
    });
    expect(moved.status).toBe(200);
    expect(() => taskResponse.parse(moved.body)).not.toThrow();

    // 7. GET /tasks/:taskId/activity
    const activity = await call(f, "GET", `/tasks/${taskId}/activity`, { actor: f.wsAdmin });
    expect(() => listEnvelopeSchema(activitySchema).parse(activity.body)).not.toThrow();
  });

  describe("envelope lỗi", () => {
    /**
     * Envelope lỗi có một `refine` riêng: chỉ `VALIDATION_FAILED` được mang
     * field-error array và chỉ `TASK_VERSION_CONFLICT` được mang object
     * `currentVersion`. Mọi code khác mà kèm `details` là sai hợp đồng, và
     * schema sẽ từ chối.
     */
    const cases: { name: string; run: () => Promise<{ body: Record<string, unknown> }> }[] = [
      {
        name: "401 khi không có session",
        run: async () => await call(f, "GET", "/workspaces"),
      },
      {
        name: "403 khi Viewer gọi mutation",
        run: async () =>
          await call(f, "PATCH", `/projects/${f.projectBId}`, {
            actor: f.viewer,
            idempotencyKey: newKey("conf-403"),
            body: { name: "x" },
          }),
      },
      {
        name: "404 khi actor ngoài project",
        run: async () => await call(f, "GET", `/projects/${f.projectBId}`, { actor: f.userA }),
      },
      {
        name: "400 khi body sai schema",
        run: async () =>
          await call(f, "PATCH", `/projects/${f.projectBId}`, {
            actor: f.owner,
            idempotencyKey: newKey("conf-400"),
            body: { name: "x", description: "field lạ" },
          }),
      },
      {
        /**
         * `COLUMN_NOT_EMPTY` là code mới của M3, và envelope lỗi có một `refine`
         * cấm mọi code ngoài `VALIDATION_FAILED` mang `details`. Một code mới
         * lỡ kèm `details` chỉ lộ ra ở đây.
         */
        name: "409 COLUMN_NOT_EMPTY khi archive cột còn task",
        run: async () => {
          const created = await call(f, "POST", `/projects/${f.projectBId}/columns`, {
            actor: f.owner,
            idempotencyKey: newKey("conf-col"),
            body: { name: "Cột còn việc", afterColumnId: null },
          });
          const columnId = (created.body["data"] as { column: { id: string } }).column.id;

          f.setColumnHasTasks(true);
          try {
            return await call(f, "PATCH", `/columns/${columnId}`, {
              actor: f.owner,
              idempotencyKey: newKey("conf-col-archive"),
              body: { archive: true },
            });
          } finally {
            f.setColumnHasTasks(false);
          }
        },
      },
      {
        /**
         * `TASK_VERSION_CONFLICT` là code **duy nhất còn lại** được mang
         * `details`, và `details` của nó là object `{ currentVersion }` chứ
         * không phải field-error array. Envelope có một `refine` cưỡng chế đúng
         * điều đó, nên một `details` sai hình dạng chỉ lộ ra ở đây.
         */
        name: "409 TASK_VERSION_CONFLICT mang object currentVersion",
        run: async () => {
          const project = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
            actor: f.wsAdmin,
            idempotencyKey: newKey("conf-vc-project"),
            body: { name: `Xung đột version ${crypto.randomUUID().slice(0, 8)}` },
          });
          const projectId = (project.body["data"] as { project: { id: string } }).project.id;

          const column = await call(f, "POST", `/projects/${projectId}/columns`, {
            actor: f.wsAdmin,
            idempotencyKey: newKey("conf-vc-col"),
            body: { name: "Cần làm", afterColumnId: null },
          });
          const columnId = (column.body["data"] as { column: { id: string } }).column.id;

          const task = await call(f, "POST", `/projects/${projectId}/tasks`, {
            actor: f.wsAdmin,
            idempotencyKey: newKey("conf-vc-task"),
            body: { title: "Việc", columnId, description: null },
          });
          const taskId = (task.body["data"] as { task: { id: string } }).task.id;

          return await call(f, "PATCH", `/tasks/${taskId}`, {
            actor: f.wsAdmin,
            idempotencyKey: newKey("conf-vc-patch"),
            body: { title: "Sai version", expectedVersion: 99 },
          });
        },
      },
      {
        name: "409 khi tái dùng Idempotency-Key",
        run: async () => {
          const key = newKey("conf-409");
          await call(f, "POST", "/workspaces", {
            actor: f.owner,
            idempotencyKey: key,
            body: { name: "Lần một" },
          });
          return await call(f, "POST", "/workspaces", {
            actor: f.owner,
            idempotencyKey: key,
            body: { name: "Lần hai" },
          });
        },
      },
    ];

    for (const testCase of cases) {
      it(`${testCase.name} khớp errorEnvelopeSchema`, async () => {
        const response = await testCase.run();
        expect(() => errorEnvelopeSchema.parse(response.body)).not.toThrow();
      });
    }

    it("mọi error code trả về đều nằm trong danh mục đóng", async () => {
      const responses = await Promise.all(cases.map(async (c) => await c.run()));
      for (const response of responses) {
        const parsed = errorEnvelopeSchema.parse(response.body);
        // `errorCodeSchema` là enum đóng, nên parse thành công đã là bằng chứng.
        expect(parsed.error.code).toBeTruthy();
      }
    });
  });
});
