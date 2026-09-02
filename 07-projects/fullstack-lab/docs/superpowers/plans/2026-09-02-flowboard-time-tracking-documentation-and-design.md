# Flowboard Time Tracking Documentation and Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bổ sung Time Tracking theo project, phê duyệt giờ linh hoạt và UI filter/select nhất quán vào baseline tài liệu và Pencil của Flowboard.

**Architecture:** Time Tracking là module project-scoped, không suy ra giờ từ Task dates. `ProjectTimeTrackingSettings`, `ProjectTimeApprover`, `WorkLog` và `WorkLogAccessOverride` có boundaries riêng; `WorkLog` dùng lifecycle `draft → submitted → approved|rejected`, trong đó self-close đi thẳng tới approved với `approval_kind=self`. UI dùng component filter thống nhất và server-computed capabilities cho mọi CTA/mutation.

**Tech Stack:** Markdown product/technical contracts, PostgreSQL/NestJS contract design, Vue/Naive UI design baseline, Pencil `.pen` design artifact.

**Spec:** `docs/superpowers/specs/2026-09-02-flowboard-time-tracking-design.md`

## Global Constraints

- Không commit hoặc push trong plan này; người dùng sẽ quyết định thời điểm commit.
- Không tạo generic CRUD/table API, raw filter, raw SQL hoặc unscoped query.
- Mọi data thuộc project phải đi qua session, resource resolver, capability/guard, domain validation và project-scoped repository.
- Owner cấu hình feature/mode/backfill/approver; Time Approver phải là Editor đang active; Owner không tự duyệt WorkLog của chính mình.
- Viewer vẫn read-only; không mở rộng Viewer thành write role mà không có ADR mới.
- Timezone của `work_date` là timezone workspace; timestamp lưu UTC; Task start/due date không suy ra WorkLog.
- Filter finite-set luôn dùng select/dropdown có label, placeholder và chevron; search tự do dùng input riêng; đổi filter reset cursor.
- Mọi screen mới có Light/Dark tương đương, full App Shell, loading/empty/error/forbidden/conflict phù hợp và text/icon meaningful đạt contrast tối thiểu 4.5:1.

---

## File structure

| File | Trách nhiệm sau plan |
|---|---|
| `docs/decisions/ADR-0002-project-time-tracking-and-approval.md` | Quyết định kiến trúc/phase, invariants và các lựa chọn bị loại. |
| `docs/product/vision-and-scope.md` | Phân biệt core MVP với Phase 1.3 Time Tracking. |
| `docs/product/delivery-roadmap.md` | Thêm Phase 1.3 cùng điều kiện vào phase và không kéo queue vào sớm. |
| `docs/data/domain-model.md` | Ownership/entity/lifecycle WorkLog và project time settings. |
| `docs/data/database-design.md` | PostgreSQL tables, constraints, foreign keys, advisory-lock key và migration strategy. |
| `docs/data/query-and-index-policy.md` | Query allowlists, cursor, aggregates, indexes và transaction policies. |
| `docs/security/authorization-model.md` | Capability catalog và object-level guards cho module Time Tracking. |
| `docs/api/endpoint-contracts.md` | Routes/DTO/error/status/idempotency contracts, không generic API. |
| `docs/api/pagination-concurrency-idempotency.md` | Cursor fingerprints, WorkLog `expectedVersion` và bulk-review idempotency. |
| `docs/reporting/progress-export.md` | Boundary rõ giữa progress export Phase 1.1 và time report aggregate Phase 1.3. |
| `docs/design/design-system.md` | Contract `FbSelect`, `FbAsyncMemberSelect`, date-range picker, chips và trạng thái select. |
| `docs/design/screen-inventory.md` | IDs `TTS-01`, `WTL-01/02`, `WTA-01`, `WTR-01` và extension Task Detail. |
| `docs/design/interaction-specifications.md` | Behavior form/log/review/bulk/override, filter semantics, errors/focus/keyboard. |
| `docs/design/pencil-handoff.md` | Mapping frame, component, permission, Light/Dark and responsive. |
| `docs/design/pencil-refactor-checklist.md` | Checklist review cho controls và các screen mới. |
| `docs/design/flowboard-v0.1.pen` | Foundations, filters và all screen variants trong Pencil; chỉ edit qua Pencil MCP. |
| `docs/user-guide/README.md`, `docs/user-guide/getting-started.md` | Entry point và hướng dẫn người dùng ghi/chốt/duyệt giờ. |

