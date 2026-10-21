CREATE TABLE "timer_settings" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"data" jsonb NOT NULL
);
