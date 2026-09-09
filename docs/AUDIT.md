# Upstream audit

Audit date: 2026-09-10.

## 1. joostmbakker/context-window-meter

**Verdict: strongest primary technical reference.**

Useful design:

- Manifest V3 extension scoped to `https://chatgpt.com/*`.
- MAIN-world script wraps `window.fetch`.
- Watches `/backend-api/conversation/{conversation-id}` responses.
- Clones the response; the original response remains untouched.
- Uses `mapping` + `current_node` and walks parent links to reconstruct the active branch rather than counting every branch.
- Separates user, assistant, tool, reasoning/thought and system-like content.
- MIT licensed.

Concerns / changes for this project:

- Its token estimator is heuristic, not an actual model tokenizer.
- Its hard-coded model context limits can become stale and should not be treated as ChatGPT conversation limits.
- Its DOM fallback uses a hard-coded 128k denominator and can undercount virtualized conversations; do not make DOM fallback authoritative.
- It sends extracted role text from MAIN world to the isolated content script. Our design should instead analyze in MAIN world and bridge **aggregate counts only**.
- Intercepting only conversation GET responses may mean no reading until ChatGPT happens to fetch the conversation. Add navigation/reload handling and, if needed, an explicitly authenticated same-origin fetch strategy later.

## 2. SpendinFR/UsageChatgpt

**Verdict: valuable research; do not copy code.**

Useful ideas:

- Validates candidate conversation mappings instead of blindly trusting arbitrary nested objects.
- Active branch reconstruction from `current_node`.
- Tracks raw estimated tokens, recent windows, role counts, hidden messages, context/summary markers and model history.
- Detects ChatGPT's visible maximum-conversation-length notice.
- Handles Project conversations, including project ID discovery when required.
- Introduces an experimental structural-load metric.

Important caveats:

- No LICENSE file was present in the repository root during this audit. Treat implementation as all-rights-reserved unless clarified; independently implement ideas only.
- The structural formula is:

  `assistant_messages + tool_messages - hidden_messages - system_messages`

- Published thresholds in its current source are Free 900, Plus 1980, Pro 4230.
- Its validation JSON lists only four calibration cases. That is far too little evidence to call those values authoritative.
- Therefore, any equivalent metric in ChatGPT Meter must be labelled **experimental** and preferably user-calibrated.
- Its direct session/access-token retrieval expands complexity and attack surface. Do not start with that unless passive interception proves insufficient.

## 3. ZM-BAD/headroom

**Verdict: good engineering/reference project; not the primary measurement model.**

Useful design:

- Apache-2.0.
- WXT + TypeScript.
- First-class Firefox and Chromium development/build scripts.
- Good reference for cross-browser packaging, testing and permission discipline.

Reason not to adopt its complete approach:

- It is intentionally multi-provider and generalized.
- Our use case is ChatGPT-specific and benefits from directly understanding the ChatGPT conversation graph.

## Browser compatibility findings

- Firefox 128 added support relevant to Manifest V3 MAIN-world content scripts.
- WXT supports cross-browser MAIN-world injection and Firefox builds.
- Use WXT so we do not maintain separate browser manifests unless a compatibility bug forces it.

## Security/privacy rules

1. Host permissions: ChatGPT only.
2. No remote telemetry, analytics or cloud storage.
3. Never persist raw prompts/replies/tool output.
4. Prefer aggregate metrics across the MAIN-world boundary.
5. Never expose ChatGPT access tokens to extension storage.
6. Clone intercepted responses; never mutate ChatGPT network responses.
7. Fail open: ChatGPT must continue functioning if meter analysis fails.
8. Avoid broad DOM scraping; use it only for state/error detection where necessary.

## Measurement terminology

Do not collapse these into one number:

- `historicalTokensEstimate`: estimated tokens represented by the active historical branch.
- `contextWindowLimit`: a configured/known model-window denominator, if reliable.
- `contextWindowPercent`: only when a denominator is known; explicitly an estimate.
- `structuralPressure`: experimental conversation-lifespan signal.
- `limitConfirmed`: ChatGPT itself displayed its maximum-length notice.

A 300k-token historical branch does **not** imply that 300k tokens are currently in the model prompt. ChatGPT may summarize, compact, omit or transform older material.