## Task 1: Ghi nhận quyết định và phân pha sản phẩm

**Files:**
- Create: `docs/decisions/ADR-0002-project-time-tracking-and-approval.md`
- Modify: `docs/decisions/README.md`
- Modify: `docs/product/vision-and-scope.md`
- Modify: `docs/product/delivery-roadmap.md`

**Interfaces:**
- Consumes: Time Tracking spec sections 1–2, 8–9.
- Produces: `ADR-0002` accepted decision; Phase 1.3 scope referenced by technical/design docs.

- [x] **Step 1: Add a failing documentation-consistency checklist**

Record that the current scope says Project Settings only changes `name`, Viewer has no write path, and no roadmap phase owns Time Tracking. Define expected new references: ADR-0002, Phase 1.3, and an explicit non-goal list.

- [x] **Step 2: Verify the baseline gap**

Run: `rg -n "Project Settings|Viewer.*write|Phase 1.3|Time Tracking" docs/product docs/data docs/security`

Expected: no approved Time Tracking phase/contract exists; current wording would contradict the new feature.

- [x] **Step 3: Write ADR-0002**

Document context, decision, alternatives (global-only rule; per-member/task custom rules), consequences, chosen project-level settings, approval self-review prohibition, backfill window and no Viewer write expansion. Set `Status: Accepted` only because the user approved the spec; do not commit.

- [x] **Step 4: Update product scope and roadmap**

Add a Phase 1.3 after reporting phases: project-level configuration, daily WorkLogs, approvals, monthly aggregate and no queue/timer/payroll. Remove the contradiction that Project Settings can only ever mutate `name` by scoping that statement to core MVP.

- [x] **Step 5: Verify cross-links and scope**

Run: `rg -n "ADR-0002|Phase 1.3|Time Tracking|WorkLog|queue|payroll" docs/decisions docs/product`

Expected: one coherent scope; queue, automatic delivery and billing remain outside Phase 1.3.

## Task 2: Define data, database and query contracts

**Files:**
- Modify: `docs/data/domain-model.md`
- Modify: `docs/data/database-design.md`
- Modify: `docs/data/query-and-index-policy.md`

**Interfaces:**
- Consumes: ADR-0002 and spec sections 3 and 5.
- Produces: Persistent entities, state machine, DDL-level constraints, query/index/locking contract used by API and reporting tasks.

- [x] **Step 1: Add failing invariant examples to the data review checklist**

List examples that must be rejected: duplicate user–task–date WorkLog, cross-project task, duration total over 1,440 minutes/day, non-Editor approver, self-review in required-approval mode and late mutation without override.

- [x] **Step 2: Verify the current model has no owner for those invariants**

Run: `rg -n "WorkLog|TimeTracking|ProjectTimeApprover|1.440|advisory" docs/data`

Expected: no existing entity/table/index claims ownership.

- [x] **Step 3: Add domain entities and lifecycle**

Add `ProjectTimeTrackingSettings`, `ProjectTimeApprover`, `WorkLog`, `WorkLogAccessOverride`; include same-project/task/member invariants, self-close versus reviewed approval kind, immutable audit history and draft/rejected edit rules.

- [x] **Step 4: Add database contract**

