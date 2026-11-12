import { getPool } from "./db"
import { unseal } from "./security"
import {
  ALERT_LIFETIME_MS,
  PushSubscriptionInput,
  pushStatus,
  sendPush,
} from "./push"
type AlertRow = {
  sequence: string
  timer_id: string | null
  session_id: string | null
  deadline: Date | null
  state: string
}

export async function deliverTimerGeneration(
  ownerId: string,
  deviceId: string,
  sequence: number,
  atTime?: number
) {
  const client = await getPool().connect()
  try {
    await client.query("BEGIN")
    // All mutations lock the device before its alert, so cancellation and delivery
    // have a single, consistent ordering without deadlocking one another.
    const device = (
      await client.query<{ subscription: string; enabled: boolean }>(
        "SELECT subscription,enabled FROM notification_devices WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [deviceId, ownerId]
      )
    ).rows[0]
    const row = (
      await client.query<AlertRow>(
        "SELECT * FROM timer_alerts WHERE device_id=$1 AND owner_id=$2 FOR UPDATE",
        [deviceId, ownerId]
      )
    ).rows[0]
    if (
      !row ||
      Number(row.sequence) !== sequence ||
      row.state !== "scheduled" ||
      !device?.enabled ||
      !row.deadline
    ) {
      await client.query("COMMIT")
      return "superseded"
    }
    const deadline = row.deadline.getTime()
    if (row.session_id) {
      const active = await client.query(
        "SELECT 1 FROM workout_sessions WHERE id=$1 AND owner_id=$2 AND data->>'status'='active'",
        [row.session_id, ownerId]
      )
      if (!active.rowCount) {
        await client.query(
          "UPDATE timer_alerts SET state='cancelled',updated_at=now() WHERE device_id=$1",
          [deviceId]
        )
        await client.query("COMMIT")
        return "workout-ended"
      }
    }
    const now = atTime ?? Date.now()
    if (now < deadline) {
      await client.query("ROLLBACK")
      return "early"
    }
    if (now >= deadline + ALERT_LIFETIME_MS) {
      await client.query(
        "UPDATE timer_alerts SET state='expired',updated_at=now() WHERE device_id=$1",
        [deviceId]
      )
      await client.query("COMMIT")
      return "expired"
    }
    const subscription = PushSubscriptionInput.parse(
      unseal(device.subscription)
    )
    try {
      // Hold only the narrow device/alert locks during the bounded push request.
      // An accepted cancel supersedes delivery. An already-sent push is final.
      await sendPush(
        subscription,
        {
          type: "rest-timer",
          ownerId,
          deviceId,
          timerId: row.timer_id!,
          sequence,
          deadline,
          url: row.session_id
            ? `/?tab=week&session=${row.session_id}`
            : "/?tab=week",
        },
        now
      )
    } catch (error) {
      if ([404, 410].includes(pushStatus(error) ?? 0)) {
        await client.query(
          "UPDATE notification_devices SET enabled=false,updated_at=now() WHERE id=$1",
          [deviceId]
        )
        await client.query(
          "UPDATE timer_alerts SET state='cancelled',updated_at=now() WHERE device_id=$1",
          [deviceId]
        )
        await client.query("COMMIT")
        return "subscription-expired"
      }
      throw error
    }
    await client.query(
      "UPDATE timer_alerts SET state='delivered',delivered_at=now(),updated_at=now() WHERE device_id=$1",
      [deviceId]
    )
    await client.query("COMMIT")
    return "delivered"
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
