import { describe, expect, it, vi } from "vitest"
import {
  TimerAudio,
  countdownCues,
  timerSoundFiles,
  type TimerAudioStatus,
} from "../lib/timer-audio"
import {
  extendRest,
  pauseRest,
  resetRest,
  resumeRest,
  startRest,
} from "../lib/timers"

const durations = { tick: 0.02, start: 0.3, countdown: 0.2, finish: 0.6 }
type Sample = { name: keyof typeof durations; duration: number }

function environment() {
  let now = 100000
  let visible = true
  const nodes: Array<
    EventTarget & {
      buffer: Sample | null
      connect: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
      start: ReturnType<typeof vi.fn>
      stop: ReturnType<typeof vi.fn>
    }
  > = []
  const context = Object.assign(new EventTarget(), {
    state: "suspended",
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => {
      context.state = "running"
    }),
    close: vi.fn(async () => {
      context.state = "closed"
    }),
    decodeAudioData: vi.fn(async (data: ArrayBuffer) => {
      const name = new TextDecoder().decode(data) as keyof typeof durations
      return { name, duration: durations[name] }
    }),
    createBufferSource: vi.fn(() => {
      const node = Object.assign(new EventTarget(), {
        buffer: null as Sample | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })
      nodes.push(node)
      return node
    }),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
  })
  const statuses: TimerAudioStatus[] = []
  const createContext = vi.fn(() => context as unknown as AudioContext)
  const transient = vi.fn()
  const loadSound = vi.fn(async (url: string) => {
    const name = Object.entries(timerSoundFiles).find(
      ([, path]) => path === url
    )![0]
    return new TextEncoder().encode(name).buffer
  })
  const audio = new TimerAudio((status) => statuses.push(status), {
    createContext,
    transient,
    loadSound,
    now: () => now,
    visible: () => visible,
  })
  return {
    audio,
    context,
    nodes,
    statuses,
    createContext,
    transient,
    loadSound,
    now: () => now,
    advance: (milliseconds: number) => {
      now += milliseconds
      context.currentTime += milliseconds / 1000
    },
    visible: (value: boolean) => {
      visible = value
      audio.foregroundChanged()
    },
  }
}

