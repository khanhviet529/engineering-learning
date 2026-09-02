# Flowboard Product & Architecture Design

**Status:** Markdown baseline v0.1 — Ready for Pencil. This acceptance confirms the Markdown contracts are ready for UI/UX work in Pencil; it does not claim that UI design or application implementation is complete.

## 1. Purpose

Flowboard is a private, project-based work-management workspace for small teams. It helps a team plan work, execute it on a configurable board, collaborate in context, and preserve an auditable history of important changes.

This document is the approved design baseline for the product and its implementation. Pencil is the source of truth for visual design. Markdown documents are the source of truth for product rules, system behavior, technical decisions, and operating procedures.

## 2. Problem and target users

Teams commonly distribute work across chat messages, ad-hoc spreadsheets, and personal notes. As a result, no one can reliably answer what needs doing, who owns it, what changed, or why a task is blocked.

Flowboard targets product and engineering teams of 2–15 people that need a focused project workspace rather than an enterprise portfolio-management suite.

| User | Primary outcome |
|---|---|
| Project Owner | Creates a project, configures its board, grants access, and keeps work moving. |
| Editor | Uses the board daily to create, update, move, assign, and discuss work. |
| Viewer | Follows work and history without changing project data. |

The primary journey begins with a Project Owner creating a workspace and project. The daily journey belongs to Editors working on tasks. Workspace administration is intentionally a lower-frequency flow.

## 3. Product scope

### 3.1 Core MVP

The MVP delivers one complete work-management loop:

~~~
Sign in
→ open a workspace
→ create or open an authorized project
→ configure board columns
→ add project members
→ create and assign tasks
→ move tasks through the board
→ comment and inspect activity history
~~~

MVP features:

- email/password sign-up, sign-in, sign-out, password reset, and email verification;
- workspaces and workspace membership;
- private projects within a workspace;
- project-specific roles: Owner, Editor, and Viewer;
- configurable board columns per project;
- tasks with title, description, column, assignee, priority, optional due date, and concurrency version;
- task comments;
- append-only activity history;
- pagination, filtering, sorting, and allowed-field search for list endpoints;
- loading, empty, network-error, conflict, and permission-denied UI states.

### 3.2 Explicit non-goals

The MVP does not include AI, realtime collaboration, custom roles, labels, checklists, task dependencies, recurring tasks, templates, calendar/daily-planning views, attachments, public API, billing, mobile applications, microservices, multi-region deployment, or automatic email report delivery.

### 3.3 Planned phases after core

| Phase | Product increment | Main engineering behavior |
|---|---|---|
| 1.1 | Owner downloads a project-progress XLSX report | report query, file generation, audit |
| 1.2 | Scheduled or requested report delivery | Redis, BullMQ worker, retry, idempotency, email |
| AI-1 | Owner generates a proposed plan from a goal | structured output, validation, human approval |
| AI-2 | Project progress/risk summary | context building, cost and latency telemetry |
| AI-3 | Project copilot and semantic search | embeddings, project-scoped RAG, citations, evaluation |
| AI-4 | Controlled AI actions | narrow tools, authorization, confirmation, audit |

## 4. Information architecture and UX rules

~~~
Authentication
└── Workspace
    ├── Project list
    ├── Project board
    │   ├── Column management
    │   ├── Task creation
    │   └── Task detail drawer
    │       ├── Edit task
    │       ├── Comments
    │       └── Activity history
    ├── Project member management
    └── Workspace settings
~~~

The board is the product's primary screen. Opening a task uses a drawer or modal so the user can inspect and edit details without losing board context.

Pencil must design sign-in/sign-up/reset/verification, workspace and project lists, configurable board, column and task forms, task detail/comments/activity, project members, empty/loading/error/forbidden/conflict states, and desktop/tablet/mobile behavior before frontend implementation.

The UI must not expose actions that the current user cannot perform. This is an affordance for clarity only; it is never the authorization decision.

## 5. Authorization model

### 5.1 Scope and privacy

A user must be a workspace member before they can become a project member. Projects are private by default.

