# Flowboard Documentation Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the approved Flowboard master specification into a navigable, detailed documentation baseline that is ready for Pencil UX design and later implementation planning.

**Architecture:** Keep one master specification as the decision baseline, then split it into focused Markdown documents by product, UX, data, API, security, engineering, operations, reporting, AI, and user guidance. Each focused document links back to the master specification and states only the rules owned by its area. README and documentation indexes make the path understandable to a GitHub visitor without opening source code.

**Tech Stack:** Markdown, relative links, ASCII/Mermaid-compatible diagrams, Pencil as the visual-design source of truth, Git.

**Spec:** `07-projects/fullstack-lab/docs/superpowers/specs/2026-09-01-flowboard-product-architecture-design.md`

## Global Constraints

- Write documentation in Vietnamese; retain standard English technical and product terms where they are clearer.
- Pencil is the source of truth for visual UI design; Markdown is the source of truth for product behavior, architecture, contracts, and operations.
- Do not scaffold `apps/`, `packages/`, `infra/`, database migrations, or application code in this plan.
- The core MVP contains private projects, configurable columns, task management, immutable comments, append-only activity logs, pagination, optimistic concurrency, and project roles Owner/Editor/Viewer.
- Core MVP excludes AI, realtime, custom roles, labels, checklists, dependencies, recurring tasks, calendar, attachments, billing, public API, mobile, microservices, and automatic report delivery.
- Workspace Admin manages workspace membership/settings but never receives implicit access to private project content.
- Authorization is deny-by-default and enforced in frontend affordances, backend policy checks, and data-scoped queries.
- No generic table-driven public APIs. Public endpoints represent explicit business use cases.
- All documentation links are relative and must resolve within the repository.
- Every difficult-to-reverse decision is recorded in an ADR after this baseline.

---

## Planned documentation structure

~~~text
07-projects/fullstack-lab/
├── README.md
└── docs/
    ├── README.md
    ├── product/
    │   ├── vision-and-scope.md
    │   ├── personas-and-jobs.md
    │   ├── user-journeys.md
    │   └── delivery-roadmap.md
    ├── design/
    │   ├── information-architecture.md
    │   ├── user-flows.md
    │   ├── screen-inventory.md
    │   ├── interaction-specifications.md
    │   ├── design-system.md
    │   └── pencil-handoff.md
    ├── data/
    │   ├── domain-model.md
    │   ├── database-design.md
    │   └── query-and-index-policy.md
    ├── api/
    │   ├── api-conventions.md
    │   ├── endpoint-contracts.md
    │   └── pagination-concurrency-idempotency.md
    ├── security/
    │   ├── authentication.md
    │   ├── authorization-model.md
    │   └── authorization-test-matrix.md
    ├── engineering/
    │   ├── repository-structure.md
    │   ├── frontend-conventions.md
    │   ├── backend-conventions.md
    │   └── shared-helper-policy.md
    ├── operations/
    │   ├── testing-strategy.md
    │   ├── local-development.md
    │   ├── ci-cd.md
    │   └── observability.md
    ├── reporting/
    │   └── progress-export.md
    ├── ai/
    │   ├── roadmap.md
    │   └── architecture-and-safety.md
    ├── user-guide/
    │   ├── README.md
    │   └── getting-started.md
    ├── decisions/
    │   └── README.md
    ├── superpowers/
    │   ├── specs/
    │   └── plans/
    └── design-and-docs-plan.md
~~~

### Task 1: Establish documentation navigation and replace the entry-point map

**Files:**
- Create: `07-projects/fullstack-lab/docs/README.md`
- Modify: `07-projects/fullstack-lab/README.md`
- Modify: `07-projects/fullstack-lab/docs/design-and-docs-plan.md`

**Consumes:** The approved master specification and the existing top-level Flowboard README.

**Produces:** A single documentation map that tells a GitHub reader what to read first, what Pencil owns, and what is intentionally deferred.

- [ ] **Step 1: Create the documentation index**

Create `docs/README.md` with the sections: “How to read this project”, “Product”, “UX and Pencil”, “System design”, “Engineering and operations”, “Future phases”, and “Decision records”.

- [ ] **Step 2: Add exact reading order**

Document this reading order:

