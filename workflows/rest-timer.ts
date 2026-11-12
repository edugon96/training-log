import { sleep, RetryableError, FatalError } from "workflow"
import { deliverTimerGeneration } from "../server/timer-alert-delivery"
import { pushStatus } from "../server/push"

async function deliver(ownerId: string, deviceId: string, sequence: number) {
  "use step"
  console.info("Rest timer notification delivery", { sequence })
  try {
    const result = await deliverTimerGeneration(ownerId, deviceId, sequence)
    if (result === "early")
      throw new RetryableError("Timer deadline has not arrived", {
        retryAfter: "1s",
      })
    console.info("Rest timer notification result", { result, sequence })
    return result
  } catch (error) {
    if (error instanceof RetryableError) throw error
    const status = pushStatus(error)
    if (status && status >= 400 && status < 500 && status !== 429)
      throw new FatalError("Notification provider rejected this alert")
    throw new RetryableError(
      "Notification delivery is temporarily unavailable",
      { retryAfter: "2s" }
    )
  }
}
deliver.maxRetries = 5

export async function deliverRestTimerAlert(
  ownerId: string,
  deviceId: string,
  sequence: number,
  deadline: number
) {
  "use workflow"
  await sleep(new Date(deadline))
  return deliver(ownerId, deviceId, sequence)
}