A workspace has two fixed membership roles: Workspace Admin and Workspace Member. A Workspace Admin can manage workspace-level membership and settings and create projects, but does **not** automatically read project content. To read or change a private project, the admin must be explicitly added to that project's membership list. The creator of a project becomes its Project Owner. A Workspace Member can be added to projects but cannot manage the workspace or create projects.

### 5.2 Project roles

| Capability | Owner | Editor | Viewer |
|---|:---:|:---:|:---:|
| Read project, board, task, comment, activity | Yes | Yes | Yes |
| Create, edit, move, and assign tasks | Yes | Yes | No |
| Create comments | Yes | Yes | No |
| Manage columns | Yes | No | No |
| Manage project members | Yes | No | No |
| Change project settings | Yes | No | No |
| Export progress report | Yes | No | No |

Comments are immutable in the MVP. This preserves a simple audit trail and avoids an edit/delete policy before it has a product need.

### 5.3 Permission catalog

~~~
project:read              project:update          project:member:manage
board-column:read         board-column:manage
task:read                 task:create             task:update
task:move                 task:assign
comment:read              comment:create
activity:read             report:export
~~~

Role-to-permission mapping is fixed in version-controlled application code. Custom roles are deferred because they require a separate permission-management product, migration policy, audit model, and administration UI.

### 5.4 Enforcement architecture

~~~
Browser capability check       → hides or disables an affordance
NestJS authorization service   → makes the authoritative allow/deny decision
Database query scope           → limits records to projects the actor can access
~~~

Every request that accepts a project, task, comment, column, or report ID performs object-level authorization. No route depends on an ID received from the client without validating that the acting user can perform the requested action on that resource.

~~~
SessionGuard
→ Resource/project resolver
→ ProjectPermissionGuard
→ application use case
→ scoped repository query
~~~

Controllers declare a required action, for example task:create or board-column:manage. A shared AuthorizationService evaluates can(actor, action, resource). The task, project, or column use case still validates its own domain rules.

The API returns server-computed capabilities with project data. The frontend uses a single can(action, resource) hook and does not duplicate role rules in page components.

## 6. Domain and data model

~~~
User
 ├── AuthSession
 └── WorkspaceMember ── Workspace
                              └── Project
                                   ├── ProjectMember
                                   ├── BoardColumn ── Task ── Comment
                                   ├── ActivityLog
                                   └── ReportExport
~~~

### 6.1 Main tables

| Table | Responsibility |
|---|---|
| users | Identity, email, display name, password hash, verification metadata. |
| auth_sessions | Hashed opaque session identifier, expiry, revocation metadata. |
| workspaces | Highest-level tenant boundary. |
| workspace_members | User membership in a workspace, including the fixed workspace role. |
| projects | Private work container within one workspace. |
| project_members | User access and role for one project. |
| board_columns | Project-specific board column, ordering, archive state. |
| tasks | Work item, current column/order, assignee, priority, optional due date, version. |
| comments | Immutable task discussion record. |
| activity_logs | Append-only history of important business mutations. |
| report_exports | Export request, filter snapshot, status, file metadata, and expiry; introduced in Phase 1.1. |

### 6.2 Important invariants

- A user cannot have duplicate workspace or project membership.
- A project belongs to exactly one workspace.
- A project member must first belong to that project's workspace.
- A task belongs to exactly one project and exactly one active board column in that project.
- An assignee must be a project member of the task's project.
- A column cannot be archived while it still contains tasks; tasks must move first.
- Column and task ordering is deterministic through position.
- An activity log is created in the same transaction as the mutation it describes.
- Passwords, session tokens, reset tokens, and verification tokens are stored as hashes, never plaintext.

### 6.3 Task fields and time

~~~
id, project_id, column_id, assignee_id
title, description, priority
position, version
due_date: optional SQL DATE
created_at, updated_at: UTC timestamps
~~~

due_date represents a date in the workspace timezone. There is no time-of-day deadline, calendar, recurrence, or notification behavior in the MVP.