~~~text
README
→ product/vision-and-scope
→ product/user-journeys
→ design/information-architecture
→ design/user-flows
→ design/screen-inventory
→ Pencil
→ data/domain-model
→ security/authorization-model
→ api/endpoint-contracts
→ engineering and operations
~~~

- [ ] **Step 3: Replace README documentation links**

Change the README documentation map so it links to the new documents rather than only the older flat files. Keep the master specification linked under an “Approved baseline” label.

- [ ] **Step 4: Update the documentation plan**

Update `design-and-docs-plan.md` to reference `docs/README.md` and explain that detailed Markdown decisions are completed before Pencil visual work starts.

- [ ] **Step 5: Verify links and commit**

Run:

~~~powershell
rg -n "\]\(" 07-projects/fullstack-lab/README.md 07-projects/fullstack-lab/docs/README.md
git add 07-projects/fullstack-lab/README.md 07-projects/fullstack-lab/docs/README.md 07-projects/fullstack-lab/docs/design-and-docs-plan.md
git commit -m "docs: add Flowboard documentation navigation"
~~~

### Task 2: Write the product documentation set

**Files:**
- Create: `07-projects/fullstack-lab/docs/product/vision-and-scope.md`
- Create: `07-projects/fullstack-lab/docs/product/personas-and-jobs.md`
- Create: `07-projects/fullstack-lab/docs/product/user-journeys.md`
- Create: `07-projects/fullstack-lab/docs/product/delivery-roadmap.md`

**Consumes:** Spec sections 2, 3, and 12.

**Produces:** Product intent, accepted scope, user outcomes, and phase boundaries that UI and API decisions can trace back to.

- [ ] **Step 1: Write vision-and-scope**

State the team-work problem, the target team size, one-sentence product statement, MVP capabilities, explicit non-goals, and success signals. Include the rule that a feature belongs in MVP only when it completes the primary work-management loop.

- [ ] **Step 2: Write personas-and-jobs**

Describe Project Owner, Editor, Viewer, Workspace Admin, their jobs-to-be-done, frequency of use, and the product information each role must see. State that Workspace Admin has no implicit private-project access.

- [ ] **Step 3: Write user-journeys**

Document the Owner setup journey, the Editor daily task journey, the Viewer review journey, and the denied-access journey. Each journey must include entry point, preconditions, success outcome, and failure outcome.

- [ ] **Step 4: Write delivery-roadmap**

Document core MVP, Phase 1.1 export, Phase 1.2 scheduled delivery, and AI-1 through AI-4. Explain which infrastructure becomes necessary at each phase and why it is not introduced earlier.

- [ ] **Step 5: Verify scope consistency and commit**

Run:

~~~powershell
rg -n "AI|realtime|custom role|Workspace Admin|Owner|Editor|Viewer" 07-projects/fullstack-lab/docs/product
git add 07-projects/fullstack-lab/docs/product
git commit -m "docs: define Flowboard product baseline"
~~~

### Task 3: Write the UX, Pencil, and interaction documentation set

**Files:**
- Create: `07-projects/fullstack-lab/docs/design/information-architecture.md`
- Create: `07-projects/fullstack-lab/docs/design/user-flows.md`
- Create: `07-projects/fullstack-lab/docs/design/screen-inventory.md`
- Create: `07-projects/fullstack-lab/docs/design/interaction-specifications.md`
- Create: `07-projects/fullstack-lab/docs/design/design-system.md`
- Create: `07-projects/fullstack-lab/docs/design/pencil-handoff.md`

**Consumes:** Product scope, permission catalog, and master specification sections 4, 5, and 8.

**Produces:** A written UX contract that Pencil can visualize without inventing behavior.

- [ ] **Step 1: Write information architecture and user flows**

Define navigation hierarchy and primary flows for authentication, workspace/project selection, member management, configurable columns, task creation, task detail, comments, and activity history. Include forbidden, session-expired, empty, and network-error branches.

- [ ] **Step 2: Write screen inventory**

Give every MVP screen a stable ID, purpose, route or route context, required API data, authorized roles, and required states. Include Sign In, Sign Up, Workspace List, Project List, Project Board, Column Editor, Task Form, Task Detail, Project Members, Forbidden, and Conflict Resolution.

- [ ] **Step 3: Write interaction specifications**

