# Domain Model

## Entities

```text
User ──< WorkspaceMember >── Workspace ──< Project ──< Task ──< Comment
                                      │          │
                                      └──────────┴── ActivityLog
```

- `User`: identity của người dùng.
- `Workspace`: boundary cao nhất của dữ liệu và membership.
- `WorkspaceMember`: quan hệ user–workspace và role.
- `Project`: nhóm công việc thuộc một workspace.
- `Task`: đơn vị công việc thuộc project.
- `Comment`: trao đổi gắn với task.
- `ActivityLog`: audit record append-only cho thay đổi nghiệp vụ.

## Important invariants

- Một user không thể có hai membership trong cùng workspace.
- Project phải thuộc đúng một workspace.
- Assignee của task phải là member của workspace chứa project.
- Comment phải thuộc task tồn tại và user phải có quyền trên project.
- Activity log chỉ được tạo trong cùng transaction với mutation mà nó mô tả.
- Archive project không xóa task và activity history.

## Roles

| Role | Workspace | Project | Task |
|---|---|---|---|
| Admin | manage members/settings | manage | full access |
| Owner | view | manage | full access |
| Member | view | view | update permitted task/comment |

Permission được quyết định ở API layer, không tin vào role hoặc project id do client gửi lên.
