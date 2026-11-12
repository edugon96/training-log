import type { RestTimerState } from "./timers"

export type TimerAudioStatus =
  "idle" | "ready" | "needs-gesture" | "unavailable"
export const timerSoundFiles = {
  tick: "/audio/timer/crisp-v1/tick.wav",
  start: "/audio/timer/crisp-v1/start.wav",
  countdown: "/audio/timer/crisp-v1/countdown.wav",
  finish: "/audio/timer/crisp-v1/finish.wav",
} as const
type TimerSound = keyof typeof timerSoundFiles
export type TimerCue = {
  key: string
  at: number
  sound: TimerSound
}

/** Cue times share the countdown's wall-clock deadline, not interval ticks. */
export function countdownCues(deadline: number, now: number): TimerCue[] {
  return (
    [3, 2, 1, 0]
      .map((second) => ({
        key: String(second),
        at: deadline - second * 1000,
        sound: (second ? "countdown" : "finish") as TimerSound,
      }))
      // A just-started three-second timer can take a few milliseconds to unlock.
      // Returning late never replays a backlog of countdown sounds.
      .filter((cue) => cue.at >= now - 100)
  )
}

type AudioEnvironment = {
  createContext: () => AudioContext
  now: () => number
  visible: () => boolean
  transient: () => void
  loadSound: (url: string) => Promise<ArrayBuffer>
}
type ScheduledCue = {
  node: AudioBufferSourceNode
  gain: GainNode
  at: number
  start: number
  duration: number
  cancelled: boolean
}

/** Audio nodes are scheduled once and discarded whenever the deadline changes. */
export class TimerAudio {
  private context: AudioContext | null = null
  private timer: RestTimerState | null = null
  private enabled = true
  private disposed = false
  private planKey = ""
  private sounds: ScheduledCue[] = []
  private previewSounds: ScheduledCue[] = []
  private startSounds: ScheduledCue[] = []
  private tickSounds: ScheduledCue[] = []
  private lastTickAt = -Infinity
  private encoded: Promise<Record<TimerSound, ArrayBuffer>> | null = null
  private bank: {
    context: AudioContext
    promise: Promise<Record<TimerSound, AudioBuffer>>
    values?: Record<TimerSound, AudioBuffer>
  } | null = null
  private played = new Set<string>()
  private version = 0
  private endCue: {
    timerId: string
    deadline: number
    sound: ScheduledCue
  } | null = null
  private lastBuzz: {
    timerId: string
    deadline: number
    heardAt: number
  } | null = null

