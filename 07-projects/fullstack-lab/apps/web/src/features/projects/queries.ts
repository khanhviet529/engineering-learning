import {
  PAGE_LIMIT_DEFAULT,
  type MemberCandidate,
  type ProjectDetail,
  type ProjectListItem,
  type ProjectRole,
} from "@flowboard/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiFailure, Intent } from "../../lib/transport.ts";
import { toFailure, unwrap } from "../../lib/query.tsx";
import {
  addProjectMember,
  changeProjectMemberRole,
  createProject,
  listMemberCandidates,
  listWorkspaceProjects,
  readProject,
  removeProjectMember,
  renameProject,
} from "../../lib/workspace-api.ts";

/**
 * Query key và mutation của feature Project.
 *
 * `projectKeys.detail(projectId)` là projection mà `GET /projects/:projectId`
 * trả về: project, capabilities, column active và member. Mọi mutation trong
 * phạm vi project invalidate đúng key đó — capability có thể **đổi theo chính
 * mutation vừa chạy** (ví dụ tự hạ vai trò của mình), nên đọc lại là bắt buộc
 * chứ không phải thận trọng thừa.
 */

export const projectKeys = {
  all: ["projects"] as const,
  inWorkspace: (workspaceId: string) => [...projectKeys.all, "workspace", workspaceId] as const,
  detail: (projectId: string) => [...projectKeys.all, "detail", projectId] as const,
  candidates: (projectId: string) => [...projectKeys.all, "candidates", projectId] as const,
};

export function useWorkspaceProjects(workspaceId: string): {
  projects: ProjectListItem[] | undefined;
  loading: boolean;
  failure: ApiFailure | undefined;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: projectKeys.inWorkspace(workspaceId),
    queryFn: () => unwrap(listWorkspaceProjects(workspaceId)),
  });

  return {
    projects: query.data?.items,
    loading: query.isPending,
    failure: toFailure(query.error),
    refetch: () => void query.refetch(),
  };
}

export function useProject(projectId: string): {
  detail: ProjectDetail | undefined;
  loading: boolean;
  failure: ApiFailure | undefined;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => unwrap(readProject(projectId)),
  });

  return {
    detail: query.data,
    loading: query.isPending,
    failure: toFailure(query.error),
    refetch: () => void query.refetch(),
  };
}

export function useCreateProject(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, intent }: { name: string; intent: Intent }) =>
      unwrap(createProject(workspaceId, name, intent)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.inWorkspace(workspaceId) });
    },
  });
}

export function useRenameProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, intent }: { name: string; intent: Intent }) =>
      unwrap(renameProject(projectId, name, intent)),
    onSuccess: () => {
      // Không cập nhật lạc quan tên project: đặc tả tương tác cấm — header,
      // breadcrumb và danh sách chỉ đổi theo tên **server xác nhận**.
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export interface MemberCandidates {
  candidates: MemberCandidate[] | undefined;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  failure: ApiFailure | undefined;
  loadMore: () => void;
  retry: () => void;
}

/**
 * Ứng viên có thể thêm vào project, phân trang bằng cursor.
 *
 * Danh sách này là roster của cả workspace trừ project member hiện tại, nên nó
 * **dài được**: một trang không phải là hết. `useInfiniteQuery` chứ không phải
 * `useQuery` vì lý do đó, và `initialPageParam` là `null` chứ không phải chuỗi
 * rỗng — "chưa có cursor" khác "cursor là chuỗi rỗng", và cái sau sẽ được gửi
 * lên rồi nhận `400`.
 *
 * `enabled` để hộp thoại chỉ hỏi khi nó thực sự mở: một danh sách roster nạp
 * sẵn cho một hộp thoại chưa ai bấm là một lần lộ dữ liệu không cần thiết.
 */
export function useMemberCandidates(projectId: string, enabled = true): MemberCandidates {
  const query = useInfiniteQuery({
    queryKey: projectKeys.candidates(projectId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      unwrap(
        listMemberCandidates(projectId, {
          limit: PAGE_LIMIT_DEFAULT,
          ...(pageParam === null ? {} : { cursor: pageParam }),
        }),
      ),
    getNextPageParam: (last) => last.page.nextCursor,
    enabled,
  });

  return {
    // `undefined` khi chưa có trang nào: `AsyncSection` phân biệt "chưa biết"
    // với "biết rồi và rỗng", và hai thứ đó nói hai câu khác nhau.
    candidates: query.data === undefined ? undefined : query.data.pages.flatMap((p) => p.items),
    loading: query.isPending,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    failure: toFailure(query.error),
    loadMore: () => void query.fetchNextPage(),
    retry: () => void query.refetch(),
  };
}

export function useAddProjectMember(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role, intent }: { userId: string; role: ProjectRole; intent: Intent }) =>
      unwrap(addProjectMember(projectId, { userId, role }, intent)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      // Người vừa được thêm không còn là ứng viên. Bỏ qua bước này thì lần mở
      // hộp thoại kế tiếp vẫn mời chọn họ, và lần chọn đó chắc chắn bị từ chối.
      void queryClient.invalidateQueries({ queryKey: projectKeys.candidates(projectId) });
    },
  });
}

export function useChangeProjectMemberRole(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role, intent }: { userId: string; role: ProjectRole; intent: Intent }) =>
      unwrap(changeProjectMemberRole(projectId, userId, role, intent)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

export function useRemoveProjectMember(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, intent }: { userId: string; intent: Intent }) =>
      unwrap(removeProjectMember(projectId, userId, intent)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      // Gỡ khỏi project đưa người đó **trở lại** danh sách ứng viên. Chiều này
      // dễ quên hơn chiều thêm, và quên nó nghĩa là không thêm lại được ai vừa
      // gỡ nhầm cho tới khi tải lại cả trang.
      void queryClient.invalidateQueries({ queryKey: projectKeys.candidates(projectId) });
    },
  });
}
