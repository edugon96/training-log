import { test, expect } from "@playwright/test"
import { betterAuth } from "better-auth"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { authOptions } from "../../server/auth"
import { getPool } from "../../server/db"
import { signInPage } from "./auth-helper"

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})
let identity: { id: string; email: string; password: string }
test.beforeAll(async () => {
  const email = `timer-lifecycle-${randomUUID()}@example.test`
  const password = randomUUID() + randomUUID()
  const account = await betterAuth(authOptions(true)).api.signUpEmail({
    body: { email, password, name: "Timer Lifecycle" },
  })
  identity = { id: account.user.id, email, password }
})
test.afterAll(async () => {
  if (!identity) return
  await getPool().query('DELETE FROM "timer_settings" WHERE owner_id = $1', [
    identity.id,
  ])
  await getPool().query('DELETE FROM "user" WHERE id = $1', [identity.id])
})

type AudioLog = {
  contexts: number
  tones: { durationMs: number; at: number; stops: number[] }[]
}
const sounds = JSON.parse(
  readFileSync(
    new URL("../../public/audio/timer/crisp-v1/manifest.json", import.meta.url),
    "utf8"
  )
).assets as Record<string, { duration: number }>
const duration = (name: string) => Math.round(sounds[name].duration * 1000)

function observeAudio() {
  const log: AudioLog = { contexts: 0, tones: [] }
  Object.assign(window, { __timerAudio: log })
  const NativeAudioContext = window.AudioContext
  class ObservedAudioContext extends NativeAudioContext {
    constructor() {
      super()
      log.contexts++
    }
    createBufferSource() {
      const node = super.createBufferSource()
      const start = node.start.bind(node),
        stop = node.stop.bind(node)
      const tone: AudioLog["tones"][number] = {
        durationMs: 0,
        at: 0,
        stops: [],
      }
      node.start = (when = 0) => {
        Object.assign(tone, {
          durationMs: Math.round((node.buffer?.duration ?? 0) * 1000),
          at: Date.now() + (when - this.currentTime) * 1000,
        })
        log.tones.push(tone)
        start(when)
      }
      node.stop = (when = 0) => {
        tone.stops.push(when)
        stop(when)
      }
      return node
    }
  }
  window.AudioContext = ObservedAudioContext
}

