// Render the original Sensory UI Crisp recipes once, so our timer can schedule
// and cancel each whole cue against its existing iOS-safe audio clock.
import { chromium } from "@playwright/test"
import ts from "typescript"
import { mkdir, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"

const revision = "20c0c763c0d169ccb7654e11f0f4dd19acac2b37"
const repository = "https://github.com/SatyamVyas04/sensory-ui"
const sourceRoot = "components/ui/sensory-ui/sounds"
const sources = [
  "packs.ts",
  "core/effects.ts",
  "core/factory.ts",
  "core/instruments.ts",
  "core/pack-generator.ts",
  "core/tunes.ts",
]
const work = path.resolve(".local/timer-sounds-sensory")
const output = path.resolve("public/audio/timer/crisp-v1")
const roles = {
  tick: "interaction.subtle",
  start: "interaction.confirm",
  countdown: "notification.info",
  finish: "notification.success",
}
await mkdir(work, { recursive: true })
await mkdir(output, { recursive: true })
const fetchSource = async (file) => {
  const response = await fetch(
    `https://raw.githubusercontent.com/SatyamVyas04/sensory-ui/${revision}/${file}`
  )
  if (!response.ok)
    throw new Error(`Cannot read upstream ${file}: ${response.status}`)
  return response.text()
}
const modules = new Map(
  await Promise.all(
    sources.map(async (file) => {
      const code = await fetchSource(`${sourceRoot}/${file}`)
      await mkdir(path.dirname(path.join(work, file)), { recursive: true })
      await writeFile(path.join(work, file), code)
      return [
        file,
        ts.transpileModule(code, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      ]
    })
  )
)
await writeFile(path.join(output, "LICENSE.txt"), await fetchSource("LICENSE"))
const browser = await chromium.launch()
const manifest = {
  repository,
  revision,
  theme: "crisp",
  sampleRate: 44100,
  assets: {},
}
try {
  const page = await browser.newPage()
  await page.route("https://sounds.test/**", async (route) => {
    const file = new URL(route.request().url()).pathname.slice(1)
    if (!file)
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html>",
      })
    const code = modules.get(file.endsWith(".ts") ? file : `${file}.ts`)
    if (!code) throw new Error(`Unexpected source dependency: ${file}`)
    await route.fulfill({ contentType: "text/javascript", body: code })
  })
  await page.goto("https://sounds.test/")
  await page.addScriptTag({
    type: "module",
    content:
      'import { crispPack } from "/packs.ts"; window.crispPack = crispPack;',
  })
  await page.waitForFunction(() => !!window.crispPack)
  for (const [name, role] of Object.entries(roles)) {
    const samples = await page.evaluate(
      async ({ role, seed }) => {
        // The pack's click uses noise. A stable seed makes the checked-in asset reproducible.
        const random = Math.random
        let state = seed
        Math.random = () => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0
          return state / 4294967296
        }
        try {
          const context = new OfflineAudioContext(1, 88200, 44100)
          window.crispPack[role](context, { volume: 1 })
          const buffer = await context.startRendering()
          const data = buffer.getChannelData(0)
          let last = data.length - 1
          while (last > 0 && Math.abs(data[last]) < 0.00001) last--
          return Array.from(data.slice(0, Math.min(data.length, last + 222)))
        } finally {
          Math.random = random
        }
      },
      { role, seed: 20261102 }
    )
    const wave = Buffer.alloc(44 + samples.length * 2)
    wave.write("RIFF")
    wave.writeUInt32LE(wave.length - 8, 4)
    wave.write("WAVEfmt ", 8)
    wave.writeUInt32LE(16, 16)
    wave.writeUInt16LE(1, 20)
    wave.writeUInt16LE(1, 22)
    wave.writeUInt32LE(44100, 24)
    wave.writeUInt32LE(88200, 28)
    wave.writeUInt16LE(2, 32)
    wave.writeUInt16LE(16, 34)
    wave.write("data", 36)
    wave.writeUInt32LE(samples.length * 2, 40)
    samples.forEach((value, i) =>
      wave.writeInt16LE(
        Math.round(Math.max(-1, Math.min(1, value)) * 32767),
        44 + i * 2
      )
    )
    await writeFile(path.join(output, `${name}.wav`), wave)
    const peak = Math.max(...samples.map(Math.abs))
    if (!(peak > 0.001 && peak < 1))
      throw new Error(`${name} is silent or clipped: ${peak}`)
    manifest.assets[name] = {
      role,
      frames: samples.length,
      duration: samples.length / 44100,
      peak,
      sha256: createHash("sha256").update(wave).digest("hex"),
    }
  }
  await writeFile(
    path.join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  )
  console.log(JSON.stringify(manifest, null, 2))
} finally {
  await browser.close()
}
