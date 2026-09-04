-- M3 — board_columns và activity_logs.
--
-- File này được **sửa tay** sau khi drizzle-kit sinh ra, ở đúng một chỗ:
-- constraint `board_columns_project_position_uniq` phải là
-- `DEFERRABLE INITIALLY IMMEDIATE`, và Drizzle không khai được thuộc tính đó.
--
-- Vì sao không dùng `CREATE UNIQUE INDEX`: PostgreSQL chỉ cho phép `DEFERRABLE`
-- trên **constraint**; một unique index không bao giờ deferrable được. Vì vậy
-- schema khai `unique()` chứ không phải `uniqueIndex()`.
--
-- Vì sao cần defer (ADR-0006 mục 3): rebalance ghi lại position của N row trong
-- một transaction, và với giá trị hiện hành tuỳ ý không tồn tại thứ tự update
-- đơn giản nào tránh được trùng ở **mọi** bước trung gian. `INITIALLY IMMEDIATE`
-- nghĩa là mặc định vẫn kiểm ngay như một unique thường; chỉ transaction
-- rebalance chạy `SET CONSTRAINTS ... DEFERRED`.
--
-- Lưu ý cho lần chạy `drizzle-kit generate` sau: snapshot của Drizzle **không**
-- ghi lại thuộc tính DEFERRABLE, nên nó cũng không diff và không drop nó. Nhưng
-- nếu ai đó xoá rồi tạo lại constraint này qua Drizzle, thuộc tính sẽ mất im
-- lặng — và test `DEFERRABLE thật sự cần thiết` là thứ bắt được điều đó.

CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"requires_reviewer" boolean DEFAULT false NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"position" numeric(20, 10) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_columns_project_id_uniq" UNIQUE("project_id","id")
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_project_created_at_idx" ON "activity_logs" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_logs_project_task_created_at_idx" ON "activity_logs" USING btree ("project_id","task_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "board_columns_project_position_idx" ON "board_columns" USING btree ("project_id","position");--> statement-breakpoint
-- Sửa tay: DEFERRABLE INITIALLY IMMEDIATE (xem chú thích đầu file).
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_project_position_uniq"
  UNIQUE ("project_id", "position") DEFERRABLE INITIALLY IMMEDIATE;