# Architecture

## Design principle

The extension measures **observable conversation history** and separately estimates **conversation pressure**. It must not imply that either value is OpenAI's internal context counter.

## Components

### `entrypoints/main-world.content.ts`

Runs in the page MAIN world at `document_start`.

Responsibilities:

- Wrap `window.fetch` without changing request/response behavior.
- Observe successful conversation-detail responses.
- Clone and parse matching JSON.
- Find `mapping` and `current_node`.
- Walk only the active parent chain.
- Produce aggregate metrics.
- Dispatch aggregate JSON via a namespaced `CustomEvent`.

It must never dispatch raw message text.

### `entrypoints/content.ts`

Runs in the normal isolated extension world.

Responsibilities:

- Listen for aggregate events from the MAIN-world observer.
- Validate the event payload.
- Maintain the small in-page meter.
- Detect the visible ChatGPT maximum-length error as a separate confirmed state.
- Eventually store user settings/calibration locally.

### `lib/analyze.ts`

Pure functions only. No DOM, browser or network calls.

Responsibilities:

- Validate conversation shape.
- Reconstruct active branch.
- Classify message roles/content types.
- Estimate token counts.
- Produce structural metrics.

Keep this independently unit-testable.

## Initial data contract

```ts
interface ConversationMetrics {
  schemaVersion: 1;
  conversationId: string | null;
  modelSlug: string | null;
  activeBranchNodes: number;
  activeBranchMessages: number;
  historicalTokensEstimate: number;
  roleTokens: {
    user: number;
    assistant: number;
    tool: number;
    system: number;
    reasoning: number;
    other: number;
  };
  roleMessages: Record<string, number>;
  hiddenMessages: number;
  compactionMarkers: number;
  structuralCharge: number;
  measuredAt: string;
}
```

`structuralCharge` may initially use an independently implemented analogue of the researched `assistant + tool - hidden - system` formula. It is an experimental raw value, **not a percentage** until we have defensible calibration.

## UI target

Keep the persistent badge small:

```text
History ~82k   |   Pressure: low
```

Expanded view later:

```text
Historical branch        ~82,400 tokens
User                       18,200
Assistant                  41,600
Tools                      19,300
Reasoning                   2,100
System/other                1,200

Structural pressure       734 raw
Compaction signals          12
Confirmed hard limit        no

[Prepare handoff]
```

If a model context denominator becomes reliable, add a **separate** model-context estimate. Never reuse a conversation-lifespan threshold as a model-context threshold.

## Handoff workflow (later phase)

At configurable warning states, expose a `Prepare handoff` action. It should insert—not automatically send—a standard prompt into ChatGPT's composer asking for concise `PROJECT_STATE.md` and `SESSION_HANDOFF.md` artifacts.

Never automatically submit a user message.

## Failure modes

- Conversation endpoint changes -> show `Unavailable`, not zero.
- JSON mapping incomplete -> reject/mark incomplete rather than silently count the full tree.
- Unknown model -> historical token estimate still works; no model-context percentage.
- Branches/regenerations -> use `current_node` parent chain only.
- Project conversation 404 -> passive interception should normally avoid this; authenticated project-aware fetch can be a later fallback.
- DOM virtualization -> irrelevant to primary counting path.
- Token estimator error -> display `~` and retain raw character/message metrics for diagnostics.

## Calibration strategy

Store calibration observations locally, for example:

```json
{
  "plan": "plus",
  "structuralChargeAtConfirmedLimit": 2050,
  "observedAt": "2026-09-10T00:00:00Z"
}
```

After multiple real limit events, derive a personal warning curve. Until then, use qualitative states based on raw metrics rather than claiming precise lifespan percentages.
