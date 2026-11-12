"use client"

import { confirmAction } from "./responsive-panel"

import { useEffect, useState } from "react"
import { Download, KeyRound, Plus, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, updateProfileName } from "@/lib/api-client"
import { ImportManifest } from "@/contracts/models"
import { Empty, Field, errorMessage } from "./shared"
import { TimerSettingsEditor } from "./timers"
import { DisplaySettings } from "./display-settings"

type Keys = Awaited<ReturnType<typeof api.listKeys>>
type Changes = Awaited<ReturnType<typeof api.changes>>
const scopes = [
  "read",
  "plans:write",
  "results:write",
  "library:write",
] as const
function download(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function Settings({
  ownerId,
  onRefresh,
  onSignOut,
  onTrainingGoals,
  canEditGoals,
  owner,
  onProfileSaved,
}: {
  ownerId: string
  onRefresh: () => Promise<void>
  onSignOut: () => Promise<void>
  onTrainingGoals: () => void
  canEditGoals: boolean
  owner: { id: string; name: string; email: string }
  onProfileSaved: (owner: { id: string; name: string; email: string }) => void
}) {
  const [keys, setKeys] = useState<Keys>([])
  const [displayName, setDisplayName] = useState(owner.name)
  const [profileStatus, setProfileStatus] = useState("")
  const [savingProfile, setSavingProfile] = useState(false)
  async function saveName() {
    const value = displayName.trim()
    if (value === owner.name || savingProfile) return
    if (!value || value.length > 200) {
      setProfileStatus("Enter a name between 1 and 200 characters.")
      return
    }
    setSavingProfile(true)
    setProfileStatus("Saving…")
    try {
      const updated = await updateProfileName(value)
      onProfileSaved(updated)
      setDisplayName(updated.name)
      setProfileStatus("Saved")
    } catch (error) {
      setProfileStatus(errorMessage(error))
    } finally {
      setSavingProfile(false)
    }
  }
  const [changes, setChanges] = useState<Changes>([])
  const [name, setName] = useState("")
  const [selectedScopes, setSelectedScopes] = useState<
    Array<(typeof scopes)[number]>
  >(["read"])
  const [secret, setSecret] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  async function refresh() {
    if (!navigator.onLine) return
    const [k, c] = await Promise.all([api.listKeys(), api.changes()])
    setKeys(k)
    setChanges(c)
  }
  useEffect(() => {
    let live = true
    if (navigator.onLine)
      void Promise.all([api.listKeys(), api.changes()])
        .then(([k, c]) => {
          if (live) {
            setKeys(k)
            setChanges(c)
          }
        })
        .catch((e) => {
          if (live) setError(errorMessage(e))
        })
    return () => {
      live = false
    }
  }, [ownerId])
  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your account</p>
          <h1>Profile</h1>
          <p className="muted">Your details and training preferences.</p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => act(onSignOut)}
        >
          Sign out
        </Button>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}
      <section className="panel">
        <h2>Your details</h2>
        <div className="form-grid mt-4">
          <Field label="Display name">
            <Input
              value={displayName}
              maxLength={200}
              disabled={savingProfile}
              onChange={(event) => setDisplayName(event.target.value)}
              onBlur={() => void saveName()}
            />
          </Field>
          <Field label="Email">
            <Input value={owner.email} readOnly />
          </Field>
        </div>
        {profileStatus && (
          <p className="muted text-sm" role="status">
            {profileStatus}
          </p>
        )}
      </section>
      <DisplaySettings />
      <section className="panel">
        <div className="section-heading">
          <h2>Training goals</h2>
        </div>
        <p className="muted">
          Default weekly targets for new and repeated weeks. Existing weeks keep
          their own targets.
        </p>
        <Button
          variant="outline"
          disabled={!canEditGoals}
          onClick={onTrainingGoals}
        >
          Training goals
        </Button>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>Timers</h2>
        </div>
        <TimerSettingsEditor />
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>API access</h2>
            <p>Give an agent a named key with only the permissions it needs.</p>
          </div>
          <KeyRound size={20} />
        </div>
        <div className="form-grid">
          <Field label="Key name">
            <Input
              placeholder="Workout planning agent"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="scope-picker">
            {scopes.map((scope) => (
              <label className="check-label" key={scope}>
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope)}
                  onChange={(e) =>
                    setSelectedScopes(
                      e.target.checked
                        ? [...selectedScopes, scope]
                        : selectedScopes.filter((s) => s !== scope)
                    )
                  }
                />
                {scope}
              </label>
            ))}
          </div>
        </div>
        <Button
          disabled={busy || !name.trim() || !selectedScopes.length}
          onClick={() =>
            act(async () => {
              const result = await api.createKey(name, selectedScopes)
              setSecret(result.key)
              setName("")
              await refresh()
            })
          }
        >
          <Plus size={16} /> Create key
        </Button>
        {secret && (
          <div className="secret-box">
            <strong>Copy this key now. It is only shown once.</strong>
            <code>{secret}</code>
            <div className="row">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  act(async () => {
                    await navigator.clipboard.writeText(secret)
                    setMessage("Key copied.")
                  })
                }
              >
                Copy key
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSecret("")}>
                Dismiss
              </Button>
            </div>
          </div>
        )}
        <div className="record-list">
          {keys.map((key) => (
            <div className="row spread" key={key.id}>
              <div>
                <strong>{key.name}</strong>
                <p className="muted">
                  {key.prefix}… · {key.scopes.join(", ")}
                  {key.revokedAt ? " · Revoked" : ""}
                </p>
              </div>
              {!key.revokedAt && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirmAction(
                        `Revoke ${key.name}? It will stop working immediately.`
                      )
                    )
                      void act(async () => {
                        await api.revokeKey(key.id)
                        await refresh()
                      })
                  }}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
        <p className="muted">
          API reference:{" "}
          <a href="/openapi.json" target="_blank" rel="noreferrer">
            OpenAPI contract
          </a>
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Backup & restore</h2>
            <p>
              JSON preserves the full record. CSV exports actual set results.
            </p>
          </div>
        </div>
        <div className="row wrap">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const data = await api.exportData("json")
                download(
                  JSON.stringify(data, null, 2),
                  "application/json",
                  `workout-backup-${new Date().toISOString().slice(0, 10)}.json`
                )
              })
            }
          >
            <Download size={16} /> Export JSON
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(async () =>
                download(
                  await api.exportData("csv"),
                  "text/csv",
                  "workout-results.csv"
                )
              )
            }
          >
            <Download size={16} /> Export CSV
          </Button>
          <label className={`file-button ${busy ? "disabled" : ""}`}>
            <Upload size={16} /> Import JSON
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file)
                  void act(async () => {
                    const manifest = ImportManifest.parse(
                      JSON.parse(await file.text())
                    )
                    if (
                      !(await confirmAction(
                        `Import ${manifest.weeks.length} weeks and ${manifest.sessions.length} sessions? Existing conflicting records will not be overwritten.`
                      ))
                    )
                      return
                    const result = await api.importData(manifest)
                    await onRefresh()
                    await refresh()
                    setMessage(`Import complete. ${JSON.stringify(result)}`)
                  })
                e.target.value = ""
              }}
            />
          </label>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Activity</h2>
            <p>Changes by you and your connected agents.</p>
          </div>
        </div>
        {changes.length ? (
          <div className="record-list">
            {changes.slice(0, 50).map((change) => (
              <div className="audit-row" key={change.id}>
                <span className="audit-dot" />
                <div>
                  <strong>{change.actor}</strong> {change.action}{" "}
                  {change.entityType}
                  <p className="muted">
                    {new Date(change.at).toLocaleString()} · Revision{" "}
                    {change.revision}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No changes yet" />
        )}
      </section>
    </>
  )
}
