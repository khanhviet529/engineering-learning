import type { Workspace, WorkspaceMemberListItem } from "@flowboard/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Intent } from "../../lib/transport.ts";
import { unwrap, toFailure } from "../../lib/query.tsx";
import {
  inviteWorkspaceMember,
  createWorkspace,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember,
} from "../../lib/workspace-api.ts";
import type { ApiFailure } from "../../lib/transport.ts";

/**
 * Query key và mutation của feature Workspace.
 *
 * Key biểu đạt **resource và input canonical**, đúng quy ước frontend: một key
 * cho danh sách workspace, một key theo `workspaceId` cho danh sách member.
 * Sau mutation, feature invalidate đúng projection bị ảnh hưởng thay vì xoá
 * sạch cache — xoá sạch là cách che giấu việc chưa rõ ai sở hữu cái gì.
 */

export const workspaceKeys = {
  all: ["workspaces"] as const,
  list: () => [...workspaceKeys.all, "list"] as const,
  members: (workspaceId: string) => [...workspaceKeys.all, workspaceId, "members"] as const,
  /**
   * Lời mời đang chờ là một danh sách **khác** danh sách thành viên, vì một lời
   * mời `pending` chưa cấp quyền gì. Trộn hai danh sách vào một query key sẽ dạy
   * người dùng rằng gửi lời mời là thêm được người.
   */
  invitations: (workspaceId: string) => [...workspaceKeys.all, workspaceId, "invitations"] as const,
};

export function useWorkspaces(): {
  workspaces: Workspace[] | undefined;
  loading: boolean;
  failure: ApiFailure | undefined;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: () => unwrap(listWorkspaces()),
  });

  return {
    workspaces: query.data?.items,
    loading: query.isPending,
    failure: toFailure(query.error),
    refetch: () => void query.refetch(),
  };
}

/**
 * `enabled` là bắt buộc chứ không phải tối ưu hoá.
 *
 * Danh sách thành viên chỉ được hỏi **sau khi** biết actor có
 * `workspace:member:manage`. Hỏi trước là gửi một request mà ta đã biết chắc
 * bị từ chối, và trong lúc chờ nó thì UI đã kịp dựng khung của một bề mặt
 * Owner-only cho người không được vào.
 */
export function useWorkspaceMembers(
  workspaceId: string,
  enabled: boolean,
): {
  members: WorkspaceMemberListItem[] | undefined;
  loading: boolean;
  failure: ApiFailure | undefined;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => unwrap(listWorkspaceMembers(workspaceId)),
    enabled,
  });

  return {
    members: query.data?.items,
    // `isPending` vẫn là `true` khi query bị tắt, nên phải nói rõ: chưa bật
    // thì đang chờ điều kiện, và đó cũng là một trạng thái đang tải.
    loading: query.isPending,
    failure: toFailure(query.error),
    refetch: () => void query.refetch(),
  };
}

/**
 * Tạo workspace.
 *
 * `Intent` sống trong một `ref` ở component gọi, không tạo mới ở đây: key gắn
 * với **một ý định của người dùng**, và tạo mới ở mỗi lần gửi sẽ biến mọi lần
 * retry vì lỗi mạng thành một workspace thứ hai.
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, intent }: { name: string; intent: Intent }) =>
      unwrap(createWorkspace(name, intent)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
    },
  });
}

export function useAddWorkspaceMember(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      email,
      role,
      intent,
    }: {
      email: string;
      role: "workspace_admin" | "workspace_member";
      intent: Intent;
    }) => unwrap(inviteWorkspaceMember(workspaceId, { email, role }, intent)),
    onSuccess: () => {
      // Mời **không** tạo membership ngay, nên danh sách thành viên không đổi.
      // Cái đổi là danh sách lời mời đang chờ — và route đó backend chưa dựng,
      // nên chưa có query key nào để làm mới. Đừng invalidate danh sách thành
      // viên: làm vậy dạy người dùng rằng gửi lời mời là thêm được người.
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.invitations(workspaceId) });
    },
  });
}

export function useRemoveWorkspaceMember(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, intent }: { userId: string; intent: Intent }) =>
      unwrap(removeWorkspaceMember(workspaceId, userId, intent)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
    },
  });
}
