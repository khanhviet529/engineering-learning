import type { FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "../database/client.ts";
import { AppError, validationError } from "../errors/app-error.ts";
import {
  claim,
  completeInTransaction,
  fingerprintRequest,
  hashIdempotencyKey,
  type StoredOutcome,
} from "./idempotency.ts";

/**
 * Ranh giới HTTP của giao thức idempotency.
 *
 * `shared/http/idempotency.ts` sở hữu **giao thức** (claim → mutation →
 * outcome). File này sở hữu phần **HTTP**: đọc header, dựng fingerprint từ
 * request đã chuẩn hoá, dịch bốn nhánh của claim sang status/lỗi, và ghi outcome
 * lại đúng chỗ.
 *
 * Tách hai tầng vì chúng đổi vì lý do khác nhau: giao thức đổi khi ngữ nghĩa
 * idempotency đổi; tầng này đổi khi hình dạng HTTP đổi.
 *
 * Mỗi module vẫn sở hữu **ngữ nghĩa key của mình**: tên `useCase` và phần request
 * nào tham gia fingerprint là quyết định của module, không phải của shared. Đó
 * đúng là giới hạn mà `docs/engineering/shared-helper-policy.md` đặt cho nhóm
 * "Retry/idempotency".
 */

/** Đọc và validate header `Idempotency-Key`. */
export function requireIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers["idempotency-key"];
  const key = typeof raw === "string" ? raw.trim() : "";

  // Hợp đồng: endpoint yêu cầu key phải từ chối request thiếu key bằng
  // `400 VALIDATION_FAILED` **trước** use case — không phải chạy rồi mới báo.
  if (key.length === 0) {
    throw validationError([
      {
        field: "Idempotency-Key",
        code: "required",
        message: "Thao tác này cần header Idempotency-Key.",
      },
    ]);
  }

  // Chặn key vô lý về độ dài: nó đi vào hash nên không nguy hiểm, nhưng một
  // header nhiều megabyte là một cách làm phí công băm.
  if (key.length > 200) {
    throw validationError([
      {
        field: "Idempotency-Key",
        code: "too_long",
        message: "Idempotency-Key tối đa 200 ký tự.",
      },
    ]);
  }

  return key;
}

export interface IdempotentRunInput<T> {
  db: Database;
  actorId: string;
  /** Định danh route/use case do **module** gán; không bao giờ do client gửi. */
  useCase: string;
  key: string;
  /**
   * Phần request tham gia fingerprint: path params đã resolve cộng body đã
   * parse. Cùng key nhưng khác fingerprint là `409 IDEMPOTENCY_KEY_REUSED`.
   */
  request: unknown;
  /** HTTP status của nhánh thành công, để lưu cùng outcome. */
  successStatus: number;
  /**
   * Mutation. Nhận `recordOutcome` để ghi `completed` **trong cùng transaction**
   * với mutation — đó là điều làm cho không tồn tại trạng thái "đã mutate nhưng
   * chưa completed".
   */
  run: (recordOutcome: RecordOutcome) => Promise<T>;
}

/**
 * Hàm mà use case gọi bên trong transaction của nó để đánh dấu outcome.
 *
 * Truyền vào thay vì để runner tự gọi sau, vì runner **không** mở transaction —
 * use case mới biết ranh giới transaction của mình ở đâu.
 */
export type RecordOutcome = (
  tx: Parameters<typeof completeInTransaction>[0],
  body: unknown,
) => Promise<void>;

export interface IdempotentResult<T> {
  /** `undefined` khi đây là một replay: body lấy từ `replayed`. */
  value?: T;
  /** Outcome đã lưu, khi request này là một replay. */
  replayed?: StoredOutcome;
}

/**
 * Chạy một mutation dưới bảo vệ idempotency.
 *
 * Bốn nhánh của claim được dịch thẳng sang hợp đồng:
 *
 * - `claimed` → chạy mutation.
 * - `replay` → trả outcome đã lưu, **không** chạy mutation lần hai.
 * - `key_reused` → `409 IDEMPOTENCY_KEY_REUSED` (lỗi lập trình client).
 * - `in_progress` → `409 IDEMPOTENCY_IN_PROGRESS` kèm `Retry-After` ngắn.
 */