Specify UUID/FK/check/unique constraints, `work_date DATE`, UTC timestamps, `duration_minutes` check, status enum/check, reviewer fields, composite unique daily entry and additive migration with feature disabled by default. Specify stable advisory-lock input `(project_id, logged_by_user_id, work_date)` before daily aggregate validation.

- [x] **Step 5: Add query/index and transaction policy**

Allowlist date/member/task/status filters; cursor fingerprints; monthly aggregate only over authorized project scope; required indexes; conditional `expectedVersion` updates and per-record bulk-review outcomes.

- [x] **Step 6: Verify every invariant has an owner**

Run: `rg -n "1.440|self-review|UNIQUE\(project_id, task_id|advisory|expectedVersion|backfill" docs/data`

Expected: every Step 1 invalid case is rejected by a named domain/use-case/database rule.

## Task 3: Extend authorization and API contracts

**Files:**
- Modify: `docs/security/authorization-model.md`
- Modify: `docs/api/endpoint-contracts.md`
- Modify: `docs/api/pagination-concurrency-idempotency.md`

**Interfaces:**
- Consumes: entities and invariant names from Task 2.
- Produces: capability names, exact request/response DTO allowlists and HTTP/error/idempotency behavior.

- [x] **Step 1: Write negative authorization examples**

Define expected denials for Viewer write/review/report, unassigned Editor review, Owner self-review, removed approver, cross-project WorkLog ID and Workspace Admin without project membership.

- [x] **Step 2: Add the capability catalog**

Add exactly `time-tracking:settings:update`, `work-log:read`, `work-log:create:self`, `work-log:update:self`, `work-log:submit:self`, `work-log:review`, `work-log:backfill:override`, `time-report:read`; map Owner, Editor, assigned Editor and Viewer without role `if` statements in UI.

- [x] **Step 3: Add endpoint contracts**

Document settings, cursor WorkLog list, create/update, submit, individual review, bulk review, access override and monthly report routes. Include body allowlists, safe responses, idempotency keys on creates/bulk review, `409`/`403`/`404` behavior and domain error codes from the spec.

- [x] **Step 4: Extend concurrency/pagination contract**

Bind WorkLog cursors to project/filter/sort, make filter change reset cursor, require `expectedVersion` for update/review, and document duplicate bulk request result behavior.

- [x] **Step 5: Verify the denial matrix**

Run: `rg -n "work-log:|time-report:|TIME_TRACKING_DISABLED|WORK_LOG_SELF_REVIEW_FORBIDDEN|Idempotency-Key" docs/security docs/api`

Expected: each Step 1 denial has a server-side capability/domain/error contract; no endpoint is generic CRUD.

## Task 4: Align reporting and documentation navigation

**Files:**
- Modify: `docs/reporting/progress-export.md`
- Modify: `docs/README.md`
- Modify: `docs/user-guide/README.md`
- Modify: `docs/user-guide/getting-started.md`

**Interfaces:**
- Consumes: Phase 1.3 boundaries from Task 1 and API/report aggregate contract from Task 3.
- Produces: clear distinction between XLSX project progress export and monthly time reporting, plus user-facing entry points.

- [x] **Step 1: Identify ambiguous report wording**

Run: `rg -n -i "report|export|progress|thời gian|giờ" docs/reporting docs/README.md docs/user-guide`

Expected: existing documentation only describes progress export and does not claim time totals are exported automatically.

- [x] **Step 2: Document report boundary**

State that Phase 1.3 monthly time report is an authorized aggregate view, separate from Phase 1.1 XLSX export. Do not imply a time XLSX, email, schedule, worker or storage lifecycle unless a future phase explicitly adds it.

- [x] **Step 3: Add concise user guidance**

Explain: choose a task/date/hours/description; support reason for another person's task; submit or self-close; review/return; Owner opens late-day access; monthly total only includes final logs.

- [x] **Step 4: Verify navigation and terminology**

