"use client"

import { useState, useSyncExternalStore } from "react"
import {
  Check,
  ChevronRight,
  Copy,
  ListChecks,
  MoreHorizontal,
  Plus,
  Settings2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ActionMenu } from "./responsive-panel"
import {
  muscleLabels,
  muscleNames,
  type LedgerRecord,
  type SessionRecord,
  type WeekRecord,
  type WorkoutRecord,
} from "@/contracts/models"
import { weekLabel } from "@/lib/presentation"
import {
  summarizeWeek,
  greetingForHour,
  trainingTimeLabel,
  workoutSession,
} from "@/lib/week-summary"
import { Empty, Modal, NativeSelect, dateLabel, today } from "./shared"

type Props = {
  name: string
  weeks: WeekRecord[]
  week?: WeekRecord
  workouts: WorkoutRecord[]
  sessions: SessionRecord[]
  ledger: LedgerRecord | null
  ledgerUnavailable: boolean
  online: boolean
  busy: boolean
  canManage: boolean
  onSelectWeek: (id: string) => void
  onNewWeek: () => void
  onEditWeek: () => void
  onRepeatWeek: () => void
  onEditGoals: () => void
  onNewWorkout: () => void
  onFromRoutine: () => void
  onOpenWorkout: (workout: WorkoutRecord) => void
  onOpenSession: (session: SessionRecord) => void
}

function subscribeGreeting(update: () => void) {
  const interval = window.setInterval(update, 60000)
  document.addEventListener("visibilitychange", update)
  return () => {
    clearInterval(interval)
    document.removeEventListener("visibilitychange", update)
  }
}
const localHour = () => new Date().getHours()
const serverHour = () => null

