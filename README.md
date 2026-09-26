# JEV Adventure Game

A visual AI-powered text adventure where every outcome is decided by **Jev** — TypeSafe's structured decision model. No random dice, no pre-written paths. Jev reads the full game state and picks what happens.

## What is it?

JEV Adventure Game is a single-player adventure that runs in the browser. You explore a dark fantasy world by choosing actions from Jev-rated cards or typing your own. Every turn, Jev makes **7 real decisions**: outcome, consequence type, danger level, significance, and a risk rating for every action card.

A separate narrator describes what happened — but cannot overrule Jev. If Jev says you failed, the story describes a failure.

## How it works

Each turn, Jev answers typed questions about your action:

- **Outcome** — success, partial, or fail (with calibrated confidence)
- **Consequence** — picked from a typed menu: `find_item`, `trigger_trap`, `reveal_passage`, `wake_enemy`, `gain_clue`, `nothing_notable`, `meet_npc`
- **Danger** — safe, risky, or deadly
- **Risk ratings** — each choice card gets a live risk tag (Safe / Risky / Dangerous), also decided by Jev from the current game state

Results are shown as a dice roll vs difficulty check (derived from Jev's real probabilities), then the consequence type and narration.

## Features

- **Choice cards with risk tags** — 3 contextual actions per turn, each rated by Jev as Safe / Risky / Dangerous. Same action gets different risk at different HP and chaos levels.
- **Jev's Read toggle** — flip it on to see raw Jev decisions: probabilities, confidence scores, consequence breakdowns. Off by default for immersion, on for demos.
- **Chaos meter** — tracks recklessness (0–10). Reckless failures raise chaos; cautious successes lower it. Jev reads the chaos level, so the world gets harsher as you push your luck.
- **Typed consequences** — Jev doesn't just say "pass/fail." It picks what happens from a structured menu, turning it from a dice roller into a situation reader.
- **Inventory tracking** — items gained and lost are tracked live. The narrator adds items on `find_item` consequences and removes consumed items.
- **Shareable end card** — "I survived 9 turns · 14 real Jev decisions · $0.003 spent"
- **Custom actions** — type anything below the choice cards. Jev evaluates it the same way.

## Damage rules

- **Success** — no health cost.
- **Partial + deadly** — −1 HP.
- **Fail + risky** — −1 HP.
- **Fail + deadly** — −2 HP.

When HP hits zero, game over. The end card shows your stats.

## Setup

Install dependencies:

```bash
npm install
```

Add your OpenRouter API key to `.env.local`:

```
OPENROUTER_API_KEY=sk-or-...
```

Start the game:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

Each turn makes **3 API calls** through a single server route (`src/app/api/turn/route.ts`):

1. **Jev outcome** (`~typesafe/jev-latest` via OpenRouter Decisions API) — 4 parallel questions: outcome, consequence, danger, noteworthy
2. **Narrator** (`openai/gpt-4o-mini` via OpenRouter Chat API) — takes Jev's ruling, writes narration, generates 3 contextual choices for the next turn
3. **Jev risk** (`~typesafe/jev-latest`) — rates risk for each new choice given current game state

The OpenRouter API key stays server-side. Game state lives in React state only — no database, one session at a time.

**Stack:** Next.js (App Router) + TypeScript + Tailwind CSS
