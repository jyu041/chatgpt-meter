import {
  analyzeConversation,
  METRICS_EVENT,
  METRICS_REQUEST_EVENT,
} from '../lib/analyze';

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
    let lastMetricsJson: string | null = null;
    let lastConversationRequest: Request | null = null;
    let refreshTimer: number | null = null;

    const publish = (data: unknown) => {
      const metrics = analyzeConversation(data);
      if (!metrics) return;
      lastMetricsJson = JSON.stringify(metrics);
      window.dispatchEvent(new CustomEvent(METRICS_EVENT, { detail: lastMetricsJson }));
    };

    const analyzeResponse = async (response: Response) => {
      if (!response.ok) return;
      try {
        publish(await response.json());
      } catch {
        // Endpoint shape changed or response was not JSON. Fail open.
      }
    };

    const drainResponse = async (response: Response) => {
      const reader = response.body?.getReader();
      if (!reader) return;
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) return;
        }
      } catch {
        // Streaming clone failed; no impact on the original ChatGPT response.
      } finally {
        reader.releaseLock();
      }
    };

    const requestFromArgs = (input: RequestInfo | URL, init?: RequestInit): Request | null => {
      try {
        if (input instanceof Request) return input.clone();
        return new Request(new URL(String(input), location.href), init);
      } catch {
        return null;
      }
    };

    const refreshLastConversation = async () => {
      const request = lastConversationRequest?.clone();
      if (!request) return;
      try {
        const response = await originalFetch(request);
        await analyzeResponse(response);
      } catch {
        // Best-effort refresh only.
      }
    };

    window.addEventListener(METRICS_REQUEST_EVENT, () => {
      if (lastMetricsJson) {
        window.dispatchEvent(new CustomEvent(METRICS_EVENT, { detail: lastMetricsJson }));
      }
    });

    window.fetch = async (...args) => {
      const request = requestFromArgs(args[0], args[1]);
      const response = await originalFetch(...args);

      try {
        const requestUrl = request?.url || response.url;
        const url = new URL(requestUrl, location.origin);
        const method = request?.method?.toUpperCase() || 'GET';
        const isConversationDetail = /^\/backend-api\/(?:f\/)?conversation\/[^/]+\/?$/.test(url.pathname);
        const isConversationPost = /^\/backend-api\/(?:f\/)?conversation\/?$/.test(url.pathname) && method === 'POST';

        if (isConversationDetail && method === 'GET') {
          lastConversationRequest = request?.clone() ?? null;
          void analyzeResponse(response.clone());
        } else if (isConversationPost && lastConversationRequest) {
          // Do not collect the stream body. Drain only the cloned response so we
          // can refresh the full graph after the turn completes.
          void drainResponse(response.clone()).then(() => {
            if (refreshTimer !== null) window.clearTimeout(refreshTimer);
            refreshTimer = window.setTimeout(() => void refreshLastConversation(), 250);
          });
        }
      } catch {
        // The meter must never change ChatGPT request/response behaviour.
      }

      return response;
    };
  },
});
