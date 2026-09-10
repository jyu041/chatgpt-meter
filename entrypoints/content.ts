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

const STYLE_ID = 'chatgpt-meter-styles';
const STYLE_TEXT = `
.cgm-meter,
.cgm-panel {
  --cgm-fallback-bg: #f7f7f8;
  --cgm-fallback-bg-secondary: #ffffff;
  --cgm-fallback-hover: #ececf1;
  --cgm-fallback-text: #2f2f2f;
  --cgm-fallback-secondary: #6b6b6b;
  --cgm-fallback-border: rgba(0,0,0,.12);
  --cgm-fallback-input: #ffffff;
  --cgm-fallback-accent: #10a37f;
  --cgm-fallback-shadow: 0 8px 30px rgba(0,0,0,.12);
  --cgm-bg: var(--main-surface-primary, var(--cgm-fallback-bg));
  --cgm-bg-secondary: var(--main-surface-secondary, var(--cgm-fallback-bg-secondary));
  --cgm-hover: var(--main-surface-tertiary, var(--cgm-fallback-hover));
  --cgm-text: var(--text-primary, var(--cgm-fallback-text));
  --cgm-secondary: var(--text-secondary, var(--cgm-fallback-secondary));
  --cgm-border: var(--border-light, var(--cgm-fallback-border));
  --cgm-input: var(--main-surface-secondary, var(--cgm-fallback-input));
  --cgm-accent: var(--accent-green, var(--cgm-fallback-accent));
  --cgm-shadow: var(--cgm-fallback-shadow);
  box-sizing: border-box;
}
#chatgpt-meter-root.cgm-meter[data-cgm-theme="dark"],
.cgm-panel[data-cgm-theme="dark"] {
  --cgm-fallback-bg: #212121;
  --cgm-fallback-bg-secondary: #2f2f2f;
  --cgm-fallback-hover: #3a3a3a;
  --cgm-fallback-text: #ececec;
  --cgm-fallback-secondary: #a0a0a0;
  --cgm-fallback-border: rgba(255,255,255,.14);
  --cgm-fallback-input: #2f2f2f;
  --cgm-fallback-shadow: 0 8px 30px rgba(0,0,0,.35);
}
#chatgpt-meter-root.cgm-meter {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483646;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  max-width: calc(100vw - 32px);
  padding: 7px 12px;
  border: 1px solid var(--cgm-border);
  border-radius: 999px;
  background: var(--cgm-bg);
  color: var(--cgm-text);
  font: 500 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  box-shadow: 0 2px 10px rgba(0,0,0,.08);
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
}
#chatgpt-meter-root.cgm-meter:hover { background: var(--cgm-hover); box-shadow: 0 4px 14px rgba(0,0,0,.12); }
#chatgpt-meter-root.cgm-meter.cgm-warning { border-color: #c88719; }
#chatgpt-meter-root.cgm-meter.cgm-critical { border-color: #d14b4b; }
#chatgpt-meter-root.cgm-meter:focus-visible,
.cgm-button:focus-visible,
.cgm-checkbox:focus-visible + .cgm-switch-track,
.cgm-input:focus-visible { outline: 2px solid var(--cgm-accent); outline-offset: 2px; }
.cgm-pill-label { color: var(--cgm-secondary); font-weight: 400; }
.cgm-pill-value { color: var(--cgm-text); font-variant-numeric: tabular-nums; }
.cgm-pill-separator { color: var(--cgm-secondary); }
.cgm-panel {
  position: fixed;
  right: 16px;
  bottom: 58px;
  z-index: 2147483645;
  display: none;
  width: min(330px, calc(100vw - 32px));
  max-height: min(72vh, 620px);
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--cgm-border);
  border-radius: 14px;
  background: var(--cgm-bg);
  color: var(--cgm-text);
  font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  box-shadow: var(--cgm-shadow);
  scrollbar-color: var(--cgm-secondary) transparent;
}
.cgm-panel.cgm-open { display: block; }
.cgm-section + .cgm-section { margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--cgm-border); }
.cgm-section-title { margin-bottom: 7px; color: var(--cgm-secondary); font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.cgm-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; min-width: 0; padding: 3px 0; }
.cgm-label { min-width: 0; color: var(--cgm-secondary); }
.cgm-value { min-width: 0; color: var(--cgm-text); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; text-align: right; }
.cgm-status { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 999px; background: var(--cgm-bg-secondary); color: var(--cgm-secondary); font-size: 11px; }
.cgm-primary-value { margin: 2px 0 0; color: var(--cgm-text); font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.cgm-button { width: 100%; margin: 14px 0 2px; padding: 7px 10px; border: 1px solid var(--cgm-border); border-radius: 8px; background: var(--cgm-bg-secondary); color: var(--cgm-text); font: inherit; cursor: pointer; }
.cgm-button:hover { background: var(--cgm-hover); }
.cgm-input { width: 88px; box-sizing: border-box; padding: 4px 7px; border: 1px solid var(--cgm-border); border-radius: 6px; background: var(--cgm-input); color: var(--cgm-text); caret-color: var(--cgm-text); font: inherit; font-variant-numeric: tabular-nums; text-align: right; }
.cgm-input::placeholder { color: var(--cgm-secondary); opacity: 1; }
.cgm-input:focus { border-color: var(--cgm-accent); outline: none; }
.cgm-input::-webkit-inner-spin-button, .cgm-input::-webkit-outer-spin-button { opacity: .55; }
.cgm-setting { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 29px; }
.cgm-switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.cgm-checkbox { position: absolute; width: 1px; height: 1px; opacity: 0; }
.cgm-switch-track { position: relative; display: inline-block; width: 28px; height: 17px; border-radius: 999px; background: var(--cgm-secondary); transition: background .15s ease; }
.cgm-switch-track::after { position: absolute; top: 3px; left: 3px; width: 11px; height: 11px; border-radius: 50%; background: var(--cgm-bg); content: ""; transition: transform .15s ease; }
.cgm-checkbox:checked + .cgm-switch-track { background: var(--cgm-accent); }
.cgm-checkbox:checked + .cgm-switch-track::after { transform: translateX(11px); }
@media (prefers-reduced-motion: reduce) { #chatgpt-meter-root.cgm-meter, .cgm-switch-track, .cgm-switch-track::after { transition: none; } }
`;

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

    const applyTheme = () => {
      if (!root || !panel) return;
      const html = document.documentElement;
      const body = document.body;
      const hint = `${html.getAttribute('data-theme') ?? ''} ${html.className} ${body?.getAttribute('data-theme') ?? ''} ${body?.className ?? ''}`.toLowerCase();
      let theme: 'dark' | 'light';
      if (hint.includes('dark')) theme = 'dark';
      else if (hint.includes('light')) theme = 'light';
      else {
        const color = getComputedStyle(document.body || html).backgroundColor;
        const background = color.match(/\d+(?:\.\d+)?/g)?.map(Number);
        const hasOpaqueBackground = background && background.length >= 3 && (background.length < 4 || (background[3] ?? 0) > 0);
        const luminance = hasOpaqueBackground ? 0.2126 * (background[0] ?? 255) + 0.7152 * (background[1] ?? 255) + 0.0722 * (background[2] ?? 255) : 255;
        theme = hasOpaqueBackground ? (luminance < 128 ? 'dark' : 'light') : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      }
      root.dataset.cgmTheme = theme;
      panel.dataset.cgmTheme = theme;
    };

    const ensureStyles = () => {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLE_TEXT;
      (document.head || document.documentElement).appendChild(style);
    };

    const makeText = (label: string, value: string) => {
      const row = document.createElement('div');
      row.className = 'cgm-row';
      const key = document.createElement('span'); key.className = 'cgm-label'; key.textContent = label;
      const val = document.createElement('span'); val.className = 'cgm-value'; val.textContent = value;
      row.append(key, val); return row;
    };

    const makeSection = (title: string, rows: HTMLElement[]) => {
      const section = document.createElement('section'); section.className = 'cgm-section';
      const heading = document.createElement('div'); heading.className = 'cgm-section-title'; heading.textContent = title;
      section.append(heading, ...rows); return section;
    };

    const makePrimary = (label: string, value: string) => {
      const block = document.createElement('div');
      const caption = document.createElement('div'); caption.className = 'cgm-section-title'; caption.textContent = label;
      const amount = document.createElement('div'); amount.className = 'cgm-primary-value'; amount.textContent = value;
      block.append(caption, amount); return block;
    };

    const makeStatusRow = (label: string, value: string) => {
      const row = document.createElement('div'); row.className = 'cgm-row';
      const key = document.createElement('span'); key.className = 'cgm-label'; key.textContent = label;
      const status = document.createElement('span'); status.className = 'cgm-status'; status.textContent = value;
      row.append(key, status); return row;
    };

    const setBadge = (historyValue: string, pressureValue: string | null, loading = false) => {
      if (!root) return;
      root.replaceChildren();
      const historyLabel = document.createElement('span'); historyLabel.className = 'cgm-pill-label'; historyLabel.textContent = 'History ';
      const history = document.createElement('span'); history.className = 'cgm-pill-value'; history.textContent = historyValue;
      const separator = document.createElement('span'); separator.className = 'cgm-pill-separator'; separator.textContent = ' · ';
      const pressureLabel = document.createElement('span'); pressureLabel.className = 'cgm-pill-label'; pressureLabel.textContent = loading ? 'Loading history...' : 'Pressure ';
      root.append(historyLabel, history, separator, pressureLabel);
      if (pressureValue) { const pressure = document.createElement('span'); pressure.className = 'cgm-pill-value'; pressure.textContent = pressureValue; root.append(pressure); }
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
      ensureStyles();
      root = document.createElement('button'); root.id = ROOT_ID; root.className = 'cgm-meter'; root.type = 'button';
      root.title = 'Historical conversation size, not OpenAI internal context usage';
      root.setAttribute('aria-label', root.title);
      root.addEventListener('click', () => { expanded = !expanded; render(); });
      panel = document.createElement('div'); panel.className = 'cgm-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'ChatGPT Meter details');
      document.body.append(root, panel);
      applyTheme();
    };

    const render = () => {
      ensureRoot(); if (!root || !panel) return;
      panel.classList.toggle('cgm-open', expanded);
      root.setAttribute('aria-expanded', String(expanded));
      const pressure = metrics?.structuralPressureRaw ?? 0;
      const history = metrics?.historicalTokensEstimate ?? 0;
      const critical = thresholdReached(pressure, settings.pressureCritical);
      const warning = thresholdReached(pressure, settings.pressureWarning) || thresholdReached(history, settings.historyWarning);
      root.classList.toggle('cgm-critical', critical);
      root.classList.toggle('cgm-warning', !critical && warning);
      if (limitConfirmed) root.textContent = 'Limit confirmed';
      else if (metrics?.measurementState === 'partial') { setBadge(`~${compactNumber(metrics.historicalTokensEstimate)}+`, null, true); }
      else if (metrics?.measurementState === 'unavailable') root.textContent = 'Meter unavailable';
      else if (metrics) { setBadge(`~${compactNumber(metrics.historicalTokensEstimate)}`, compactNumber(metrics.structuralPressureRaw)); }
      else root.textContent = currentConversationId() ? 'Meter: reading...' : 'Meter: new chat';
      if (!metrics) { panel.replaceChildren(makeText('Status', currentConversationId() ? 'Reading...' : 'New chat')); return; }
      const status = metrics.measurementState === 'complete' ? 'Complete' : `${metrics.measurementState} (${metrics.pagesLoaded} pages)`;
      panel.replaceChildren(
        makeSection('Conversation history', [makePrimary('Estimated historical tokens', `~${metrics.historicalTokensEstimate.toLocaleString()}${metrics.hasMoreHistory ? '+' : ''}`), makeText('Messages', metrics.activeBranchMessages.toLocaleString()), makeText('Nodes', metrics.activeBranchNodes.toLocaleString()), makeStatusRow('Status', status)]),
        makeSection('Breakdown', [makeText('User', metrics.roleTokens.user.toLocaleString()), makeText('Assistant', metrics.roleTokens.assistant.toLocaleString()), makeText('Tools', metrics.roleTokens.tool.toLocaleString()), makeText('Reasoning', metrics.roleTokens.reasoning.toLocaleString()), makeText('System / other', `${metrics.roleTokens.system.toLocaleString()} / ${metrics.roleTokens.other.toLocaleString()}`)]),
        makeSection('Conversation signals', [makeText('Characters', metrics.historicalCharacters.toLocaleString()), makeText('Pressure', `${metrics.structuralPressureRaw} (experimental)`), makeText('Hidden messages', String(metrics.hiddenMessages)), makeText('Compaction', `${metrics.compactionSignals} (${metrics.compactionSignalLevel})`), makeText('Model', metrics.modelSlug ?? 'unknown'), makeText('Measured', new Date(metrics.measuredAt).toLocaleString()), makeText('Hard limit confirmed', limitConfirmed ? 'yes' : 'not observed')]),
      );
      const handoff = document.createElement('button'); handoff.type = 'button'; handoff.className = 'cgm-button'; handoff.textContent = 'Prepare handoff'; handoff.addEventListener('click', fillComposer); panel.append(handoff);
      const settingsTitle = document.createElement('div'); settingsTitle.className = 'cgm-section-title'; settingsTitle.textContent = 'Local settings'; panel.append(settingsTitle);
      const settingsNote = document.createElement('small'); settingsNote.textContent = 'Thresholds are your own warnings, not ChatGPT limits.'; panel.append(settingsNote);
      const expandedSetting = document.createElement('label'); expandedSetting.className = 'cgm-setting cgm-switch'; const expandedCheckbox = document.createElement('input'); expandedCheckbox.className = 'cgm-checkbox'; expandedCheckbox.type = 'checkbox'; expandedCheckbox.checked = settings.expandedDefault; expandedCheckbox.onchange = () => { settings.expandedDefault = expandedCheckbox.checked; saveSettings(); }; const track = document.createElement('span'); track.className = 'cgm-switch-track'; expandedSetting.append(document.createTextNode('Expanded by default'), expandedCheckbox, track); panel.append(expandedSetting);
      const numberSetting = (label: string, key: 'pressureWarning' | 'pressureCritical' | 'historyWarning') => {
        const wrapper = document.createElement('label'); wrapper.className = 'cgm-setting'; wrapper.append(document.createTextNode(label));
        const input = document.createElement('input'); input.className = 'cgm-input'; input.type = 'number'; input.min = '0'; input.step = '1'; input.placeholder = 'off'; input.value = settings[key] === null ? '' : String(settings[key]);
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
      }, 300);
    };
    const resetForNavigation = () => { metrics = null; limitConfirmed = false; expanded = settings.expandedDefault; render(); void loadLimitState(); window.dispatchEvent(new CustomEvent(METRICS_REQUEST_EVENT)); scheduleLimitCheck(); };
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
    const themeObserver = new MutationObserver(applyTheme);
    const start = async () => { const stored = await browser.storage.local.get(STORAGE_KEY); if (stored[STORAGE_KEY] && typeof stored[STORAGE_KEY] === 'object') settings = { ...DEFAULTS, ...(stored[STORAGE_KEY] as Partial<Settings>) }; expanded = settings.expandedDefault; render(); void loadLimitState(); if (document.body) observer.observe(document.body, { childList: true, subtree: true }); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] }); if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] }); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && expanded) { expanded = false; render(); } }); document.addEventListener('click', (event) => { if (expanded && root && panel && event.target instanceof Node && !root.contains(event.target) && !panel.contains(event.target)) { expanded = false; render(); } }); scheduleLimitCheck(); window.dispatchEvent(new CustomEvent(METRICS_REQUEST_EVENT)); };
    if (document.body) void start(); else document.addEventListener('DOMContentLoaded', () => void start(), { once: true });
  },
});
