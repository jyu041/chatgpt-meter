import { METRICS_EVENT, METRICS_REQUEST_EVENT, type ConversationMetrics } from '../lib/analyze';
import { upsertLimitObservation, type LimitObservation } from '../lib/calibration';
import { conversationIdFromPath } from '../lib/routes';
import { thresholdReached } from '../lib/settings';

const ROOT_ID = 'chatgpt-meter-root';
const STORAGE_KEY = 'chatgpt-meter:settings';
const LIMITS_KEY = 'chatgpt-meter:limit-observations';
const DEFAULTS = {
  expandedDefault: false,
  pressureWarning: null as number | null,
  pressureCritical: null as number | null,
  historyWarning: null as number | null,
};
type Settings = typeof DEFAULTS;

const MAX_LENGTH_PATTERNS = [
  /maximum length for this conversation/i,
  /conversation has reached (?:its )?maximum length/i,
  /maximum conversation length/i,
  /conversation is too long/i,
];

function currentConversationId(): string | null {
  return conversationIdFromPath(location.pathname);
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 1000 ? 'compact' : 'standard', maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value);
}

function isMetrics(value: unknown): value is ConversationMetrics {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<ConversationMetrics>;
  return data.schemaVersion === 1 && typeof data.conversationId === 'string' && typeof data.historicalTokensEstimate === 'number' && typeof data.structuralPressureRaw === 'number' && typeof data.activeBranchMessages === 'number' && typeof data.historicalCharacters === 'number' && typeof data.compactionSignalLevel === 'string';
}

function containsMaximumLengthNotice(text: string): boolean {
  return MAX_LENGTH_PATTERNS.some((pattern) => pattern.test(text));
}

function visibleMaximumLengthReached(): boolean {
  const likely = document.querySelectorAll('[role="alert"], [aria-live], [data-testid*="toast" i]');
  let likelyText = '';
  for (const element of Array.from(likely)) likelyText += ` ${element.textContent ?? ''}`;
  return containsMaximumLengthNotice(likelyText);
}

