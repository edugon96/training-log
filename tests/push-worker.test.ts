import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { expect, test, vi } from "vitest"

function worker(visible: boolean | null) {
  const handlers = new Map<string, (event: unknown) => void>()
  const showNotification = vi.fn(async () => undefined)
  const client = {
    visibilityState: "visible",
    postMessage: vi.fn((data, ports) =>
      ports[0].postMessage({
        silent:
          visible === true &&
          data.ownerId === "owner" &&
          data.deviceId === "device",
      })
    ),
  }
  const self = {
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      handlers.set(type, handler),
    clients: {
      matchAll: vi.fn(async () => (visible === null ? [] : [client])),
    },
    registration: { showNotification },
    location: { origin: "https://training.example" },
  }
  runInNewContext(
    readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"),
    { self, MessageChannel, setTimeout, clearTimeout, URL }
  )
  return {
    showNotification,
    async push(payload: unknown) {
      let finished!: Promise<unknown>
      handlers.get("push")!({
        data: { json: () => payload },
        waitUntil: (value: Promise<unknown>) => {
          finished = value
        },
      })
      await finished
    },
  }
}
test("foreground end notifications stay visible and silent for the matching owner and device", async () => {
  const sw = worker(true)
  await sw.push({
    ownerId: "owner",
    deviceId: "device",
    sequence: 1,
    type: "rest-timer",
    url: "/?tab=week",
  })
  expect(sw.showNotification).toHaveBeenCalledWith(
    "Rest complete",
    expect.objectContaining({
      silent: true,
      renotify: false,
      tag: "training-rest-device-1",
    })
  )
})
test("background and unmatched-owner pushes use the phone notification sound", async () => {
  for (const foreground of [false, null]) {
    const sw = worker(foreground)
    await sw.push({ ownerId: "owner", deviceId: "device", sequence: 1 })
    expect(sw.showNotification).toHaveBeenCalledWith(
      "Rest complete",
      expect.objectContaining({ silent: false })
    )
  }
  const sw = worker(true)
  await sw.push({ ownerId: "other", deviceId: "device", sequence: 1 })
  expect(sw.showNotification).toHaveBeenCalledWith(
    "Rest complete",
    expect.objectContaining({ silent: false })
  )
})
test("every received push displays, including duplicate and stale payloads required by iOS", async () => {
  const sw = worker(null)
  const payload = {
    ownerId: "owner",
    deviceId: "device",
    sequence: 1,
    deadline: 1,
  }
  await sw.push(payload)
  await sw.push(payload)
  expect(sw.showNotification).toHaveBeenCalledTimes(2)
  expect(sw.showNotification.mock.calls[0]).toEqual(
    sw.showNotification.mock.calls[1]
  )
})
