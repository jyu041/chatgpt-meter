export type Composer = HTMLTextAreaElement | HTMLElement;

export type HandoffResult =
  | 'inserted'
  | 'composer-not-found'
  | 'composer-already-has-draft'
  | 'insert-failed';

const CONTENTEDITABLE_SELECTORS = [
  '#prompt-textarea[contenteditable="true"]',
  '[data-testid="prompt-textarea"][contenteditable="true"]',
  'div.ProseMirror[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"][aria-label*="Chat" i]',
  'form div[contenteditable="true"][role="textbox"]',
];

const TEXTAREA_SELECTORS = [
  'textarea[name="prompt-textarea"]',
  'textarea[data-testid="prompt-textarea"]',
  'textarea[data-testid*="prompt" i]',
];

function isHidden(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.getAttribute('aria-hidden')?.toLowerCase() === 'true') return true;
    if (view) {
      const style = view.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    }
    current = current.parentElement;
  }
  return false;
}

function isUsable(element: Element): element is Composer {
  if (!(element instanceof HTMLElement) || !element.isConnected || isHidden(element)) return false;
  if (element instanceof HTMLTextAreaElement) return !element.disabled;
  return element.getAttribute('contenteditable')?.toLowerCase() === 'true';
}

export function findComposer(root: ParentNode): Composer | null {
  for (const selector of CONTENTEDITABLE_SELECTORS) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (isUsable(element)) return element;
    }
  }
  for (const selector of TEXTAREA_SELECTORS) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (isUsable(element)) return element;
    }
  }
  return null;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function composerText(composer: Composer): string {
  return composer instanceof HTMLTextAreaElement ? composer.value : composer.textContent ?? '';
}

export function hasUnrelatedDraft(composer: Composer, prompt: string): boolean {
  const current = normalize(composerText(composer));
  return current !== '' && current !== normalize(prompt);
}

function selectComposerContents(composer: HTMLElement): boolean {
  const document = composer.ownerDocument;
  const selection = document.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(composer);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function insertContentEditable(composer: HTMLElement, prompt: string): boolean {
  composer.focus();
  if (!selectComposerContents(composer)) return false;
  const inserted = composer.ownerDocument.execCommand('insertText', false, prompt);
  return inserted && normalize(composerText(composer)) === normalize(prompt);
}

function insertTextarea(composer: HTMLTextAreaElement, prompt: string): boolean {
  composer.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) return false;
  setter.call(composer, prompt);
  composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
  composer.dispatchEvent(new Event('change', { bubbles: true }));
  return composer.value === prompt;
}

export function prepareHandoff(composer: Composer | null, prompt: string): HandoffResult {
  if (!composer) return 'composer-not-found';
  if (hasUnrelatedDraft(composer, prompt)) return 'composer-already-has-draft';
  const inserted = composer instanceof HTMLTextAreaElement
    ? insertTextarea(composer, prompt)
    : insertContentEditable(composer, prompt);
  return inserted ? 'inserted' : 'insert-failed';
}
