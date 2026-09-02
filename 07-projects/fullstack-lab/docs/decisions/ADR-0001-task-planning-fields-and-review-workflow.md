# ADR-0001: Task planning fields and review workflow

- Status: Accepted
- Date: 2026-09-02

## Context

Pencil review exposed a contract gap: the MVP UI needs planning metadata, clear overdue behavior, and an optional review handoff, while the previous baseline only defined priority and one due date.

## Decision

Core MVP Task has optional `category`, `start_date`, `due_date`, and `reviewer_id`, plus non-null `created_by_user_id`. `priority` is one of `none`, `low`, `medium`, `high`, `urgent`; `category` is one of `feature`, `bug`, `design`, `research`, `operations`, `other`.

`due_state` is never persisted. The server derives `none`, `scheduled`, `due_soon`, `due_today`, or `overdue` from the workspace-local current date, dates, and whether the task is in a terminal column. A terminal task is never overdue.

An Owner may mark a board column `requires_reviewer`. Only when moving into such a column does the client require `reviewerId`; the server requires that reviewer to be a project member different from the assignee. Review is not globally mandatory and no custom role is introduced.

The creation form has no persisted “save draft” feature in MVP. Dirty-form protection remains local confirmation on close/navigation.

## Consequences

Database, task projections, create/update/move contracts, query allowlists, validation, Pencil, and user guidance must change together. Attachments, subtasks, dependencies, custom labels, custom fields, recurrence, and notifications remain outside MVP.
