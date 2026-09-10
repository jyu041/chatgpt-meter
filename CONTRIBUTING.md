# Contributing

## Setup

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
npm run check
```

Build packages with `npm run zip:firefox` or `npm run zip:chrome`.

## Changes

- Run tests and typecheck before opening a pull request.
- Keep host and API permissions minimal.
- Use synthetic fixtures only; never commit real ChatGPT conversations.
- Never include authentication tokens, cookies, private content, or unsanitized captures in code, issues, or pull requests.
- Preserve the aggregate-only MAIN-world to isolated-world privacy boundary.
- Treat private ChatGPT endpoints as unstable and justify response-shape changes with sanitized structural evidence.

## Pull Requests

Describe the user-visible change, tests run, and any permission or privacy implications. Do not add telemetry, analytics, remote configuration, cloud processing, or remotely hosted executable code.
