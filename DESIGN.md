# SilentCatch — Design System

## World: the surgical light-table
The product is presented as a radiology light-table: warm paper, graphite ink, and one arterial-red
signal. Imaging is the only dark material in the system — a film held against the light. There is no
cyan neon, no glass, no gradient, no glow. Depth comes from tone steps and a single edge.

## Palette (roles, not decoration)
| Role | Token | Value |
| --- | --- | --- |
| Ground | `--paper` | `#F1EDE4` |
| Ground, deeper | `--paper-deep` | `#E7E1D4` |
| Sheet (app work surface) | `--sheet` | `#FBF9F4` |
| Sheet, secondary | `--sheet-2` | `#F5F2E9` |
| Ink | `--ink` | `#15171A` |
| Ink, secondary | `--ink-2` | `#2F3236` |
| Muted | `--muted` | `#6B6A63` |
| Faint | `--faint` | `#96928A` |
| Edge | `--edge` | `#DCD6C8` |
| Edge, strong | `--edge-2` | `#C6BFAD` |
| Signal (intercept / arterial) | `--signal` | `#B0232A` |
| Signal wash | `--signal-wash` | `#F2E1DF` |
| Safe | `--safe` | `#2C5A43` |
| Safe wash | `--safe-wash` | `#E4EBE3` |
| Warning | `--warn` | `#8A611E` |
| Warning wash | `--warn-wash` | `#F2E9D6` |
| Imaging chamber | `--night` | `#0A0B0C` |
| Imaging ink | `--night-ink` | `#EDE8DD` |

Red is a decision, not a decoration. It appears on the intercept, the flagged series, the redline,
and the one primary action that resolves it. It never appears as a background field on a page.

## Type
- **Display:** Instrument Serif (400, roman + italic), tracking −0.03em, leading 0.9–0.96. Used for
  the landing headline, section headings, and the verdict line in the console.
- **UI:** Geist Sans. 13–17px for running text; tabular figures for clinical values.
- **Data:** Geist Mono for IDs, units, character offsets, latencies, tokens. Never for prose.
- Two families only. No tiny tracked uppercase labels on the landing page.

## Composition
### Landing (Persuade)
Editorial report. A fixed 42% vertical axis organises the page: small notes and standfirsts sit to
its left, headings and body columns begin on it. A full-bleed imaging band opens the page; the
headline sits below it, flush to the axis. Sections do not repeat a layout: two giant specimens,
a 160-mark cascade diagram, a pinned 3D film, a typographic case ledger, alternating FAQ bands,
an inverted close.

### Console (Operate)
Tinted L-frame (`--paper-deep`) holds the 48px top bar; the work sits on a `--sheet` with a 1px
`--edge`, 16px radius, inset 8px from the right and bottom. Three equal columns, 20px gutters,
24px padding. Panels are flat: 1px edge, no shadow, 8px radius. Imaging viewports are the only
dark surfaces. Status is a tone step plus a 2px edge, not a glow.

## The 3D
A volume reconstructed from the key slice: 34 additive planes, a readable key slice at centre,
a red nodule beacon at the ROI, and a creatinine ribbon that rises through the evidence stage.
Scroll drives a camera that starts wide, dives to the lesion, pulls back as the packet appears,
and closes on the patch. The reconstruction is labelled as a reconstruction — it is not raw DICOM.

## Motion
Meaningful and bounded: scan sweep, camera dolly, redline draw, masked line reveals, 60–90ms
staggered entrances, number roll-ups. Transform and opacity only. Every motion has a
`prefers-reduced-motion` fallback that keeps the content and drops the travel.

## Bans
No cyan, violet, or neon. No glassmorphism, gradients, glows, or shadows at rest. No icon-topped
cards. No pill-shaped nav. No emoji in product UI. No fake accuracy numbers. No unlabelled replay.