Specify drag-and-drop move behavior, optimistic UI behavior, 409 conflict recovery, form validation, unsaved-changes behavior, pagination/load-more behavior, focus management, keyboard behavior, and mobile horizontal-board behavior.

- [ ] **Step 4: Write design-system and Pencil handoff rules**

Define token categories, component naming, variants, required states, responsive rules, and the mapping format from a Pencil component to a frontend component. State that Ant Design provides primitives and Flowboard components wrap them when the product needs a stable behavior or style.

- [ ] **Step 5: Verify Pencil readiness and commit**

Run:

~~~powershell
rg -n "Loading|Empty|Error|Forbidden|Conflict|Owner|Editor|Viewer" 07-projects/fullstack-lab/docs/design
git add 07-projects/fullstack-lab/docs/design
git commit -m "docs: define Flowboard UX and Pencil handoff"
~~~

### Task 4: Write domain, database, and query-policy documentation

**Files:**
- Create: `07-projects/fullstack-lab/docs/data/domain-model.md`
- Create: `07-projects/fullstack-lab/docs/data/database-design.md`
- Create: `07-projects/fullstack-lab/docs/data/query-and-index-policy.md`

**Consumes:** Spec sections 5, 6, and 8.

**Produces:** The data contract that later database migrations, repositories, and frontend data assumptions implement.

- [ ] **Step 1: Write the domain model**

Document entities, relationships, ownership boundaries, state transitions, invariants, and ownership of each business rule. Include User, AuthSession, Workspace, WorkspaceMember, Project, ProjectMember, BoardColumn, Task, Comment, ActivityLog, and future ReportExport.

- [ ] **Step 2: Write database design**

For every table, document columns, PostgreSQL types, primary/foreign/unique keys, nullability, creation/update timestamps, data retention, and whether the table belongs to core MVP or a later phase. Define UUID identifiers, UTC timestamps, optional due_date, and version integer for tasks.

- [ ] **Step 3: Write query and index policy**

Specify default and maximum page size, opaque cursor rules, allowed task filters/sort/search fields, required indexes, project-scoped query rule, explain-plan verification rule, and per-column bounded board loading.

- [ ] **Step 4: Add transaction rules**

Document transactions for task create, task update, task move, project member change, column archive, activity logging, and export request. State that activity writes share the transaction with the mutation they describe.

- [ ] **Step 5: Verify invariants and commit**

Run:

~~~powershell
rg -n "UNIQUE|foreign key|transaction|version|cursor|project_id" 07-projects/fullstack-lab/docs/data
git add 07-projects/fullstack-lab/docs/data
git commit -m "docs: define Flowboard data and query policy"
~~~

### Task 5: Write authentication and authorization documentation

**Files:**
- Create: `07-projects/fullstack-lab/docs/security/authentication.md`
- Create: `07-projects/fullstack-lab/docs/security/authorization-model.md`
- Create: `07-projects/fullstack-lab/docs/security/authorization-test-matrix.md`

**Consumes:** Spec sections 5 and 9.4.

**Produces:** A central access-control contract shared by frontend, NestJS guards, repositories, tests, and future AI tools.

- [ ] **Step 1: Write authentication**

Describe sign-up, email verification, sign-in, opaque session creation, session cookie attributes, server-side session hashing/revocation, logout, password reset with all-session revocation, rate limiting, and CSRF defense. State Argon2id is the password hashing algorithm and defer authenticated password change until account-settings scope and re-authentication policy are defined.

- [ ] **Step 2: Write authorization model**

Document workspace roles, project roles, permission catalog, deny-by-default behavior, object-level authorization flow, capabilities returned to the frontend, ProjectPermissionGuard behavior, and the required repository query scope.

- [ ] **Step 3: Write authorization test matrix**

Create a matrix whose rows are Owner, Editor, Viewer, Workspace Admin without project membership, User A, and User B; columns include every read/write/manage/export action. Define expected allow/deny status and tests for ID substitution, direct HTTP mutation, hidden-field updates, and response field exposure.

- [ ] **Step 4: Add implementation integration points**

Name the future backend primitives: SessionGuard, ResourceProjectResolver, ProjectPermissionGuard, AuthorizationService, RequireProjectPermission decorator, and scoped repository query. Name the future frontend primitive: can(action, resource).

