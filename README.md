# ChatGPT Meter

Private Firefox/Chromium browser-extension project for estimating how large the current ChatGPT conversation has become and warning before a handoff is prudent.

## Goal

Provide a small always-visible meter for long ChatGPT conversations without pretending that historical conversation size equals the model's live context window.

The project keeps three concepts separate:

1. **History size** — estimated tokens/content on the active conversation branch.
2. **Structural pressure** — message/node/hidden/compaction signals that may correlate with ChatGPT's practical conversation lifespan.
3. **Confirmed limit** — only when ChatGPT itself reports that the maximum conversation length was reached.

Percentages must always name their denominator. Unknown limits stay unknown.

## Architecture

```text
ChatGPT page
  -> MAIN-world fetch observer
  -> parse /backend-api/conversation/{id}
  -> aggregate active-branch metrics in-page
  -> JSON-only aggregate CustomEvent
  -> isolated extension content script
  -> small UI / future warnings
```

Raw conversation text must not cross the MAIN-world/extension bridge or leave the browser.

## Current status

Initial research + skeleton only. The skeleton is intentionally small; it proves the data path and displays a minimal badge. The real meter UI, settings, calibration, tests and handoff workflow are implementation work for OpenCode.

See:

- [`docs/AUDIT.md`](docs/AUDIT.md) — upstream audit and constraints.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — data model and design rules.
- [`docs/OPENCODE.md`](docs/OPENCODE.md) — implementation handoff.

## Development

Requires Node 20+.

```bash
npm install
npm run dev:firefox
```

Chrome/Chromium:

```bash
npm run dev:chrome
```

Production builds:

```bash
npm run build:firefox
npm run build:chrome
```

## Non-goals

- Claiming access to OpenAI's authoritative context usage counter.
- Treating an API model's advertised context window as ChatGPT's conversation hard limit.
- DOM-only counting as the primary measurement method.
- Sending conversation content to any server.

## Research basis

Primary references:

- `joostmbakker/context-window-meter` — MIT; active-branch conversation-graph interception.
- `SpendinFR/UsageChatgpt` — useful structural/limit research, but no license was present during the audit; research only, no code copying.
- `ZM-BAD/headroom` — Apache-2.0; useful cross-browser/WXT reference.
- Mozilla + WXT documentation for MAIN-world and cross-browser script injection.
