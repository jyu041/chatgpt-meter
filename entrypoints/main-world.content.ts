import {
  aggregateMeasurements,
  analyzeConversation,
  measureMessages,
  METRICS_EVENT,
  METRICS_REQUEST_EVENT,
  withConversationId,
  type ConversationMetrics,
  type MessageMeasurement,
  type MeasurementStatus,
} from '../lib/analyze';
import { conversationDetailId, conversationIdFromPath } from '../lib/routes';
import { nextPageCursor, parsePageInfo, type PageInfo } from '../lib/pagination';

const MAX_PAGES = 100;
const PAGE_SIZE = '100';
type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => value !== null && typeof value === 'object' && !Array.isArray(value);

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
    const debug = (window as typeof window & { __chatgptMeterDebug__?: boolean }).__chatgptMeterDebug__ === true;
    let lastMetricsJson: string | null = null;
    let lastConversationRequest: Request | null = null;
    let lastConversationId: string | null = null;
    let refreshTimer: number | null = null;
    let measurementGeneration = 0;
    let activeController: AbortController | null = null;

    const log = (...values: unknown[]) => { if (debug) console.info('[ChatGPT Meter]', ...values); };

    const publish = (data: unknown, expectedId: string | null = null, status: MeasurementStatus = {}) => {
      const analyzed = analyzeConversation(data, status);
      const metrics = expectedId && analyzed ? withConversationId(analyzed, expectedId) : analyzed;
      if (!metrics) return;
      lastMetricsJson = JSON.stringify(metrics);
      window.dispatchEvent(new CustomEvent(METRICS_EVENT, { detail: lastMetricsJson }));
    };

    const publishMeasured = (data: UnknownRecord, measured: MessageMeasurement[], expectedId: string, status: MeasurementStatus) => {
      const analyzed = aggregateMeasurements(data, measured, measured.length, status);
      const metrics = withConversationId(analyzed, expectedId);
      if (!metrics) return;
      lastMetricsJson = JSON.stringify(metrics);
      window.dispatchEvent(new CustomEvent(METRICS_EVENT, { detail: lastMetricsJson }));
    };

    const drainResponse = async (response: Response) => {
      const reader = response.body?.getReader();
      if (!reader) return;
      try { while (true) { const { done } = await reader.read(); if (done) return; } }
      catch { /* The clone is disposable; never affect ChatGPT's stream. */ }
      finally { reader.releaseLock(); }
    };

    const requestFromArgs = (input: RequestInfo | URL, init?: RequestInit): Request | null => {
      try {
        if (input instanceof Request) return input.clone();
        return new Request(new URL(String(input), location.href), init);
      } catch { return null; }
    };

    const currentRequestIsValid = (id: string, generation: number, signal: AbortSignal) =>
      generation === measurementGeneration && !signal.aborted && conversationIdFromPath(location.pathname) === id;

    const paginate = async (request: Request, firstPage: UnknownRecord, expectedId: string, generation: number, controller: AbortController) => {
      if (!Array.isArray(firstPage.messages)) { publish(firstPage, expectedId); return; }
      const measured: MessageMeasurement[] = [];
      const seen = new Set<string>();
      const addPage = (data: UnknownRecord) => {
        for (const item of measureMessages(data.messages as unknown[])) {
          if (!seen.has(item.id)) { seen.add(item.id); measured.push(item); }
        }
      };
      const parsedFirstInfo = parsePageInfo(firstPage.page_info);
      addPage(firstPage);
      delete firstPage.messages;
      log('conversation format: messages', 'page 1:', measured.length, 'messages');
      if (!parsedFirstInfo) {
        publishMeasured(firstPage, measured, expectedId, { measurementState: 'unavailable', pagesLoaded: 1, messagesMeasured: measured.length, hasMoreHistory: true });
        return;
      }
      publishMeasured(firstPage, measured, expectedId, { measurementState: parsedFirstInfo.hasPreviousPage ? 'partial' : 'complete', pagesLoaded: 1, messagesMeasured: measured.length, hasMoreHistory: parsedFirstInfo.hasPreviousPage });
      let info: PageInfo = parsedFirstInfo;
      const cursors = new Set<string>();
      let pagesLoaded = 1;
      let cursor = nextPageCursor(info, cursors, pagesLoaded, MAX_PAGES);
      while (cursor) {
        if (!currentRequestIsValid(expectedId, generation, controller.signal)) return;
        const nextUrl = new URL(request.url);
        nextUrl.searchParams.set('num_turns', PAGE_SIZE);
        nextUrl.searchParams.set('before', cursor);
        const nextRequest = new Request(nextUrl.toString(), {
          method: request.method,
          headers: request.headers,
          credentials: request.credentials,
          mode: request.mode,
          cache: request.cache,
          redirect: request.redirect,
          referrer: request.referrer,
          referrerPolicy: request.referrerPolicy,
          signal: controller.signal,
        });
        let response: Response;
        try { response = await originalFetch(nextRequest); if (!response.ok) throw new Error(`HTTP ${response.status}`); }
        catch { publishMeasured(firstPage, measured, expectedId, { measurementState: 'unavailable', pagesLoaded, messagesMeasured: measured.length, hasMoreHistory: true }); return; }
        let page: unknown;
        try { page = await response.json(); }
        catch { publishMeasured(firstPage, measured, expectedId, { measurementState: 'unavailable', pagesLoaded, messagesMeasured: measured.length, hasMoreHistory: true }); return; }
        if (!isRecord(page) || !Array.isArray(page.messages)) { publishMeasured(firstPage, measured, expectedId, { measurementState: 'unavailable', pagesLoaded, messagesMeasured: measured.length, hasMoreHistory: true }); return; }
        if (!currentRequestIsValid(expectedId, generation, controller.signal)) return;
        addPage(page);
        pagesLoaded += 1;
        const nextInfo = parsePageInfo(page.page_info);
        delete page.messages;
        info = nextInfo ?? { hasPreviousPage: false, startCursor: null };
        log(`page ${pagesLoaded}:`, measured.length, 'unique messages', 'has_previous_page:', info.hasPreviousPage);
        publishMeasured(firstPage, measured, expectedId, { measurementState: info.hasPreviousPage ? 'partial' : 'complete', pagesLoaded, messagesMeasured: measured.length, hasMoreHistory: info.hasPreviousPage });
        cursor = nextPageCursor(info, cursors, pagesLoaded, MAX_PAGES);
      }
      if (info.hasPreviousPage) publishMeasured(firstPage, measured, expectedId, { measurementState: 'unavailable', pagesLoaded, messagesMeasured: measured.length, hasMoreHistory: true });
      if (!info.hasPreviousPage) log('complete:', measured.length, 'unique messages');
    };

    const analyzeResponse = async (response: Response, expectedId: string, request: Request, generation: number, controller: AbortController) => {
      if (!response.ok) return;
      try {
        const data = await response.json();
        if (!isRecord(data) || !currentRequestIsValid(expectedId, generation, controller.signal)) return;
        await paginate(request, data, expectedId, generation, controller);
      } catch { /* Endpoint shape changes must never break ChatGPT. */ }
    };

    const refreshLastConversation = async () => {
      const request = lastConversationRequest?.clone();
      const id = lastConversationId;
      if (!request || !id) return;
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const generation = ++measurementGeneration;
      try { const response = await originalFetch(new Request(request, { signal: controller.signal })); await analyzeResponse(response, id, request, generation, controller); }
      catch { /* Best-effort refresh only. */ }
    };

    window.addEventListener(METRICS_REQUEST_EVENT, () => { if (lastMetricsJson) window.dispatchEvent(new CustomEvent(METRICS_EVENT, { detail: lastMetricsJson })); });

    window.fetch = async (...args) => {
      const request = requestFromArgs(args[0], args[1]);
      const response = await originalFetch(...args);
      try {
        const url = new URL(request?.url || response.url, location.origin);
        const method = request?.method?.toUpperCase() || 'GET';
        const requestId = conversationDetailId(url.pathname);
        const isPost = /^\/backend-api\/(?:f\/)?conversation(?:s)?\/?$/.test(url.pathname) && method === 'POST';
        if (requestId && method === 'GET' && request) {
          const routeId = conversationIdFromPath(location.pathname);
          if (routeId !== requestId) return response;
          activeController?.abort();
          const controller = new AbortController();
          activeController = controller;
          const generation = ++measurementGeneration;
          lastConversationRequest = request.clone();
          lastConversationId = requestId;
          void analyzeResponse(response.clone(), requestId, request.clone(), generation, controller);
        } else if (isPost && lastConversationRequest) {
          void drainResponse(response.clone()).then(() => {
            if (refreshTimer !== null) window.clearTimeout(refreshTimer);
            refreshTimer = window.setTimeout(() => void refreshLastConversation(), 250);
          });
        }
      } catch { /* Fail open: return ChatGPT's original response untouched. */ }
      return response;
    };
  },
});
