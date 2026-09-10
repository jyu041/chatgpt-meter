# OpenCode handoff

## Objective

Turn the current baseline into a reliable Firefox-first ChatGPT conversation meter without claiming access to OpenAI's internal context counter.

## Read first

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/AUDIT.md`

Treat the privacy/security invariants in `ARCHITECTURE.md` as hard requirements.

## Baseline already present

- WXT + TypeScript, Firefox/Chromium MV3.
- MAIN-world fetch observer for conversation graph responses.
- Pure active-branch analyzer.
- Aggregate-only MAIN -> isolated-world bridge.
- Minimal in-page badge.
- SPA conversation-ID filtering.
- Best-effort post-turn graph refresh.
- Synthetic analyzer tests.
- Compact details/settings panel, local aggregate limit observations, and manual handoff prompt filling.

## First implementation task

Before adding features, run:

```bash
npm install
npm run check
```

Then load the Firefox dev build and validate the data path against current ChatGPT.

### Validate these cases

1. Existing normal conversation loads a non-zero reading.
2. New chat shows `Meter: new chat` without a fake 0%.
3. Sending a prompt causes metrics to refresh after the response finishes.
4. Switching between `/c/{id}` conversations never briefly accepts another conversation's metrics as current.
5. Regenerated/branched replies count only the `current_node` parent chain.
6. Project conversations work, or document the exact failing route/request.
7. Web/tool-heavy conversations produce non-zero tool/reasoning/system aggregates where present.
8. Extension errors do not interfere with ChatGPT requests or rendering.

Capture **sanitized structural fixtures only** when debugging. Do not commit real prompts/replies or authentication data.

## Then implement, in order

### Phase 1 — reliability

- Fix any current ChatGPT endpoint/stream lifecycle mismatches.
- Add tests for every discovered conversation payload shape.
- Make measurement state explicit: `reading`, `ready`, `stale`, `unavailable`.
- Avoid DOM message counting as an authoritative fallback.

### Phase 2 — useful UI

Keep it compact. Expanded panel should show:

- historical branch estimated tokens
- role breakdown
- active branch messages/nodes
- raw structural pressure
- hidden messages
- explicit compaction candidate signals
- model slug, if observed
- last measurement time/status
- confirmed maximum-length state

Use `~` for token estimates. Do not show a context/lifespan percentage unless the denominator is explicitly labeled and defensible.

### Phase 3 — local settings/calibration

- Store only settings and aggregate calibration observations.
- Configurable warning thresholds for raw structural pressure/history size.
- Record a user-local structural reading when a confirmed hard-limit UI is observed.
- After multiple observations, optionally expose a clearly labeled personal/experimental lifespan estimate.

### Phase 4 — handoff action

Add `Prepare handoff` that fills the ChatGPT composer with a standard request for:

- `PROJECT_STATE.md`
- `SESSION_HANDOFF.md`
- optional `EVIDENCE_LOG.md`

Never auto-send the prompt.

The handoff action is implemented in the expanded panel. Live route and post-turn behavior still require manual Firefox validation against an authenticated ChatGPT session.

## Do not do

- Do not copy code/constants from unlicensed `SpendinFR/UsageChatgpt`.
- Do not hard-code API model context windows as ChatGPT conversation limits.
- Do not store access tokens.
- Do not send conversation content off-device.
- Do not count the entire mapping when `current_node` is available.
- Do not silently return zero for malformed/incomplete graphs.
- Do not add broad site permissions.

## Definition of done for the next milestone

- `npm run check` passes.
- Firefox current release works in normal + Project conversations.
- Meter updates after each completed turn without reload.
- Active-branch behavior is covered by synthetic tests.
- No raw conversation text crosses the extension boundary or enters storage/logging.
- README reflects actual behavior, not planned behavior.
