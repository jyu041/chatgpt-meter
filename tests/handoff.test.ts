import { beforeEach, describe, expect, it } from 'vitest';
import { findComposer, prepareHandoff } from '../lib/handoff';

class FakeDocument {
  defaultView = { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
  selectedRange: { node?: FakeElement } | null = null;
  selection = {
    removeAllRanges: () => undefined,
    addRange: (range: { node?: FakeElement }) => { this.selectedRange = range; },
  };
  getSelection = () => this.selection;
  createRange = () => {
    const range: { node?: FakeElement; selectNodeContents: (node: FakeElement) => void } = {
      selectNodeContents: (node) => { range.node = node; },
    };
    return range;
  };
  execCommand = (_command: string, _showUi: boolean, value: string) => {
    if (!this.selectedRange?.node) return false;
    this.selectedRange.node.textContent = value;
    return true;
  };
}

class FakeElement {
  nodeType = 1;
  isConnected = true;
  hidden = false;
  disabled = false;
  textContent = '';
  ownerDocument = new FakeDocument();
  attributes = new Map<string, string>();
  constructor(public tagName: string) {}
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  closest() { return null; }
  focus() { return undefined; }
  dispatchEvent() { return true; }
}

class FakeTextArea extends FakeElement {
  private currentValue = '';
  constructor() { super('TEXTAREA'); }
  get value() { return this.currentValue; }
  set value(value: string) { this.currentValue = value; }
}

class FakeContentEditable extends FakeElement {
  constructor() {
    super('DIV');
    this.attributes.set('contenteditable', 'true');
  }
}

const installDomTypes = () => {
  const globals = globalThis as Record<string, unknown>;
  globals.HTMLElement = FakeElement;
  globals.HTMLTextAreaElement = FakeTextArea;
  globals.InputEvent = class { constructor(public type: string, public init: unknown) {} };
  globals.Event = class { constructor(public type: string, public init?: unknown) {} };
};

function rootWith(selectors: Record<string, FakeElement[]>): ParentNode {
  return { querySelectorAll: (selector: string) => selectors[selector] ?? [] } as unknown as ParentNode;
}

describe('findComposer', () => {
  beforeEach(installDomTypes);

  it('prefers the visible prompt contenteditable over a fallback textarea', () => {
    const editor = new FakeContentEditable();
    const textarea = new FakeTextArea();
    const root = rootWith({
      '#prompt-textarea[contenteditable="true"]': [editor],
      'textarea[data-testid*="prompt" i]': [textarea],
    });
    expect(findComposer(root)).toBe(editor);
  });

  it('rejects hidden and disabled candidates before using a usable textarea fallback', () => {
    const hidden = new FakeContentEditable(); hidden.hidden = true;
    const disabled = new FakeTextArea(); disabled.disabled = true;
    const usable = new FakeTextArea();
    const root = rootWith({
      'div.ProseMirror[contenteditable="true"]': [hidden],
      'textarea[name="prompt-textarea"]': [disabled, usable],
    });
    expect(findComposer(root)).toBe(usable);
  });
});

describe('prepareHandoff', () => {
  beforeEach(installDomTypes);

  it('inserts into a textarea through its native value setter', () => {
    const textarea = new FakeTextArea();
    expect(prepareHandoff(textarea as unknown as HTMLTextAreaElement, 'handoff')).toBe('inserted');
    expect(textarea.value).toBe('handoff');
  });

  it('uses editor-recognized insertion for contenteditable', () => {
    const editor = new FakeContentEditable();
    expect(prepareHandoff(editor as unknown as HTMLElement, 'handoff')).toBe('inserted');
    expect(editor.textContent).toBe('handoff');
  });

  it('does not destroy an unrelated draft or mutate a missing target', () => {
    const editor = new FakeContentEditable();
    editor.textContent = 'DO NOT DELETE THIS TEST DRAFT';
    expect(prepareHandoff(editor as unknown as HTMLElement, 'handoff')).toBe('composer-already-has-draft');
    expect(editor.textContent).toBe('DO NOT DELETE THIS TEST DRAFT');
    expect(prepareHandoff(null, 'handoff')).toBe('composer-not-found');
  });
});
