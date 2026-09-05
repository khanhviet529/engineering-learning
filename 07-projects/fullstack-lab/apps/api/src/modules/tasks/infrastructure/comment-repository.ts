import { and, asc, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../../shared/database/client.ts";
import { comments, users } from "../../../shared/database/schema.ts";

/**
 * Repository của comment.
 *
 * Nó có **insert và select, và không có gì khác**. Không update, không delete,
 * không soft-delete: MVP cố ý không có route sửa hay xoá comment (ADR-0009), và
 * một method `updateComment` nằm sẵn ở đây "cho tương lai" là một đường ghi mà
 * không hợp đồng nào công bố — thứ mà một use case sau sẽ dùng vì nó có sẵn.
 *
 * Comment sống trong module `tasks` chứ không có module riêng: nó không có vòng
 * đời độc lập với task, và ADR-0005 đặt `comments → tasks` ở cùng nhánh. Tách
 * ra một module chỉ để có một bảng riêng là thêm một biên giới không bảo vệ gì.
 */

type Executor = Database | Transaction;

/** `created_at` dưới dạng text ISO đủ microsecond — khoá cursor chính xác. */
const createdAtKey = () =>
  sql<string>`to_char(${comments.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface CommentRow {
  id: string;
  taskId: string;
  authorUserId: string;
  authorDisplayName: string;
  body: string;
  createdAt: Date;
  /**
   * `created_at` dạng text **đủ microsecond**, chỉ dùng làm khoá cursor.
   *
   * `timestamptz` có độ phân giải microsecond còn `Date` của JavaScript chỉ tới
   * millisecond. Dựng cursor từ `Date.toISOString()` nghĩa là hai comment gửi
   * cách nhau vài trăm microsecond có **cùng** khoá seek, và trang sau đọc lại
   * chính dòng cuối của trang trước.
   */
  createdAtKey: string;
}

/**
 * Vị trí seek của comment: `createdAt` rồi `id`, tăng dần.
 *
 * `createdAtKey` là **chuỗi**, không phải `Date`: một `Date` đi vào câu truy vấn
 * sẽ mang theo đúng độ phân giải millisecond của JavaScript, và so sánh với một
 * cột `timestamptz` microsecond thì hai comment trong cùng một millisecond
 * không phân biệt được. Giữ nguyên chuỗi rồi ép `::timestamptz` là cách so sánh
 * đúng thứ mà database đang lưu.
 */
export interface CommentSeek {
  createdAtKey: string;
  id: string;
}

export class CommentRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Comment của một task, thứ tự **cố định** `createdAt, id` tăng dần.
   *
   * Thứ tự không phải tuỳ chọn: hợp đồng nói "comment có order cố định
   * `createdAt, id` và immutable". Một cuộc trao đổi đọc ngược thời gian là một
   * cuộc trao đổi khác.
   */
  async findCommentsForTask(
    taskId: string,
    limit: number,
    after?: CommentSeek,
    tx?: Executor,
  ): Promise<CommentRow[]> {
    const seek =
      after === undefined
        ? undefined
        : sql`(${comments.createdAt} > ${after.createdAtKey}::timestamptz
               or (${comments.createdAt} = ${after.createdAtKey}::timestamptz
                   and ${comments.id} > ${after.id}))`;

    const scope = eq(comments.taskId, taskId);

    // Đọc dư **một** hàng để biết `hasMore` mà không cần một câu `COUNT` thứ hai.
    return (await (tx ?? this.#db)
      .select({
        id: comments.id,
        taskId: comments.taskId,
        authorUserId: comments.authorUserId,
        authorDisplayName: users.displayName,
        body: comments.body,
        createdAt: comments.createdAt,
        createdAtKey: createdAtKey(),
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorUserId))
      .where(seek === undefined ? scope : and(scope, seek))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(limit + 1)) as CommentRow[];
  }

  /**
   * Thêm một comment.
   *
   * `body` được ghi **đúng như nhận được**: không trim thêm (schema đã trim),
   * không normalize Unicode, không escape, không chuyển sang HTML. Mọi phép
   * biến đổi ở tầng lưu trữ đều là một bản sao thứ hai của thứ người dùng gõ,
   * và bản sao đó là cái duy nhất còn lại.
   */
  async insertComment(
    input: { taskId: string; authorUserId: string; body: string },
    tx: Transaction,
  ): Promise<CommentRow> {
    const [inserted] = await tx
      .insert(comments)
      .values(input)
      .returning({ id: comments.id, createdAt: comments.createdAt, createdAtKey: createdAtKey() });

    const row = inserted as { id: string; createdAt: Date; createdAtKey: string };

    const [author] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, input.authorUserId));

    return {
      id: row.id,
      taskId: input.taskId,
      authorUserId: input.authorUserId,
      authorDisplayName: (author as { displayName: string }).displayName,
      body: input.body,
      createdAt: row.createdAt,
      createdAtKey: row.createdAtKey,
    };
  }

  /** Số comment của một task — chỉ dùng cho chẩn đoán và test. */
  async countForTask(taskId: string, tx?: Executor): Promise<number> {
    const [row] = await (tx ?? this.#db)
      .select({ n: sql<number>`count(*)::int` })
      .from(comments)
      .where(eq(comments.taskId, taskId));
    return row?.n ?? 0;
  }
}
