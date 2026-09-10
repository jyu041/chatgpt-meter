# Upstream audit

Audit date: 2026-09-10.

## `joostmbakker/context-window-meter`

**Verdict: strongest primary technical reference.**

Useful design:

- Manifest V3 scoped to `https://chatgpt.com/*`.
- MAIN-world `window.fetch` observation.
- Conversation-detail response cloning; original response remains untouched.
- `mapping` + `current_node` parent-chain reconstruction rather than whole-tree counting.
- Separation of user/assistant/tool/reasoning/system-like content.
- MIT licensed.

Changes for ChatGPT Meter:

- Do not treat its heuristic tokenizer or hard-coded model limits as authoritative.
- Do not make its DOM fallback authoritative; long chats may be virtualized.
- Analyze in MAIN world and bridge aggregate counts only, rather than raw role text.
- Add reliable post-turn refresh instead of relying on the initial conversation GET alone.

## `SpendinFR/UsageChatgpt`

**Verdict: valuable research only; no code copying.**

Useful concepts:

- Validate conversation mappings.
- Active-branch reconstruction.
- Structural counts, hidden messages, context/summary candidates and model history.
- Visible maximum-conversation-length detection.
- Project-chat research.
- Experimental conversation-lifespan calibration.

Caveats:

- No root `LICENSE` file was found during this audit. Treat code as all-rights-reserved unless clarified.
- Published structural formulas/thresholds are experimental and based on limited observations; do not ship them as platform facts.
- Direct session/access-token retrieval unnecessarily expands attack surface for this project unless passive/same-origin approaches fail.
- ChatGPT Meter's analyzer/estimator must be independently implemented.

## `ZM-BAD/headroom`

**Verdict: useful cross-browser engineering reference.**

- Apache-2.0.
- WXT + TypeScript.
- Firefox and Chromium support.
- Useful reference for permission discipline, packaging and UI engineering.

Its generalized multi-provider measurement model is not the primary architecture here; ChatGPT Meter can understand ChatGPT's conversation graph directly.

## Firefox/WXT findings

- Firefox 128+ supports the Manifest V3 MAIN-world path required here.
- WXT supports cross-browser MAIN-world content scripts.
- WXT's Firefox target must be explicitly built as MV3 for this design; repository scripts use `--mv3` and the manifest config is pinned to version 3.
- Keep Firefox 128+ as the documented minimum unless testing proves a different bound.
- The generated Firefox manifest contains only the ChatGPT host permission and a stable extension ID. WXT may warn about Firefox's newer data-collection declaration; this extension has no telemetry, analytics, or remote service and stores only local settings and aggregate calibration observations.

## September 10, 2026 live finding

An authenticated Firefox test observed ChatGPT using `GET /backend-api/conversations/{id}?include_has_versions=true&num_turns=10` with a 200 JSON response containing paginated `messages[]`, `current_node`, and `page_info`. The plural endpoint is now the primary path in this implementation. The legacy singular `conversation/{id}` `mapping` + `current_node` shape remains a compatibility path for accounts/builds that still expose it.

The implementation uses message `id` for deduplication and the observed `page_info.has_previous_page` / `start_cursor` fields for backwards pagination. The supplied evidence does not establish whether `include_has_versions=true` makes `messages[]` include alternate regenerated versions or guarantees that it is already the selected branch. Until a sanitized payload confirms those semantics, paginated messages are treated as the endpoint's selected sequence and alternate-version selection is documented as uncertain.

## Security/privacy rules

1. Host permissions: ChatGPT only.
2. No remote telemetry, analytics or cloud storage.
3. Never persist raw prompts/replies/tool output.
4. Aggregate metrics only across the MAIN-world boundary.
5. Never store ChatGPT access/session tokens.
6. Clone observed responses; never mutate ChatGPT traffic.
7. Fail open: ChatGPT must continue functioning if meter analysis fails.
8. DOM inspection may detect UI/error state, not primary conversation size.

## Measurement terminology

Do not collapse these into one number:

- `historicalTokensEstimate`: rough text-token estimate for the active historical branch.
- `structuralPressureRaw`: experimental raw structural signal.
- `compactionSignals`: conservative candidate signals, not proof of server-side compaction.
- `limitConfirmed`: ChatGPT visibly displayed a maximum-length notice.
- future `contextWindowPercent`: only if an explicitly labeled, reliable denominator exists.
- future `lifespanPercent`: only after defensible local/empirical calibration.

A 300k historical-token estimate does **not** mean 300k tokens are in the model's current prompt. ChatGPT may summarize, transform or omit older material.
