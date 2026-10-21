import { describe, expect, it } from "vitest"
import { locationUrl, parseLocation } from "../lib/navigation"

describe("app locations", () => {
  it("defaults to Week without inventing a session", () => {
    expect(parseLocation("")).toEqual({
      tab: "week",
      weekId: "",
      sessionId: null,
    })
  })
  it("round-trips tabs, selected weeks and workout sessions", () => {
    const location = {
      tab: "profile" as const,
      weekId: "00000000-0000-4000-8000-000000000001",
      sessionId: "00000000-0000-4000-8000-000000000002",
    }
    expect(parseLocation(locationUrl(location).slice(1))).toEqual(location)
  })
  it("ignores invalid navigation parameters", () => {
    expect(
      parseLocation(
        "?tab=https://example.com&week=undefined&session=../../user"
      )
    ).toEqual({ tab: "week", weekId: "", sessionId: null })
  })
  it("round-trips an unopened workout and keeps legacy tab links usable", () => {
    const location = {
      tab: "week" as const,
      weekId: "00000000-0000-4000-8000-000000000001",
      sessionId: null,
      workoutId: "00000000-0000-4000-8000-000000000003",
    }
    expect(parseLocation(locationUrl(location).slice(1))).toEqual(location)
    expect(parseLocation("?tab=settings").tab).toBe("profile")
    expect(parseLocation("?tab=history").tab).toBe("week")
  })
})
