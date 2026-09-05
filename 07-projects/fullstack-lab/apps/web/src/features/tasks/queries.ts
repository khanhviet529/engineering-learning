"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  PAGE_LIMIT_DEFAULT,
  type Activity,
  type Comment,
  type CreateTaskRequest,
  type MoveTaskRequest,
  type Task,
  type UpdateTaskRequest,
} from "@flowboard/contracts";
import type { ApiFailure, Intent } from "../../lib/transport.ts";
import { toFailure, unwrap } from "../../lib/query.tsx";
import {
  createComment,
  createTask,
  listTaskActivity,
  listTasks,
  moveTask,
  readTask,
  updateTask,
} from "../../lib/workspace-api.ts";
import { projectKeys } from "../projects/queries.ts";
import { applyLedger, applyLedgerToTask, rememberTask } from "./task-ledger.ts";
import { filterFingerprint, taskQueryParams, type BoardFilters } from "./task-filters.ts";

/**
 * Query key và mutation của feature Task.
 *
 * Hai quyết định định hình cả tệp này:
 *
 * 1. **Một cột = một query.** Key mang `columnId`, nên cursor của cột này
 *    không bao giờ chạm cột kia, và một cột hỏng không kéo theo cột khác. Đó
 *    cũng là lý do artifact vẽ Loading và Error **theo từng cột**.
 * 2. **Fingerprint của filter nằm trong key.** Đổi filter là đổi key, nên
 *    response của filter cũ về muộn không tìm thấy chỗ để ghi. Đây là cơ chế
 *    chống stale response, không phải một phép so timestamp ở callback.
 */

export const taskKeys = {
  all: ["tasks"] as const,
  column: (projectId: string, columnId: string, filters: BoardFilters) =>
    [...taskKeys.all, "column", projectId, columnId, filterFingerprint(filters)] as const,
  /** Mọi query task của một project, dùng để invalidate sau mutation. */
  project: (projectId: string) => [...taskKeys.all, "column", projectId] as const,
  detail: (taskId: string) => [...taskKeys.all, "detail", taskId] as const,
  activity: (taskId: string) => [...taskKeys.all, "activity", taskId] as const,
};

export interface ColumnTasks {
  tasks: Task[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  failure: ApiFailure | undefined;
  loadMore: () => void;
  retry: () => void;
}

/**
 * Task của **một** cột, phân trang bằng cursor của chính cột đó.
 *
 * `initialPageParam` là `null` chứ không phải chuỗi rỗng: cursor là giá trị
 * opaque của server, và "chưa có cursor" là một trạng thái khác với "cursor là
 * chuỗi rỗng" — cái sau sẽ được gửi lên và nhận `400`.
 */
export function useColumnTasks(
  projectId: string,
  columnId: string,
  filters: BoardFilters,
  enabled = true,
): ColumnTasks {
  const client = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: taskKeys.column(projectId, columnId, filters),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = taskQueryParams(filters, columnId, PAGE_LIMIT_DEFAULT, pageParam ?? undefined);
      const page = await unwrap(listTasks(projectId, params));
      // Áp sổ version **trước khi** dữ liệu vào cache: đây là chỗ duy nhất
      // thấy được cả bản vừa nhận lẫn bản server đã xác nhận.
      return { ...page, items: applyLedger(client, page.items) };
    },
    getNextPageParam: (last) => last.page.nextCursor,
    enabled,
  });

  return {
    tasks: (query.data?.pages ?? []).flatMap((page) => page.items),
    loading: query.isPending,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    failure: toFailure(query.error),
    loadMore: () => void query.fetchNextPage(),
    retry: () => void query.refetch(),
  };
}

export interface TaskDetail {
  task: Task;
  comments: Comment[];
  capabilities: string[];
}

export function useTaskDetail(taskId: string | undefined): {
  detail: TaskDetail | undefined;
  loading: boolean;
  failure: ApiFailure | undefined;
  refetch: () => void;
} {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: taskKeys.detail(taskId ?? "none"),
    queryFn: async () => {
      const data = await unwrap(readTask(taskId as string));
      return {
        task: applyLedgerToTask(client, data.task),
        comments: data.comments.items,
        capabilities: data.capabilities,
      } satisfies TaskDetail;
    },
    enabled: taskId !== undefined,
  });

  return {
    detail: query.data,
    loading: query.isPending,
    failure: toFailure(query.error),
    refetch: () => void query.refetch(),
  };
}

export function useTaskActivity(
  taskId: string | undefined,
  enabled: boolean,
): { activities: Activity[] | undefined; loading: boolean; failure: ApiFailure | undefined } {
  const query = useQuery({
    queryKey: taskKeys.activity(taskId ?? "none"),
    queryFn: () => unwrap(listTaskActivity(taskId as string)),
    enabled: taskId !== undefined && enabled,
  });

  return {
    activities: query.data?.items,
    loading: query.isPending,
    failure: toFailure(query.error),
  };
}

/** Sau mọi mutation task: ghi sổ bản server xác nhận rồi làm mới đúng phạm vi. */
function afterTaskMutation(client: QueryClient, projectId: string, task: Task): void {
  rememberTask(client, task);
  void client.invalidateQueries({ queryKey: taskKeys.project(projectId) });
  void client.invalidateQueries({ queryKey: taskKeys.detail(task.id) });
  void client.invalidateQueries({ queryKey: taskKeys.activity(task.id) });
  // `GET /projects/:projectId` mang `columns` và `members`; task không nằm
  // trong đó, nên nó **không** cần đọc lại. Invalidate nó ở đây sẽ nạp lại cả
  // board cho một thay đổi một task.
}

export function useCreateTask(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, intent }: { body: CreateTaskRequest; intent: Intent }) =>
      unwrap(createTask(projectId, body, intent)),
    onSuccess: (data) => afterTaskMutation(client, projectId, data.task),
  });
}

export function useUpdateTask(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      body,
      intent,
    }: {
      taskId: string;
      body: UpdateTaskRequest;
      intent: Intent;
    }) => unwrap(updateTask(taskId, body, intent)),
    onSuccess: (data) => afterTaskMutation(client, projectId, data.task),
  });
}

/**
 * Move task.
 *
 * Không có `onMutate` ghi vào cache ở đây, và đó là chủ ý: giao diện lạc quan
 * của `BRD-01` sống trong state của chính màn hình — một danh sách thứ tự tạm
 * — chứ không phải trong cache. Lý do là **rollback phải chính xác**: hoàn
 * nguyên một state cục bộ là gán lại một biến, còn hoàn nguyên nhiều trang
 * infinite query của hai cột là ghép lại thứ mà ta không sở hữu.
 */
export function useMoveTask(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      body,
      intent,
    }: {
      taskId: string;
      body: MoveTaskRequest;
      intent: Intent;
    }) => unwrap(moveTask(taskId, body, intent)),
    onSuccess: (data) => afterTaskMutation(client, projectId, data.task),
    onError: () => {
      // Thất bại thì thứ tự hiển thị phải là thứ tự **server đang giữ**. Đọc
      // lại là cách duy nhất biết chắc nó là gì sau một lệnh move nửa chừng.
      void client.invalidateQueries({ queryKey: taskKeys.project(projectId) });
    },
  });
}

export function useCreateComment(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, intent }: { body: string; intent: Intent }) =>
      unwrap(createComment(taskId, { body }, intent)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      void client.invalidateQueries({ queryKey: taskKeys.activity(taskId) });
    },
  });
}

/** Dùng khi capability của project có thể đã đổi cùng một mutation task. */
export function invalidateProjectDetail(client: QueryClient, projectId: string): void {
  void client.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
}
