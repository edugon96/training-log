# Timer Sounds

The timer uses the **Crisp** pack from [Sensory UI](https://www.sensory-ui.com/docs/core/sound-packs), by Satyam Vyas, under the included MIT license.

| Event | Original Crisp Role |
|---|---|
| Custom duration selector | `interaction.subtle` |
| Preset, Start, Resume | `interaction.confirm` |
| 3, 2, 1 seconds remaining | `notification.info` |
| Timer complete | `notification.success` |

The original sound recipes are rendered to mono PCM WAV with Web Audio. The application schedules these buffers against the countdown deadline, retaining cancellation, iOS audio recovery, and offline playback. Pitch, waveform, note order, and envelopes are unchanged. Only trailing silence is trimmed. Playback uses the app's sound toggle and volume balance.

Source revision: [`20c0c763c0d169ccb7654e11f0f4dd19acac2b37`](https://github.com/SatyamVyas04/sensory-ui/tree/20c0c763c0d169ccb7654e11f0f4dd19acac2b37).

Regenerate with `node scripts/generate-timer-sounds.mjs`. The generator uses the existing TypeScript and Playwright development dependencies, downloads only the pinned sound-source files, and seeds the click's noise for reproducibility. `crisp-v1/manifest.json` records the exact roles, durations and checksums. Keep released asset paths immutable and use a new version directory when changing the sounds.
