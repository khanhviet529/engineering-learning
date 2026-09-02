# Flowboard authorization test matrix

This matrix is mandatory for unit, integration, and end-to-end coverage. It validates the fixed catalog in [authorization-model.md](authorization-model.md), including direct HTTP attempts that bypass the frontend.

## Test fixture and outcome rules

The target is private **Project B** in one workspace.

- **Owner**, **Editor**, and **Viewer** are Project B members with the named project role and are ordinary Workspace Members.
- **Workspace Admin without project membership** is an admin in the same workspace but has no `project_members` row for Project B.
- **User A** is a Workspace Member and Owner of a different private Project A in the same workspace. User A has no Project B membership and uses IDs belonging to User B/Project B.
- **User B** is a Workspace Member and Owner of Project B. User B supplies the target resources for substitution tests.

`Allow` means the request succeeds only after its normal validation and concurrency/domain checks. `Deny` means no business mutation, no activity record, no response body with the protected resource, and no capability for that action. An unauthenticated request receives `401`; a request to a resource outside the actor's visible project scope receives `404`; a Project B member lacking an action receives `403`.

## Full action matrix

### Workspace actions

| Actor | `workspace:read` | `workspace:member:manage` | `workspace:settings:update` | `project:create` |
|---|:---:|:---:|:---:|:---:|
| Owner | Allow | Deny | Deny | Deny |
| Editor | Allow | Deny | Deny | Deny |
| Viewer | Allow | Deny | Deny | Deny |
| Workspace Admin without project membership | Allow | Allow | Allow | Allow |
| User A | Allow | Deny | Deny | Deny |
| User B | Allow | Deny | Deny | Deny |

### Project B read, write, management, and export actions

| Actor | `project:read` | `project:update` | `project:member:manage` | `board-column:read` | `board-column:manage` | `task:read` | `task:create` | `task:update` | `task:move` | `task:assign` | `comment:read` | `comment:create` | `activity:read` | `report:export` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Owner | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow |
| Editor | Allow | Deny | Deny | Allow | Deny | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Deny |
| Viewer | Allow | Deny | Deny | Allow | Deny | Allow | Deny | Deny | Deny | Deny | Allow | Deny | Allow | Deny |
| Workspace Admin without project membership | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny |
| User A | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny | Deny |
| User B | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow | Allow |

`report:export` is exercised when Phase 1.1 export routes exist; its Owner-only result is nevertheless fixed now. Comment edit/delete and activity edit/delete have no MVP action and therefore deny for every actor. Project settings changes in the MVP are limited to the project name.

## Required authorization tests

| Test | Setup and request | Expected result |
|---|---|---|
| Role-policy unit tests | Evaluate `AuthorizationService.can` for every cell in both matrices. | Exact Allow/Deny result for each actor/action pair; no implicit admin-to-project grant. |
| Decorator/guard integration | Route declares `@RequireProjectPermission('task:update')`; exercise Owner, Editor, Viewer, admin without membership, User A, and User B. | `ProjectPermissionGuard` makes the matrix decision before the use case. |
| ID substitution: task | User A sends `GET /tasks/:userBTaskId`, `PATCH /tasks/:userBTaskId`, and `POST /tasks/:userBTaskId/comments`. | `404`; no task/comment/activity body, mutation, or existence signal. |
| ID substitution: column and report | User A uses a Project B column in `PATCH /columns/:id` or a Project B report ID in `GET /reports/:id` / download. | `404`; the resolver scopes the resource to Project B before the repository call. |
| Mismatched parent/child IDs | Actor submits a Project A route ID with a Project B task, comment, column, or report ID. | Deny (`404` for out-of-scope resource); the client parent ID never overrides resolved ownership. |
| Direct HTTP mutation by Viewer | Viewer directly calls project update/member management, column management, task create/update/move/assign, comment create, and export routes. | `403`; the frontend being hidden/disabled is irrelevant; no side effect or activity row exists. |
| Direct HTTP mutation by non-member admin | Workspace Admin without Project B membership calls every Project B route, including reads. | `404`; workspace administration does not disclose or grant Project B content. |
| Query-scope enforcement | Invoke each project repository with an authorized Project B scope while supplying User A/Project A IDs, and inspect generated SQL/query conditions. | No row is read or written unless the resource also matches the authorized `project_id`; comments join through scoped tasks. |
| Hidden-field update | Owner or Editor sends `projectId`, `columnId`, `position`, `version`, timestamps, audit fields, or other non-allowlisted keys to `PATCH /tasks/:id`. | `400` validation error; no mutation. `columnId`/`position` require the dedicated authorized move endpoint, and `version` is server controlled (only `expectedVersion` is a precondition). |
| Cross-project assignment/move | Owner or Editor attempts to assign a non-member or move a task into a column from Project A. | Reject before commit; no cross-project update and no activity row. |
| Capability response | Fetch Project B as each actor and inspect `capabilities`. | Only server-computed allowed Project B actions appear; admin without membership and User A receive no Project B data/capabilities. |
| Response field exposure | Test success, `403`, and `404` schemas for project/task/comment/activity/report routes. | Authorized responses contain only endpoint allowlisted fields and current-project capabilities. They never expose password hashes, raw or hashed session IDs, reset/verification tokens or hashes, CSRF secrets, private data/counts from another project, internal audit payloads, or denied-resource existence. Denied responses contain only the standard error envelope. |

## Authentication/security regressions coupled to authorization

| Test | Expected result |
|---|---|
| Opaque-session storage | Sign-in sets an HttpOnly opaque cookie; the database contains only a hash, and a raw cookie value cannot be found in storage/log fixtures. |
| Session lifecycle | Expired, revoked, logged-out, reset-password, and changed-password sessions are rejected by `SessionGuard`; reset/change revokes all prior sessions. |
| Cookie contract | Production cookie has `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, host-only scope, and explicit expiry. |
| CSRF | A protected mutation without a valid session-bound `X-CSRF-Token` or allowed origin is rejected and makes no mutation/activity record. |
| Token lifecycle | Reset and verification tokens are hashed, one-time, expiring, and fail when replayed. |
| Rate limiting | Repeated sign-in and password-reset attempts are bounded without leaking account existence. |

The test suite must run direct API coverage as well as role-based UI checks. UI tests prove the frontend uses `can(action, resource)` for affordances; they never substitute for `SessionGuard`, `ResourceProjectResolver`, `ProjectPermissionGuard`, `AuthorizationService`, `RequireProjectPermission`, or the scoped repository query.
