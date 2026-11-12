import { describe, expect, it } from "vitest"
import { readStoredRestTimer, writeStoredRestTimer } from "../lib/timer-storage"
import { pauseRest, resetRest, startRest } from "../lib/timers"

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}
describe("rest timer storage", () => {
  it("recovers a still-running standalone timer after session storage is lost", () => {
    const standalone = storage(),
      session = storage()
    const environment = { session, standalone, now: () => 1000 }
    const timer = startRest(30, 1000, null)
    expect(writeStoredRestTimer("owner", timer, environment)).toBe(true)
    expect(
      readStoredRestTimer("owner", { ...environment, session: storage() })
    ).toEqual(timer)
    expect(
      readStoredRestTimer("another-owner", {
        ...environment,
        session: storage(),
      })
    ).toBeNull()
  })
  it("keeps ordinary browser tabs isolated and ignores expired standalone timers", () => {
    const standalone = storage(),
      session = storage(),
      timer = startRest(3, 1000, null)
    writeStoredRestTimer("owner", timer, {
      standalone,
      session,
      now: () => 1000,
    })
    expect(
      readStoredRestTimer("owner", { session: storage(), now: () => 1000 })
    ).toBeNull()
    expect(
      readStoredRestTimer("owner", {
        standalone,
        session: storage(),
        now: () => 4000,
      })
    ).toBeNull()
    expect(readStoredRestTimer("owner", { session, now: () => 2000 })).toEqual(
      timer
    )
  })
  it("restores paused timers and removes standalone recovery on reset, completion or cancellation", () => {
    const standalone = storage(),
      session = storage(),
      timer = startRest(30, 1000, null)
    const environment = { standalone, session, now: () => 2000 }
    const paused = pauseRest(timer, 2000)
    writeStoredRestTimer("owner", paused, environment)
    expect(
      readStoredRestTimer("owner", { ...environment, session: storage() })
    ).toEqual(paused)
    for (const value of [
      resetRest(timer),
      { ...timer, status: "complete" as const, deadline: null, remainingMs: 0 },
      null,
    ]) {
      writeStoredRestTimer("owner", timer, environment)
      writeStoredRestTimer("owner", value, environment)
      expect(
        readStoredRestTimer("owner", { ...environment, session: storage() })
      ).toBeNull()
    }
  })
  it("keeps the session's explicit reset authoritative and tolerates unavailable storage", () => {
    const standalone = storage(),
      session = storage(),
      timer = startRest(30, 1000, null)
    const environment = { standalone, session, now: () => 2000 }
    writeStoredRestTimer("owner", timer, environment)
    const reset = resetRest(timer)
    writeStoredRestTimer("owner", reset, { session, now: () => 2000 })
    expect(readStoredRestTimer("owner", environment)).toEqual(reset)
    expect(readStoredRestTimer("owner", { now: () => 0 })).toBeNull()
    expect(writeStoredRestTimer("owner", timer, { now: () => 0 })).toBe(false)
  })
})
