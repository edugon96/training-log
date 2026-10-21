import { describe, expect, it, vi } from "vitest"
import {
  readDisplayPreference,
  watchScreenAwake,
  type WakeStatus,
} from "../lib/screen-awake"

function environment() {
  let visible = true
  let listener = () => {}
  const statuses: WakeStatus[] = []
  const locks: Array<
    EventTarget & {
      released: boolean
      release: ReturnType<typeof vi.fn<() => Promise<void>>>
    }
  > = []
  const request = vi.fn(async () => {
    const lock = Object.assign(new EventTarget(), {
      released: false,
      release: vi.fn(async () => {
        lock.released = true
        lock.dispatchEvent(new Event("release"))
      }),
    })
    locks.push(lock)
    return lock
  })
  const unsubscribe = vi.fn()
  const port = {
    request,
    isVisible: () => visible,
    subscribe: (callback: () => void) => {
      listener = callback
      return unsubscribe
    },
  }
  return {
    port,
    request,
    statuses,
    locks,
    unsubscribe,
    visibility: (next: boolean) => {
      visible = next
      listener()
    },
    start: () => watchScreenAwake(port, (value) => statuses.push(value)),
  }
}
const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
describe("visible-app wake lock", () => {
  it("defaults on and reads only supported device preference versions", () => {
    for (const value of [
      null,
      "invalid",
      '{"version":2,"keepScreenAwake":false}',
    ])
      expect(readDisplayPreference(value).keepScreenAwake).toBe(true)
    expect(
      readDisplayPreference('{"version":1,"keepScreenAwake":false}')
        .keepScreenAwake
    ).toBe(false)
  })
  it("acquires, releases on hide, reacquires on foreground and cleans up", async () => {
    const env = environment(),
      stop = env.start()
    await tick()
    expect(env.statuses.at(-1)).toBe("active")
    env.visibility(false)
    expect(env.locks[0].release).toHaveBeenCalledTimes(1)
    env.visibility(true)
    await tick()
    expect(env.request).toHaveBeenCalledTimes(2)
    stop()
    expect(env.locks[1].release).toHaveBeenCalledTimes(1)
    expect(env.unsubscribe).toHaveBeenCalledOnce()
  })
  it("does not retry an OS release or rejection until another foreground transition", async () => {
    const env = environment(),
      stop = env.start()
    await tick()
    await env.locks[0].release()
    await tick()
    expect(env.statuses.at(-1)).toBe("released")
    expect(env.request).toHaveBeenCalledTimes(1)
    env.request.mockRejectedValueOnce(new Error("Power saving"))
    env.visibility(false)
    env.visibility(true)
    await tick()
    expect(env.statuses.at(-1)).toBe("unavailable")
    expect(env.request).toHaveBeenCalledTimes(2)
    stop()
  })
  it("deduplicates pending requests and releases a late acquisition after disable", async () => {
    const env = environment()
    const original = env.request.getMockImplementation()!
    let resolve!: (lock: Awaited<ReturnType<typeof original>>) => void
    env.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const stop = env.start()
    env.visibility(true)
    env.visibility(true)
    expect(env.request).toHaveBeenCalledOnce()
    stop()
    const lock = await original()
    resolve(lock)
    await tick()
    expect(lock.release).toHaveBeenCalledOnce()
    expect(env.statuses).not.toContain("active")
  })
  it("gracefully reports missing browser support", () => {
    const statuses: WakeStatus[] = []
    const stop = watchScreenAwake(
      { request: undefined, isVisible: () => true, subscribe: () => () => {} },
      (value) => statuses.push(value)
    )
    expect(statuses).toEqual(["unavailable"])
    stop()
  })
})
