CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "workspace_invitations_role_check" CHECK ("workspace_invitations"."role" in ('workspace_admin', 'workspace_member')),
	CONSTRAINT "workspace_invitations_status_check" CHECK ("workspace_invitations"."status" in ('pending', 'accepted', 'revoked')),
	CONSTRAINT "workspace_invitations_accepted_at_check" CHECK (("workspace_invitations"."status" = 'accepted') = ("workspace_invitations"."accepted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_pending_uniq" ON "workspace_invitations" USING btree ("workspace_id","email") WHERE "workspace_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "workspace_invitations_workspace_created_at_idx" ON "workspace_invitations" USING btree ("workspace_id","created_at" DESC NULLS LAST);