### 6.4 Index baseline

Indexes are verified with real query plans as data grows. The initial design includes:

~~~
workspace_members(workspace_id, user_id) UNIQUE
project_members(project_id, user_id) UNIQUE
projects(workspace_id, created_at DESC)
board_columns(project_id, position)
tasks(project_id, column_id, position)
tasks(project_id, due_date)
tasks(project_id, assignee_id, updated_at DESC)
comments(task_id, created_at)
activity_logs(project_id, created_at DESC)
report_exports(project_id, created_at DESC)
~~~

## 7. API design

### 7.1 Principles

- Public routes represent explicit product use cases, not database tables.
- A controller accepts a narrow request schema and returns a narrow response schema.
- The client never chooses database table names, columns, raw query expressions, or unrestricted fields.
- All errors share code, message, requestId, and optional validated details.
- Request IDs are propagated through web, API, worker, and logs.
- Mutations that can be safely retried use an idempotency key.

An account with valid credentials but an unverified email receives `403 EMAIL_VERIFICATION_REQUIRED` in the standard error envelope (`error.code`, safe `error.message`, and `requestId`; no `details`). Sign-in creates no session or cookie for this outcome and returns no private data. The frontend clears the password and takes the user to email verification, where it can offer the separately rate-limited resend flow without placing the email in a URL.

### 7.2 Endpoint groups

~~~
POST /auth/sign-up
POST /auth/sign-in
POST /auth/sign-out
POST /auth/password/forgot
POST /auth/password/reset
POST /auth/email/verify
POST /auth/email/verification/resend

GET  /workspaces
POST /workspaces
GET  /workspaces/:workspaceId/members
POST /workspaces/:workspaceId/members
DELETE /workspaces/:workspaceId/members/:userId

POST   /workspaces/:workspaceId/projects
GET    /projects/:projectId
PATCH  /projects/:projectId
POST   /projects/:projectId/members
PATCH  /projects/:projectId/members/:userId
DELETE /projects/:projectId/members/:userId

POST  /projects/:projectId/columns
PATCH /columns/:columnId
POST  /columns/reorder

GET   /projects/:projectId/tasks
POST  /projects/:projectId/tasks
GET   /tasks/:taskId
PATCH /tasks/:taskId
POST  /tasks/:taskId/move
POST  /tasks/:taskId/comments
GET   /tasks/:taskId/activity

POST /projects/:projectId/reports/progress-export
GET  /reports/:reportId
GET  /reports/:reportId/download
~~~

### 7.3 Controlled generic core

Reusable primitives exist in shared, while product behavior remains explicit in its module:

~~~
Shared: pagination parser, cursor codec, allowlisted sort/filter parser,
        error mapper, response envelope, transaction helper, idempotency helper.

Module: create schema, update schema, list-query schema, response schema,
        allowed filters/sort/search fields, permission requirement, use case.
~~~

There is no generic table-based endpoint. A generic table API bypasses business rules such as activity logging, project scope, assignment validation, task ordering, and concurrency handling.

### 7.4 Field policy example: task

| Contract | Allowed fields |
|---|---|
| Create task | title, description, columnId, assigneeId, priority, dueDate |
| Update task | Editable task fields only; never projectId, version, timestamps, or audit fields |
| List task filter | columnId, assigneeId, priority, dueDate range |
| List task sort | position, createdAt, updatedAt, dueDate |
| Search | title and description only |

## 8. Pagination, ordering, and concurrency

### 8.1 Pagination

All list endpoints are bounded. The default page size is 25 and the maximum is 100.

~~~
GET /projects/:projectId/tasks
  ?cursor=<opaque>
  &limit=25
  &assigneeId=<id>
  &dueFrom=YYYY-MM-DD
  &dueTo=YYYY-MM-DD
  &columnId=<id>
  &sort=dueDate:asc
~~~

~~~
{
  items: [],
  page: { nextCursor: opaque-value-or-null, hasMore: true }
}
~~~

