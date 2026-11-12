import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

// Subscriptions are encrypted with the application's existing server secret.
export const notificationDevices = pgTable(
  "notification_devices",
  {
    id: uuid("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    subscription: text("subscription").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("notification_devices_owner").on(t.ownerId)]
)

// One current alert per enrolled device. Old workflows cannot deliver a newer
// generation, even if cancellation or a workflow start response is lost.
export const timerAlerts = pgTable(
  "timer_alerts",
  {
    deviceId: uuid("device_id")
      .primaryKey()
      .references(() => notificationDevices.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    requestHash: text("request_hash").notNull(),
    timerId: text("timer_id"),
    sessionId: uuid("session_id"),
    deadline: timestamp("deadline", { withTimezone: true }),
    state: text("state").notNull(),
    runId: text("run_id"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("timer_alerts_owner").on(t.ownerId)]
)
