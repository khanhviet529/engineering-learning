import type { CreateColumnRequest, UpdateColumnRequest } from "@flowboard/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Intent } from "../../lib/transport.ts";
import { unwrap } from "../../lib/query.tsx";
import { createColumn, reorderColumns, updateColumn } from "../../lib/workspace-api.ts";
import { projectKeys } from "../projects/queries.ts";

/**
 * Mutation cấp board column.
 *
 * Cả ba đều làm mới đúng một projection: `GET /projects/:projectId`, nơi
 * `columns` sống. Không mutation nào ở đây cập nhật lạc quan — [đặc tả tương
 * tác](../../../../../docs/design/interaction-specifications.md) nói thẳng
 * rằng archive cột và thay đổi quyền không dùng optimistic UI, vì với chúng
 * "dữ liệu xác nhận quan trọng hơn cảm giác tức thời".
 *
 * `useReorderColumns` là ngoại lệ **một nửa**: người dùng sắp xếp trên một bản
 * nháp cục bộ trước khi bấm lưu, nên có state đi trước server. Nhưng bản nháp
 * đó không phải optimistic UI — nó chưa được gửi đi, và khi gửi thất bại thì
 * `BRD-02` trả nó về đúng thứ tự server đang giữ.
 */

export function useCreateColumn(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, intent }: { body: CreateColumnRequest; intent: Intent }) =>
      unwrap(createColumn(projectId, body, intent)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

/**
 * Một lần gọi = **một** command.
 *
 * `command` mang kiểu union của hợp đồng, nên không có chỗ nào trong ứng dụng
 * biểu đạt được `{ name, isTerminal }`. Đây là điểm chặn ở tầng kiểu; test
 * `board.test.tsx` chặn lần nữa ở tầng request thật gửi đi.
 */
export function useUpdateColumn(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      columnId,
      command,
      intent,
    }: {
      columnId: string;
      command: UpdateColumnRequest;
      intent: Intent;
    }) => unwrap(updateColumn(columnId, command, intent)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

export function useReorderColumns(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderedColumnIds, intent }: { orderedColumnIds: string[]; intent: Intent }) =>
      unwrap(reorderColumns({ projectId, orderedColumnIds }, intent)),
    onSettled: () => {
      // `onSettled`, không phải `onSuccess`: sau một lần gửi thất bại, thứ tự
      // hiển thị phải là thứ tự **server đang giữ**, chứ không phải bản nháp
      // vừa bị từ chối. Đọc lại là cách duy nhất biết chắc thứ tự đó.
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}