- [ ] **Step 5: Verify permission completeness and commit**

Run:

~~~powershell
rg -n "deny|Owner|Editor|Viewer|ProjectPermissionGuard|User A|User B" 07-projects/fullstack-lab/docs/security
git add 07-projects/fullstack-lab/docs/security
git commit -m "docs: define Flowboard authentication and authorization"
~~~

### Task 6: Write API contract documentation

**Files:**
- Create: `07-projects/fullstack-lab/docs/api/api-conventions.md`
- Create: `07-projects/fullstack-lab/docs/api/endpoint-contracts.md`
- Create: `07-projects/fullstack-lab/docs/api/pagination-concurrency-idempotency.md`

**Consumes:** Spec sections 7 and 8, data query policy, and authorization model.

**Produces:** Explicit HTTP contracts that prevent generic table endpoints, mass assignment, inconsistent errors, and silent concurrent overwrites.

- [ ] **Step 1: Write API conventions**

Define JSON response envelope, error shape, requestId, validation failure, unauthenticated response, forbidden response, missing-resource response, conflict response, field naming, date serialization, idempotency-key convention, and OpenAPI publication rule.

- [ ] **Step 2: Write endpoint contracts**

For every core endpoint group, document method, path, required permission, request schema fields, response fields, success status, failure codes, side effects, and activity-log behavior. Include auth, workspace members, project creation/members, columns, tasks, comments, and activity endpoints.

- [ ] **Step 3: Write pagination, concurrency, and idempotency**

Define opaque cursor response, default/max limit, allowed query fields, task expectedVersion requirement, 409 response behavior, task move request contract, fractional ordering/rebalance rule, and which mutations require idempotency keys.

- [ ] **Step 4: Document the controlled generic core**

Explain which primitives belong in shared HTTP code and which schemas/policies remain inside modules. Explicitly forbid paths equivalent to a generic table GET or POST endpoint.

- [ ] **Step 5: Verify endpoint coverage and commit**

Run:

~~~powershell
rg -n "^POST |^GET |^PATCH |^DELETE |409|Idempotency|cursor" 07-projects/fullstack-lab/docs/api
git add 07-projects/fullstack-lab/docs/api
git commit -m "docs: define Flowboard API contracts"
~~~

### Task 7: Write frontend and backend engineering conventions

**Files:**
- Create: `07-projects/fullstack-lab/docs/engineering/repository-structure.md`
- Create: `07-projects/fullstack-lab/docs/engineering/frontend-conventions.md`
- Create: `07-projects/fullstack-lab/docs/engineering/backend-conventions.md`
- Create: `07-projects/fullstack-lab/docs/engineering/shared-helper-policy.md`

**Consumes:** Spec section 9 and UX/API/security documents.

**Produces:** A consistent code organization plan before scaffolding a monorepo.

- [ ] **Step 1: Write repository structure**

Document pnpm workspace layout, responsibilities of apps/web, apps/api, later apps/worker, packages/contracts, packages/ui, packages/config, infra, scripts, and docs. State no worker exists until asynchronous reporting exists.

- [ ] **Step 2: Write frontend conventions**

Define the role of app, features, components/ui, components/shared, hooks, lib, styles, and tests. Define Ant Design, SCSS Modules, TanStack Query, React Hook Form, Zod, dnd-kit, Vitest, and Playwright responsibilities. State when Formily becomes appropriate and why Naive UI is excluded.

- [ ] **Step 3: Write backend conventions**

Define module shape, dependency direction from controller through use case/domain/repository/infrastructure, Fastify adapter, Drizzle database boundary, Zod validation boundary, Pino logging, and OpenAPI boundary.

- [ ] **Step 4: Write shared-helper policy**

Define the two-consumer rule, no-domain-logic rule, narrow-contract rule, allowed shared categories, prohibited generic utils dumping ground, and examples of helpers that stay in task/project modules.

- [ ] **Step 5: Verify boundaries and commit**

Run:

~~~powershell
rg -n "apps/web|apps/api|packages/contracts|two-consumer|controller|repository" 07-projects/fullstack-lab/docs/engineering
git add 07-projects/fullstack-lab/docs/engineering
git commit -m "docs: define Flowboard engineering conventions"
~~~

