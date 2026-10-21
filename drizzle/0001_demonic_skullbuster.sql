CREATE TABLE "training_defaults" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"targets" jsonb NOT NULL
);