const HANDOFF_PROMPT = `Create a concise handoff for this project and current session. Do not guess or omit exact identifiers.

When artifact/file generation is available, create actual downloadable Markdown files (not just fenced text):
- PROJECT_STATE.md: current objective, exact identifiers, key decisions, completed work, unresolved issues, and constraints.
- SESSION_HANDOFF.md: what is in progress, next steps, things not to repeat, and precise verification commands.
- Add EVIDENCE_LOG.md only when there are concrete observations, test results, or links worth preserving.

Preserve exact names, paths, versions, errors, and decisions. Optimize for information density. Distinguish VERIFIED FACTS, INFERENCES, and OPEN QUESTIONS. Include a START_HERE section. Do not automatically omit older decisions that still constrain the project. Keep the files actionable and concise.`;

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  runAt: 'document_start',
  main() {
    let metrics: ConversationMetrics | null = null;
    let limitConfirmed = false;
    let expanded = false;
    let settings: Settings = { ...DEFAULTS };
    let lastPath = location.pathname;
    let root: HTMLButtonElement | null = null;
    let panel: HTMLDivElement | null = null;
    let limitCheckTimer: number | null = null;
    let lastFullLimitCheck = 0;

    const saveSettings = () => void browser.storage.local.set({ [STORAGE_KEY]: settings });
    const recordLimit = async () => {
      const id = currentConversationId();
      if (!id || !metrics) return;
      const stored = await browser.storage.local.get(LIMITS_KEY);
      const observations = Array.isArray(stored[LIMITS_KEY]) ? stored[LIMITS_KEY] as LimitObservation[] : [];
      const observation: LimitObservation = { conversationId: id, measuredAt: metrics.measuredAt, historicalTokensEstimate: metrics.historicalTokensEstimate, structuralPressureRaw: metrics.structuralPressureRaw, activeBranchMessages: metrics.activeBranchMessages };
      await browser.storage.local.set({ [LIMITS_KEY]: upsertLimitObservation(observations, observation) });
    };
    const loadLimitState = async () => {
      const id = currentConversationId();
      if (!id) return;
      const stored = await browser.storage.local.get(LIMITS_KEY);
      const observations = Array.isArray(stored[LIMITS_KEY]) ? stored[LIMITS_KEY] : [];
      limitConfirmed = observations.some((item: unknown) => item && typeof item === 'object' && (item as { conversationId?: unknown }).conversationId === id);
      render();
    };

    const makeText = (label: string, value: string) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:12px;padding:2px 0';
      const key = document.createElement('span'); key.textContent = label;
      const val = document.createElement('strong'); val.textContent = value;
      row.append(key, val); return row;
    };

    const fillComposer = () => {
      const target = document.querySelector('form textarea, textarea[data-testid*="prompt" i], textarea[placeholder*="Message ChatGPT" i], div[contenteditable="true"][role="textbox"]') as HTMLTextAreaElement | HTMLDivElement | null;
      if (!target) return;
      if (target instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(target, HANDOFF_PROMPT);
      } else target.textContent = HANDOFF_PROMPT;
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: HANDOFF_PROMPT }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.focus();
    };

    const ensureRoot = () => {
      if (root?.isConnected && panel?.isConnected) return;
      if (!document.body) return;
      root = document.createElement('button'); root.id = ROOT_ID; root.type = 'button';
      root.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:999px;padding:7px 11px;background:Canvas;color:CanvasText;font:500 12px/1.2 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.12);cursor:pointer';
      root.title = 'Historical conversation size, not OpenAI internal context usage';
      root.setAttribute('aria-label', root.title);
      root.addEventListener('click', () => { expanded = !expanded; render(); });
      panel = document.createElement('div'); panel.style.cssText = 'display:none;position:fixed;right:16px;bottom:54px;z-index:2147483645;width:280px;max-height:70vh;overflow:auto;padding:12px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;background:Canvas;color:CanvasText;font:12px/1.35 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.18)';
      document.body.append(root, panel);
    };

    const render = () => {
      ensureRoot(); if (!root || !panel) return;
      panel.style.display = expanded ? 'block' : 'none';
      const pressure = metrics?.structuralPressureRaw ?? 0;
      const history = metrics?.historicalTokensEstimate ?? 0;
      const critical = thresholdReached(pressure, settings.pressureCritical);
      const warning = thresholdReached(pressure, settings.pressureWarning) || thresholdReached(history, settings.historyWarning);
      root.style.borderColor = critical ? '#c33' : warning ? '#c80' : 'color-mix(in srgb,currentColor 18%,transparent)';
      root.textContent = limitConfirmed ? 'Limit confirmed' : metrics ? `History ~${compactNumber(metrics.historicalTokensEstimate)} · Pressure ${compactNumber(metrics.structuralPressureRaw)}` : currentConversationId() ? 'Meter: reading...' : 'Meter: new chat';
      if (!metrics) { panel.replaceChildren(makeText('Status', currentConversationId() ? 'Reading...' : 'New chat')); return; }
      panel.replaceChildren(
        makeText('Historical tokens', `~${metrics.historicalTokensEstimate.toLocaleString()}`), makeText('Characters', metrics.historicalCharacters.toLocaleString()),
        makeText('Active nodes / messages', `${metrics.activeBranchNodes} / ${metrics.activeBranchMessages}`), makeText('User tokens', metrics.roleTokens.user.toLocaleString()), makeText('Assistant tokens', metrics.roleTokens.assistant.toLocaleString()), makeText('Tool tokens', metrics.roleTokens.tool.toLocaleString()), makeText('Reasoning tokens', metrics.roleTokens.reasoning.toLocaleString()), makeText('System / other', `${metrics.roleTokens.system.toLocaleString()} / ${metrics.roleTokens.other.toLocaleString()}`), makeText('Hidden messages', String(metrics.hiddenMessages)), makeText('Compaction signals', `${metrics.compactionSignals} (${metrics.compactionSignalLevel})`), makeText('Raw pressure', `${metrics.structuralPressureRaw} (experimental)`), makeText('Model', metrics.modelSlug ?? 'unknown'), makeText('Measured', new Date(metrics.measuredAt).toLocaleString()), makeText('Hard limit confirmed', limitConfirmed ? 'yes' : 'not observed'),
      );
      const handoff = document.createElement('button'); handoff.type = 'button'; handoff.textContent = 'Prepare handoff'; handoff.style.cssText = 'margin-top:8px;width:100%;padding:6px;cursor:pointer'; handoff.addEventListener('click', fillComposer); panel.append(handoff);
      const settingsTitle = document.createElement('div'); settingsTitle.textContent = 'Local settings'; settingsTitle.style.cssText = 'margin-top:12px;font-weight:700'; panel.append(settingsTitle);
      const settingsNote = document.createElement('small'); settingsNote.textContent = 'Thresholds are your own warnings, not ChatGPT limits.'; panel.append(settingsNote);
      const expandedSetting = document.createElement('label'); const expandedCheckbox = document.createElement('input'); expandedCheckbox.type = 'checkbox'; expandedCheckbox.checked = settings.expandedDefault; expandedCheckbox.onchange = () => { settings.expandedDefault = expandedCheckbox.checked; saveSettings(); }; expandedSetting.append(expandedCheckbox, ' Expanded by default'); panel.append(expandedSetting);
      const numberSetting = (label: string, key: 'pressureWarning' | 'pressureCritical' | 'historyWarning') => {
        const wrapper = document.createElement('label'); wrapper.style.cssText = 'display:flex;justify-content:space-between;gap:8px;padding:2px 0'; wrapper.append(label);
        const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '1'; input.placeholder = 'off'; input.value = settings[key] === null ? '' : String(settings[key]); input.style.width = '90px';
        input.onchange = () => { const value = Number(input.value); if (!input.value.trim()) settings[key] = null; else if (Number.isFinite(value) && value >= 0) settings[key] = Math.floor(value); else return; saveSettings(); render(); };
        wrapper.append(input); return wrapper;
      };
      panel.append(numberSetting('Pressure warning', 'pressureWarning'), numberSetting('Pressure critical', 'pressureCritical'), numberSetting('History warning', 'historyWarning'));
    };

    const scheduleLimitCheck = () => {
      if (limitConfirmed || limitCheckTimer !== null) return;
      limitCheckTimer = window.setTimeout(() => {
        limitCheckTimer = null;
        if (visibleMaximumLengthReached()) {
          limitConfirmed = true;
          void recordLimit();
          render();
          return;
        }
        const now = Date.now();
        if (now - lastFullLimitCheck >= 1500) {
          lastFullLimitCheck = now;
          if (containsMaximumLengthNotice(document.body?.innerText ?? '')) {
            limitConfirmed = true;
            void recordLimit();
            render();
            return;
          }
        }
      }, 300);
    };
    const resetForNavigation = () => { metrics = null; limitConfirmed = false; expanded = settings.expandedDefault; lastFullLimitCheck = 0; render(); void loadLimitState(); window.dispatchEvent(new CustomEvent(METRICS_REQUEST_EVENT)); scheduleLimitCheck(); };
    window.addEventListener(METRICS_EVENT, (event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
      try { const parsed: unknown = JSON.parse(event.detail); const routeId = currentConversationId(); if (!isMetrics(parsed) || !routeId || parsed.conversationId !== routeId) return; metrics = parsed; render(); } catch { /* malformed bridge data is ignored */ }
    });
    const observer = new MutationObserver(() => {
      const nextPath = location.pathname;
      if (nextPath !== lastPath) { lastPath = nextPath; resetForNavigation(); }
      scheduleLimitCheck();
      if (!root?.isConnected) render();
    });
    const start = async () => { const stored = await browser.storage.local.get(STORAGE_KEY); if (stored[STORAGE_KEY] && typeof stored[STORAGE_KEY] === 'object') settings = { ...DEFAULTS, ...(stored[STORAGE_KEY] as Partial<Settings>) }; expanded = settings.expandedDefault; render(); void loadLimitState(); if (document.body) observer.observe(document.body, { childList: true, subtree: true }); scheduleLimitCheck(); window.dispatchEvent(new CustomEvent(METRICS_REQUEST_EVENT)); };
    if (document.body) void start(); else document.addEventListener('DOMContentLoaded', () => void start(), { once: true });
  },
});