export function WeekHome(props: Props) {
  const {
    name,
    weeks,
    week,
    workouts,
    sessions,
    ledger,
    busy,
    online,
    canManage,
  } = props
  const [showLedger, setShowLedger] = useState(false)
  const hour = useSyncExternalStore(subscribeGreeting, localHour, serverHour)
  const days = workouts
    .filter(
      (workout) => workout.weekId === week?.id && workout.kind === "planned"
    )
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
  const summary = summarizeWeek(week?.id ?? "", workouts, sessions)
  const selectedLedger =
    !props.ledgerUnavailable && ledger?.weekId === week?.id ? ledger : null
  const firstName = name.trim().split(/\s+/)[0]
  const currentDate = today()
  const action = (workout: WorkoutRecord) => {
    const session = workoutSession(workout.id, sessions)
    return {
      session,
      label: session
        ? session.status === "active"
          ? "Resume"
          : "View results"
        : "Start",
    }
  }

  return (
    <div className="week-home">
      <div className="home-greeting">
        <h1>
          {hour === null ? "Hello" : greetingForHour(hour)}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p>Here’s your training week.</p>
      </div>
      <div className="home-week-toolbar">
        <div className="home-week-select">
          <NativeSelect
            label="Selected week"
            value={week?.id ?? ""}
            onChange={props.onSelectWeek}
            disabled={!weeks.length}
          >
            <option value="" disabled>
              Select a week
            </option>
            {weeks.map((value) => (
              <option key={value.id} value={value.id}>
                {weekLabel(value.startDate)}
                {!/^(?:week(?: of)?\b|training week$)/i.test(value.title.trim())
                  ? ` · ${value.title}`
                  : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        <ActionMenu
          label="Week actions"
          trigger={<MoreHorizontal size={22} />}
          actions={[
            {
              label: "Muscle ledger",
              icon: ListChecks,
              disabled: !week,
              onSelect: () => setShowLedger(true),
            },
            {
              label: "Week details",
              icon: Settings2,
              disabled: !week || !online,
              onSelect: props.onEditWeek,
            },
            {
              label: "Repeat week",
              icon: Copy,
              disabled: !week || !canManage,
              onSelect: props.onRepeatWeek,
            },
            {
              label: "New workout",
              icon: Plus,
              separator: true,
              disabled: !week || !online,
              onSelect: props.onNewWorkout,
            },
            {
              label: "Add from routine",
              icon: Plus,
              disabled: !week || !online,
              onSelect: props.onFromRoutine,
            },
            {
              label: "New week",
              icon: Plus,
              separator: true,
              disabled: !canManage,
              onSelect: props.onNewWeek,
            },
          ]}
        />
      </div>
      {week ? (
        <>
          <section className="home-progress" aria-label="Weekly progress">
            <dl className="home-stats">
              <div>
                <dt>Workouts</dt>
                <dd>
                  {summary.completed}
                  <span> / {summary.planned}</span>
                </dd>
                <small>completed</small>
              </div>
              <div>
                <dt>Logged time</dt>
                <dd>{trainingTimeLabel(summary.durationMs)}</dd>
                <small>
                  {summary.missingTimes
                    ? `${summary.timedSessions} of ${summary.completedSessions} timed`
                    : "completed workouts"}
                </small>
              </div>
              <div>
                <dt>Working sets</dt>
                <dd>{selectedLedger?.completedTotal ?? "—"}</dd>
                <small>
                  {selectedLedger
                    ? "logged"
                    : props.ledgerUnavailable
                      ? "unavailable"
                      : online
                        ? "loading…"
                        : "unavailable offline"}
                </small>
              </div>
            </dl>
            <div
              className="home-progress-track"
              role="progressbar"
              aria-label="Workouts completed"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, summary.planned)}
              aria-valuenow={summary.completed}
            >
              <span
                style={{
                  width: `${summary.planned ? (summary.completed / summary.planned) * 100 : 0}%`,
                }}
              />
            </div>
            {!online && (
              <p className="home-sync-note">
                Offline · showing last loaded weekly progress.
              </p>
            )}
          </section>
          <section
            className="home-workouts"
            aria-labelledby="home-workouts-heading"
          >
            <div className="home-section-heading">
              <h2 id="home-workouts-heading">Your workouts</h2>
              <span>{days.length} planned</span>
            </div>
            <div className="home-workout-list">
              {days.map((workout) => {
                const { session } = action(workout)
                const isToday = workout.date === currentDate
                const blocks = session?.blocks ?? workout.blocks
                const items = blocks.flatMap((block) => block.items)
                const plannedSets = items.reduce(
                  (sum, item) => sum + item.sets.length,
                  0
                )
                const loggedSets =
                  session?.results.filter(
                    (result) => result.status === "completed"
                  ).length ?? 0
                return (
                  <button
                    key={workout.id}
                    type="button"
                    aria-label={`Open ${workout.title}`}
                    disabled={busy}
                    onClick={() => props.onOpenWorkout(workout)}
                    className={[
                      "home-workout-card",
                      isToday && "is-today",
                      session?.status === "completed" && "is-complete",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="home-workout-preview">
                      <span className="home-workout-date">
                        <span>
                          {dateLabel(workout.date, { weekday: "short" })}
                        </span>
                        <strong>
                          {dateLabel(workout.date, { day: "numeric" })}
                        </strong>
                      </span>
                      <span className="home-workout-copy">
                        <strong>{workout.title}</strong>
                        <span>
                          {items.length}{" "}
                          {items.length === 1 ? "movement" : "movements"} ·{" "}
                          {session
                            ? `${loggedSets} / ${plannedSets} sets logged`
                            : `${plannedSets} sets`}
                        </span>
                      </span>
                      <ChevronRight size={18} aria-hidden="true" />
                    </span>
                    <span className="home-workout-bottom">
                      <span
                        className={[
                          "home-workout-status",
                          session?.status === "completed" && "done",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {session?.status === "completed" && <Check size={14} />}
                        {isToday && (
                          <span className="home-today-label">Today</span>
                        )}
                        {session
                          ? session.status === "active"
                            ? "In progress"
                            : "Completed"
                          : "Planned"}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            {sessions
              .filter(
                (session) =>
                  session.weekId === week?.id &&
                  !days.some(
                    (workout) =>
                      workoutSession(workout.id, sessions)?.id === session.id
                  )
              )
              .map((session) => (
                <button
                  className="home-workout-card home-workout-preview"
                  key={session.id}
                  type="button"
                  disabled={busy}
                  onClick={() => props.onOpenSession(session)}
                >
                  <span className="home-workout-date">
                    {dateLabel(session.performedOn)}
                  </span>
                  <span className="home-workout-copy">
                    <strong>{session.title}</strong>
                    <span>
                      {session.status === "completed"
                        ? "Completed"
                        : "In progress"}
                    </span>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
            {!days.length && (
              <Empty title="A clear week ahead">
                <p>Add a workout or repeat a previous week to get started.</p>
                <Button disabled={!online} onClick={props.onNewWorkout}>
                  <Plus size={16} />
                  Add workout
                </Button>
              </Empty>
            )}
          </section>
        </>
      ) : (
        <Empty title="Start your first week">
          <p>Plan your workouts, then track your progress here.</p>
          <Button disabled={!canManage} onClick={props.onNewWeek}>
            <Plus size={16} />
            New week
          </Button>
        </Empty>
      )}

      {showLedger && week && (
        <Modal
          title="Muscle ledger"
          description={weekLabel(week.startDate)}
          onClose={() => setShowLedger(false)}
        >
          {!selectedLedger ? (
            <p className="muted">
              {props.ledgerUnavailable
                ? "Weekly sets could not be loaded. Reload to try again."
                : online
                  ? "Loading weekly sets…"
                  : "The ledger is unavailable offline."}
            </p>
          ) : (
            <div className="home-ledger-table">
              <table>
                <thead>
                  <tr>
                    <th>Muscle</th>
                    <th>Plan</th>
                    <th>Done</th>
                    <th>Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {muscleNames.map((muscle) => {
                    const row = selectedLedger.rows.find(
                      (value) => value.muscle === muscle
                    )
                    return (
                      <tr key={muscle}>
                        <th scope="row">{muscleLabels[muscle]}</th>
                        <td>{row?.planned ?? 0}</td>
                        <td>{row?.completed ?? 0}</td>
                        <td>{week.targets[muscle]}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted text-sm">
            Working lifting sets, credited once to their primary muscle. Power
            and conditioning stay separate.
          </p>
          <div className="dialog-footer">
            <Button
              variant="outline"
              disabled={!canManage}
              onClick={() => {
                setShowLedger(false)
                props.onEditGoals()
              }}
            >
              Edit week targets
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