The project board loads a bounded number of tasks per column and loads additional tasks per column on demand. It never fetches every task in a large project at once.

### 8.2 Concurrent update

Tasks use optimistic concurrency:

~~~
client reads version 7
→ client sends expectedVersion 7 with an update
→ first successful update increments version to 8
→ a stale update receives 409 Conflict with the current version
~~~

The frontend tells the user that the task changed elsewhere and provides a reload/review path. It must not silently overwrite newer state.

### 8.3 Concurrent move

The task move endpoint is a dedicated transaction. It receives a destination column and target position, checks permission and project scope, applies row locks where needed, updates ordering, increments task version, and appends one activity record.

Task and column positions use gap/fractional ordering so ordinary drag-and-drop does not rewrite every row in a column. A controlled rebalance runs when positions become too dense.

## 9. Technical baseline

### 9.1 Repository

~~~
fullstack-lab/
├── docs/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/              # introduced with async reports/queue
├── packages/
│   ├── contracts/
│   ├── ui/
│   └── config/
├── infra/
│   ├── docker/
│   ├── compose/
│   ├── kubernetes/
│   └── monitoring/
└── scripts/
~~~

The repository uses a pnpm workspace monorepo.

### 9.2 Frontend

~~~
Next.js App Router + React + TypeScript
Ant Design for base components and theme tokens
SCSS Modules for Flowboard-specific styling
TanStack Query for server state
React Hook Form + Zod for fixed forms and validation
dnd-kit for board drag-and-drop
Vitest + Testing Library for unit/component tests
Playwright for end-to-end tests
~~~

Formily is deferred. It becomes appropriate only if Flowboard later supports user-configured custom fields or schema-driven form builders. Naive UI is not used because Flowboard uses React/Next.js rather than Vue.

~~~
apps/web/src/
├── app/             # route/layout composition
├── features/        # product modules and their UI/query state
├── components/ui/   # Flowboard wrappers around Ant Design primitives
├── components/shared/
├── hooks/
├── lib/             # transport/query setup and small generic helpers
├── styles/
└── test/
~~~

### 9.3 Backend

~~~
NestJS + Fastify adapter + TypeScript
PostgreSQL
Drizzle ORM + Drizzle Kit migrations
Zod at API boundaries and shared contracts
OpenAPI/Swagger contract publication
Pino structured logging
Vitest for unit and integration tests
~~~

~~~
apps/api/src/
├── modules/
│   ├── auth/
│   ├── workspaces/
│   ├── projects/
│   ├── board-columns/
│   ├── tasks/
│   ├── comments/
│   ├── activity/
│   └── reports/
├── shared/
│   ├── authorization/
│   ├── database/
│   ├── http/
│   ├── observability/
│   ├── config/
│   └── errors/
└── main.ts
~~~

Dependency direction:

~~~
controller → application use case → domain rule → repository interface → infrastructure
~~~

A helper belongs to shared only when at least two modules use it, it contains no module-specific business rule, and it has a narrow contract. Otherwise, it remains with its owning module.

### 9.4 Authentication

~~~
email/password
→ Argon2id password hash
→ random opaque session ID in HttpOnly cookie
→ hash of session ID stored in PostgreSQL
→ SessionGuard authenticates request
→ ProjectPermissionGuard authorizes action/resource
~~~

Cookie requirements: HttpOnly, Secure outside local development, appropriate SameSite, expiry, server-side revocation, and CSRF protection for state-changing requests. Login and password-reset routes have rate limits.

Password reset and email verification use one-time expiring random tokens whose hashes are stored in the database. A successful password reset revokes every existing session. An authenticated password-change endpoint is deferred from the MVP until its account-settings product scope and re-authentication policy are defined.

## 10. Reporting and asynchronous work

Only a Project Owner can request an Excel export. The request captures its project scope and filter snapshot in report_exports, then writes an audit/activity event.

Phase 1.1 supports owner-initiated download. The owner sends the file to a manager manually.

Phase 1.2 introduces Redis and a separate worker using BullMQ. The worker generates reports and sends scheduled or requested deliveries. Jobs have explicit status, bounded retry, idempotency key, error code, expiry, and audit records.

