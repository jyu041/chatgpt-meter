# Architecture

## Principle

ChatGPT Meter measures **observable historical conversation structure**. It must not imply access to OpenAI's internal live-context counter.

Keep separate:

- `historicalTokensEstimate` — approximate text-token size of the active historical branch.
- `structuralPressureRaw` — experimental structural signal; no percentage without calibration.
- `compactionSignals` — explicit candidate metadata/types only; not proof of internal compaction.
- `compactionSignalLevel` — `unknown`, `possible`, or `observed`; weak recap/context types are never treated as proof.
- `limitConfirmed` — UI state only when ChatGPT visibly reports a maximum conversation length.

## Data path

```text
ChatGPT MAIN world
  window.fetch
      │
      ├─ observe GET /backend-api/.../conversation/{id}
      │      └─ clone JSON response
      │
      ├─ analyze active branch locally
      │      └─ raw text exists only during analysis
      │
      └─ CustomEvent(JSON aggregate metrics only)
                    │
                    ▼
isolated content script
  validate schema + route conversation ID
  render small badge
  detect visible confirmed-limit message
```

### Live refresh

The baseline remembers a clone of the last successful conversation-detail request. After a cloned conversation POST response finishes streaming, it performs a best-effort same-origin refresh using that request and re-analyzes the resulting full graph.

This is deliberately provisional. OpenCode must validate it against current ChatGPT and Project conversations. If the endpoint/request contract changes, prefer another same-origin aggregate-safe strategy; do not introduce access-token persistence merely for convenience.

## Components

### `entrypoints/main-world.content.ts`

- Runs at `document_start`, `world: MAIN`.
- Wraps `window.fetch` once.
- Never mutates requests/responses.
- Recognizes conversation-detail GETs and conversation POSTs.
- Clones only responses required for lifecycle detection/analysis.
- Calls the pure analyzer in MAIN world.
- Emits aggregate JSON only.
- Fails open on all errors.

### `entrypoints/content.ts`

- Runs in the isolated extension world.
- Validates aggregate event payloads.
- Rejects metrics for a different `/c/{conversationId}` route.
- Resets on SPA navigation.
- Displays a minimal persistent badge.
- Detects visible maximum-length wording separately.
- Does not scrape conversation messages for measurement.

### `lib/analyze.ts`

Pure TypeScript. No DOM/network/browser APIs.

- Validate `mapping` + `current_node`.
- Walk parent links only; reject cycles/broken parent chains.
- Classify message roles/content types.
- Extract textual scalar content generically while ignoring pointer/ID fields.
- Estimate text tokens with a deliberately rough, independently specified heuristic.
- Count explicit candidate compaction signals conservatively.
- Produce aggregate metrics.

## Metrics contract

```ts
interface ConversationMetrics {
  schemaVersion: 1;
  conversationId: string | null;
  modelSlug: string | null;
  activeBranchNodes: number;
  activeBranchMessages: number;
  historicalCharacters: number;
  historicalTokensEstimate: number;
  roleTokens: Record<Role, number>;
  roleMessages: Record<Role, number>;
  hiddenMessages: number;
  compactionSignals: number;
  compactionSignalLevel: 'unknown' | 'possible' | 'observed';
  structuralPressureRaw: number;
  measuredAt: string;
}
```

The persistent UI intentionally starts as:

```text
History ~82k · Pressure 734
```

No model-context percentage and no conversation-lifespan percentage should appear until their denominator is empirically defensible.

## Privacy/security invariants

1. ChatGPT host scope only.
2. No telemetry or remote services.
3. Never persist raw conversation content.
4. Never send raw conversation content across the MAIN/isolated-world bridge.
5. Never persist ChatGPT access/session tokens.
6. Never mutate ChatGPT network traffic.
7. A meter failure must not break ChatGPT.
8. DOM inspection is allowed for UI state/error detection, not primary message counting.

## Handoff workflow

The expanded panel includes a user-triggered `Prepare handoff` control that fills, but **does not submit**, a prompt requesting concise `PROJECT_STATE.md` and `SESSION_HANDOFF.md` files and optional `EVIDENCE_LOG.md`.

The isolated content script stores settings and aggregate limit observations in extension-local storage. It never stores message content.

Warning thresholds should initially be configurable raw values. After several personally observed confirmed limits, derive a local calibration curve. Do not ship upstream experimental thresholds as facts.

## Open questions to validate live

- Exact conversation-detail route variants used by normal and Project chats.
- Whether post-turn refresh with the saved GET request remains reliable.
- Whether ChatGPT prefetches unrelated conversation-detail requests.
- Current maximum-length error wording/localizations.
- Which content types materially affect historical-size estimates.
- Which metadata fields are genuine compaction evidence rather than ordinary injected context.