Run: `rg -n "Tự chốt|Cần duyệt|ghi bù|Báo cáo giờ tháng|XLSX" docs/reporting docs/README.md docs/user-guide`

Expected: user docs are Vietnamese, report boundaries are explicit and no automatic-delivery claim exists.

## Task 5: Standardize filters and design behavior in Markdown

**Files:**
- Modify: `docs/design/design-system.md`
- Modify: `docs/design/screen-inventory.md`
- Modify: `docs/design/interaction-specifications.md`
- Modify: `docs/design/pencil-handoff.md`
- Modify: `docs/design/pencil-refactor-checklist.md`

**Interfaces:**
- Consumes: API query allowlists from Task 3 and UX screens/filter policy from the spec.
- Produces: named reusable select components and screen/interaction definitions consumed by Pencil work.

- [x] **Step 1: Add a filter-control audit matrix**

For BRD-01, MYT-01, PRJ-04, RPT-01, WTL-01, WTA-01 and WTR-01, map every field to `FbAsyncMemberSelect`, `FbSelect`, `FbDateRangePicker`, `FbSearchInput` or sort menu. Map `Người giao` to `createdById`, `Trạng thái` to active Board Column and `Quá hạn` to derived `dueState`.

- [x] **Step 2: Define reusable component states**

Document default, filled, open, search-loading, empty option, disabled, error, clear-chip, keyboard focus and mobile drawer states. Every finite select shows label/placeholder/chevron; a search input does not pretend to be select.

- [x] **Step 3: Add Time Tracking screen inventory**

Add `TTS-01`, `WTL-01`, `WTL-02`, `WTA-01`, `WTR-01` and `TSK-02` extension with route, input, capability, Light/Dark, loading/empty/error/forbidden/conflict state requirements.

- [x] **Step 4: Add interaction behavior**

Specify daily total validation, support-reason condition, late-date block/override, self-close versus submit, individual/bulk review partial-result behavior, month aggregate calculation, focus return and toast/banner/inline error placement.

- [x] **Step 5: Update Pencil handoff and checklist**

Map each component/screen to Light/Dark frames and explicit review checks: no fake dropdown, no unlabeled control, active chips reset cursor, select chevrons visible, accessibility name remains in collapsed sidebar.

- [x] **Step 6: Verify screen-to-contract mapping**

Run: `rg -n "FbAsyncMemberSelect|FbSelect|TTS-01|WTL-01|WTA-01|WTR-01|createdById|dueState" docs/design`

Expected: every UI control maps to a server-allowlisted query/mutation field and every new screen has a permission/state contract.

## Task 6: Refactor existing Pencil filter controls and foundations

**Files:**
- Modify: `docs/design/flowboard-v0.1.pen` (Pencil MCP only)

**Interfaces:**
- Consumes: Task 5 component contract and existing `FbAppShell`/Light-Dark tokens.
- Produces: visible reusable select/dropdown patterns and corrected BRD/MYT/Dashboard/Export controls.

- [x] **Step 1: Inspect every existing filter-bearing frame**

Open BRD-01/02, MYT-01, PRJ-04, RPT-01 in Light and Dark. Record each current filter control, whether it is search/select/date/sort, its active chip state and whether it has a chevron.

- [x] **Step 2: Build foundations first**

Create/refresh a select component reference page with `FbSelect`, `FbAsyncMemberSelect`, `FbDateRangePicker`, `FbSearchInput`, sort menu and active filter chip in Light/Dark. Include default/open/selected/error/disabled/focus states at font size ≥11 and contrast ≥4.5:1.

- [x] **Step 3: Apply filters to existing pages**

Replace ambiguous filter-like fields in Board, My Tasks, Dashboard and Export with the named component patterns. Show member avatar/search in people dropdown, column/status options, date-range fields and clearable chips; preserve existing query semantics.

- [x] **Step 4: Verify visual states**

