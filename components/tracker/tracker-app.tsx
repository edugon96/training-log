"use client"
import { newGroup } from "@/lib/workout-groups"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Copy,
  Dumbbell,
  UserRound,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, ApiError } from "@/lib/api-client"
import { savePlanEdit } from "@/lib/workout-edits"
import { disablePhoneNotifications } from "@/lib/timer-alerts"
import {
  publishSaved,
  subscribeSaved,
  type SavedEdit,
} from "@/lib/autosave-events"
import {
  cacheSession,
  cachePlans,
  cacheWeekPlans,
  cacheWorkout,
  readCachedPlans,
  getWorkoutDraft,
  offlineDb,
  listCachedSessions,
  listPending,
  readCachedSession,
  withPendingSessions,
  purgeWorkout,
} from "@/lib/offline"
import {
  type CatalogRecord,
  type EquipmentRecord,
  type ExerciseRecord,
  type LedgerRecord,
  type SessionRecord,
  type TrainingDefaultsRecord,
  type WeekRecord,
  type WorkoutRecord,
} from "@/contracts/models"
import { Field, Modal, NativeSelect, errorMessage, today } from "./shared"
import { WorkoutEditor } from "./workout-editor"
import { SessionView } from "./session-view"
import { AutosaveStatus, useAutosaveCoordinator } from "./autosave"
import { Library } from "./library"
import { Settings } from "./settings"
import { ConfirmationProvider, confirmAction } from "./responsive-panel"
import { TrainingGoals } from "./training-goals"
import { TimerProvider } from "./timers"
import { DisplayProvider } from "./display-settings"
import { WeekHome } from "./week-home"
import { PageSkeleton, TrackerSkeleton } from "./loading-skeleton"
import { preferredWeek, workoutSession } from "@/lib/week-summary"
import { parseLocation, writeLocation, type AppTab } from "@/lib/navigation"

