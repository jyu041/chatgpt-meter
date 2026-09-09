export const METRICS_EVENT = 'chatgpt-meter:metrics';

export type Role = 'user' | 'assistant' | 'tool' | 'system' | 'reasoning' | 'other';

export interface ConversationMetrics {
  schemaVersion: 1;
  conversationId: string | null;
  modelSlug: string | null;
  activeBranchNodes: number;
  activeBranchMessages: number;
  historicalTokensEstimate: number;
  roleTokens: Record<Role, number>;
  roleMessages: Record<Role, number>;
  hiddenMessages: number;
  compactionMarkers: number;
  structuralCharge: number;
  measuredAt: string;
}

type UnknownRecord = Record<string, unknown>;

const emptyByRole = (): Record<Role, number> => ({
  user: 0,
  assistant: 0,
  tool: 0,
  system: 0,
  reasoning: 0,
  other: 0,
});

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Deliberately heuristic. Keep '~' in the UI until a tokenizer is introduced.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  let nonAscii = 0;
  let cjk = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) cjk += 1;
    else if (code <= 127) ascii += 1;
    else nonAscii += 1;
  }

  const codeLike = /```|(?:^|\n)\s*(?:function |const |let |var |class |def |import |SELECT |CREATE |diff --git)/m.test(text);
  return Math.ceil(ascii / (codeLike ? 3.25 : 3.9) + nonAscii / 2.55 + cjk / 1.15);
}

function extractText(value: unknown, depth = 0): string {
  if (depth > 12 || value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((v) => extractText(v, depth + 1)).filter(Boolean).join('\n');
  if (!isRecord(value)) return '';

  for (const key of ['text', 'output_text', 'result', 'caption', 'summary']) {
    if (typeof value[key] === 'string') return value[key] as string;
  }
  for (const key of ['parts', 'items', 'thoughts', 'chunks', 'content']) {
    if (value[key] != null) {
      const nested = extractText(value[key], depth + 1);
      if (nested) return nested;
    }
  }
  return '';
}

function classify(message: UnknownRecord): Role {
  const content = isRecord(message.content) ? message.content : {};
  const type = typeof content.content_type === 'string' ? content.content_type : '';
  if (type === 'thoughts' || type === 'reasoning_recap') return 'reasoning';
  const author = isRecord(message.author) ? message.author : {};
  const role = typeof author.role === 'string' ? author.role : '';
  return ['user', 'assistant', 'tool', 'system'].includes(role) ? role as Role : 'other';
}

function activeBranch(mapping: UnknownRecord, currentNode: unknown): UnknownRecord[] | null {
  if (typeof currentNode !== 'string' || !isRecord(mapping[currentNode])) return null;
  const branch: UnknownRecord[] = [];
  const seen = new Set<string>();
  let id: string | null = currentNode;

  while (id && !seen.has(id)) {
    const node = mapping[id];
    if (!isRecord(node)) return null;
    seen.add(id);
    branch.push(node);
    id = typeof node.parent === 'string' ? node.parent : null;
  }

  if (id !== null) return null;
  return branch.reverse();
}

export function analyzeConversation(data: unknown): ConversationMetrics | null {
  if (!isRecord(data) || !isRecord(data.mapping)) return null;
  const branch = activeBranch(data.mapping, data.current_node);
  if (!branch) return null;

  const roleTokens = emptyByRole();
  const roleMessages = emptyByRole();
  let hiddenMessages = 0;
  let compactionMarkers = 0;
  let modelSlug: string | null = typeof data.default_model_slug === 'string' ? data.default_model_slug : null;
  let messages = 0;

  for (const node of branch) {
    if (!isRecord(node.message)) continue;
    const message = node.message;
    const role = classify(message);
    const content = isRecord(message.content) ? message.content : {};
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    const text = extractText(content);
    const tokens = estimateTokens(text);

    messages += 1;
    roleMessages[role] += 1;
    roleTokens[role] += tokens;

    if (metadata.is_visually_hidden_from_conversation === true || metadata.is_hidden === true) hiddenMessages += 1;
    if (Object.keys(metadata).some((key) => /summary|compact|truncat|context_summary/i.test(key))) compactionMarkers += 1;
    if (/summary|recap|model_editable_context/i.test(String(content.content_type ?? ''))) compactionMarkers += 1;

    for (const key of ['resolved_model_slug', 'model_slug', 'default_model_slug']) {
      if (typeof metadata[key] === 'string') {
        modelSlug = metadata[key] as string;
        break;
      }
    }
  }

  const historicalTokensEstimate = Object.values(roleTokens).reduce((a, b) => a + b, 0);
  const structuralCharge = Math.max(
    0,
    roleMessages.assistant + roleMessages.tool - hiddenMessages - roleMessages.system,
  );

  return {
    schemaVersion: 1,
    conversationId: typeof data.id === 'string' ? data.id : typeof data.conversation_id === 'string' ? data.conversation_id : null,
    modelSlug,
    activeBranchNodes: branch.length,
    activeBranchMessages: messages,
    historicalTokensEstimate,
    roleTokens,
    roleMessages,
    hiddenMessages,
    compactionMarkers,
    structuralCharge,
    measuredAt: new Date().toISOString(),
  };
}
