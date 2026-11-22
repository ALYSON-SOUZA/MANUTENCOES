CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_name" text NOT NULL,
	"is_master" boolean DEFAULT false NOT NULL,
	"action" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_number" text NOT NULL,
	"category" text NOT NULL,
	"asset_name" text NOT NULL,
	"type" text NOT NULL,
	"performed_date" text NOT NULL,
	"next_date" text DEFAULT '' NOT NULL,
	"warranty_days" text DEFAULT '' NOT NULL,
	"warranty_end_date" text DEFAULT '' NOT NULL,
	"value" double precision DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_by_master" boolean DEFAULT false NOT NULL,
	"updated_by" text NOT NULL,
	"updated_by_master" boolean DEFAULT false NOT NULL,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"cpf" text DEFAULT '' NOT NULL,
	"is_master" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;