"use client"

import { useSyncExternalStore, type CSSProperties } from "react"
import { parseLocation, type AppTab } from "@/lib/navigation"

type LoadingPage = AppTab | "workout"
function subscribeLocation(update: () => void) {
  window.addEventListener("popstate", update)
  return () => window.removeEventListener("popstate", update)
}
const locationSnapshot = () => window.location.search
const serverLocation = () => null

function Line({
  width = "100%",
  height = 14,
}: {
  width?: string
  height?: number
}) {
  return (
    <span
      className="skeleton-line"
      style={{ width, height } as CSSProperties}
    />
  )
}
function Heading() {
  return (
    <div className="skeleton-heading">
      <Line width="72%" height={34} />
      <Line width="55%" />
    </div>
  )
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="skeleton-card">{children}</div>
}

export function PageSkeleton({ page }: { page: LoadingPage }) {
  return (
    <section
      className={`page-skeleton skeleton-${page}`}
      role="status"
      aria-label={`Loading ${page}`}
      aria-busy="true"
      data-loading-page={page}
    >
      <span className="sr-only">Loading {page}</span>
      <div aria-hidden="true">
        <Heading />
        {page === "week" && (
          <>
            <div className="skeleton-toolbar">
              <Line width="52%" height={20} />
            </div>
            <Card>
              <div className="skeleton-metrics">
                {[0, 1, 2].map((item) => (
                  <div key={item}>
                    <Line width="70%" height={10} />
                    <Line width="75%" height={26} />
                    <Line width="60%" height={10} />
                  </div>
                ))}
              </div>
              <Line height={3} />
            </Card>
            <div className="skeleton-toolbar">
              <Line width="38%" height={20} />
            </div>
            {[0, 1, 2, 3].map((item) => (
              <Card key={item}>
                <div className="skeleton-workout-row">
                  <div>
                    <Line width="28px" height={10} />
                    <Line width="34px" height={32} />
                  </div>
                  <div>
                    <Line width="78%" height={18} />
                    <Line width="64%" height={12} />
                    <Line width="40%" height={12} />
                  </div>
                </div>
              </Card>
            ))}
          </>
        )}
        {page === "workout" && (
          <>
            <Line height={3} />
            {[0, 1, 2].map((item) => (
              <Card key={item}>
                <Line width="65%" height={22} />
                <Line width="45%" height={12} />
                {[0, 1, 2].map((row) => (
                  <div className="skeleton-set-row" key={row}>
                    <Line width="18px" />
                    <Line height={14} />
                    <Line height={40} />
                    <Line height={40} />
                  </div>
                ))}
              </Card>
            ))}
          </>
        )}
        {page === "library" && (
          <>
            <div className="skeleton-toolbar">
              <Line width="100%" height={42} />
            </div>
            <div className="library-grid">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <Card key={item}>
                  <Line width="72%" height={20} />
                  <Line width="48%" />
                  <Line width="60%" />
                </Card>
              ))}
            </div>
          </>
        )}
        {page === "profile" &&
          [0, 1, 2].map((item) => (
            <Card key={item}>
              <Line width="40%" height={20} />
              <div className="form-grid">
                <div>
                  <Line width="35%" height={10} />
                  <Line height={44} />
                </div>
                <div>
                  <Line width="35%" height={10} />
                  <Line height={44} />
                </div>
              </div>
            </Card>
          ))}
      </div>
    </section>
  )
}

export function TrackerSkeleton({
  sidebarCollapsed,
}: {
  sidebarCollapsed: boolean
}) {
  const search = useSyncExternalStore(
    subscribeLocation,
    locationSnapshot,
    serverLocation
  )
  const route = search === null ? null : parseLocation(search)
  const page = route?.sessionId || route?.workoutId ? "workout" : route?.tab
  return (
    <div
      className={`app-shell skeleton-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <aside className="sidebar" aria-hidden="true">
        <Line width="75%" height={24} />
        <Line width="80%" height={40} />
        <Line width="80%" height={40} />
        <Line width="80%" height={40} />
      </aside>
      <div className="workspace">
        <header className="topbar" aria-hidden="true">
          <Line width="145px" height={20} />
        </header>
        <main
          className={`main-content ${page === "workout" ? "session-content" : ""}`}
        >
          {page ? (
            <PageSkeleton page={page} />
          ) : (
            <div role="status" aria-label="Loading page">
              <div aria-hidden="true">
                <Heading />
              </div>
            </div>
          )}
        </main>
      </div>
      <div className="mobile-nav" aria-hidden="true">
        {[0, 1, 2].map((item) => (
          <div className="skeleton-nav-item" key={item}>
            <Line width="24px" height={24} />
            <Line width="38px" height={8} />
          </div>
        ))}
      </div>
    </div>
  )
}
