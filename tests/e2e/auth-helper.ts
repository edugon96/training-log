import { expect, type APIRequestContext, type Page } from "@playwright/test"

/** Respect production login throttling during consecutive disposable-owner tests. */
export async function signIn(
  context: APIRequestContext,
  email: string,
  password: string
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await context.post("/api/auth/sign-in/email", {
      data: { email, password },
    })
    if (response.status() !== 429 || attempt === 3) return response
    const retry = response.headers()["retry-after"]
    const seconds = Number(retry)
    const delay =
      Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000
        : Math.max(1000, Date.parse(retry ?? "") - Date.now()) || 11000
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(delay + 250, 15000))
    )
  }
  throw new Error("Login retry exhausted")
}

export async function signInPage(page: Page, email: string, password: string) {
  await page.goto("/")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  for (let attempt = 0; attempt < 4; attempt++) {
    const pending = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/sign-in/email")
    )
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    const response = await pending
    if (response.status() !== 429) {
      expect(response.ok(), await response.text()).toBe(true)
      return
    }
    const seconds = Number(response.headers()["retry-after"] || "10")
    await page.waitForTimeout(
      (Number.isFinite(seconds) ? Math.max(1, seconds) : 10) * 1000 + 250
    )
  }
  throw new Error("Login retry exhausted")
}
