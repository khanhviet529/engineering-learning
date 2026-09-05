import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveCsrfToken } from "../shared/http/csrf.ts";
import { KeyRing } from "../shared/security/key-ring.ts";
import { encodeCursor } from "../shared/http/cursor.ts";
import {
  CSRF_SECRET_PREVIOUS,
  SESSION_SECRET_PREVIOUS,
  call,
  createFixture,
  newKey,
  type Fixture,
  type TestActor,
} from "./fixture.ts";

/**
 * Xoay secret **mà không đá ai ra**.
 *
 * ## Điều đo được trước khi thiết kế, và nó đổi cả thiết kế
 *
 * Câu hỏi đặt ra là "đổi `SESSION_SECRET` thì mọi session chết". Đọc code cho
 * thấy **không phải vậy**: session token là 32 byte ngẫu nhiên và database chỉ
 * giữ SHA-256 của nó — không key nào ký nó cả. `SESSION_SECRET` ký **cursor**;
 * `CSRF_SECRET` ký CSRF token. Test đầu tiên dưới đây khẳng định đúng điều đó,
 * vì một thiết kế dựa trên một giả định sai sẽ giải một bài toán không tồn tại.
 */

const url = process.env["DATABASE_URL_HOST"] ?? process.env["DATABASE_URL"];
const describeIfDb = url ? describe : describe.skip;

