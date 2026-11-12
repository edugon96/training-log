import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { TimerFace } from "../components/tracker/timer-face"

function rest(milliseconds: number, totalMs = 90_000) {
  const html = renderToStaticMarkup(
    createElement(TimerFace, {
      mode: "rest",
      milliseconds,
      totalMs,
      label: "Rest countdown",
      active: true,
    })
  )
  return {
    text: html.match(/class="timer-digits[^\"]*">([^<]+)/)?.[1],
    lit: (html.match(/class="timer-tick[^\"]*is-lit/g) ?? []).length,
    marks: (html.match(/<line /g) ?? []).length,
  }
}

test("rest marks and digits change together at each second, including the final second", () => {
  for (const total of [30, 60, 90, 120, 180]) {
    expect(rest(total * 1000, total * 1000).marks).toBe(total)
    for (const ms of [1000, 501, 100, 1]) {
      expect(rest(ms, total * 1000)).toMatchObject({ text: "0:01", lit: 1 })
    }
    expect(rest(0, total * 1000)).toMatchObject({ text: "0:00", lit: 0 })
  }
  for (const ms of [90_000, 89_999, 89_500, 89_001]) {
    expect(rest(ms)).toEqual({ text: "1:30", lit: 90, marks: 90 })
  }
  expect(rest(89_000)).toEqual({ text: "1:29", lit: 89, marks: 90 })
  expect(rest(60_001)).toMatchObject({ text: "1:01", lit: 61 })
  expect(rest(60_000)).toMatchObject({ text: "1:00", lit: 60 })
})

test("long timers keep readable marks and extensions use the new duration", () => {
  expect(rest(3_600_000, 3_600_000)).toEqual({
    text: "1:00:00",
    lit: 180,
    marks: 180,
  })
  expect(rest(3_599_500, 3_600_000).lit).toBe(180)
  expect(rest(3_580_000, 3_600_000).lit).toBe(179)
  expect(rest(80_500, 120_000)).toEqual({ text: "1:21", lit: 81, marks: 120 })
})

test("the workout hand sits on the second shown by the digits", () => {
  for (const ms of [29_000, 29_500, 29_999]) {
    const html = renderToStaticMarkup(
      createElement(TimerFace, {
        mode: "workout",
        milliseconds: ms,
        label: "Workout clock",
      })
    )
    expect(html).toContain("--sweep:174deg")
    expect(html).toContain(">0:29</span>")
    expect((html.match(/<line /g) ?? []).length).toBe(60)
  }
})
