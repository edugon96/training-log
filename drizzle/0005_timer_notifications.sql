CREATE TABLE "notification_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"subscription" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timer_alerts" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"request_hash" text NOT NULL,
	"timer_id" text,
	"session_id" uuid,
	"deadline" timestamp with time zone,
	"state" text NOT NULL,
	"run_id" text,
	"delivered_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "timer_alerts" ADD CONSTRAINT "timer_alerts_device_id_notification_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."notification_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_devices_owner" ON "notification_devices" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "timer_alerts_owner" ON "timer_alerts" USING btree ("owner_id");