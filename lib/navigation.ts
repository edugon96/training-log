export type AppTab = "week" | "library" | "profile"
export type AppLocation = {
  tab: AppTab
  weekId: string
  sessionId: string | null
  workoutId?: string | null
}
const tabs: AppTab[] = ["week", "library", "profile"]
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export function parseLocation(search: string): AppLocation {
  const params = new URLSearchParams(search)
  const rawTab = params.get("tab")
  const tab = (rawTab === "settings" ? "profile" : rawTab) as AppTab
  const week = params.get("week") ?? ""
  const session = params.get("session") ?? ""
  const workout = params.get("workout") ?? ""
  return {
    tab: tabs.includes(tab) ? tab : "week",
    weekId: uuid.test(week) ? week : "",
    sessionId: uuid.test(session) ? session : null,
    ...(uuid.test(workout) ? { workoutId: workout } : {}),
  }
}
export function locationUrl(location: AppLocation) {
  const params = new URLSearchParams({ tab: location.tab })
  if (location.weekId) params.set("week", location.weekId)
  if (location.sessionId) params.set("session", location.sessionId)
  else if (location.workoutId) params.set("workout", location.workoutId)
  return `/?${params}`
}
export function writeLocation(location: AppLocation, replace = false) {
  const url = locationUrl(location)
  const previous = window.location.pathname + window.location.search
  if (url === previous) return
  if (replace) window.history.replaceState({ ...window.history.state }, "", url)
  else window.history.pushState({ trainingFrom: previous }, "", url)
}
