CREATE TABLE "deleted_records" (
	"owner_id" text NOT NULL,
	"resource" text NOT NULL,
	"id" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deleted_records_owner_id_resource_id_pk" PRIMARY KEY("owner_id","resource","id")
);
