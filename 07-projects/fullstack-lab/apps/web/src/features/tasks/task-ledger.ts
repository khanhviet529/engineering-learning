import type { QueryClient } from "@tanstack/react-query";
import type { Task } from "@flowboard/contracts";

/**
 * Sổ ghi **phiên bản đã được server xác nhận** của từng task.
 *
 * Vấn đề nó giải: một refetch có thể trả về trạng thái **cũ hơn** kết quả một
 * mutation vừa commit — response của list được đọc trước khi mutation commit
 * nhưng về tới client sau. Ghi đè bằng dữ liệu đó sẽ làm một thay đổi đã lưu
 * biến mất khỏi màn hình, và người dùng sẽ sửa lại lần nữa.
 *
 * Quy tắc từ [đặc tả tương tác §2](../../../../../docs/design/interaction-specifications.md):
 * *client không bao giờ thay một task trong cache bằng payload có `version`
 * thấp hơn version đã được server xác nhận cho task đó*. `version` là thước đo
 * mới/cũ duy nhất ở phía client — không phải thời điểm response về.
 *
 * Sổ sống trong chính `QueryClient` chứ không phải một biến module: một biến
 * module là state dùng chung giữa các phiên và giữa các test, và nó sẽ sống
 * sót qua cả lần đăng xuất.
 */

const LEDGER_KEY = ["tasks", "ledger"] as const;

type Ledger = Record<string, Task>;

function readLedger(client: QueryClient): Ledger {
  return client.getQueryData<Ledger>(LEDGER_KEY) ?? {};
}

/** Ghi nhận một task **server vừa xác nhận**. Gọi từ `onSuccess` của mutation. */
export function rememberTask(client: QueryClient, task: Task): void {
  const current = readLedger(client);
  const known = current[task.id];
  if (known !== undefined && known.version > task.version) return;
  client.setQueryData<Ledger>(LEDGER_KEY, { ...current, [task.id]: task });
}

/** Bản mới hơn giữa hai bản của cùng một task. Bằng version thì bản đến sau thắng. */
export function newerOf(incoming: Task, confirmed: Task | undefined): Task {
  if (confirmed === undefined) return incoming;
  return confirmed.version > incoming.version ? confirmed : incoming;
}

/**
 * Áp sổ lên một trang kết quả vừa nhận.
 *
 * Chạy ngay trong `queryFn`, trước khi dữ liệu vào cache: chỗ đó là nơi duy
 * nhất biết cả hai bản và biết trước khi giao diện đọc.
 */
export function applyLedger(client: QueryClient, tasks: readonly Task[]): Task[] {
  const ledger = readLedger(client);
  return tasks.map((task) => newerOf(task, ledger[task.id]));
}

/** Áp sổ cho một task đơn lẻ — dùng ở `TSK-02`. */
export function applyLedgerToTask(client: QueryClient, task: Task): Task {
  return newerOf(task, readLedger(client)[task.id]);
}