describe("foreground timer audio", () => {
  it("ticks immediately on selection, coalesces fast scrolling and honors mute and background", async () => {
    const env = environment()
    env.audio.playTick()
    expect(env.createContext).not.toHaveBeenCalled()
    await env.audio.prepare()
    env.audio.playTick()
    env.audio.playTick()
    env.advance(30)
    env.audio.playTick()
    expect(env.nodes.map((n) => n.buffer?.name)).toEqual(["tick"])
    env.advance(30)
    env.audio.playTick()
    expect(env.nodes).toHaveLength(2)
    expect(env.nodes[0].stop).toHaveBeenLastCalledWith()
    env.audio.update(null, false)
    env.advance(100)
    env.audio.playTick()
    expect(env.nodes).toHaveLength(2)
    env.audio.update(null, true)
    env.visible(false)
    env.audio.playTick()
    expect(env.nodes).toHaveLength(2)
    env.audio.dispose()
  })
  it("prefetches assets without opening audio, then shares decoding across gestures", async () => {
    const env = environment()
    env.audio.preload()
    expect(env.createContext).not.toHaveBeenCalled()
    expect(env.loadSound).toHaveBeenCalledTimes(4)
    await Promise.all([env.audio.prepare(), env.audio.prepare()])
    expect(env.context.decodeAudioData).toHaveBeenCalledTimes(4)
    expect(env.loadSound).toHaveBeenCalledTimes(4)
    env.audio.dispose()
  })
  it("plays a start cue only on explicit start or resume and honors mute", async () => {
    const env = environment(),
      timer = startRest(60, env.now(), null)
    env.audio.update(timer, true)
    await env.audio.playStart()
    expect(env.nodes.filter((n) => n.buffer?.name === "start")).toHaveLength(1)
    expect(env.nodes.at(-1)!.start).toHaveBeenCalledWith(10)
    await env.audio.prepare()
    expect(env.nodes.filter((n) => n.buffer?.name === "start")).toHaveLength(1)
    env.audio.update(pauseRest(timer, env.now()), true)
    env.advance(1000)
    env.audio.update(resumeRest(pauseRest(timer, env.now()), env.now()), true)
    await env.audio.playStart()
    expect(env.nodes.filter((n) => n.buffer?.name === "start")).toHaveLength(2)
    env.audio.update(timer, false)
    await env.audio.playStart()
    expect(env.nodes.filter((n) => n.buffer?.name === "start")).toHaveLength(2)
    env.audio.dispose()
  })
  it("drops stale start gestures while files load and cancels a pending start on pause", async () => {
    const env = environment()
    let finish!: () => void
    env.context.decodeAudioData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ name: "tick", duration: 0.02 })
        })
    )
    env.audio.update(startRest(60, env.now(), null), true)
    const first = env.audio.playStart()
    await vi.waitFor(() => expect(finish).toBeDefined())
    const timer = startRest(90, env.now(), null)
    env.audio.update(timer, true)
    const second = env.audio.playStart()
    finish()
    await Promise.all([first, second])
    expect(env.nodes.filter((n) => n.buffer?.name === "start")).toHaveLength(1)
    const pending = env.audio.playStart()
    env.audio.update(pauseRest(timer, env.now()), true)
    await pending
    expect(env.nodes.filter((n) => n.buffer?.name === "start")).toHaveLength(1)
    env.audio.dispose()
  })
  it("reports a missing asset without false push suppression and retries later", async () => {
    const env = environment(),
      timer = startRest(60, env.now(), null)
    env.loadSound.mockRejectedValueOnce(
      new Error("Offline without a cached sound")
    )
    env.audio.update(timer, true)
    expect(await env.audio.prepare()).toBe(false)
    expect(env.statuses.at(-1)).toBe("unavailable")
    expect(env.audio.covers(timer.id, timer.deadline!)).toBe(false)
    expect(await env.audio.prepare()).toBe(true)
    expect(env.audio.covers(timer.id, timer.deadline!)).toBe(true)
    env.audio.dispose()
  })
  it("only suppresses phone sound for a matching queued or actually completed buzz", async () => {
    const env = environment(),
      timer = startRest(3, env.now(), null)
    env.audio.update(timer, true)
    expect(env.audio.covers(timer.id, timer.deadline!)).toBe(false)
    await env.audio.prepare()
    expect(env.audio.covers(timer.id, timer.deadline!)).toBe(true)
    expect(env.audio.covers("other", timer.deadline!)).toBe(false)
    env.visible(false)
    env.advance(4000)
    env.visible(true)
    expect(env.audio.covers(timer.id, timer.deadline!)).toBe(false)
    const next = startRest(1, env.now(), null)
    env.audio.update(next, true)
    env.advance(1550)
    env.nodes.at(-1)!.dispatchEvent(new Event("ended"))
    env.audio.update(null, true)
    expect(env.audio.covers(next.id, next.deadline!)).toBe(true)
    env.advance(60_000)
    expect(env.audio.covers(next.id, next.deadline!)).toBe(false)
    env.audio.dispose()
  })
  it("schedules three countdown tones and completion on the timer deadline", async () => {
    const env = environment()
    env.audio.update(startRest(10, env.now(), null), true)
    expect(env.createContext).not.toHaveBeenCalled()
    await env.audio.prepare()
    expect(env.transient).toHaveBeenCalledOnce()
    expect(env.nodes.map((node) => node.buffer!.name)).toEqual([
      "countdown",
      "countdown",
      "countdown",
      "finish",
    ])
    expect(env.nodes.map((node) => node.start.mock.calls[0][0])).toEqual([
      17, 18, 19, 20,
    ])
    expect(env.nodes.map((node) => node.stop.mock.calls[0][0])).toEqual([
      17.2, 18.2, 19.2, 20.6,
    ])
    env.audio.dispose()
  })
  it("keeps the remaining cues for short timers and skips overdue cues", () => {
    expect(countdownCues(11000, 10000).map((cue) => cue.key)).toEqual([
      "1",
      "0",
    ])
    expect(countdownCues(13000, 10040).map((cue) => cue.key)).toEqual([
      "3",
      "2",
      "1",
      "0",
    ])
    expect(countdownCues(10000, 12200)).toEqual([])
    expect(countdownCues(10000, 8500).map((cue) => cue.key)).toEqual(["1", "0"])
  })
  it("does not duplicate a running timer plan or replay ended cues on foreground", async () => {
    const env = environment(),
      timer = startRest(10, env.now(), null)
    env.audio.update(timer, true)
    await env.audio.prepare()
    env.audio.update({ ...timer }, true)
    await env.audio.prepare()
    expect(env.nodes).toHaveLength(4)
    env.advance(7200)
    env.nodes[0].dispatchEvent(new Event("ended"))
    env.visible(false)
    env.advance(100)
    env.visible(true)
    await env.audio.prepare()
    expect(env.nodes).toHaveLength(7)
    expect(env.nodes.slice(4).map((node) => node.buffer!.name)).toEqual([
      "countdown",
      "countdown",
      "finish",
    ])
    env.audio.dispose()
  })
  it("cancels old cues on pause, extension, reset, replacement and cancellation", async () => {
    const env = environment()
    const timer = startRest(10, env.now(), null)
    env.audio.update(timer, true)
    await env.audio.prepare()
    const old = [...env.nodes]
    env.audio.update(pauseRest(timer, env.now()), true)
    for (const node of old) expect(node.stop).toHaveBeenLastCalledWith()
    env.audio.update(resumeRest(pauseRest(timer, env.now()), env.now()), true)
    expect(env.nodes).toHaveLength(8)
    env.audio.update(extendRest(timer, env.now()), true)
    expect(
      env.nodes.slice(8).map((node) => node.start.mock.calls[0][0])
    ).toEqual([47, 48, 49, 50])
    env.audio.update(resetRest(timer), true)
    expect(env.nodes[11].stop).toHaveBeenLastCalledWith()
    env.audio.update(startRest(5, env.now(), null), true)
    env.audio.update(startRest(8, env.now(), null), true)
    expect(env.nodes[15].stop).toHaveBeenLastCalledWith()
    env.audio.update(null, true)
    expect(env.nodes.at(-1)!.stop).toHaveBeenLastCalledWith()
    env.audio.dispose()
  })
  it("lets the zero buzz finish when the visual timer completes", async () => {
    const env = environment(),
      timer = startRest(1, env.now(), null)
    env.audio.update(timer, true)
    await env.audio.prepare()
    env.advance(1000)
    env.audio.update(
      { ...timer, status: "complete", deadline: null, remainingMs: 0 },
      true
    )
    expect(env.nodes[1].stop).toHaveBeenCalledOnce()
    expect(env.nodes[1].stop).toHaveBeenLastCalledWith(11.6)
    env.audio.dispose()
  })
  it("does not sound behind the lock screen or burst missed beeps on return", async () => {
    const env = environment(),
      timer = startRest(10, env.now(), null)
    env.audio.update(timer, true)
    await env.audio.prepare()
    env.visible(false)
    for (const node of env.nodes) expect(node.stop).toHaveBeenLastCalledWith()
    env.advance(10500)
    env.visible(true)
    expect(env.nodes).toHaveLength(4)
    env.audio.dispose()
  })
  it("recovers interrupted audio using a gesture and only schedules future cues", async () => {
    const env = environment(),
      timer = startRest(10, env.now(), null)
    env.audio.update(timer, true)
    await env.audio.prepare()
    env.context.state = "interrupted"
    env.context.dispatchEvent(new Event("statechange"))
    expect(env.statuses.at(-1)).toBe("needs-gesture")
    env.advance(8500)
    await env.audio.prepare()
    expect(env.context.resume).toHaveBeenCalledTimes(2)
    expect(env.nodes.slice(4).map((node) => node.buffer!.name)).toEqual([
      "countdown",
      "finish",
    ])
    env.audio.dispose()
  })
  it("handles a denied resume without throwing and retries from the next gesture", async () => {
    const env = environment()
    env.context.resume.mockRejectedValueOnce(
      new Error("User activation required")
    )
    env.audio.update(startRest(3, env.now(), null), true)
    expect(await env.audio.prepare()).toBe(false)
    expect(env.statuses.at(-1)).toBe("needs-gesture")
    expect(env.nodes).toHaveLength(0)
    expect(await env.audio.prepare()).toBe(true)
    expect(env.nodes).toHaveLength(4)
    env.audio.dispose()
  })
  it("does not resurrect canceled audio when a pending resume resolves", async () => {
    const env = environment()
    let resume!: () => void
    env.context.resume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resume = () => {
            env.context.state = "running"
            resolve()
          }
        })
    )
    env.audio.update(startRest(3, env.now(), null), true)
    const prepared = env.audio.prepare()
    env.audio.update(null, true)
    resume()
    await prepared
    expect(env.nodes).toHaveLength(0)
    env.audio.dispose()
  })
  it("honors sound off and previews the exact sequence without changing the timer", async () => {
    const env = environment(),
      timer = startRest(60, env.now(), null)
    env.audio.update(timer, false)
    await env.audio.prepare()
    expect(env.nodes).toHaveLength(0)
    await env.audio.preview()
    expect(env.nodes.map((node) => node.start.mock.calls[0][0])).toEqual([
      10, 11, 12, 13, 14,
    ])
    env.visible(false)
    for (const node of env.nodes) expect(node.stop).toHaveBeenLastCalledWith()
    env.audio.dispose()
  })
  it("does not start a pending sound test after the app is hidden", async () => {
    const env = environment()
    let resume!: () => void
    env.context.resume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resume = () => {
            env.context.state = "running"
            resolve()
          }
        })
    )
    const preview = env.audio.preview()
    env.visible(false)
    resume()
    await preview
    expect(env.nodes).toHaveLength(0)
    env.audio.dispose()
  })
  it("does not fail when Audio Session is unsupported or its setter rejects", async () => {
    const env = environment()
    env.transient.mockImplementation(() => {
      throw new Error("Unsupported")
    })
    env.audio.update(startRest(1, env.now(), null), true)
    expect(await env.audio.prepare()).toBe(true)
    expect(env.nodes).toHaveLength(2)
    env.audio.dispose()
  })
})
