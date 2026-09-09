import { analyzeConversation, METRICS_EVENT } from '../lib/analyze';

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const marker = '__chatgptMeterFetchWrapped__';
    const markedWindow = window as typeof window & Record<string, unknown>;
    if (markedWindow[marker]) return;
    markedWindow[marker] = true;

    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);

      try {
        const requestUrl =
          response.url ||
          (typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '');

        const url = new URL(requestUrl, location.origin);
        if (/^\/backend-api\/conversation\/[^/]+\/?$/.test(url.pathname)) {
          void response.clone().json().then((data) => {
            const metrics = analyzeConversation(data);
            if (metrics) {
              // Aggregate counts only. Never bridge raw conversation content.
              window.dispatchEvent(new CustomEvent(METRICS_EVENT, { detail: metrics }));
            }
          }).catch(() => undefined);
        }
      } catch {
        // Fail open: the meter must never interfere with ChatGPT.
      }

      return response;
    };
  },
});
