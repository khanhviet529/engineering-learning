import type { ProjectDetail, ProjectListItem, ProjectRole } from "@flowboard/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiFailure, Intent } from "../../lib/transport.ts";
import { toFailure, unwrap } from "../../lib/query.tsx";
import {
  addProjectMember,
  changeProjectMemberRole,
  createProject,
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

export function useAddProjectMember(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role, intent }: { userId: string; role: ProjectRole; intent: Intent }) =>
      unwrap(addProjectMember(projectId, { userId, role }, intent)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
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
    },
  });
}
