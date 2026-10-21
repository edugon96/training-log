CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"revision" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"revision" integer NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_muscles" (
	"exercise_id" uuid NOT NULL,
	"muscle" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "exercise_muscles_exercise_id_muscle_role_pk" PRIMARY KEY("exercise_id","muscle","role")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"revision" integer NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_sources" (
	"owner_id" text NOT NULL,
	"file" text NOT NULL,
	"sha256" text NOT NULL,
	"notes" text NOT NULL,
	CONSTRAINT "import_sources_owner_id_file_sha256_pk" PRIMARY KEY("owner_id","file","sha256")
);
--> statement-breakpoint
CREATE TABLE "mutation_receipts" (
	"owner_id" text NOT NULL,
	"key" text NOT NULL,
	"hash" text NOT NULL,
	"response" text NOT NULL,
	"status" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_receipts_owner_id_key_pk" PRIMARY KEY("owner_id","key")
);
--> statement-breakpoint
CREATE TABLE "result_sets" (
	"id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"target_id" uuid,
	"status" text NOT NULL,
	"reps" double precision,
	"data" jsonb NOT NULL,
	CONSTRAINT "result_sets_session_id_id_pk" PRIMARY KEY("session_id","id")
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"revision" integer NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"revision" integer NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"revision" integer NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_sets" ADD CONSTRAINT "result_sets_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_owner" ON "audit_events" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "equipment_owner" ON "equipment" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "exercises_owner" ON "exercises" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "result_owner" ON "result_sets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "sessions_owner" ON "workout_sessions" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "weeks_owner" ON "weeks" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "workouts_owner" ON "workouts" USING btree ("owner_id");