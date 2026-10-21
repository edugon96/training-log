import { and, eq } from "drizzle-orm"
import { TimerSettings, defaultTimerSettings } from "../contracts/models"
import type { Store } from "./db"
import type { Actor } from "./security"
import { demand } from "./errors"
import { timerSettings } from "./schema"
import { recordAudit } from "./repository"

export async function storedTimerSettings(db: Store, ownerId: string) {
  const [row] = await db
    .select()
    .from(timerSettings)
    .where(eq(timerSettings.ownerId, ownerId))
  return row?.data ?? null
}
export async function getTimerSettings(db: Store, ownerId: string) {
  return (
    (await storedTimerSettings(db, ownerId)) ??
    structuredClone(defaultTimerSettings)
  )
}
export async function saveTimerSettings(
  db: Store,
  actor: Actor,
  input: unknown,
  expectedRevision: number
) {
  const value = TimerSettings.parse(input)
  demand(
    new Set(value.presets).size === value.presets.length,
    422,
    "duplicate_preset",
    "Choose distinct preset durations"
  )
  const current = await getTimerSettings(db, actor.ownerId)
  demand(
    current.revision === expectedRevision &&
      value.revision === expectedRevision,
    409,
    "revision_conflict",
    "Timer settings changed elsewhere",
    { current }
  )
  const next = { ...value, revision: expectedRevision + 1 }
  const saved =
    expectedRevision === 0
      ? await db
          .insert(timerSettings)
          .values({
            ownerId: actor.ownerId,
            revision: next.revision,
            data: next,
          })
          .onConflictDoNothing()
          .returning()
      : await db
          .update(timerSettings)
          .set({ revision: next.revision, data: next })
          .where(
            and(
              eq(timerSettings.ownerId, actor.ownerId),
              eq(timerSettings.revision, expectedRevision)
            )
          )
          .returning()
  demand(
    saved.length,
    409,
    "revision_conflict",
    "Timer settings changed elsewhere",
    { current: await getTimerSettings(db, actor.ownerId) }
  )
  await recordAudit(
    db,
    actor,
    expectedRevision ? "updated" : "created",
    "timer_settings",
    actor.ownerId,
    next.revision
  )
  return next
}
