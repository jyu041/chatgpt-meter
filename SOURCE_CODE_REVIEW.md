# Source Code Review

This repository is the source package for Firefox review.

## Requirements

- Node.js 20 or newer
- npm

## Reproduction

```bash
npm ci
npm run build:firefox
```

The unpacked Firefox MV3 build is written to `.output/firefox-mv3/`. Create the review package with:

```bash
npm run zip:firefox
```

WXT writes `.output/chatgpt-meter-0.1.1-firefox.zip` and, with the Firefox zip command, `.output/chatgpt-meter-0.1.1-sources.zip`. The generated manifest contains the packaged extension icons, only the `storage` permission and the `https://chatgpt.com/*` host permission, plus Firefox's `data_collection_permissions.required: ["none"]` declaration.
