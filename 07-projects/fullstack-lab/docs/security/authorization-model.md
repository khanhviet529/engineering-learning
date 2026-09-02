# Flowboard authorization model

This document is the central access-control contract for the frontend, NestJS guards, repositories, tests, and future AI tools. It is authoritative for MVP role behavior; the UI only reflects server-computed decisions.

## Scope, roles, and default

Flowboard is a workspace-tenant product. A user must be a member of a workspace before that user can be added to one of its projects. Every MVP project is private: no anonymous, workspace-wide, or public-project fallback exists.

Workspace roles are fixed:

| Workspace role | Allowed workspace behavior | Project-content effect |
|---|---|---|
| Workspace Admin | Read its workspace, manage workspace membership and settings, and create projects. | None by itself. The admin must also be a Project Member to read or change a private project. |
| Workspace Member | Read its workspace and be added to projects. | None by itself. |

Project roles are fixed and version-controlled in application code. The project creator is its Owner. A project must retain at least one Owner; owner removal or demotion that would remove the last Owner is rejected. Workspace Admin is never auto-added or auto-promoted in a project.

| Project role | Read project content | Write tasks/comments | Manage project | Export |
|---|:---:|:---:|:---:|:---:|
| Owner | Yes | Yes | Columns, members, and project settings | Yes, beginning in Phase 1.1 |
| Editor | Yes | Tasks and comments | No | No |
| Viewer | Yes | No | No | No |

Authorization is **deny by default**. An action is allowed only when the actor has a valid session, is in the required workspace and project scope, and has the exact fixed permission. A missing membership, an unresolved resource, an action not listed below, a cross-project resource, or an unsupported future feature is denied.

## Permission catalog

The following project permissions are the complete MVP catalog:

| Permission | Owner | Editor | Viewer | Meaning |
|---|:---:|:---:|:---:|---|
| `project:read` | Allow | Allow | Allow | Read the project and its permitted metadata. |
| `project:update` | Allow | Deny | Deny | Change project settings; MVP allows the project name only. |
| `project:member:manage` | Allow | Deny | Deny | Add, change role, or remove project members subject to membership invariants. |
| `board-column:read` | Allow | Allow | Allow | Read active project board columns. |
| `board-column:manage` | Allow | Deny | Deny | Create, reorder, or archive columns. |
| `task:read` | Allow | Allow | Allow | Read tasks in the project. |
| `task:create` | Allow | Allow | Deny | Create a task in an active same-project column. |
| `task:update` | Allow | Allow | Deny | Update allowlisted task content fields. |
| `task:move` | Allow | Allow | Deny | Move a task through the dedicated move use case. |
| `task:assign` | Allow | Allow | Deny | Assign a task to a member of the same project. |
| `comment:read` | Allow | Allow | Allow | Read comments for an authorized task. |
| `comment:create` | Allow | Allow | Deny | Append a comment. Comments are immutable in the MVP. |
| `activity:read` | Allow | Allow | Allow | Read append-only project/task activity. |
| `report:export` | Allow | Deny | Deny | Request/download a project-progress export in Phase 1.1. |
| `time-tracking:settings:update` | Allow | Deny | Deny | Enable/mode/backfill and Time Approver list in Phase 1.3. |
| `work-log:read` | Allow | Allow | Allow | Read authorized project/task WorkLogs when feature is enabled. |
| `work-log:create:self` | Allow | Allow | Deny | Create an entry authored by actor; does not update Task. |
| `work-log:update:self` | Allow | Allow | Deny | Edit actor draft/rejected entry only in allowed date window. |
| `work-log:submit:self` | Allow | Allow | Deny | Submit/self-close actor valid entry. |
| `work-log:review` | Allow | Assigned Editor | Deny | Review another actor's submitted WorkLog in required-approval mode. |
| `work-log:backfill:override` | Allow | Deny | Deny | Open bounded late-date access with reason. |
| `time-report:read` | Allow | Assigned Editor | Deny | Read Phase 1.3 monthly aggregate within project scope. |

Workspace administration is a separate scope: `workspace:read` is available to either workspace role; `workspace:member:manage`, `workspace:settings:update`, and `project:create` require Workspace Admin. Those workspace abilities do not imply any entry in the project catalog.

The role/visibility matrices in [screen inventory](../design/screen-inventory.md) and [information architecture](../design/information-architecture.md) are **derived** from this catalog, never independent sources. When any of them diverges from the catalog, the catalog wins and the derived matrix is the document to fix. A permission change is not complete until those derived matrices are re-checked; [testing strategy](../operations/testing-strategy.md) carries the test that enforces this.

### Time Tracking conditions (Phase 1.3)

`work-log:review` and Editor `time-report:read` are not role-wide permissions: `AuthorizationService` additionally requires a current `ProjectTimeApprover` record for that exact project. Owner is an implicit approver. A reviewer must differ from `work_log.logged_by_user_id`; direct request self-review is denied even when the actor is Owner. When Time Tracking is disabled, write/review/report use cases deny with `TIME_TRACKING_DISABLED` after scope resolution.

