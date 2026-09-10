export const METRICS_EVENT = 'chatgpt-meter:metrics';
export const METRICS_REQUEST_EVENT = 'chatgpt-meter:request-latest';

export type Role = 'user' | 'assistant' | 'tool' | 'system' | 'reasoning' | 'other';
export type CompactionSignalLevel = 'unknown' | 'possible' | 'observed';

export interface ConversationMetrics {
  schemaVersion: 1;
  conversationId: string | null;
  modelSlug: string | null;
  activeBranchNodes: number;
  activeBranchMessages: number;
  historicalCharacters: number;
  historicalTokensEstimate: number;
  roleTokens: Record<Role, number>;
  roleMessages: Record<Role, number>;
  hiddenMessages: number;
  compactionSignals: number;
  compactionSignalLevel: CompactionSignalLevel;
  structuralPressureRaw: number;
  measuredAt: string;
}

type UnknownRecord = Record<string, unknown>;

const ROLES: Role[] = ['user', 'assistant', 'tool', 'system', 'reasoning', 'other'];
const ignoredContentKeys = new Set([
  'content_type',
  'asset_pointer',
  'image_asset_pointer',
  'file_id',
  'id',
]);

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

/**
 * Deliberately rough and independently specified. The UI must keep the `~` marker.
 * Weighted character units avoid claiming model-tokenizer accuracy while handling
 * CJK/code materially better than a plain `characters / 4` rule.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const isCjk =
      (code >= 0x3400 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af);

    if (isCjk) units += 4;
    else if (/\s/u.test(char)) units += 0.25;
    else if (code <= 0x7f && /[A-Za-z0-9_]/u.test(char)) units += 1;
    else if (code <= 0x7f) units += 1.75;
    else units += 2.25;
  }

  const codeLike = /```|(?:^|\n)\s*(?:const|let|function|class|def|import|SELECT|CREATE|diff --git)\b/m.test(text);
  if (codeLike) units *= 1.1;

  return Math.max(0, Math.ceil(units / 4));
}

function extractContentText(value: unknown): string {
  const parts: string[] = [];
  const seen = new WeakSet<object>();

  const visit = (item: unknown, depth: number, key?: string) => {
    if (depth > 14 || item == null || (key && ignoredContentKeys.has(key))) return;

    if (typeof item === 'string') {
      if (item) parts.push(item);
      return;
    }
    if (typeof item === 'number' || typeof item === 'boolean') {
      parts.push(String(item));
      return;
    }
    if (typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);

    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }

    for (const [childKey, child] of Object.entries(item)) {
      visit(child, depth + 1, childKey);
    }
  };

  visit(value, 0);
  return parts.join('\n');
}

function classify(message: UnknownRecord): Role {
  const content = isRecord(message.content) ? message.content : {};
  const type = typeof content.content_type === 'string' ? content.content_type : '';

  if (type === 'thoughts' || type === 'reasoning_recap') return 'reasoning';
  if (type === 'model_editable_context') return 'system';

  const author = isRecord(message.author) ? message.author : {};
  const role = typeof author.role === 'string' ? author.role : '';
  return ROLES.includes(role as Role) ? (role as Role) : 'other';
}

function activeBranch(mapping: UnknownRecord, currentNode: unknown): UnknownRecord[] | null {
  if (typeof currentNode !== 'string' || !isRecord(mapping[currentNode])) return null;

  const reversed: UnknownRecord[] = [];
  const seen = new Set<string>();
  let id: string | null = currentNode;

  while (id !== null) {
    if (seen.has(id)) return null;
    const node: unknown = mapping[id];
    if (!isRecord(node)) return null;

    seen.add(id);
    reversed.push(node);

    if (node.parent == null) id = null;
    else if (typeof node.parent === 'string') id = node.parent;
    else return null;
  }

  return reversed.reverse();
}

function explicitCompactionSignalCount(contentType: string, metadata: UnknownRecord): number {
  const explicitTypes = new Set(['context_summary', 'conversation_summary', 'compaction_summary']);
  const explicitKeys = new Set([
    'context_summary',
    'conversation_summary',
    'compaction',
    'compacted',
    'context_truncated',
    'truncated_context',
  ]);

  let count = explicitTypes.has(contentType) ? 1 : 0;
  for (const [key, value] of Object.entries(metadata)) {
    if (explicitKeys.has(key.toLowerCase()) && value !== false && value != null && value !== '') count += 1;
  }
  return count;
}

export function withConversationId(
  metrics: ConversationMetrics,
  expectedId: string,
): ConversationMetrics | null {
  if (metrics.conversationId && metrics.conversationId !== expectedId) return null;
  return metrics.conversationId ? metrics : { ...metrics, conversationId: expectedId };
}

function compactionSignalLevel(
  count: number,
  branch: UnknownRecord[],
): CompactionSignalLevel {
  if (count > 0) return 'observed';
  const hasWeakCandidate = branch.some((node) => {
    const message = isRecord(node.message) ? node.message : {};
    const content = isRecord(message.content) ? message.content : {};
    return ['reasoning_recap', 'model_editable_context'].includes(
      typeof content.content_type === 'string' ? content.content_type : '',
    );
  });
  return hasWeakCandidate ? 'possible' : 'unknown';
}

export function analyzeConversation(data: unknown): ConversationMetrics | null {
  if (!isRecord(data) || !isRecord(data.mapping)) return null;

  const branch = activeBranch(data.mapping, data.current_node);
  if (!branch) return null;

  const roleTokens = emptyByRole();
  const roleMessages = emptyByRole();
  let historicalCharacters = 0;
  let hiddenMessages = 0;
  let compactionSignals = 0;
  let activeBranchMessages = 0;
  let modelSlug = typeof data.default_model_slug === 'string' ? data.default_model_slug : null;

  for (const node of branch) {
    if (!isRecord(node.message)) continue;

    const message = node.message;
    const content = isRecord(message.content) ? message.content : {};
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    const role = classify(message);
    const text = extractContentText(content);
    const contentType = typeof content.content_type === 'string' ? content.content_type : '';

    activeBranchMessages += 1;
    historicalCharacters += text.length;
    roleMessages[role] += 1;
    roleTokens[role] += estimateTokens(text);

    if (metadata.is_visually_hidden_from_conversation === true || metadata.is_hidden === true) {
      hiddenMessages += 1;
    }

    compactionSignals += explicitCompactionSignalCount(contentType, metadata);

    for (const key of ['resolved_model_slug', 'model_slug', 'default_model_slug']) {
      const candidate = metadata[key];
      if (typeof candidate === 'string' && candidate) {
        modelSlug = candidate;
        break;
      }
    }
  }

  const historicalTokensEstimate = ROLES.reduce((total, role) => total + roleTokens[role], 0);

  // Experimental structural signal only; not a percentage or published ChatGPT limit.
  const structuralPressureRaw = Math.max(
    0,
    roleMessages.assistant +
      roleMessages.tool +
      Math.ceil(roleMessages.reasoning / 4) -
      Math.ceil(hiddenMessages / 2),
  );

  return {
    schemaVersion: 1,
    conversationId:
      typeof data.id === 'string'
        ? data.id
        : typeof data.conversation_id === 'string'
          ? data.conversation_id
          : null,
    modelSlug,
    activeBranchNodes: branch.length,
    activeBranchMessages,
    historicalCharacters,
    historicalTokensEstimate,
    roleTokens,
    roleMessages,
    hiddenMessages,
    compactionSignals,
    compactionSignalLevel: compactionSignalLevel(compactionSignals, branch),
    structuralPressureRaw,
    measuredAt: new Date().toISOString(),
  };
}