### Task 8: Write operations and quality documentation

**Files:**
- Create: `07-projects/fullstack-lab/docs/operations/testing-strategy.md`
- Create: `07-projects/fullstack-lab/docs/operations/local-development.md`
- Create: `07-projects/fullstack-lab/docs/operations/ci-cd.md`
- Create: `07-projects/fullstack-lab/docs/operations/observability.md`

**Consumes:** Spec section 11 and all cross-cutting contracts.

**Produces:** A definition of quality and operability before any runtime is scaffolded.

- [ ] **Step 1: Write testing strategy**

Define unit, integration, E2E, authorization, concurrency, and failure-experiment test responsibilities. Include the required role matrix, User A/User B object-level access tests, stale-version update test, and task-move transaction test.

- [ ] **Step 2: Write local development**

Document the initial Docker Compose topology: web, API, PostgreSQL, and Mailpit. Define environment configuration policy, local secrets policy, migration command policy, seed-data goals, health endpoint expectations, and later Redis/worker addition.

- [ ] **Step 3: Write CI/CD**

Define the pipeline order: format, lint, typecheck, unit, integration, build, E2E, container image. Specify which pull-request checks block merge and that migration execution is controlled rather than schema push.

- [ ] **Step 4: Write observability**

Define structured log fields, requestId propagation, health/readiness behavior, safe error messages, core metrics for later phases, queue/report telemetry, and the staged addition of traces and Kubernetes monitoring.

- [ ] **Step 5: Verify operations coverage and commit**

Run:

~~~powershell
rg -n "Docker|PostgreSQL|Mailpit|requestId|health|integration|E2E|migration" 07-projects/fullstack-lab/docs/operations
git add 07-projects/fullstack-lab/docs/operations
git commit -m "docs: define Flowboard operations baseline"
~~~

### Task 9: Write reporting and AI design documents

**Files:**
- Create: `07-projects/fullstack-lab/docs/reporting/progress-export.md`
- Create: `07-projects/fullstack-lab/docs/ai/roadmap.md`
- Create: `07-projects/fullstack-lab/docs/ai/architecture-and-safety.md`

**Consumes:** Spec sections 10 and 12, existing AI engineering notes, security model, and operations baseline.

**Produces:** A phased plan for future capabilities without expanding core MVP.

- [ ] **Step 1: Write progress-export**

Document Phase 1.1 owner-authorized XLSX download, report filter snapshot, report_exports lifecycle, file download access, activity/audit record, and manual manager delivery. Document Phase 1.2 queue, worker, retry, idempotency, expiry, and scheduled/requested email delivery.

- [ ] **Step 2: Write AI roadmap**

Document AI-1 through AI-4, prerequisite product data, user value, input/output, excluded capabilities, required permissions, and acceptance signal for advancing to the next AI phase.

- [ ] **Step 3: Write AI architecture and safety**

Define context builder, provider adapter, structured-output validator, conversations, retrieval, tool registry/executor, evaluation, observability, project-scoped context, provider-independent DTOs, output-as-untrusted-input, narrow tools, server-derived identity, confirmation for writes, and audit requirements.

- [ ] **Step 4: Add links to existing learning notes**

Link each Flowboard AI phase to the relevant existing notes for structured output, context engineering, RAG, tool calling, evaluation, and AI observability.

- [ ] **Step 5: Verify phase boundaries and commit**

Run:

~~~powershell
rg -n "AI-1|AI-2|AI-3|AI-4|BullMQ|confirmation|project-scoped|untrusted" 07-projects/fullstack-lab/docs/reporting 07-projects/fullstack-lab/docs/ai
git add 07-projects/fullstack-lab/docs/reporting 07-projects/fullstack-lab/docs/ai
git commit -m "docs: define reporting and AI roadmap"
~~~

### Task 10: Write user-guide foundations and ADR process

**Files:**
- Create: `07-projects/fullstack-lab/docs/user-guide/README.md`
- Create: `07-projects/fullstack-lab/docs/user-guide/getting-started.md`
- Create: `07-projects/fullstack-lab/docs/decisions/README.md`
- Create: `07-projects/fullstack-lab/docs/decisions/ADR-template.md`

**Consumes:** Product journeys, UX flows, architecture decisions, and reporting/AI phase boundaries.