Use Pencil screenshots of each Light/Dark frame. Confirm visible chevron, label/placeholder, non-overflowing overlay, active selection and no duplicate/ambiguous controls.

## Task 7: Design Time Tracking flows in Pencil

**Files:**
- Modify: `docs/design/flowboard-v0.1.pen` (Pencil MCP only)

**Interfaces:**
- Consumes: Task 5 screen/interaction contract and Task 6 components.
- Produces: Light/Dark parity for `TTS-01`, `WTL-01/02`, `WTA-01`, `WTR-01`, Task Detail time-log extension and all overlay/permission states.

- [x] **Step 1: Create TTS-01 Project Settings section**

Show Owner-only Time Tracking toggle, two-mode segmented select, numeric backfill select/input constrained 0–31, searchable Editor approver multi-select and non-retroactive warning. Add disabled/forbidden and save/error state.

- [x] **Step 2: Create WTL-01/02 daily workflow**

Design My Work Log day/week view with daily total, per-task entry rows and statuses. Form shows task async select, date picker, duration, description, conditional support-reason error, draft/submit or self-close CTA, late-date error and conflict state.

- [x] **Step 3: Create WTA-01 approval workflow**

Design queue with filters, selected-summary bar, checkbox selection, individual side-panel/modal and bulk confirmation. Make rejection reason required, self-review CTA absent/forbidden and individual failure visible without pretending the full bulk action succeeded.

- [x] **Step 4: Create WTR-01 monthly report**

Design month select, member table with final hours plus self-closed/pending/rejected breakdown, accessible drilldown and permission-specific empty/forbidden state. Do not introduce an export CTA unless a later spec adds time-export.

- [x] **Step 5: Create Dark equivalents and responsive/collapsed shell states**

Copy information architecture, not colors; use Dark tokens, intact sidebar icons and active navigation. Include mobile filter drawer and full-height sheets for daily form/review.

- [x] **Step 6: Verify Pencil integrity**

Query and screenshot new roots. Expected: no placeholder roots, no `NO ICON` nodes, no meaningful text below 11 px, no broken layout/overflow and matching Light/Dark screen IDs.

## Task 8: Final cross-document and visual review

**Files:**
- Modify only files found inconsistent in Tasks 1–7.

**Interfaces:**
- Consumes: all prior contracts and Pencil frames.
- Produces: documentation/design baseline ready for future code implementation, with no commit/push.

- [x] **Step 1: Run terminology and contradiction scan**

Run: `rg -n -i "settings.*name only|Viewer.*write|Time Tracking|WorkLog|Phase 1.3|self-close|requires_approval" docs`

Expected: core-MVP wording is explicitly scoped, Viewer remains read-only and no old statement contradicts the new module.

- [x] **Step 2: Run contract coverage scan**

Check that each spec section maps to at least one product, data, authorization, API, interaction and Pencil artifact. Record any absence as a concrete edit before continuing.

- [x] **Step 3: Run Markdown quality checks**

Run: `$forbidden = @('TO'+'DO', 'TB'+'D', '\[placeholder\]') -join '|'; rg -n -i $forbidden docs/superpowers/specs/2026-09-02-flowboard-time-tracking-design.md docs/superpowers/plans/2026-09-02-flowboard-time-tracking-documentation-and-design.md`

Expected: no placeholders. Then run `git diff --check -- docs`; expected no whitespace errors in tracked content.

- [x] **Step 4: Verify visual evidence**

Take Pencil screenshots for component foundations, Board filter toolbar, WTL-02, WTA-01 and WTR-01 in both Light/Dark. Review selected/open/error/permission states directly; fix actual clipping, contrast or Vietnamese-copy issues before marking checklist items complete.

- [x] **Step 5: Handoff without commit**

Update `pencil-handoff.md` and this plan’s checkboxes only after evidence exists. Report exact changed files, outstanding future scope (timer/payroll/time-export/Viewer write) and confirm no commit or push occurred.
