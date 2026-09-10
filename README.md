# ChatGPT Meter

Private Firefox/Chromium extension for estimating the size of the current ChatGPT conversation and warning before a handoff is prudent.

## What it measures

Keep these separate:

1. **History size** — estimated text tokens represented by the active conversation branch.
2. **Structural pressure** — experimental node/message/hidden/compaction signals that may correlate with conversation lifespan.
3. **Confirmed limit** — only when ChatGPT itself displays a maximum-conversation-length error.

The extension does **not** claim access to OpenAI's internal context counter. A historical branch size is not the same as the model's live prompt/context usage.

## Current implementation

The skeleton now includes:

- Firefox/Chromium Manifest V3 via WXT.
- MAIN-world observation of ChatGPT conversation-detail responses.
- First-class support for the current paginated `GET /backend-api/conversations/{id}` `messages[]` response, plus legacy `mapping` compatibility.
- Active-branch reconstruction using `mapping` + `current_node`.
- Aggregate-only cross-world events; raw conversation text stays in MAIN world.
- Best-effort refresh after a streamed conversation POST completes.
- Conversation-ID filtering across ChatGPT SPA navigation.
- A deliberately small in-page badge: `History ~82k · Pressure 734`, with a details panel.
- Local settings for visibility, default expansion, and approximate warning thresholds.
- A user-triggered `Prepare handoff` action that fills, but never submits, the composer.
- Detection of visible maximum-length errors as a separate confirmed state, with aggregate-only local calibration observations.
- Pure analyzer tests with synthetic conversation graphs, including malformed and structured content.

No percentage is shown until a defensible denominator/calibration exists.

## Development

Requires Node 20+ and Firefox 128+ for the Firefox MV3 MAIN-world path.

```bash
npm install
npm run dev:firefox
```

Chromium:

```bash
npm run dev:chrome
```

Checks/builds:

```bash
npm run test
npm run typecheck
npm run build:firefox
npm run build:chrome
```

`npm install` generates `package-lock.json`; commit it once dependencies are installed locally.

The observer recognizes `/backend-api/conversation/{id}`, `/backend-api/conversations/{id}`, and their `/f/` variants. Project chats are selected by the normal `/c/{id}` route. ChatGPT endpoint behavior can change, so live validation remains necessary.

As verified in the September 10, 2026 Firefox test, current ChatGPT commonly requests the plural endpoint with `num_turns=10`. The meter follows `page_info.start_cursor` backwards sequentially using `before=` and `num_turns=100` until history is complete. This is an observed private contract, not a stability guarantee.

Warning thresholds start unset. They are optional, user-defined warnings and are not ChatGPT limits. Maximum-length detection uses only a debounced bounded alert/live-region scan; it deliberately has no full-conversation text fallback.

`Open panel by default` controls whether the details panel opens when a conversation is loaded or navigated to. It does not enable or disable the independent threshold fields.

## Observed calibration data

On 2026-09-10, a known previously maxed conversation was reopened and measured at approximately 3.52M historical tokens, 3,348 messages, and raw pressure 2,483. The hard-limit UI was not observed by the extension during this measurement, so this is a retrospective near/at-limit calibration observation, not `limitConfirmed`. One personal observation is insufficient to infer a universal threshold.

## Privacy rules

- Host scope: `https://chatgpt.com/*` only.
- No telemetry, analytics, remote storage or cloud processing.
- Never persist raw prompts, replies, tool output or access tokens.
- Raw conversation content must not cross the MAIN-world/extension bridge.
- Clone observed responses; never mutate ChatGPT traffic.
- Fail open: extension failure must not interfere with ChatGPT.

## Docs

- [`docs/AUDIT.md`](docs/AUDIT.md) — upstream research and constraints.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — data path and invariants.
- [`docs/OPENCODE.md`](docs/OPENCODE.md) — concise implementation handoff.

## Reference projects

- `joostmbakker/context-window-meter` — MIT; primary reference for active-branch conversation-graph observation.
- `SpendinFR/UsageChatgpt` — useful structural/limit research; no root license found during the audit, so concepts only and no code copying.
- `ZM-BAD/headroom` — Apache-2.0; useful WXT/cross-browser engineering reference.