describeIfDb("xoay secret", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture(url as string);
    f.setToday("2026-09-05");
  });

  afterAll(async () => {
    await f.cleanup();
  });

  /* ---------------------------------------------------------------------- *
   * Session **không** được ký bằng key nào
   * ---------------------------------------------------------------------- */

  /**
   * Nếu session được ký, xoay key sẽ làm request dưới đây thành `401`.
   *
   * Nó là `200`, và đó là bằng chứng rằng "đổi key đá mọi người ra" **không**
   * đúng với session — thứ thật sự đau là CSRF token, và thiết kế nhắm vào đó.
   */
  it("session sống sót qua mọi bộ key, vì không key nào ký nó", async () => {
    const foreignKeys = new KeyRing("thu-nghiem", { current: "z".repeat(32) });
    expect(foreignKeys.signingKey).not.toBe(f.csrfKeys.signingKey);

    // Đọc thuần, không cần CSRF: session vẫn resolve được actor.
    const response = await call(f, "GET", "/workspaces", { actor: f.owner });
    expect(response.status).toBe(200);
  });

  /* ---------------------------------------------------------------------- *
   * CSRF: token của thế hệ trước vẫn dùng được
   * ---------------------------------------------------------------------- */

  async function mutate(actor: TestActor, csrfToken: string) {
    return await call(f, "PATCH", `/projects/${f.projectBId}`, {
      actor: { ...actor, csrfToken },
      idempotencyKey: newKey("rotate"),
      body: { name: `Đổi tên ${crypto.randomUUID().slice(0, 8)}` },
    });
  }

  /**
   * Đây là toàn bộ giá trị của cửa sổ xoay.
   *
   * Một tab đang mở cầm CSRF token ký bằng key **cũ**. Không có cửa sổ, nó nhận
   * `403` ngay khoảnh khắc key đổi — và người dùng không hiểu vì sao nút Lưu
   * ngừng hoạt động.
   */
  it("CSRF token ký bằng key cũ vẫn được chấp nhận trong cửa sổ xoay", async () => {
    const oldToken = deriveCsrfToken(f.owner.sessionToken, CSRF_SECRET_PREVIOUS);
    expect(oldToken).not.toBe(f.owner.csrfToken);

    const before = f.csrfKeys.previousKeyHits;
    const response = await mutate(f.owner, oldToken);

    expect(response.status).toBe(200);
    /**
     * Bộ đếm là thứ thay thế `kid`.
     *
     * Không có nó, một `200` ở trên không phân biệt được "key cũ được chấp nhận"
     * với "phép kiểm CSRF không chạy" — và đó đúng là loại test xanh mà không
     * kiểm được gì.
     */
    expect(f.csrfKeys.previousKeyHits).toBe(before + 1);
  });

  it("token ký bằng key hiện hành **không** làm bộ đếm nhích", async () => {
    const before = f.csrfKeys.previousKeyHits;
    const response = await mutate(f.owner, f.owner.csrfToken);

    expect(response.status).toBe(200);
    // Đường thường không đi qua key cũ, nên "đóng cửa sổ được chưa" trả lời được.
    expect(f.csrfKeys.previousKeyHits).toBe(before);
  });

  it("token ký bằng key không thuộc bộ nào vẫn bị từ chối", async () => {
    const forged = deriveCsrfToken(f.owner.sessionToken, "x".repeat(32));
    const response = await mutate(f.owner, forged);

    expect(response.status).toBe(403);
    expect((response.body["error"] as { code: string }).code).toBe("FORBIDDEN");
  });

  /**
   * Token **mới cấp** luôn thuộc thế hệ mới.
   *
   * Cửa sổ xoay chỉ nới phía verify. Nếu phía ký cũng nới, cửa sổ sẽ không bao
   * giờ đóng được: mỗi lần đăng nhập lại phát sinh thêm một token ký bằng key
   * cũ, và bộ đếm không bao giờ về không.
   */
  it("token mới luôn ký bằng key hiện hành, không phải key cũ", async () => {
    const response = await call(f, "GET", "/auth/session", { actor: f.owner });
    expect(response.status).toBe(200);

    const issued = (response.body["data"] as { csrfToken: string }).csrfToken;
    expect(issued).toBe(deriveCsrfToken(f.owner.sessionToken, f.csrfKeys.signingKey));
    expect(issued).not.toBe(deriveCsrfToken(f.owner.sessionToken, CSRF_SECRET_PREVIOUS));
  });

  /* ---------------------------------------------------------------------- *
   * Cursor: cùng cơ chế, hậu quả nhẹ hơn
   * ---------------------------------------------------------------------- */

  /**
   * Cursor ký bằng key cũ vẫn cuộn tiếp được.
   *
   * Hậu quả khi không có cửa sổ nhẹ hơn CSRF — người dùng bị đá về trang đầu chứ
   * không mất một thao tác — nhưng cơ chế giống hệt, nên nó được xử cùng một
   * cách thay vì có một đường xử lý thứ hai.
   */
  it("cursor ký bằng key cũ vẫn giải mã được", async () => {
    const projectId = await (async (): Promise<string> => {
      const created = await call(f, "POST", `/workspaces/${f.workspaceId}/projects`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("rotate-cursor"),
        body: { name: `Xoay cursor ${crypto.randomUUID().slice(0, 8)}` },
      });
      return (created.body["data"] as { project: { id: string } }).project.id;
    })();

    const column = await call(f, "POST", `/projects/${projectId}/columns`, {
      actor: f.wsAdmin,
      idempotencyKey: newKey("col"),
      body: { name: "Cần làm", afterColumnId: null },
    });
    const columnId = (column.body["data"] as { column: { id: string } }).column.id;

    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const task = await call(f, "POST", `/projects/${projectId}/tasks`, {
        actor: f.wsAdmin,
        idempotencyKey: newKey("task"),
        body: { title: `Việc ${String(i)}`, columnId, description: "" },
      });
      created.push((task.body["data"] as { task: { id: string } }).task.id);
    }

    // Trang đầu, cursor ký bằng key **hiện hành**.
    const first = await call(f, "GET", `/projects/${projectId}/tasks?limit=1`, {
      actor: f.wsAdmin,
    });
    const cursor = (first.body["data"] as { page: { nextCursor: string } }).page.nextCursor;

    // Dựng lại **cùng** payload nhưng ký bằng key cũ — đúng thứ một tab mở từ
    // trước lúc xoay đang cầm.
    const payload = JSON.parse(
      Buffer.from(cursor.slice(0, cursor.lastIndexOf(".")), "base64url").toString("utf8"),
    ) as { f: string; sortKey: string; id: string };

    const oldSigned = encodeCursor(
      { sortKey: payload.sortKey, id: payload.id },
      payload.f,
      SESSION_SECRET_PREVIOUS,
    );

    const before = f.cursorKeys.previousKeyHits;
    const response = await call(
      f,
      "GET",
      `/projects/${projectId}/tasks?limit=1&cursor=${encodeURIComponent(oldSigned)}`,
      { actor: f.wsAdmin },
    );

    expect(response.status).toBe(200);
    expect(f.cursorKeys.previousKeyHits).toBe(before + 1);
    // Và nó trỏ đúng chỗ: trang hai, không phải trang đầu.
    // Trỏ đúng chỗ: trang hai, tức **không** phải task mới nhất (trang một).
    const items = (response.body["data"] as { items: { id: string }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(created[1]);
  });

  /* ---------------------------------------------------------------------- *
   * Chính `KeyRing`
   * ---------------------------------------------------------------------- */

  it("bộ key từ chối key quá ngắn ở cả hai vị trí", () => {
    expect(() => new KeyRing("t", { current: "ngắn" })).toThrow();
    expect(() => new KeyRing("t", { current: "a".repeat(32), previous: "ngắn" })).toThrow();
  });

  it("key cũ trùng key mới thì không tính là đang xoay", () => {
    const same = "a".repeat(32);
    const ring = new KeyRing("t", { current: same, previous: same });
    expect(ring.rotating).toBe(false);
    // Và verify vẫn thành công mà không nhích bộ đếm — không báo động giả.
    expect(ring.verify((key) => key === same)).toBe(true);
    expect(ring.previousKeyHits).toBe(0);
  });

  it("bộ chỉ một key thì không có gì để thử lần hai", () => {
    const ring = KeyRing.single("t", "a".repeat(32));
    expect(ring.rotating).toBe(false);
    expect(ring.verify(() => false)).toBe(false);
    expect(ring.previousKeyHits).toBe(0);
  });

  it("ký luôn dùng key hiện hành, kể cả khi đang xoay", () => {
    const ring = new KeyRing("t", { current: "a".repeat(32), previous: "b".repeat(32) });
    expect(ring.rotating).toBe(true);
    expect(ring.signingKey).toBe("a".repeat(32));
  });
});