Viewer keeps the core read-only contract: Viewer may read WorkLog only when the project feature is enabled and the normal project/task read scope permits it, but cannot create, update, submit, review, override or receive a monthly-report CTA. A Workspace Admin without ProjectMember remains outside every Time Tracking route.

## Object-level authorization flow

Every endpoint accepting a project, task, comment, column, or report ID follows this sequence. An ID is a locator, never evidence of access.

```text
request
  -> SessionGuard
  -> ResourceProjectResolver
  -> ProjectPermissionGuard (@RequireProjectPermission)
  -> use case domain validation
  -> scoped repository query/mutation
```

1. **`SessionGuard`** authenticates the opaque server session and sets the actor. It returns `401` for no valid session.
2. **`ResourceProjectResolver`** resolves the route resource to its owning project. A project ID resolves directly; a task resolves through `task.project_id`; a comment through its task; a column through `column.project_id`; and a report through `report.project_id`. It never trusts a client-supplied `projectId` that conflicts with the resolved owner.
3. **`ProjectPermissionGuard`** receives the required permission declared by **`RequireProjectPermission`** and calls **`AuthorizationService.can(actor, action, resource)`**. It checks workspace membership, project membership, resource-to-project ownership, and the fixed role mapping. The guard returns `404` for a resource outside the actor's visible project scope, so it does not confirm another private project's existence; it returns `403` when a visible project member lacks the requested action.
4. The application use case still enforces domain rules: active destination column, same-project assignee, last-Owner protection, immutable comments/activity, optimistic concurrency, and allowlisted fields.
5. The repository uses the authorized project scope for every read and write. A successful guard alone is not permission to issue an unscoped query.

`AuthorizationService` is the single policy evaluator. Controllers and future AI tools supply an actor, a catalog action, and a resolved resource; they do not implement role `if` statements themselves. AI-generated resource identity or role claims are untrusted and are independently resolved and authorized through this same flow.

## Scoped repository contract

A repository query or mutation over project data takes an authorized `projectId`/project scope, not an arbitrary bare resource ID. At minimum it applies these predicates:

| Resource | Required project scope |
|---|---|
| Project | `projects.id = :projectId` after project membership authorization. |
| Board column | `board_columns.project_id = :projectId`. |
| Task | `tasks.project_id = :projectId`. |
| Comment | Join task and require `tasks.project_id = :projectId`. |
| Activity log / report export | `activity_logs.project_id = :projectId` / `report_exports.project_id = :projectId`. |

The scoped repository also applies the endpoint's fixed field/filter/sort allowlists. For example, task updates reject `projectId`, `columnId`, `position`, `version`, timestamps, and audit fields; moving a task is the separate `task:move` transaction. This defense in depth prevents an ID substitution, hidden-field payload, or accidental unscoped query from crossing a project boundary.

## Capabilities for the frontend

Project responses include the server-computed capabilities for the authenticated actor and that exact project, for example:

```json
{
  "project": { "id": "project-uuid", "name": "Launch" },
  "capabilities": ["project:read", "task:create", "task:update", "task:move", "task:assign", "comment:create"]
}
```

The frontend exposes one primitive, **`can(action, resource)`**, which reads those capabilities to hide or disable unavailable controls and to prevent optimistic UI from attempting known-denied actions. It does not duplicate role mappings in page components and it does not treat a capability response as authoritative after a server rejection. The API remains the final decision point; capability values are recomputed by the server on each relevant response.

A flat project-level list cannot express permissions that depend on the state of an individual record. `work-log:update:self` and `work-log:submit:self` depend on that WorkLog's status and date window; `work-log:review` depends on that WorkLog's author differing from the actor. For these, the server computes a **per-record `capabilities` list on the resource projection itself** — a WorkLog item carries, for example, `"capabilities": ["work-log:update:self", "work-log:submit:self"]` — evaluated from the same Time Tracking conditions above. Resolution order for `can(action, resource)`: when the resolved resource projection carries its own `capabilities`, that list decides the affordance for record-scoped actions; otherwise the current project-level list decides. The frontend never re-derives these from status, dates, or authorship — that would duplicate policy on the client, which this document forbids.

## Future implementation primitives

| Primitive | Responsibility |
|---|---|
| `SessionGuard` | Authenticate the hashed opaque session and establish the actor. |
| `ResourceProjectResolver` | Resolve a route resource to its owning project before authorization. |
| `RequireProjectPermission` | Controller decorator that declares a catalog action such as `task:update`. |
| `ProjectPermissionGuard` | Enforce the declared action against the actor and resolved project resource. |
| `AuthorizationService` | Provide the shared `can(actor, action, resource)` policy evaluation. |
| Scoped repository query | Apply the already-authorized project predicate to every project-data read or mutation. |
| `can(action, resource)` | Frontend capability helper; an affordance layer only, never the server authorization decision. Reads the resource projection's own `capabilities` when present (record-scoped actions), else the project-level list. |
