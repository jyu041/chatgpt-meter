# Development Notes

## Requirements

Node.js 20 or newer, npm, and Firefox 128+ for the primary live target.

## Commands

```bash
npm ci
npm run check
npm run build:firefox
npm run build:chrome
npm run zip:firefox
npm run zip:chrome
```

## Architecture Notes

The MAIN-world observer uses ChatGPT's current plural paginated conversation response when available and retains legacy `mapping + current_node` support. It analyzes raw message content locally, converts it to aggregate measurements, and sends only aggregate JSON across the world boundary. The isolated script validates the current route before rendering.

The plural endpoint and its pagination fields are private ChatGPT behavior and may change. Regenerated/edited version semantics for `include_has_versions=true` remain an explicit limitation until independently verified with sanitized structural evidence.

## Safe Debugging

Set `window.__chatgptMeterDebug__ = true` before the observer initializes to enable local structural diagnostics. Logs contain only format, page, cursor, and unique-message counts. Never log or commit message content, credentials, cookies, request headers, screenshots with private data, or raw response captures.

## Contributions

See [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`AUDIT.md`](AUDIT.md).