// Observe native browser Web Audio scheduling. This does not prove speaker output
// or iPhone audio-session behavior, which still require a physical-device check.
test("rest timer schedules native cues and cancels them across controls and reload", async ({
  page,
}) => {
  await page.addInitScript(observeAudio)
  await page.addInitScript((ownerId) => {
    const key = `training-rest:${ownerId}`
    if (!sessionStorage.getItem(key))
      sessionStorage.setItem(
        key,
        JSON.stringify({
          id: "audio-lifecycle",
          sessionId: null,
          durationMs: 10000,
          remainingMs: 10000,
          deadline: null,
          status: "paused",
        })
      )
  }, identity.id)
  const log = () =>
    page.evaluate((tickDuration) => {
      const log = (window as unknown as { __timerAudio: AudioLog }).__timerAudio
      return {
        ...log,
        tones: log.tones.filter((tone) => tone.durationMs !== tickDuration),
      }
    }, duration("tick"))
  const readTimer = () =>
    page.evaluate(
      (id) => JSON.parse(sessionStorage.getItem(`training-rest:${id}`)!),
      identity.id
    )
  await signInPage(page, identity.email, identity.password)
  await page.getByRole("button", { name: "Open running rest timer" }).click()
  expect((await log()).contexts).toBe(0)
  await page
    .getByRole("button", { name: "Resume rest timer", exact: true })
    .click()
  await expect.poll(async () => (await log()).tones.length).toBe(5)
  const running = await readTimer(),
    scheduled = (await log()).tones.filter(
      (tone) => tone.durationMs !== duration("start")
    )
  expect(scheduled.map((tone) => tone.durationMs)).toEqual([
    duration("countdown"),
    duration("countdown"),
    duration("countdown"),
    duration("finish"),
  ])
  expect(
    (await log()).tones.filter((tone) => tone.durationMs === duration("start"))
  ).toHaveLength(1)
  for (const [index, tone] of scheduled.entries())
    expect(
      Math.abs(tone.at - (running.deadline - (3 - index) * 1000))
    ).toBeLessThan(100)
  await page
    .getByRole("button", { name: "Pause rest timer", exact: true })
    .click()
  expect((await log()).tones.every((tone) => tone.stops.at(-1) === 0)).toBe(
    true
  )
  await page
    .getByRole("button", { name: "Add 30 seconds", exact: true })
    .click()
  expect((await readTimer()).status).toBe("paused")
  expect((await log()).tones).toHaveLength(5)
  await page
    .getByRole("button", { name: "Resume rest timer", exact: true })
    .click()
  await expect.poll(async () => (await log()).tones.length).toBe(10)
  await page
    .getByRole("button", { name: "Reset rest timer", exact: true })
    .click()
  expect((await log()).tones.every((tone) => tone.stops.at(-1) === 0)).toBe(
    true
  )
  await page.getByRole("button", { name: "Custom", exact: true }).click()
  const ruler = page.getByRole("slider", { name: "Custom duration" })
  await ruler.focus()
  await ruler.press("Home")
  await ruler.press("ArrowRight")
  await ruler.press("ArrowRight")
  await expect(ruler).toHaveAttribute("aria-valuenow", "3")
  await page
    .getByRole("button", { name: "Start rest timer", exact: true })
    .click()
  await expect.poll(async () => (await log()).tones.length).toBe(15)
  await expect(page.locator(".timer-face")).toHaveClass(/is-complete/, {
    timeout: 5000,
  })
  expect(
    (await log()).tones
      .filter((tone) => tone.durationMs === duration("finish"))
      .at(-1)!.stops
  ).toHaveLength(1)
  const startsBeforePreset = (await log()).tones.filter(
    (tone) => tone.durationMs === duration("start")
  ).length
  await page.getByRole("button", { name: "1:00", exact: true }).click()
  await expect
    .poll(
      async () =>
        (await log()).tones.filter(
          (tone) => tone.durationMs === duration("start")
        ).length
    )
    .toBe(startsBeforePreset + 1)
  await page.reload()
  await page.getByRole("button", { name: "Open running rest timer" }).waitFor()
  expect((await log()).contexts).toBe(0)
  await page.getByRole("button", { name: "Open running rest timer" }).click()
  await expect.poll(async () => (await log()).tones.length).toBe(4)
  await page
    .getByRole("button", { name: "Reset rest timer", exact: true })
    .click()
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Profile", exact: true })
    .click()
  await page.getByRole("button", { name: "Test sound", exact: true }).click()
  await expect.poll(async () => (await log()).tones.length).toBe(9)
  expect((await log()).tones.slice(-5).map((tone) => tone.durationMs)).toEqual([
    duration("start"),
    duration("countdown"),
    duration("countdown"),
    duration("countdown"),
    duration("finish"),
  ])
  expect((await readTimer()).status).toBe("idle")
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page
    .getByRole("button", { name: "Test sound", exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({
    path: test.info().outputPath("timer-alert-settings-mobile.png"),
  })
})

test("Crisp selector feedback works offline, stays quiet at boundaries and respects saved mute", async ({
  page,
  context,
}) => {
  await page.addInitScript(observeAudio)
  await signInPage(page, identity.email, identity.password)
  await page.evaluate(
    (ownerId) =>
      sessionStorage.setItem(
        `training-rest:${ownerId}`,
        JSON.stringify({
          id: "selector-audio",
          sessionId: null,
          durationMs: 60000,
          remainingMs: 60000,
          deadline: null,
          status: "paused",
        })
      ),
    identity.id
  )
  await page.reload()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true)
  const assets = Object.keys(sounds).map(
    (name) => `/audio/timer/crisp-v1/${name}.wav`
  )
  await expect
    .poll(() =>
      page.evaluate(
        async (paths) =>
          (await Promise.all(paths.map((path) => caches.match(path)))).every(
            Boolean
          ),
        assets
      )
    )
    .toBe(true)
  await context.setOffline(true)
  await page.reload()
  await page.getByRole("button", { name: "Open running rest timer" }).click()
  await page.getByRole("button", { name: "Custom", exact: true }).click()
  const ruler = page.getByRole("slider", { name: "Custom duration" })
  const tones = () =>
    page.evaluate(
      () => (window as unknown as { __timerAudio: AudioLog }).__timerAudio.tones
    )
  const ticks = async () =>
    (await tones()).filter((tone) => tone.durationMs === duration("tick"))
      .length
  await expect
    .poll(async () => {
      await ruler.press("ArrowRight")
      return ticks()
    })
    .toBeGreaterThan(0)
  await ruler.press("End")
  await expect(ruler).toHaveAttribute("aria-valuenow", "3600")
  const atEnd = await ticks()
  await ruler.press("ArrowRight")
  await ruler.press("End")
  expect(await ticks()).toBe(atEnd)
  await page.waitForTimeout(70)
  await ruler.dispatchEvent("wheel", { deltaY: -8 })
  await expect(ruler).toHaveAttribute("aria-valuenow", "3599")
  expect(await ticks()).toBe(atEnd + 1)
  await page.getByRole("button", { name: "1:00", exact: true }).click()
  await expect
    .poll(
      async () =>
        (await tones()).filter((tone) => tone.durationMs === duration("start"))
          .length
    )
    .toBe(1)
  expect(
    (await tones()).filter((tone) => tone.durationMs === duration("countdown"))
  ).toHaveLength(3)
  expect(
    (await tones()).filter((tone) => tone.durationMs === duration("finish"))
  ).toHaveLength(1)
  await context.setOffline(false)
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Profile", exact: true })
    .click()
  const mute = page.getByLabel("Timer sounds", { exact: true })
  await expect(mute).toBeEnabled()
  await mute.click()
  await expect(mute).not.toBeChecked()
  await page.reload()
  const afterReload = await tones()
  await page.getByRole("button", { name: "Open running rest timer" }).click()
  await page.getByRole("button", { name: "Custom", exact: true }).click()
  await ruler.press("ArrowRight")
  await page.getByRole("button", { name: "1:00", exact: true }).click()
  expect(await tones()).toEqual(afterReload)
  await page
    .getByRole("button", { name: "Reset rest timer", exact: true })
    .click()
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Profile", exact: true })
    .click()
  await page.getByLabel("Timer sounds", { exact: true }).click()
  await expect(page.getByLabel("Timer sounds", { exact: true })).toBeChecked()
})

test("wake lock recovers on foreground lifecycle and interaction after a bounded retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let held:
      | (EventTarget & { released: boolean; release: () => Promise<void> })
      | undefined
    const state = {
      requests: 0,
      release: async () => {
        await held?.release()
      },
    }
    Object.assign(window, { __wakeLifecycle: state })
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          state.requests++
          const lock = Object.assign(new EventTarget(), {
            released: false,
            release: async () => {
              lock.released = true
              lock.dispatchEvent(new Event("release"))
            },
          })
          held = lock
          return lock
        },
      },
    })
  })
  const requests = () =>
    page.evaluate(
      () =>
        (window as unknown as { __wakeLifecycle: { requests: number } })
          .__wakeLifecycle.requests
    )
  const release = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          __wakeLifecycle: { release: () => Promise<void> }
        }
      ).__wakeLifecycle.release()
    )
  await signInPage(page, identity.email, identity.password)
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" })
  ).toBeVisible()
  await expect.poll(requests).toBeGreaterThan(0)
  // Development Strict Mode deliberately mounts and cleans up effects twice.
  const baseline = await requests()
  await release()
  await expect.poll(requests).toBe(baseline + 1)
  await release()
  await page.waitForTimeout(1300)
  expect(await requests()).toBe(baseline + 1)
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow"))
  )
  await expect.poll(requests).toBe(baseline + 2)
  await release()
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect.poll(requests).toBe(baseline + 3)
  await release()
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Profile", exact: true })
    .click()
  await expect.poll(requests).toBe(baseline + 4)
  await page.getByLabel("Keep screen awake", { exact: true }).uncheck()
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  expect(await requests()).toBe(baseline + 4)
})