export async function runIdempotent<T>(input: IdempotentRunInput<T>): Promise<IdempotentResult<T>> {
  const keyHash = hashIdempotencyKey(input.key);
  const fingerprint = fingerprintRequest(input.request);

  const claimed = await claim(input.db, {
    userId: input.actorId,
    useCase: input.useCase,
    keyHash,
    fingerprint,
  });

  switch (claimed.kind) {
    case "key_reused":
      throw new AppError("IDEMPOTENCY_KEY_REUSED");

    case "in_progress":
      // Client chờ theo `Retry-After` rồi gửi lại **cùng** key, không xoay key.
      throw new AppError("IDEMPOTENCY_IN_PROGRESS", { retryAfterSeconds: 2 });

    case "replay":
      return { replayed: claimed.outcome };

    case "claimed": {
      const recordId = claimed.recordId;
      try {
        const value = await input.run(async (tx, body) => {
          await completeInTransaction(tx, recordId, { status: input.successStatus, body });
        });
        return { value };
      } catch (error) {
        // Business failure **xác định** được lưu lại để retry cùng key phát lại
        // đúng lỗi đó, thay vì chạy lại mutation và có thể cho kết quả khác.
        //
        // Lỗi hạ tầng thì **không** lưu: nó không phải một kết luận về ý định
        // của người dùng, và đóng băng nó lại sẽ chặn một retry lẽ ra thành
        // công. Record `in_progress` còn lại sẽ được takeover sau 60 giây.
        if (error instanceof AppError && isDeterministicFailure(error)) {
          await completeInTransaction(input.db, recordId, {
            status: error.status,
            body: {
              error: {
                code: error.code,
                message: error.message,
                ...(error.details === undefined ? {} : { details: error.details }),
              },
            },
          });
        }
        throw error;
      }
    }
  }
}

/**
 * Lỗi nào là kết luận, lỗi nào là sự cố tạm thời.
 *
 * `4xx` là kết luận về chính request đó: gửi lại y nguyên sẽ ra cùng kết quả,
 * nên lưu và phát lại là đúng. `5xx` và `429` thì không: chúng nói về trạng
 * thái hệ thống tại một thời điểm, và một retry sau đó hoàn toàn có thể thành
 * công.
 */
function isDeterministicFailure(error: AppError): boolean {
  if (error.code === "RATE_LIMITED") return false;
  if (error.code === "IDEMPOTENCY_IN_PROGRESS") return false;
  return error.status >= 400 && error.status < 500;
}

/**
 * Phát lại một outcome đã lưu.
 *
 * Hai điều dễ sai, và cả hai đều từng sai ở đây trước khi test bắt được:
 *
 * 1. **Status phải lấy từ outcome đã lưu**, không phải từ `@HttpCode` của
 *    route. Một business failure đã lưu `400` mà phát lại dưới `201` sẽ nói với
 *    client rằng thao tác thành công, kèm một body chứa `error`. Đó là hỏng
 *    theo cách tệ nhất: client tin vào status.
 * 2. **`requestId` là của chính request replay**, không phải của request gốc.
 *    Correlation ID dùng để tra log lần gọi **này**; phát lại ID cũ làm mọi
 *    replay trỏ về một dòng log duy nhất từ hôm trước.
 *
 * Body đã lưu tự phân biệt hai nhánh: outcome lỗi lưu envelope có khoá `error`,
 * outcome thành công lưu đúng phần `data`.
 */
export function applyReplay(
  reply: FastifyReply,
  requestId: string,
  outcome: StoredOutcome,
): unknown {
  void reply.status(outcome.status);

  // `204` không có body, kể cả khi phát lại.
  if (outcome.status === 204) return undefined;

  const body = outcome.body;
  if (body !== null && typeof body === "object" && "error" in body) {
    return { ...(body as Record<string, unknown>), requestId };
  }
  return { data: body, requestId };
}