Redis and BullMQ are not part of the first vertical slice. They appear only when reporting and notification work becomes asynchronous. The web/API request returns promptly; CPU, file generation, and delivery run in the worker.

## 11. Testing, delivery, and observability

~~~
Unit        domain rules, permission policy, pure helper
Integration Nest use cases with PostgreSQL, transactions, pagination, authz, conflicts
E2E         Next.js + API, primary journey, role-based UI, conflict recovery
~~~

The authorization test matrix is mandatory. It tests all relevant roles, direct HTTP attempts by a Viewer, attempts by User A to access User B's resources, and response field exposure.

Initial Docker Compose services:

~~~
web + api + PostgreSQL + Mailpit
~~~

Redis and worker are added only in the report-delivery phase. Migration commands are explicit and controlled; production deployment never uses an uncontrolled schema push.

~~~
format → lint → typecheck → unit test → integration test → build → E2E → container image
~~~

The first release includes structured Pino logs, requestId, health and readiness endpoints, and safe error reporting. Later phases add metrics, traces, queue monitoring, load tests, failure experiments, and local Kubernetes.

## 12. AI design

AI is a later capability, never a shortcut around permission or product rules.

| Phase | Behavior | Safety boundary |
|---|---|---|
| AI-1 | Generate a proposed board/tasks from an Owner's goal | Structured output validation and explicit user confirmation before writes |
| AI-2 | Summarize project progress and risk | Server-built, project-scoped context; token, latency, and cost telemetry |
| AI-3 | Answer questions and semantic search | Project-filtered retrieval, citations, evaluation, no cross-project context |
| AI-4 | Read-only then controlled mutation tools | Narrow allowlisted tools, server-side authorization, timeout, confirmation, audit |

~~~
modules/ai/
├── context/
├── provider/
├── structured-output/
├── conversations/
├── retrieval/
├── tools/
├── evaluation/
└── observability/
~~~

The model provider is accessed through an application-owned adapter. Provider DTOs never leak into application or frontend contracts. Provider selection is a configuration/ADR decision made when AI implementation begins, after cost, capability, privacy, and latency requirements are evaluated.

Model output is untrusted input: parse, schema-validate, normalize, then use. The model proposes actions; the application validates permission and domain state before executing them. Tools are narrow, bounded, audited, and never accept user, workspace, or project identity from model-generated arguments.

AI telemetry stores prompt version, provider/model, token usage, latency, finish reason, validation result, and redacted context metadata. RAG phases additionally record retrieved IDs, scores, citations, and evaluation results.

## 13. Documentation deliverables

After this baseline is approved, the repository will contain focused documents for product brief/personas/scope/user journeys; information architecture/user flows/screen inventory/design system/Pencil handoff; domain model/table specifications/migrations/query-index policy; API conventions/endpoint contracts/errors/pagination/idempotency; authentication/authorization/permission catalog/test matrix; frontend/backend conventions/repository structure/shared-helper policy; testing/local development/Docker/CI/observability/deployment; reporting/export; AI roadmap/architecture/safety/evaluation; and a user guide.

The documentation index records traceability from every section of this specification to its focused documents and defines the canonical names for product concepts and technical identifiers. Markdown remains authoritative for these contracts; Pencil is authoritative only for the visual UI/UX design that follows this acceptance gate.

## 14. Baseline acceptance criteria

This design is ready to drive implementation planning when:

- product scope and non-goals are explicit;
- primary roles and project privacy are defined;
- authorization is enforced in UI, API, and data access layers;
- the domain model and critical invariants are defined;
- API routes represent use cases rather than generic tables;
- pagination, ordering, and concurrent writes have specified behavior;
- technology boundaries and repository layout are defined;
- asynchronous reporting and AI are phased rather than prematurely included;
- test, CI, local runtime, and observability requirements are specified.

Any later change is evaluated against this baseline and recorded in an ADR when it changes a difficult-to-reverse decision.
