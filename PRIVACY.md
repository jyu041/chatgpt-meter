# Privacy Policy

Last updated: 2026-09-10

Conversation Meter for ChatGPT is an unofficial third-party extension. It is not affiliated with, endorsed by, or supported by OpenAI. This policy applies only to the extension, not to ChatGPT or OpenAI.

## What Is Processed

The extension locally analyzes the ChatGPT conversation data needed to estimate historical conversation size, message-role breakdowns, experimental structural pressure, and aggregate conversation-limit calibration observations.

## ChatGPT Requests

The extension observes ChatGPT's same-origin requests and may make additional authenticated requests to `https://chatgpt.com` using the existing browser session to retrieve older pages of the current conversation. These requests are required for complete local measurement. The extension does not extract or persist session credentials, and does not send credentials to the developer.

These ChatGPT requests are not developer data collection. There are no developer servers, telemetry, analytics, remote configuration, advertising, or third-party data-processing services.

## What Is Not Transmitted

The extension does not transmit raw prompts, replies, tool output, conversation text, credentials, cookies, or access tokens to the developer or any third party. It does not sell or share user data.

## Local Storage

Extension-local storage contains only settings and aggregate observations: conversation IDs where needed for per-conversation calibration, timestamps, historical-token estimates, structural-pressure values, and aggregate message counts. Raw conversation text is not persisted.

## Retention and Deletion

Users can remove these local records by resetting/removing the extension's storage or uninstalling the extension. This policy makes no claim about ChatGPT or OpenAI's retention practices.

## Contact

For security or privacy vulnerability reports, see [`SECURITY.md`](SECURITY.md).
