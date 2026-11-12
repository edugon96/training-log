import { randomUUID } from "node:crypto"
import { z } from "zod"
import { start, getRun } from "workflow/api"
import { getPool } from "./db"
import { demand } from "./errors"
import { fingerprint, seal, unseal } from "./security"
import { PushSubscriptionInput, pushConfiguration, sendPush } from "./push"
import { deliverRestTimerAlert } from "../workflows/rest-timer"
import { TimerAlertInput, NotificationDeviceInput } from "../contracts/models"

export { TimerAlertInput } from "../contracts/models"
export type { TimerAlertRequest } from "../contracts/models"
type AlertRow = {
  device_id: string
  owner_id: string
  sequence: string
  request_hash: string
  timer_id: string | null
  session_id: string | null
  deadline: Date | null
  state: string
  run_id: string | null
  subscription?: string
  enabled?: boolean
}

export async function enrollDevice(ownerId: string, input: unknown) {
  demand(
    pushConfiguration().configured,
    503,
    "push_unavailable",
    "Phone notifications are not configured yet"
  )
  const value = NotificationDeviceInput.extend({
    subscription: PushSubscriptionInput,
  }).parse(input)
  const result = await getPool().query(
    `INSERT INTO notification_devices (id, owner_id, subscription, enabled)
     VALUES ($1,$2,$3,true)
     ON CONFLICT (id) DO UPDATE SET subscription=excluded.subscription, enabled=true, updated_at=now()
     WHERE notification_devices.owner_id=excluded.owner_id RETURNING id`,
    [value.deviceId, ownerId, seal(value.subscription)]
  )
  demand(
    result.rowCount,
    409,
    "device_unavailable",
    "This device cannot be enrolled"
  )
  return { deviceId: value.deviceId, enabled: true }
}
export async function deviceStatus(ownerId: string, deviceId: string) {
  z.uuid().parse(deviceId)
  const result = await getPool().query<{ enabled: boolean }>(
    "SELECT enabled FROM notification_devices WHERE id=$1 AND owner_id=$2",
    [deviceId, ownerId]
  )
  return { deviceId, enabled: result.rows[0]?.enabled ?? false }
}
export async function disableDevice(ownerId: string, deviceId: string) {
  z.uuid().parse(deviceId)
  const client = await getPool().connect()
  let runId: string | null = null
  try {
    await client.query("BEGIN")
    await client.query(
      "UPDATE notification_devices SET enabled=false, updated_at=now() WHERE id=$1 AND owner_id=$2",
      [deviceId, ownerId]
    )
    const current = await client.query<{ run_id: string | null }>(
      "UPDATE timer_alerts SET state='cancelled', updated_at=now() WHERE device_id=$1 AND owner_id=$2 RETURNING run_id",
      [deviceId, ownerId]
    )
    runId = current.rows[0]?.run_id ?? null
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
  if (runId)
    await getRun(runId)
      .cancel()
      .catch(() => undefined)
  return { deviceId, enabled: false }
}
export async function scheduleTimerAlert(ownerId: string, input: unknown) {
  demand(
    pushConfiguration().configured,
    503,
    "push_unavailable",
    "Phone notifications are not configured yet"
  )
  const value = TimerAlertInput.parse(input)
  const now = Date.now()
  demand(
    value.deadline === null || value.deadline <= now + 86_400_000,
    422,
    "timer_too_long",
    "Phone alerts support timers up to 24 hours"
  )
  const hash = fingerprint("PUT", "/api/v1/timer-alerts", value)
  const client = await getPool().connect()
  let next: AlertRow
  let oldRun: string | null = null
  try {
    await client.query("BEGIN")
    // A device row serializes timer generations even before its first alert.
    const device = await client.query<{ enabled: boolean }>(
      "SELECT enabled FROM notification_devices WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [value.deviceId, ownerId]
    )
    demand(
      device.rows[0]?.enabled,
      409,
      "notifications_disabled",
      "Enable notifications on this device first"
    )
    if (value.sessionId) {
      const session = await client.query(
        "SELECT 1 FROM workout_sessions WHERE id=$1 AND owner_id=$2",
        [value.sessionId, ownerId]
      )
      demand(session.rowCount, 404, "not_found", "Workout not found")
    }
    const existing = (
      await client.query<AlertRow>(
        "SELECT * FROM timer_alerts WHERE device_id=$1 AND owner_id=$2 FOR UPDATE",
        [value.deviceId, ownerId]
      )
    ).rows[0]
    if (existing && Number(existing.sequence) > value.sequence) {
      await client.query("COMMIT")
      return {
        sequence: Number(existing.sequence),
        state: existing.state,
        superseded: true,
      }
    }
    if (existing && Number(existing.sequence) === value.sequence) {
      demand(
        existing.request_hash === hash,
        409,
        "idempotency_conflict",
        "This timer update was already used"
      )
      next = existing
    } else {
      oldRun = existing?.run_id ?? null
      const state =
        value.deadline === null
          ? "cancelled"
          : value.deadline <= now
            ? "expired"
            : "scheduled"
      next = (
        await client.query<AlertRow>(
          `INSERT INTO timer_alerts (device_id,owner_id,sequence,request_hash,timer_id,session_id,deadline,state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (device_id) DO UPDATE SET sequence=excluded.sequence,request_hash=excluded.request_hash,
         timer_id=excluded.timer_id,session_id=excluded.session_id,deadline=excluded.deadline,state=excluded.state,
         run_id=null,delivered_at=null,updated_at=now() RETURNING *`,
          [
            value.deviceId,
            ownerId,
            value.sequence,
            hash,
            value.timerId,
            value.sessionId,
            value.deadline === null ? null : new Date(value.deadline),
            state,
          ]
        )
      ).rows[0]
    }
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
  if (oldRun)
    await getRun(oldRun)
      .cancel()
      .catch(() => undefined)
  if (next.state === "scheduled" && next.deadline && !next.run_id) {
    // Admission is deliberately outside the DB transaction. If its response is
    // lost a retry may start a second job, but only one can claim this generation.
    const run = await start(deliverRestTimerAlert, [
      ownerId,
      value.deviceId,
      value.sequence,
      next.deadline.getTime(),
    ])
    const acknowledged = await getPool().query(
      "UPDATE timer_alerts SET run_id=$4 WHERE device_id=$1 AND owner_id=$2 AND sequence=$3 AND state='scheduled' AND run_id IS NULL RETURNING device_id",
      [value.deviceId, ownerId, value.sequence, run.runId]
    )
    if (!acknowledged.rowCount)
      await getRun(run.runId)
        .cancel()
        .catch(() => undefined)
  }
  return { sequence: value.sequence, state: next.state, superseded: false }
}

export async function testDeviceNotification(
  ownerId: string,
  deviceId: string
) {
  z.uuid().parse(deviceId)
  const row = (
    await getPool().query<{ subscription: string }>(
      "SELECT subscription FROM notification_devices WHERE id=$1 AND owner_id=$2 AND enabled=true",
      [deviceId, ownerId]
    )
  ).rows[0]
  demand(
    row,
    409,
    "notifications_disabled",
    "Enable notifications on this device first"
  )
  await sendPush(PushSubscriptionInput.parse(unseal(row.subscription)), {
    type: "test",
    ownerId,
    deviceId,
    timerId: randomUUID(),
    sequence: Date.now(),
    deadline: Date.now(),
    url: "/?tab=profile",
  })
  return { sent: true }
}