type Owner = Awaited<ReturnType<typeof api.me>>
type Tab = AppTab
const nav = [
  { id: "week", label: "Week", icon: CalendarDays },
  { id: "library", label: "Library", icon: BookOpen },
  { id: "profile", label: "Profile", icon: UserRound },
] as const
function upsertRecord<T extends { id: string; revision: number }>(
  values: T[],
  next: T
) {
  const previous = values.find((value) => value.id === next.id)
  if (previous && previous.revision > next.revision) return values
  return previous
    ? values.map((value) => (value.id === next.id ? next : value))
    : [...values, next]
}
function cloneBlocks(workout: WorkoutRecord) {
  return workout.blocks.map((b) => ({
    ...b,
    id: crypto.randomUUID(),
    items: b.items.map((i) => ({
      ...i,
      id: crypto.randomUUID(),
      sets: i.sets.map((s) => ({ ...s, id: crypto.randomUUID() })),
    })),
  }))
}
function weekStart() {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default function TrackerApp() {
  return (
    <ConfirmationProvider>
      <TrackerContent />
    </ConfirmationProvider>
  )
}
function TrackerContent() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [owner, setOwner] = useState<Owner | null>(null)
  const [loading, setLoading] = useState(true)
  const [routeReady, setRouteReady] = useState(false)
  const [openingWorkout, setOpeningWorkout] = useState(false)
  const [tab, setTab] = useState<Tab>("week")
  const [online, setOnline] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [weeks, setWeeks] = useState<WeekRecord[]>([])
  const [workouts, setWorkouts] = useState<WorkoutRecord[]>([])
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [exercises, setExercises] = useState<ExerciseRecord[]>([])
  const [equipment, setEquipment] = useState<EquipmentRecord[]>([])
  const [catalog, setCatalog] = useState<CatalogRecord | undefined>()
  const [trainingDefaults, setTrainingDefaults] =
    useState<TrainingDefaultsRecord | null>(null)
  const [goalsMode, setGoalsMode] = useState<"defaults" | "week" | null>(null)
  const [weekId, setWeekId] = useState("")
  const [ledger, setLedger] = useState<LedgerRecord | null>(null)
  const [ledgerErrorWeekId, setLedgerErrorWeekId] = useState("")
  const [ledgerVersion, setLedgerVersion] = useState(0)
  const [active, setActive] = useState<SessionRecord | null>(null)
  const [editingWorkout, setEditingWorkout] = useState<WorkoutRecord | null>(
    null
  )
  const [editingWeek, setEditingWeek] = useState<WeekRecord | null>(null)
  const [copying, setCopying] = useState(false)
  const [copyDate, setCopyDate] = useState("")
  const [routinePicker, setRoutinePicker] = useState(false)
  const [routineId, setRoutineId] = useState("")
  const [planDate, setPlanDate] = useState(today())
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const ownerIdRef = useRef<string | null>(null)
  const leaveRef = useRef<(() => boolean) | null>(null)
  const persistenceRef = useRef<Promise<unknown>>(Promise.resolve())
  const navigationVersion = useRef(0)
  const activeLocation = useRef("")
  const readVersion = useRef(0)
  const savedVersion = useRef(0)
  const acknowledged = useRef(new Map<string, SavedEdit>())
  const activeRef = useRef(active)
  const editorRef = useRef(editingWorkout)
  useEffect(() => {
    activeRef.current = active
    editorRef.current = editingWorkout
  }, [active, editingWorkout])
  const invalidateLedger = useCallback(
    () => setLedgerVersion((value) => value + 1),
    []
  )
  const week = weeks.find((w) => w.id === weekId)
  const routines = workouts.filter((w) => w.kind === "routine")

  const refresh = useCallback(async () => {
    const ownerId = ownerIdRef.current
    const baseline = ownerId ? await offlineDb.plans.get(ownerId) : undefined
    const [w, p, s, e, m, defaults, choices] = await Promise.all([
      api.listWeeks(),
      api.listWorkouts(),
      api.listSessions(),
      api.listExercises(),
      api.listEquipment(),
      api.getTrainingDefaults(),
      api.catalog(),
    ])
    if (ownerIdRef.current !== ownerId) return
    if (ownerId) await cachePlans(ownerId, w, p, baseline?.workouts)
    w.sort((a, b) => b.startDate.localeCompare(a.startDate))
    setWeeks(w)
    const cached = ownerIdRef.current
      ? await readCachedPlans(ownerIdRef.current)
      : undefined
    setWorkouts(cached?.workouts ?? p)
    setSessions(s)
    setExercises(e)
    setEquipment(m)
    setTrainingDefaults(defaults)
    setCatalog(choices)
    setWeekId((id) => {
      const requested = parseLocation(window.location.search).weekId || id
      return preferredWeek(w, requested, today())
    })
  }, [])
  const refreshSync = useCallback(async () => {
    if (!owner || !weekId || !navigator.onLine) return
    const version = ++readVersion.current
    const saved = savedVersion.current
    const baseline = await offlineDb.plans.get(owner.id)
    const [w, p, s] = await Promise.all([
      api.listWeeks(),
      api.listWorkouts({ weekId }),
      api.listSessions({ weekId }),
    ])
    const isCurrent = () =>
      version === readVersion.current &&
      ownerIdRef.current === owner.id &&
      saved === savedVersion.current
    if (!isCurrent()) return
    await cacheWeekPlans(owner.id, weekId, w, p, isCurrent, baseline?.workouts)
    const [plans, currentSessions] = await Promise.all([
      readCachedPlans(owner.id),
      withPendingSessions(owner.id, s, weekId),
    ])
    if (!isCurrent()) return
    setWeeks(w.sort((a, b) => b.startDate.localeCompare(a.startDate)))
    if (plans) setWorkouts(plans.workouts)
    setSessions((values) => [
      ...values.filter((value) => value.weekId !== weekId),
      ...currentSessions,
    ])
    invalidateLedger()
  }, [owner, weekId, invalidateLedger])

  useEffect(() => {
    if (!owner) return
    let live = true
    const unsubscribe = subscribeSaved((event) => {
      if (event.ownerId !== owner.id) return
      savedVersion.current++
      const key = `${owner.id}:${event.kind}:${event.after.id}`
      if (
        (acknowledged.current.get(key)?.after.revision ?? -1) <
        event.after.revision
      )
        acknowledged.current.set(key, event)
      void (async () => {
        if (event.kind === "workouts") {
          const cached = await readCachedPlans(owner.id)
          const next =
            cached?.workouts.find((value) => value.id === event.after.id) ??
            event.after
          if (live) setWorkouts((values) => upsertRecord(values, next))
        } else {
          const next =
            (await readCachedSession(owner.id, event.after.id)) ?? event.after
          if (live) setSessions((values) => upsertRecord(values, next))
        }
        if (live) invalidateLedger()
      })().catch(() => {
        if (live) invalidateLedger()
      })
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [owner, invalidateLedger])
  useEffect(() => {
    let live = true
    async function initialize() {
      setSidebarCollapsed(
        localStorage.getItem("training-sidebar-collapsed") === "true"
      )
      try {
        const identity = await api.me()
        if (!live) return
        ownerIdRef.current = identity.id
        setOwner(identity)
        sessionStorage.setItem("training-owner", JSON.stringify(identity))
        await refresh()
      } catch (e) {
        if (!navigator.onLine) {
          const saved = sessionStorage.getItem("training-owner")
          if (saved) {
            try {
              const identity = JSON.parse(saved) as Owner
              ownerIdRef.current = identity.id
              setOwner(identity)
              setSessions(await listCachedSessions(identity.id))
              const cached = await readCachedPlans(identity.id)
              if (cached) {
                setWeeks(cached.weeks)
                setWorkouts(cached.workouts)
                setWeekId(
                  preferredWeek(
                    cached.weeks,
                    parseLocation(window.location.search).weekId,
                    today()
                  )
                )
              }
            } catch {
              setError("Could not open the device cache.")
            }
          }
        } else if (!(e instanceof ApiError && e.status === 401))
          setError(errorMessage(e))
      } finally {
        if (live) {
          setOnline(navigator.onLine)
          setLoading(false)
        }
      }
    }
    void initialize()
    if (
      "serviceWorker" in navigator &&
      (process.env.NODE_ENV === "production" ||
        process.env.NEXT_PUBLIC_ENABLE_SW === "1")
    )
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined)
    return () => {
      live = false
    }
  }, [refresh])
  useEffect(() => {
    if (!owner || loading) return
    let live = true
    const restore = async () => {
      const version = ++navigationVersion.current
      const location = parseLocation(window.location.search)
      try {
        // Keep the logger mounted until its latest edit is durable on this device.
        await persistenceRef.current
        let session: SessionRecord | null = null
        if (leaveRef.current && !leaveRef.current()) {
          const previous = activeLocation.current
          if (previous) window.history.pushState({}, "", previous)
          return
        }
        setOpeningWorkout(!!(location.sessionId || location.workoutId))
        if (location.sessionId) {
          const cached = await readCachedSession(owner.id, location.sessionId)
          if (navigator.onLine) {
            await cacheSession(
              owner.id,
              await api.getSession(location.sessionId)
            )
            session =
              (await readCachedSession(owner.id, location.sessionId)) ?? null
          } else session = cached ?? null
          if (!session)
            throw new Error(
              "This workout is not available on this device. Connect and try again."
            )
        }
        if (!location.sessionId && location.workoutId) {
          const cachedPlans = await readCachedPlans(owner.id)
          const pendingPlan = await offlineDb.planEdits.get(
            `${owner.id}:${location.workoutId}`
          )
          const workout =
            pendingPlan?.value.revision === 0
              ? pendingPlan.value
              : navigator.onLine
                ? await api.getWorkout(location.workoutId)
                : cachedPlans?.workouts.find((w) => w.id === location.workoutId)
          if (!workout)
            throw new Error(
              "Open this workout while connected to cache it on this device."
            )
          setWorkouts((values) => [
            ...values.filter((value) => value.id !== workout.id),
            workout,
          ])
          const candidates = navigator.onLine
            ? await api.listSessions({ workoutId: workout.id })
            : await listCachedSessions(owner.id)
          const existing = workoutSession(workout.id, candidates)
          if (existing) {
            await cacheSession(owner.id, existing)
            session =
              (await readCachedSession(owner.id, existing.id)) ?? existing
          } else session = await getWorkoutDraft(owner.id, workout)
        }
        if (!live || version !== navigationVersion.current) return
        activeLocation.current =
          window.location.pathname + window.location.search
        setTab(location.tab)
        if (location.weekId) setWeekId(location.weekId)
        setActive(session)
        if (location.editor) {
          const kind =
            location.editor === "planned" || location.editor === "routine"
              ? location.editor
              : null
          const cached = await readCachedPlans(owner.id)
          const date =
            cached?.weeks.find((value) => value.id === location.weekId)
              ?.startDate ?? today()
          const editor = kind
            ? blankWorkout(kind, location.weekId, date)
            : await api.getWorkout(location.editor)
          if (!live || version !== navigationVersion.current) return
          setEditingWorkout(editor)
        } else setEditingWorkout(null)
        setEditingWeek(null)
        setGoalsMode(null)
        setCopying(false)
        setRoutinePicker(false)
        setError("")
      } catch (error) {
        if (live && version === navigationVersion.current) {
          if (
            error instanceof ApiError &&
            (error.code === "record_deleted" || error.status === 404)
          ) {
            writeLocation(
              { tab: "week", weekId: location.weekId, sessionId: null },
              true
            )
            setActive(null)
            setTab("week")
          }
          setError(errorMessage(error))
        }
      } finally {
        if (live && version === navigationVersion.current) {
          setOpeningWorkout(false)
          setRouteReady(true)
        }
      }
    }
    const handlePop = () => {
      void restore()
    }
    window.addEventListener("popstate", handlePop)
    void restore()
    return () => {
      live = false
      window.removeEventListener("popstate", handlePop)
    }
  }, [owner, loading])
  useEffect(() => {
    if (owner && weekId && !parseLocation(window.location.search).weekId) {
      writeLocation({ ...parseLocation(window.location.search), weekId }, true)
    }
  }, [owner, weekId])
  useAutosaveCoordinator(loading ? undefined : owner?.id)
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine)
    window.addEventListener("online", changed)
    window.addEventListener("offline", changed)
    return () => {
      window.removeEventListener("online", changed)
      window.removeEventListener("offline", changed)
    }
  }, [])
  useEffect(() => {
    let live = true
    const timeout = setTimeout(() => {
      if (weekId && online && owner)
        api
          .ledger(weekId)
          .then((value) => {
            if (live) {
              setLedger(value)
              setLedgerErrorWeekId("")
            }
          })
          .catch((e) => {
            if (live) {
              setLedgerErrorWeekId(weekId)
              setError(errorMessage(e))
            }
          })
    }, 100)
    return () => {
      live = false
      clearTimeout(timeout)
    }
  }, [owner, weekId, online, ledgerVersion])
  useEffect(() => {
    readVersion.current++
  }, [owner, weekId])
  useEffect(() => {
    if (!owner || loading || !weekId) return
    const timeout = setTimeout(() => {
      void refreshSync().catch(() => {
        /* Keep the cached week usable during a transient failure. */
      })
    }, 0)
    return () => clearTimeout(timeout)
  }, [owner, loading, weekId, refreshSync])
  useEffect(() => {
    if (!owner || loading) return
    let live = true
    let working = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const revalidate = async () => {
      if (
        working ||
        !navigator.onLine ||
        document.visibilityState !== "visible"
      )
        return
      working = true
      const navigation = navigationVersion.current
      let deletedWorkoutId: string | null = null
      let readingActive = false
      try {
        await persistenceRef.current
        const current = activeRef.current
        const editor = editorRef.current
        // Reconcile the mounted record before refreshing the week cache so its
        // baseline still describes the version the editor has already received.
        const cached = current
          ? await offlineDb.sessions.get(`${owner.id}:${current.id}`)
          : undefined
        const planId = current?.workoutId ?? editor?.id
        const plans = planId ? await offlineDb.plans.get(owner.id) : undefined
        const planBaseline = plans?.workouts.find(
          (value) => value.id === planId
        )
        if (!live || navigation !== navigationVersion.current) return
        if (current && (cached?.serverRevision ?? current.revision) > 0) {
          readingActive = true
          const remote = await api.getSession(current.id)
          if (
            !live ||
            navigation !== navigationVersion.current ||
            activeRef.current?.id !== current.id
          )
            return
          // A save may finish while the GET is in flight. Its acknowledgement is
          // already merged, and replaying it could undo a more recent local edit.
          const latest = await offlineDb.sessions.get(
            `${owner.id}:${current.id}`
          )
          let baseline = latest?.base ?? cached?.base ?? current
          await cacheSession(owner.id, remote)
          const acknowledgedEdit = acknowledged.current.get(
            `${owner.id}:sessions:${current.id}`
          )
          if (
            acknowledgedEdit?.kind === "sessions" &&
            acknowledgedEdit.after.revision > baseline.revision
          )
            baseline = acknowledgedEdit.after
          if (remote.revision > baseline.revision)
            publishSaved({
              ownerId: owner.id,
              kind: "sessions",
              before: baseline,
              after: remote,
            })
        } else if (planId) {
          if (!planBaseline || !planBaseline.revision) return
          deletedWorkoutId = planId
          readingActive = true
          const remote = await api.getWorkout(planId)
          if (
            !live ||
            navigation !== navigationVersion.current ||
            (current
              ? activeRef.current?.id !== current.id
              : editorRef.current?.id !== planId)
          )
            return
          const latest = await offlineDb.plans.get(owner.id)
          let baseline =
            latest?.workouts.find((value) => value.id === planId) ??
            planBaseline
          await cacheWorkout(owner.id, remote)
          const acknowledgedEdit = acknowledged.current.get(
            `${owner.id}:workouts:${planId}`
          )
          if (
            acknowledgedEdit?.kind === "workouts" &&
            acknowledgedEdit.after.revision > baseline.revision
          )
            baseline = acknowledgedEdit.after
          if (remote.revision > baseline.revision)
            publishSaved({
              ownerId: owner.id,
              kind: "workouts",
              before: baseline,
              after: remote,
            })
        }
      } catch (error) {
        if (!live || navigation !== navigationVersion.current) return
        if (
          readingActive &&
          error instanceof ApiError &&
          (error.status === 404 || error.code === "record_deleted")
        ) {
          const current = activeRef.current
          if (current || deletedWorkoutId) {
            await purgeWorkout(owner.id, {
              workoutId: deletedWorkoutId,
              sessionIds: current ? [current.id] : [],
            })
            setActive(null)
            setEditingWorkout(null)
            setTab("week")
            writeLocation({ tab: "week", weekId, sessionId: null }, true)
          }
        }
        // Retain the usable local view on a transient foreground refresh failure.
      } finally {
        if (live && navigation === navigationVersion.current)
          await refreshSync().catch(() => undefined)
        working = false
      }
    }
    const schedule = () => {
      if (document.visibilityState !== "visible") return
      clearTimeout(timeout)
      timeout = setTimeout(() => void revalidate(), 100)
    }
    window.addEventListener("focus", schedule)
    window.addEventListener("online", schedule)
    document.addEventListener("visibilitychange", schedule)
    return () => {
      live = false
      clearTimeout(timeout)
      window.removeEventListener("focus", schedule)
      window.removeEventListener("online", schedule)
      document.removeEventListener("visibilitychange", schedule)
    }
  }, [owner, loading, weekId, refreshSync])
  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function openSession(session: SessionRecord) {
    if (!owner || (leaveRef.current && !leaveRef.current())) return
    await persistenceRef.current
    const version = ++navigationVersion.current
    setOpeningWorkout(true)
    try {
      if (navigator.onLine) session = await api.getSession(session.id)
      await cacheSession(owner.id, session)
      const loaded = (await readCachedSession(owner.id, session.id)) ?? session
      if (version !== navigationVersion.current) return
      writeLocation({ tab, weekId, sessionId: session.id })
      activeLocation.current = window.location.pathname + window.location.search
      setActive(loaded)
      window.scrollTo({ top: 0 })
    } finally {
      if (version === navigationVersion.current) setOpeningWorkout(false)
    }
  }
  async function openWorkout(workout: WorkoutRecord) {
    if (!owner || (leaveRef.current && !leaveRef.current())) return
    await persistenceRef.current
    const version = ++navigationVersion.current
    setOpeningWorkout(true)
    try {
      const pending = await offlineDb.planEdits.get(`${owner.id}:${workout.id}`)
      if (pending) workout = pending.value
      else if (navigator.onLine && workout.revision > 0)
        workout = await api.getWorkout(workout.id)
      if (version !== navigationVersion.current) return
      setWorkouts((values) => [
        ...values.filter((value) => value.id !== workout.id),
        workout,
      ])
      const candidates = navigator.onLine
        ? await api.listSessions({ workoutId: workout.id })
        : await listCachedSessions(owner.id)
      if (version !== navigationVersion.current) return
      const existing = workoutSession(workout.id, candidates)
      let session: SessionRecord
      if (existing) {
        await cacheSession(owner.id, existing)
        session = (await readCachedSession(owner.id, existing.id)) ?? existing
      } else session = await getWorkoutDraft(owner.id, workout)
      if (version !== navigationVersion.current) return
      writeLocation({
        tab: "week",
        weekId,
        sessionId: existing?.id ?? null,
        workoutId: existing ? undefined : workout.id,
      })
      activeLocation.current = window.location.pathname + window.location.search
      setActive(session)
      window.scrollTo({ top: 0 })
    } finally {
      if (version === navigationVersion.current) setOpeningWorkout(false)
    }
  }
  function newWorkout(kind: "planned" | "routine" = "planned") {
    writeLocation({ tab, weekId, sessionId: null, editor: kind })
    setEditingWorkout(blankWorkout(kind, weekId, week?.startDate ?? today()))
  }
  function closeEditor() {
    setEditingWorkout(null)
    writeLocation({ tab, weekId, sessionId: null }, true)
  }
  async function logout() {
    if (!owner) return
    await persistenceRef.current
    const pending = await listPending(owner.id)
    if (
      pending.length &&
      !(await confirmAction(
        `${pending.length} sessions still have unsynced edits on this device. Signing out keeps those edits here. Sign back into this same account to sync them. Continue?`
      ))
    )
      return
    await disablePhoneNotifications(owner.id).catch(() => undefined)
    await api.signOut()
    ownerIdRef.current = null
    readVersion.current++
    sessionStorage.removeItem("training-owner")
    setOwner(null)
    setRouteReady(false)
    setOpeningWorkout(false)
    setActive(null)
    writeLocation({ tab: "week", weekId: "", sessionId: null }, true)
    setPassword("")
  }
  async function navigate(id: Tab) {
    if (leaveRef.current && !leaveRef.current()) return
    try {
      await persistenceRef.current
      navigationVersion.current++
      writeLocation({ tab: id, weekId, sessionId: null })
      setTab(id)
      setOpeningWorkout(false)
      setActive(null)
      setError("")
    } catch {
      setError(
        "Your latest workout edits are not yet saved on this device. Keep this workout open and retry."
      )
    }
  }
  function selectWeek(id: string) {
    setOpeningWorkout(false)
    navigationVersion.current++
    writeLocation({ tab: "week", weekId: id, sessionId: null })
    setWeekId(id)
  }
  if (loading || (owner && !routeReady))
    return <TrackerSkeleton sidebarCollapsed={sidebarCollapsed} />
  if (!owner)
    return (
      <main className="login-screen">
        <section className="login-card">
          <div className="row">
            <span className="brand-mark">
              <Dumbbell size={22} />
            </span>
            <span className="brand-name">Training log</span>
          </div>
          <p className="eyebrow">Your next session starts here</p>
          <h1>Back to the work.</h1>
          <p className="muted">Your plan, your progress, every set.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void act(async () => {
                await api.signIn(email, password)
                const identity = await api.me()
                ownerIdRef.current = identity.id
                setLoading(true)
                setRouteReady(false)
                setOwner(identity)
                sessionStorage.setItem(
                  "training-owner",
                  JSON.stringify(identity)
                )
                try {
                  await refresh()
                } finally {
                  setLoading(false)
                }
              })
            }}
          >
            <Field label="Email">
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <Button className="login-submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              <ArrowRight size={18} />
            </Button>
          </form>
          <p className="login-footnote">Private workspace · No public signup</p>
        </section>
      </main>
    )
  return (
    <DisplayProvider key={owner.id} ownerId={owner.id}>
      <TimerProvider ownerId={owner.id}>
        <div
          className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${active || openingWorkout ? "focused-workout" : ""}`}
        >
          <aside className="sidebar">
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              onClick={() => {
                const collapsed = !sidebarCollapsed
                setSidebarCollapsed(collapsed)
                localStorage.setItem(
                  "training-sidebar-collapsed",
                  String(collapsed)
                )
              }}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </Button>
            <Link href="/" className="brand">
              <span className="brand-mark">
                <Dumbbell size={22} />
              </span>
              <span className="brand-name">Training log</span>
            </Link>
            <p className="sidebar-label">WORKSPACE</p>
            <nav aria-label="Main navigation">
              {nav.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  aria-label={label}
                  title={sidebarCollapsed ? label : undefined}
                  className={tab === id && !active ? "active" : ""}
                  onClick={() => void navigate(id)}
                >
                  <Icon size={19} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="platform-note">
                <Activity size={19} />
                <p>
                  Build with intention.
                  <br />
                  <strong>Log what happened.</strong>
                </p>
              </div>
              <div className="owner">
                <span className="avatar">
                  {owner.name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{owner.name}</strong>
                  <span>Personal workspace</span>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Sign out"
                  onClick={() => act(logout)}
                >
                  <LogOut size={16} />
                </Button>
              </div>
            </div>
          </aside>
          <div className="workspace">
            <div className="connection-strip">
              {!active && <AutosaveStatus ownerId={owner.id} />}
            </div>
            <main
              className={`main-content ${active || openingWorkout ? "session-content" : ""}`}
            >
              {error && (
                <div className="error-message" role="alert">
                  {error}
                  <button
                    aria-label="Dismiss error"
                    onClick={() => setError("")}
                  >
                    ×
                  </button>
                </div>
              )}
              <div
                className={openingWorkout ? undefined : "page-reveal"}
                key={
                  openingWorkout
                    ? "loading"
                    : (active?.id ?? `${tab}:${weekId}`)
                }
              >
                {openingWorkout ? (
                  <PageSkeleton page="workout" />
                ) : active ? (
                  <SessionView
                    key={active.id}
                    initial={active}
                    plan={workouts.find(
                      (workout) => workout.id === active.workoutId
                    )}
                    onDeleted={async () => {
                      leaveRef.current = null
                      navigationVersion.current++
                      writeLocation(
                        { tab: "week", weekId, sessionId: null },
                        true
                      )
                      setActive(null)
                      setTab("week")
                      await refreshSync()
                    }}
                    onBeforeLeave={(guard) => {
                      leaveRef.current = guard
                    }}
                    ownerId={owner.id}
                    exercises={exercises}
                    equipment={equipment}
                    onBack={() => {
                      if (window.history.state?.trainingFrom)
                        window.history.back()
                      else {
                        navigationVersion.current++
                        writeLocation({ tab, weekId, sessionId: null }, true)
                        setActive(null)
                      }
                      void refreshSync().catch((e) => setError(errorMessage(e)))
                    }}
                    onSaved={() => {
                      invalidateLedger()
                    }}
                    onPersistence={(promise) => {
                      persistenceRef.current = promise
                    }}
                  />
                ) : (
                  <>
                    {tab === "week" && (
                      <WeekHome
                        key={weekId}
                        name={owner.name}
                        weeks={weeks}
                        week={week}
                        workouts={workouts}
                        sessions={sessions}
                        ledger={ledger}
                        ledgerUnavailable={ledgerErrorWeekId === weekId}
                        online={online}
                        busy={busy}
                        canManage={!!trainingDefaults && online}
                        onSelectWeek={selectWeek}
                        onNewWeek={() => {
                          if (!trainingDefaults) return
                          setEditingWeek({
                            id: crypto.randomUUID(),
                            revision: 0,
                            startDate: weekStart(),
                            title: "Training week",
                            targets: { ...trainingDefaults.targets },
                            notes: "",
                          })
                        }}
                        onEditWeek={() => {
                          if (week) setEditingWeek(week)
                        }}
                        onRepeatWeek={() => {
                          if (!week) return
                          const date = new Date(`${week.startDate}T12:00:00`)
                          date.setDate(date.getDate() + 7)
                          setCopyDate(
                            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
                          )
                          setCopying(true)
                        }}
                        onEditGoals={() => setGoalsMode("week")}
                        onNewWorkout={() => newWorkout()}
                        onFromRoutine={() => {
                          if (week) setPlanDate(week.startDate)
                          setRoutinePicker(true)
                        }}
                        onOpenWorkout={(workout) => {
                          void act(() => openWorkout(workout))
                        }}
                        onOpenSession={(session) => {
                          void act(() => openSession(session))
                        }}
                      />
                    )}
                    {tab === "library" && (
                      <>
                        <Library
                          exercises={exercises}
                          equipment={equipment}
                          catalog={catalog}
                          onRefresh={refresh}
                        />
                        <section className="panel">
                          <div className="section-heading">
                            <div>
                              <h2>Reusable routines</h2>
                              <p>Your starting points for the next week.</p>
                            </div>
                            <Button
                              variant="outline"
                              onClick={() => newWorkout("routine")}
                            >
                              <Plus size={15} /> Routine
                            </Button>
                          </div>
                          <div className="record-list">
                            {routines.map((routine) => (
                              <button
                                className="routine-row"
                                key={routine.id}
                                onClick={() => {
                                  writeLocation({
                                    tab,
                                    weekId,
                                    sessionId: null,
                                    editor: routine.id,
                                  })
                                  setEditingWorkout(routine)
                                }}
                              >
                                <strong>{routine.title}</strong>
                                <span>
                                  {
                                    routine.blocks.flatMap((b) => b.items)
                                      .length
                                  }{" "}
                                  movements <ChevronRight size={15} />
                                </span>
                              </button>
                            ))}
                          </div>
                        </section>
                      </>
                    )}
                    {tab === "profile" && (
                      <Settings
                        ownerId={owner.id}
                        owner={owner}
                        onProfileSaved={(identity) => {
                          setOwner(identity)
                          sessionStorage.setItem(
                            "training-owner",
                            JSON.stringify(identity)
                          )
                        }}
                        onRefresh={refresh}
                        onSignOut={logout}
                        onTrainingGoals={() => setGoalsMode("defaults")}
                        canEditGoals={!!trainingDefaults && online}
                      />
                    )}
                  </>
                )}
              </div>
            </main>
          </div>
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {nav.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={tab === id && !active ? "active" : ""}
                onClick={() => void navigate(id)}
              >
                <Icon size={20} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          {editingWorkout && (
            <WorkoutEditor
              ownerId={owner.id}
              draftKey={
                editingWorkout.revision
                  ? `plan:${editingWorkout.id}`
                  : `new:${editingWorkout.kind}:${editingWorkout.weekId ?? "library"}`
              }
              workout={editingWorkout}
              exercises={exercises}
              equipment={equipment}
              onClose={closeEditor}
              onSave={async (value, base) => {
                const saved = await savePlanEdit(owner.id, value, base)
                const cached = await readCachedPlans(owner.id)
                if (cached) setWorkouts(cached.workouts)
                return saved
              }}
            />
          )}
          {editingWeek && (
            <Modal
              title={
                editingWeek.revision ? "Week details" : "New training week"
              }
              dirty={
                editingWeek.revision > 0
                  ? JSON.stringify(editingWeek) !==
                    JSON.stringify(
                      weeks.find((value) => value.id === editingWeek.id)
                    )
                  : editingWeek.title !== "Training week" ||
                    editingWeek.startDate !== weekStart()
              }
              onClose={() => setEditingWeek(null)}
            >
              <div className="form-grid">
                <Field label="Title">
                  <Input
                    value={editingWeek.title}
                    onChange={(e) =>
                      setEditingWeek({ ...editingWeek, title: e.target.value })
                    }
                  />
                </Field>
                <Field label="Week starts">
                  <Input
                    type="date"
                    value={editingWeek.startDate}
                    onChange={(e) =>
                      setEditingWeek({
                        ...editingWeek,
                        startDate: e.target.value,
                      })
                    }
                  />
                </Field>
              </div>
              <p className="muted">
                {Object.values(editingWeek.targets).reduce((a, b) => a + b, 0)}{" "}
                sets
                {editingWeek.revision
                  ? " in this week's target snapshot."
                  : " from your saved training goals."}
              </p>
              <div className="dialog-footer">
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const saved = await api.saveWeek(editingWeek)
                      await refresh()
                      selectWeek(saved.id)
                      setEditingWeek(null)
                    })
                  }
                >
                  Save week
                </Button>
              </div>
            </Modal>
          )}
          {copying && week && (
            <Modal
              title="Repeat this week"
              description="Copies plans using your saved training goals. Completed results stay with their original week."
              onClose={() => setCopying(false)}
            >
              <Field label="New week starts">
                <Input
                  type="date"
                  value={copyDate}
                  onChange={(e) => setCopyDate(e.target.value)}
                />
              </Field>
              <Button
                disabled={busy || !trainingDefaults}
                onClick={() =>
                  act(async () => {
                    const result = await api.copyWeek(week.id, copyDate)
                    await refresh()
                    selectWeek(result.id)
                    setCopying(false)
                  })
                }
              >
                <Copy size={16} /> Repeat week
              </Button>
            </Modal>
          )}
          {goalsMode && trainingDefaults && (
            <TrainingGoals
              defaults={trainingDefaults}
              week={goalsMode === "week" ? week : undefined}
              initialMode={goalsMode}
              onClose={() => setGoalsMode(null)}
              onRefresh={refresh}
            />
          )}
          {routinePicker && (
            <Modal
              title="Add a routine"
              onClose={() => setRoutinePicker(false)}
            >
              <Field label="Routine">
                <NativeSelect
                  label="Routine to add"
                  value={routineId}
                  onChange={setRoutineId}
                >
                  <option value="">Select routine</option>
                  {routines.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.title}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Workout date">
                <Input
                  type="date"
                  value={planDate}
                  onChange={(e) => setPlanDate(e.target.value)}
                />
              </Field>
              <Button
                disabled={!routineId || busy}
                onClick={() =>
                  act(async () => {
                    const routine = routines.find((r) => r.id === routineId)
                    if (!routine) return
                    await api.saveWorkout({
                      ...routine,
                      id: crypto.randomUUID(),
                      revision: 0,
                      kind: "planned",
                      routineId: routine.id,
                      weekId,
                      date: planDate,
                      blocks: cloneBlocks(routine),
                      source: null,
                    })
                    await refresh()
                    setRoutinePicker(false)
                  })
                }
              >
                Add to week
              </Button>
            </Modal>
          )}
        </div>
      </TimerProvider>
    </DisplayProvider>
  )
}

function blankWorkout(
  kind: "planned" | "routine",
  weekId: string,
  date: string
): WorkoutRecord {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    kind,
    routineId: null,
    weekId: kind === "planned" ? weekId : null,
    date: kind === "planned" ? date : null,
    title: "",
    focus: "",
    blocks: [newGroup([])],
    notes: "",
    source: null,
  }
}
