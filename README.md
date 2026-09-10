# Conversation Meter for ChatGPT

An unofficial Firefox-first extension that estimates the observable historical size of the current ChatGPT conversation and shows experimental structural pressure.

**Unofficial third-party extension. Not affiliated with, endorsed by, or supported by OpenAI.**

## Why

ChatGPT does not expose a clear conversation-lifespan meter. Long technical conversations can eventually reach a maximum conversation length, while the useful signals available to an extension are only partial observations.

## What It Shows

- Approximate historical conversation tokens and characters
- User, assistant, tool, reasoning, system, and other breakdowns
- Active conversation structure and hidden-message counts
- Experimental raw structural pressure
- Conservative compaction signals
- A separately observed conversation-limit state
- A `Prepare handoff` action that fills the composer without submitting

## Important Distinction

Historical tokens are not the model's current context-window usage. The extension cannot access OpenAI's internal context counter. Structural pressure is experimental and is not an OpenAI metric or a universal conversation limit.

## Screenshots

Screenshots are intentionally not committed until they can be captured from a clean authenticated browser session without private conversation content. See [`assets/README.md`](assets/README.md) for the release asset plan.

## Browser Support

- Firefox 128+: primary target and live-tested with authenticated ChatGPT sessions
- Chromium: MV3 build-tested; additional browser validation remains pending

## Installation

For development, install Node.js 20 or newer, then:

```bash
npm ci
npm run dev:firefox
```

Load the generated development extension in Firefox. Chromium development uses `npm run dev:chrome`.

## Privacy

Conversation data is analyzed locally in the ChatGPT page. The extension may make additional authenticated same-origin requests to ChatGPT to retrieve older pages of the current conversation. It does not send conversation content to the developer or a third-party service. See [`PRIVACY.md`](PRIVACY.md) and [`SECURITY.md`](SECURITY.md).

## Development

```bash
npm ci
npm run check
```

Tests use synthetic fixtures only. Do not commit real conversations, credentials, cookies, or request captures.

## Building

```bash
npm run build:firefox
npm run build:chrome
npm run zip:firefox
npm run zip:chrome
```

See [`SOURCE_CODE_REVIEW.md`](SOURCE_CODE_REVIEW.md) for reproducible Firefox source-review instructions.

## Limitations

- Token estimates are deliberately approximate.
- ChatGPT's private endpoints and response formats may change without notice.
- Paginated message responses are treated as the endpoint's selected sequence; regenerated/edited version semantics remain uncertain.
- Historical size is not current model context usage.
- Structural pressure has no universal denominator or threshold.
- A reopened conversation cannot prove a prior hard-limit UI event that is no longer visible.

## License

MIT. See [`LICENSE`](LICENSE).

## Disclaimer

Unofficial third-party extension. Not affiliated with, endorsed by, or supported by OpenAI. ChatGPT and OpenAI are trademarks of their respective owners.