**Produces:** A user-documentation structure that later receives Pencil screenshots and a decision-record process for architecture changes.

- [ ] **Step 1: Write user-guide index**

State the audience, guide style, screenshot rule, and the required guide format: purpose, prerequisites, steps, expected result, failure cases, Pencil reference, and related concepts.

- [ ] **Step 2: Write getting-started**

Document the future user path: sign in, create or join workspace, access an authorized project, understand role-based actions, create/open a task, and find activity history. Mark screenshots as a post-Pencil addition without unresolved screenshot markers.

- [ ] **Step 3: Write decisions index and ADR template**

Define when an ADR is mandatory: authentication/session choice, ORM, database ordering/concurrency approach, permission changes, queue addition, AI provider selection, and deployment changes. The template must include Context, Decision, Alternatives, Consequences, and Revisit When.

- [ ] **Step 4: Link guides to product/UX docs**

Add relative links from the guide and ADR index to the product and design documents they explain.

- [ ] **Step 5: Verify guide structure and commit**

Run:

~~~powershell
rg -n "Purpose|Prerequisites|Expected result|Context|Decision|Revisit When" 07-projects/fullstack-lab/docs/user-guide 07-projects/fullstack-lab/docs/decisions
git add 07-projects/fullstack-lab/docs/user-guide 07-projects/fullstack-lab/docs/decisions
git commit -m "docs: add Flowboard guide and ADR foundations"
~~~

### Task 11: Run documentation acceptance review and freeze baseline

**Files:**
- Modify: `07-projects/fullstack-lab/README.md`
- Modify: `07-projects/fullstack-lab/docs/README.md`
- Modify: `07-projects/fullstack-lab/docs/design-and-docs-plan.md`
- Modify: `07-projects/fullstack-lab/docs/superpowers/specs/2026-09-01-flowboard-product-architecture-design.md`

**Consumes:** Every document from Tasks 1–10.

**Produces:** A coherent documentation baseline ready for Pencil UI/UX design.

- [ ] **Step 1: Trace each master-spec section**

Create a table in the documentation index that maps master-spec sections 1–14 to focused documentation files. Every section must map to at least one focused document.

- [ ] **Step 2: Check terminology**

Verify that all docs use identical names for Workspace Admin, Workspace Member, Project Owner, Editor, Viewer, Board Column, Task, Activity Log, due_date, expectedVersion, requestId, and capabilities.

- [ ] **Step 3: Check scope and link integrity**

Run:

~~~powershell
rg -n -i "[T]ODO|[T]BD|place[h]older" 07-projects/fullstack-lab/docs
rg -n "\]\(" 07-projects/fullstack-lab/README.md 07-projects/fullstack-lab/docs
~~~

Resolve every reported unresolved marker and every broken relative link.

- [ ] **Step 4: Mark the documentation baseline ready for Pencil**

In README and the design-and-docs plan, state that Markdown baseline v0.1 is ready for Pencil work. Do not claim that UI design or application implementation is complete.

- [ ] **Step 5: Commit the documentation baseline**

~~~powershell
git add 07-projects/fullstack-lab
git commit -m "docs: freeze Flowboard documentation baseline v0.1"
~~~

## Plan self-review

### Spec coverage

| Master specification area | Plan task |
|---|---|
| Product and scope | Task 2 |
| UX and Pencil | Task 3 |
| Authorization | Task 5 |
| Domain, database, query policy | Task 4 |
| API, pagination, concurrency | Task 6 |
| Repository and technical stack | Task 7 |
| Reporting and asynchronous work | Task 9 |
| Testing, delivery, observability | Task 8 |
| AI design | Task 9 |
| User guidance and ADR process | Task 10 |
| Documentation navigation and acceptance | Tasks 1 and 11 |

### Completeness scan

This plan contains no undecided technical work. “Deferred” features are explicitly excluded from MVP or assigned to a named future phase.

### Dependency consistency

- Task 1 establishes the entry points used by every later task.
- Tasks 2–6 define product, UX, data, security, and API contracts before engineering-convention documents in Task 7.
- Task 8 uses the API/security/data contracts to define quality checks.
- Task 9 reuses security, operations, and data boundaries rather than creating an AI-specific bypass.
- Task 11 verifies all documents against the master specification.