  constructor(
    private onStatus: (status: TimerAudioStatus) => void,
    private environment: AudioEnvironment = {
      createContext: () => new AudioContext(),
      now: () => Date.now(),
      visible: () => document.visibilityState === "visible",
      loadSound: async (url) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error("Timer sound could not be loaded")
        return response.arrayBuffer()
      },
      transient: () => {
        const browser = navigator as Navigator & {
          audioSession?: { type: string }
        }
        // Short cues should mix with music, rather than taking its playback slot.
        if (browser.audioSession) browser.audioSession.type = "transient"
      },
    }
  ) {}

  /** Download small, same-origin assets before the first tap. No audio autoplay. */
  preload() {
    void this.loadEncoded().catch(() => undefined)
  }

  private loadEncoded() {
    if (!this.encoded) {
      const pending = Promise.all(
        Object.entries(timerSoundFiles).map(async ([name, url]) => [
          name,
          await this.environment.loadSound(url),
        ])
      ).then(
        (entries) =>
          Object.fromEntries(entries) as Record<TimerSound, ArrayBuffer>
      )
      this.encoded = pending
      void pending.catch(() => {
        if (this.encoded === pending) this.encoded = null
      })
    }
    return this.encoded
  }

  private loadBuffers(context: AudioContext) {
    if (this.bank?.context === context) return this.bank.promise
    const bank: NonNullable<TimerAudio["bank"]> = {
      context,
      promise: this.loadEncoded().then(async (files) => {
        const entries = await Promise.all(
          Object.entries(files).map(async ([name, data]) => [
            name,
            // Decoding can detach the input. Retain bytes for a replacement context.
            await context.decodeAudioData(data.slice(0)),
          ])
        )
        bank.values = Object.fromEntries(entries) as Record<
          TimerSound,
          AudioBuffer
        >
        return bank.values
      }),
    }
    this.bank = bank
    void bank.promise.catch(() => {
      if (this.bank === bank) this.bank = null
    })
    return bank.promise
  }

  /** Call directly from the user event, before awaiting persistence or network. */
  async prepare(): Promise<boolean> {
    if (this.disposed) return false
    try {
      try {
        this.environment.transient()
      } catch {
        // AudioSession is optional. Web Audio remains available without it.
      }
      if (!this.context || this.context.state === "closed") {
        this.context?.removeEventListener("statechange", this.stateChanged)
        this.context = this.environment.createContext()
        this.context.addEventListener("statechange", this.stateChanged)
      }
      const context = this.context
      if (context.state !== "running") await context.resume()
      await this.loadBuffers(context)
      if (this.disposed || this.context !== context) return false
      const ready = context.state === "running"
      this.onStatus(ready ? "ready" : "needs-gesture")
      if (ready) this.schedule()
      return ready
    } catch {
      if (!this.disposed)
        this.onStatus(
          this.context && this.context.state !== "running"
            ? "needs-gesture"
            : "unavailable"
        )
      return false
    }
  }

  update(timer: RestTimerState | null, enabled: boolean) {
    const previousKey = this.timer && `${this.timer.id}:${this.timer.deadline}`
    const nextKey = timer && `${timer.id}:${timer.deadline}`
    if (
      previousKey !== nextKey ||
      this.timer?.status !== timer?.status ||
      !enabled
    ) {
      this.version++
      this.stop(this.startSounds)
      this.stop(this.tickSounds)
    }
    this.timer = timer
    this.enabled = enabled
    if (previousKey !== nextKey) this.played.clear()
    if (!enabled || !timer || timer.status !== "running") {
      // Let the buzz finish when the visual clock changes to Complete at zero.
      this.cancel(
        timer?.status === "complete" && enabled && this.environment.visible()
      )
      if (!enabled) {
        this.version++
        this.stop(this.previewSounds)
      }
      return
    }
    this.schedule()
  }

  foregroundChanged() {
    if (!this.environment.visible()) {
      this.version++
      this.cancel()
      this.stop(this.previewSounds)
      this.stop(this.startSounds)
      this.stop(this.tickSounds)
      return
    }
    if (this.enabled && this.context) void this.prepare()
    else if (this.enabled && this.timer?.status === "running")
      this.onStatus("needs-gesture")
  }

  /** A matching audible cue, rather than context state alone, can silence push. */
  covers(timerId: string, deadline: number): boolean {
    if (this.disposed || !this.environment.visible()) return false
    const heard = this.lastBuzz
    if (
      heard?.timerId === timerId &&
      heard.deadline === deadline &&
      this.environment.now() - heard.heardAt < 60_000
    )
      return true
    const cue = this.endCue
    return !!(
      this.enabled &&
      this.context?.state === "running" &&
      cue?.timerId === timerId &&
      cue.deadline === deadline &&
      !cue.sound.cancelled &&
      this.context.currentTime < cue.sound.start + cue.sound.duration
    )
  }

  async preview() {
    const version = ++this.version
    this.stop(this.previewSounds)
    this.stop(this.startSounds)
    this.stop(this.tickSounds)
    if (
      !(await this.prepare()) ||
      this.disposed ||
      version !== this.version ||
      !this.environment.visible()
    )
      return
    const now = this.environment.now()
    this.previewSounds = [
      { key: "start", at: now, sound: "start" } as TimerCue,
      ...countdownCues(now + 4000, now),
    ].map((cue) => this.play(cue))
  }

  /** Only explicit starts/resumes call this. Restoring a timer stays quiet. */
  async playStart() {
    if (!this.enabled || this.timer?.status !== "running") return
    const version = ++this.version
    this.stop(this.startSounds)
    this.stop(this.previewSounds)
    this.stop(this.tickSounds)
    if (
      !(await this.prepare()) ||
      this.disposed ||
      version !== this.version ||
      !this.enabled ||
      !this.environment.visible() ||
      this.timer?.status !== "running"
    )
      return
    this.startSounds = [
      this.play({ key: "start", at: this.environment.now(), sound: "start" }),
    ]
  }

  /** Immediate feedback only. Fast scrolling never queues a backlog of clicks. */
  playTick() {
    const now = this.environment.now()
    if (
      this.disposed ||
      !this.enabled ||
      !this.environment.visible() ||
      this.context?.state !== "running" ||
      this.bank?.context !== this.context ||
      !this.bank.values ||
      now - this.lastTickAt < 60
    )
      return
    this.lastTickAt = now
    this.stop(this.tickSounds)
    this.tickSounds = [this.play({ key: "tick", at: now, sound: "tick" })]
  }

  dispose() {
    this.disposed = true
    this.version++
    this.cancel()
    this.stop(this.previewSounds)
    this.stop(this.startSounds)
    this.stop(this.tickSounds)
    this.context?.removeEventListener("statechange", this.stateChanged)
    void this.context?.close().catch(() => undefined)
    this.context = null
    this.bank = null
    this.encoded = null
  }

  private stateChanged = () => {
    if (this.disposed) return
    if (this.context?.state === "running") {
      if (this.bank?.context === this.context && this.bank.values)
        this.onStatus("ready")
      this.schedule()
    } else {
      this.version++
      this.cancel()
      this.stop(this.previewSounds)
      this.stop(this.startSounds)
      this.stop(this.tickSounds)
      this.onStatus("needs-gesture")
    }
  }

  private schedule() {
    const timer = this.timer
    if (
      this.disposed ||
      !this.enabled ||
      !this.environment.visible() ||
      this.context?.state !== "running" ||
      this.bank?.context !== this.context ||
      !this.bank.values ||
      timer?.status !== "running" ||
      timer.deadline === null
    )
      return
    const key = `${timer.id}:${timer.deadline}`
    if (key === this.planKey) return
    this.cancel()
    this.planKey = key
    const now = this.environment.now()
    this.sounds = countdownCues(timer.deadline, now)
      .filter((cue) => !this.played.has(`${key}:${cue.key}`))
      .map((cue) => {
        const sound = this.play(cue)
        if (cue.key === "0")
          this.endCue = { timerId: timer.id, deadline: timer.deadline!, sound }
        sound.node.addEventListener("ended", () => {
          if (!sound.cancelled && this.environment.now() >= cue.at) {
            this.played.add(`${key}:${cue.key}`)
            if (cue.key === "0" && this.environment.visible())
              this.lastBuzz = {
                timerId: timer.id,
                deadline: timer.deadline!,
                heardAt: this.environment.now(),
              }
          }
        })
        return sound
      })
  }

  private play(cue: TimerCue): ScheduledCue {
    const context = this.context!
    const node = context.createBufferSource()
    const buffer = this.bank!.values![cue.sound]
    const duration = buffer.duration
    const gain = context.createGain()
    const start =
      context.currentTime + Math.max(0, cue.at - this.environment.now()) / 1000
    node.buffer = buffer
    // Authored envelopes are part of each sample. Keep the acknowledgement
    // softer than the countdown and its longer completion cue.
    gain.gain.setValueAtTime(
      cue.sound === "tick" ? 0.4 : cue.sound === "start" ? 0.5 : 0.75,
      start
    )
    node.connect(gain)
    gain.connect(context.destination)
    node.addEventListener(
      "ended",
      () => {
        node.disconnect()
        gain.disconnect()
      },
      { once: true }
    )
    node.start(start)
    node.stop(start + duration)
    return {
      node,
      gain,
      at: cue.at,
      start,
      duration,
      cancelled: false,
    }
  }

  private stop(sounds: ScheduledCue[]) {
    for (const sound of sounds.splice(0)) {
      sound.cancelled = true
      try {
        sound.node.stop()
      } catch {
        // Already-ended nodes need no further action.
      }
      sound.node.disconnect()
      sound.gain.disconnect()
    }
  }

  private cancel(letStartedFinish = false) {
    if (letStartedFinish) {
      const future = this.sounds.filter(
        (sound) => sound.at > this.environment.now()
      )
      this.sounds = this.sounds.filter(
        (sound) => sound.at <= this.environment.now()
      )
      this.stop(future)
    } else this.stop(this.sounds)
    if (this.endCue?.sound.cancelled) this.endCue = null
    this.planKey = ""
  }
}
