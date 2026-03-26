# Vigil — Brand & Design Context

This file is the single source of truth for Vigil's visual and verbal identity.
AI agents and contributors should read this before creating any design assets, copy, or UI code.

---

## Product positioning

**Vigil** is a CLI-first, AI-agent-native SIEM. Primary consumers are AI agents (Claude Code, Codex, etc.)
that ingest events, query alerts, and propose responses. Humans stay in the loop via HITL approval flows.

**One-line pitch:** "The SIEM your AI agents can actually use."

**Three pillars:**
1. Structured JSON output on every command — agents reason about it directly
2. Real-time Sigma detection — rules deploy in seconds, fire in milliseconds
3. Human-in-the-loop — agents propose, humans approve destructive actions

---

## Color palette

| Token | Hex | Usage |
|---|---|---|
| `--bg-primary` | `#080B10` | Page background |
| `--bg-card` | `#0E1117` | Card / panel backgrounds |
| `--bg-elevated` | `#161B22` | Elevated surfaces, title bars |
| `--border-subtle` | `#1E2633` | All borders, dividers |
| `--text-primary` | `#E2E8F0` | Body text, headings |
| `--text-muted` | `#718096` | Secondary text, labels, placeholders |
| `--accent-cyan` | `#00E5FF` | **Primary brand accent** — CTAs, links, highlights |
| `--accent-amber` | `#FFB547` | Alerts, warnings, attention signals |
| `--accent-red` | `#F85149` | Critical severity, errors |
| `--accent-green` | `#3FB950` | Success, safe state, online indicators |

**Design philosophy:** Dark terminal aesthetic — "engineer-honest, not hacker-edgy".
Mirrors the CLI environment that is the product's native habitat.
Cyan reads as "machine intelligence" — it is the AI color. Own it.

---

## Typography

| Role | Font | Weights | Usage |
|---|---|---|---|
| Display / Headings | Space Grotesk | 700, 600 | H1–H3, nav, buttons, badges |
| Body | Inter | 400, 500 | Paragraphs, labels, descriptions |
| Code / Mono | JetBrains Mono | 400, 500 | CLI commands, JSON, code blocks |

**Type scale:** H1 48–60px · H2 36–42px · H3 24–28px · Body 14–16px · Caption 12px · Code 12–13px

---

## Logo

**Concept: Sentinel Eye**
- Upper arc (eyelid): `#E2E8F0` (off-white), thin curved stroke, no lower lid
- Pupil: filled circle `#00E5FF` with `drop-shadow(0 0 6px #00E5FF)` glow
- Wordmark: "vigil" (all lowercase) in Space Grotesk Bold next to the mark

**Do:**
- Use the mark alone at small sizes (favicon, app icon)
- Allow the cyan glow on dark backgrounds
- Maintain the asymmetry (no lower lid)

**Don't:**
- Add a lower eyelid — it makes it static
- Use on light backgrounds without adjusting contrast
- Modify the pupil color

---

## Copy voice

**Tone:** Confident, direct, technical. No enterprise fluff.
**Audience:** Security engineers, DevSecOps, AI agent developers.
**Not:** CISOs, marketing readers, non-technical buyers.

**Rules:**
- Short sentences over long
- Concrete claims over abstract ("< 50ms detection" over "real-time protection")
- Use `code` formatting in prose for CLI commands
- Never use: "revolutionary", "paradigm", "synergy", "leverage"
- Use: "structured", "deterministic", "autonomous", "signal", "watch"

**Key copy:**
- Hero H1: "The SIEM your AI agents can actually use."
- Tagline: "Built for agents. Watched by humans."
- Footer: "© 2026 Vigil. Built for agents. Watched by humans."

---

## Component patterns

**Cards:** `bg-bg-card`, `border border-border-subtle`, `rounded-xl`, no fill — border only.
**Buttons primary:** `bg-accent-cyan text-bg-primary`, font-display font-semibold, with subtle glow shadow.
**Buttons secondary:** `border border-border-subtle text-text-muted hover:text-text-primary`.
**Code blocks:** `bg-bg-primary border border-border-subtle rounded-lg p-3 font-mono text-xs`.
**Badges:** `border border-[color]/30 bg-[color]/5 text-[color] font-mono text-xs`.
**Section headers:** small-caps eyebrow in accent-cyan + large display heading below.

---

## Image asset slots

All image slots have CSS-only fallbacks (gradient mesh). Images are optional enhancements.

| Slot | Path | Midjourney prompt |
|---|---|---|
| Hero bg | `public/images/hero-bg.png` | dark terminal room, server rack glow, electric teal light, cinematic, wide angle, no people, 16:9 |
| OG image | `public/og-image.png` | dark card, "Vigil" wordmark, subtle cyan glow, 1200×630 |
| Agent session | `public/images/agent-session.png` | split screen terminal, JSON output, dark UI, cyan syntax highlights |
| MITRE grid bg | `public/images/grid-bg.png` | abstract dark network graph, teal glowing lines, no text, 1:1 |
| Blog default | `public/images/blog-default.png` | dark abstract tech pattern, teal geometric lines, 16:9 |

---

## What this website is NOT

The marketing site at `website/` is completely separate from `vigil web start` (the embedded
HITL dashboard). The marketing site has no runtime connection to the Vigil API. It is a
static/SSG Next.js site deployed on Vercel. It never shows live event data.
