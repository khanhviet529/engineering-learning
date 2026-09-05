-- M4 — tasks, comments, tìm kiếm không dấu, và FK còn nợ của activity_logs.
--
-- File này được **sửa tay** sau khi drizzle-kit sinh ra, ở bốn chỗ. Cả bốn đều
-- là thứ Drizzle không khai được, không phải sở thích:
--
-- 1. `CREATE EXTENSION unaccent` và hàm `fb_unaccent(text)` — phải chạy **trước**
--    GIN index vì index tham chiếu tới hàm.
-- 2. `tasks_project_column_position_uniq` phải `DEFERRABLE INITIALLY IMMEDIATE`;
--    nó được gỡ khỏi `CREATE TABLE` và thêm lại ở cuối. PostgreSQL chỉ cho phép
--    `DEFERRABLE` trên **constraint**, nên schema khai `unique()` chứ không phải
--    `uniqueIndex()`.
-- 3. GIN index trên biểu thức full-text — Drizzle không khai được index biểu thức.
-- 4. `activity_logs.task_id` nhận foreign key: M3 tạo cột nullable **không** FK
--    vì `tasks` chưa tồn tại. Mọi event của M3 để cột đó `NULL` nên không có
--    dòng nào phải backfill trước khi thêm constraint.
--
-- Lưu ý cho lần `drizzle-kit generate` sau: snapshot của Drizzle **không** ghi
-- lại `DEFERRABLE`, extension, function hay index biểu thức. Nó cũng không diff
-- và không drop chúng — nhưng nếu ai đó xoá rồi tạo lại constraint qua Drizzle
-- thì thuộc tính `DEFERRABLE` mất im lặng, và test "DEFERRABLE thật sự cần
-- thiết" là thứ bắt được điều đó.

--> statement-breakpoint
-- Sửa tay 1/4: extension và hàm bọc, phải có trước GIN index.
-- Bẫy bắt buộc biết: `unaccent()` là `STABLE` (dictionary có thể đổi), nên
-- PostgreSQL **từ chối** dùng nó trực tiếp trong expression index — index yêu
-- cầu `IMMUTABLE`. Wrapper dưới đây khai `IMMUTABLE PARALLEL SAFE` và **chỉ định
-- tường minh dictionary**; khai IMMUTABLE an toàn vì dictionary được ghim làm
-- hợp đồng. Đổi dictionary thì phải REINDEX trong cùng migration.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE OR REPLACE FUNCTION fb_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;--> statement-breakpoint

CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"column_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"assignee_id" uuid,
	"reviewer_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text,
	"priority" text DEFAULT 'none' NOT NULL,
	"position" numeric(20, 10) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"start_date" date,
	"due_date" date,
	"evidence_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_project_id_uniq" UNIQUE("project_id","id"),
	CONSTRAINT "tasks_category_check" CHECK ("tasks"."category" is null or "tasks"."category" in ('feature', 'bug', 'design', 'research', 'operations', 'other')),
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" in ('none', 'low', 'medium', 'high', 'urgent')),
	CONSTRAINT "tasks_version_check" CHECK ("tasks"."version" > 0),
	CONSTRAINT "tasks_date_order_check" CHECK ("tasks"."start_date" is null or "tasks"."due_date" is null or "tasks"."start_date" <= "tasks"."due_date"),
	CONSTRAINT "tasks_reviewer_not_assignee_check" CHECK ("tasks"."reviewer_id" is null or "tasks"."assignee_id" is null or "tasks"."reviewer_id" <> "tasks"."assignee_id")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_column_fk" FOREIGN KEY ("project_id","column_id") REFERENCES "public"."board_columns"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_assignee_fk" FOREIGN KEY ("project_id","assignee_id") REFERENCES "public"."project_members"("project_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_reviewer_fk" FOREIGN KEY ("project_id","reviewer_id") REFERENCES "public"."project_members"("project_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_task_created_at_idx" ON "comments" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "tasks_project_created_at_idx" ON "tasks" USING btree ("project_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tasks_project_due_date_idx" ON "tasks" USING btree ("project_id","due_date","id");--> statement-breakpoint
CREATE INDEX "tasks_project_updated_at_idx" ON "tasks" USING btree ("project_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tasks_project_assignee_updated_at_idx" ON "tasks" USING btree ("project_id","assignee_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tasks_project_created_by_updated_at_idx" ON "tasks" USING btree ("project_id","created_by_user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tasks_project_reviewer_updated_at_idx" ON "tasks" USING btree ("project_id","reviewer_id","updated_at" DESC NULLS LAST);--> statement-breakpoint

-- Sửa tay 2/4: DEFERRABLE INITIALLY IMMEDIATE (xem chú thích đầu file).
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_column_position_uniq"
  UNIQUE ("project_id", "column_id", "position") DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint

-- Sửa tay 3/4: GIN full-text, **đối xứng dấu cả hai phía**.
--
-- Index unaccent mà query không unaccent (hoặc ngược lại) thì `thiet ke` không
-- khớp `thiết kế`. Người Việt gõ không dấu thường xuyên, nên đây là yêu cầu UX
-- chứ không phải tối ưu — và nó chỉ đúng khi *cả hai* phía dùng cùng `fb_unaccent`.
--
-- `'simple'` chứ không phải một cấu hình ngôn ngữ: không có stemmer tiếng Việt,
-- và stemmer tiếng Anh sẽ cắt sai từ tiếng Việt đã bỏ dấu.
CREATE INDEX "tasks_search_idx" ON "tasks"
  USING gin (to_tsvector('simple', fb_unaccent("title" || ' ' || "description")));--> statement-breakpoint

-- Sửa tay 4/4: FK mà M3 còn nợ.
--
-- M3 tạo `activity_logs.task_id` nullable và **không** FK vì `tasks` chưa tồn
-- tại. `RESTRICT` đúng quy ước chung: core MVP không cascade dữ liệu audit —
-- xoá một task khi còn lịch sử phải là quyết định tường minh của use case.
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_task_id_tasks_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;