test("Home Screen relaunch recovers the same timer and clears canceled or expired recovery", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: true,
    })
  })
  await signInPage(page, identity.email, identity.password)
  await page.evaluate(
    (ownerId) =>
      sessionStorage.setItem(
        `training-rest:${ownerId}`,
        JSON.stringify({
          id: "standalone-recovery",
          sessionId: null,
          durationMs: 120000,
          remainingMs: 120000,
          deadline: null,
          status: "paused",
        })
      ),
    identity.id
  )
  await page.reload()
  await page.getByRole("button", { name: "Open running rest timer" }).click()
  await page
    .getByRole("button", { name: "Resume rest timer", exact: true })
    .click()
  const saved = await page.evaluate(
    (ownerId) =>
      JSON.parse(localStorage.getItem(`training-rest-standalone:${ownerId}`)!),
    identity.id
  )
  expect(saved.status).toBe("running")
  const relaunched = await context.newPage()
  await page.close()
  await relaunched.goto("/")
  await expect(
    relaunched.getByRole("button", { name: "Open running rest timer" })
  ).toBeVisible()
  const recovered = await relaunched.evaluate(
    (ownerId) =>
      JSON.parse(sessionStorage.getItem(`training-rest:${ownerId}`)!),
    identity.id
  )
  expect(recovered.id).toBe(saved.id)
  expect(recovered.deadline).toBe(saved.deadline)
  await relaunched
    .getByRole("button", { name: "Open running rest timer" })
    .click()
  await relaunched
    .getByRole("button", { name: "Reset rest timer", exact: true })
    .click()
  expect(
    await relaunched.evaluate(
      (ownerId) => localStorage.getItem(`training-rest-standalone:${ownerId}`),
      identity.id
    )
  ).toBeNull()
  await relaunched.evaluate(
    ({ ownerId, timer }) => {
      sessionStorage.removeItem(`training-rest:${ownerId}`)
      localStorage.setItem(
        `training-rest-standalone:${ownerId}`,
        JSON.stringify({ ...timer, deadline: Date.now() - 1000 })
      )
    },
    { ownerId: identity.id, timer: saved }
  )
  await relaunched.reload()
  await expect(
    relaunched.getByRole("navigation", { name: "Mobile navigation" })
  ).toBeVisible()
  await expect(
    relaunched.getByRole("button", { name: "Open running rest timer" })
  ).toHaveCount(0)
})
