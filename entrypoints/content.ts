import { METRICS_EVENT, METRICS_REQUEST_EVENT, type ConversationMetrics } from '../lib/analyze';

const ROOT_ID = 'chatgpt-meter-root';
const MAX_LENGTH_PATTERNS = [
  /maximum length for this conversation/i,
  /conversation has reached (?:its )?maximum length/i,
  /maximum conversation length/i,
];

function currentConversationId(): string | null {
  const match = location.pathname.match(/\/c\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function isMetrics(value: unknown): value is ConversationMetrics {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<ConversationMetrics>;
  return (
    data.schemaVersion === 1 &&
    typeof data.historicalTokensEstimate === 'number' &&
    typeof data.structuralPressureRaw === 'number' &&
    typeof data.activeBranchMessages === 'number'
  );
}

function visibleMaximumLengthReached(): boolean {
  const text = document.body?.innerText ?? '';
  return MAX_LENGTH_PATTERNS.some((pattern) => pattern.test(text));
}

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  runAt: 'document_start',
  main() {
    let metrics: ConversationMetrics | null = null;
    let confirmedLimit = false;
    let lastPath = location.pathname;
    let root: HTMLButtonElement | null = null;

    const ensureRoot = () => {
      if (root?.isConnected) return root;
      if (!document.body) return null;

      root = document.createElement('button');
      root.id = ROOT_ID;
      root.type = 'button';
      root.title = 'ChatGPT Meter — historical conversation size, not OpenAI internal context usage';
      root.setAttribute('aria-label', root.title);
      Object.assign(root.style, {
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        zIndex: '2147483646',
        border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
        borderRadius: '999px',
        padding: '7px 11px',
        background: 'Canvas',
        color: 'CanvasText',
        font: '500 12px/1.2 system-ui, sans-serif',
        boxShadow: '0 2px 10px rgba(0,0,0,.12)',
        cursor: 'default',
      });
      document.body.appendChild(root);
      return root;
    };

    const render = () => {
      const element = ensureRoot();
      if (!element) return;

      if (confirmedLimit) {
        element.textContent = 'Limit confirmed';
        element.title = 'ChatGPT displayed a maximum-conversation-length message.';
        element.setAttribute('aria-label', element.title);
        return;
      }

      if (!metrics) {
        element.textContent = currentConversationId() ? 'Meter: reading…' : 'Meter: new chat';
        return;
      }

      element.textContent = `History ~${compactNumber(metrics.historicalTokensEstimate)} · Pressure ${compactNumber(metrics.structuralPressureRaw)}`;
      element.title = [
        `Historical branch: ~${metrics.historicalTokensEstimate.toLocaleString()} estimated tokens`,
        `Messages: ${metrics.activeBranchMessages.toLocaleString()}`,
        `Pressure: ${metrics.structuralPressureRaw.toLocaleString()} raw (experimental)`,
        `Compaction signals: ${metrics.compactionSignals.toLocaleString()}`,
        'Not OpenAI internal context usage.',
      ].join('\n');
      element.setAttribute('aria-label', element.title);
    };

    const resetForNavigation = () => {
      metrics = null;
      confirmedLimit = false;
      render();
      window.dispatchEvent(new CustomEvent(METRICS_REQUEST_EVENT));
    };

    window.addEventListener(METRICS_EVENT, (event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
      try {
        const parsed: unknown = JSON.parse(event.detail);
        if (!isMetrics(parsed)) return;

        const routeId = currentConversationId();
        if (routeId && parsed.conversationId && routeId !== parsed.conversationId) return;

        metrics = parsed;
        render();
      } catch {
        // Reject malformed cross-world payloads.
      }
    });

    const observer = new MutationObserver(() => {
      const nextPath = location.pathname;
      if (nextPath !== lastPath) {
        lastPath = nextPath;
        resetForNavigation();
      }

      if (!confirmedLimit && visibleMaximumLengthReached()) {
        confirmedLimit = true;
        render();
      }

      if (!root?.isConnected) render();
    });

    const start = () => {
      render();
      observer.observe(document.body, { childList: true, subtree: true });
      window.dispatchEvent(new CustomEvent(METRICS_REQUEST_EVENT));
    };

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  },
});
