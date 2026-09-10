export const METRICS_EVENT = 'chatgpt-meter:metrics';
export const METRICS_REQUEST_EVENT = 'chatgpt-meter:request-latest';

export type Role = 'user' | 'assistant' | 'tool' | 'system' | 'reasoning' | 'other';
export type CompactionSignalLevel = 'unknown' | 'possible' | 'observed';
export type MeasurementState = 'loading' | 'partial' | 'complete' | 'unavailable';

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
  measurementState: MeasurementState;
  pagesLoaded: number;
  messagesMeasured: number;
  hasMoreHistory: boolean;
}

export interface MessageMeasurement {
  id: string;
  role: Role;
  characters: number;
  estimatedTokens: number;
  hidden: boolean;
  compactionSignals: number;
  weakCompactionCandidate: boolean;
  modelSlug?: string;
}

type UnknownRecord = Record<string, unknown>;
const ROLES: Role[] = ['user', 'assistant', 'tool', 'system', 'reasoning', 'other'];
const ignoredContentKeys = new Set(['content_type', 'asset_pointer', 'image_asset_pointer', 'file_id', 'id']);

const emptyByRole = (): Record<Role, number> => ({ user: 0, assistant: 0, tool: 0, system: 0, reasoning: 0, other: 0 });
const isRecord = (value: unknown): value is UnknownRecord => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Deliberately rough. This is an estimate, not a model tokenizer or context counter. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const isCjk = (code >= 0x3400 && code <= 0x9fff) || (code >= 0x3040 && code <= 0x30ff) || (code >= 0xac00 && code <= 0xd7af);
    if (isCjk) units += 4;
    else if (/\s/u.test(char)) units += 0.25;
    else if (code <= 0x7f && /[A-Za-z0-9_]/u.test(char)) units += 1;
    else if (code <= 0x7f) units += 1.75;
    else units += 2.25;
  }
  if (/```|(?:^|\n)\s*(?:const|let|function|class|def|import|SELECT|CREATE|diff --git)\b/m.test(text)) units *= 1.1;
  return Math.max(0, Math.ceil(units / 4));
}

function extractContentText(value: unknown): string {
  const parts: string[] = [];
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number, key?: string) => {
    if (depth > 14 || item == null || (key && ignoredContentKeys.has(key))) return;
    if (typeof item === 'string') { if (item) parts.push(item); return; }
    if (typeof item === 'number' || typeof item === 'boolean') { parts.push(String(item)); return; }
    if (typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    if (Array.isArray(item)) { for (const child of item) visit(child, depth + 1); return; }
    for (const [childKey, child] of Object.entries(item)) visit(child, depth + 1, childKey);
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
  return ROLES.includes(role as Role) ? role as Role : 'other';
}

function explicitCompactionSignalCount(contentType: string, metadata: UnknownRecord): number {
  const explicitTypes = new Set(['context_summary', 'conversation_summary', 'compaction_summary']);
  const explicitKeys = new Set(['context_summary', 'conversation_summary', 'compaction', 'compacted', 'context_truncated', 'truncated_context']);
  let count = explicitTypes.has(contentType) ? 1 : 0;
  for (const [key, value] of Object.entries(metadata)) if (explicitKeys.has(key.toLowerCase()) && value !== false && value != null && value !== '') count += 1;
  return count;
}

function measureMessage(message: UnknownRecord, id: string): MessageMeasurement {
  const content = isRecord(message.content) ? message.content : {};
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const contentType = typeof content.content_type === 'string' ? content.content_type : '';
  const text = extractContentText(content);
  const modelSlug = ['resolved_model_slug', 'model_slug', 'default_model_slug'].map((key) => metadata[key]).find((value): value is string => typeof value === 'string' && value.length > 0);
  return {
    id,
    role: classify(message),
    characters: text.length,
    estimatedTokens: estimateTokens(text),
    hidden: metadata.is_visually_hidden_from_conversation === true || metadata.is_hidden === true,
    compactionSignals: explicitCompactionSignalCount(contentType, metadata),
    weakCompactionCandidate: contentType === 'reasoning_recap' || contentType === 'model_editable_context',
    ...(modelSlug ? { modelSlug } : {}),
  };
}

export function measureMessages(messages: unknown[]): MessageMeasurement[] {
  const measured: MessageMeasurement[] = [];
  const seen = new Set<string>();
  for (const item of messages) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    measured.push(measureMessage(item, item.id));
  }
  return measured;
}

export interface MeasurementStatus {
  measurementState?: MeasurementState;
  pagesLoaded?: number;
  messagesMeasured?: number;
  hasMoreHistory?: boolean;
}

export function aggregateMeasurements(data: UnknownRecord, measurements: MessageMeasurement[], activeBranchNodes: number, status: MeasurementStatus = {}): ConversationMetrics {
  const roleTokens = emptyByRole();
  const roleMessages = emptyByRole();
  let historicalCharacters = 0;
  let hiddenMessages = 0;
  let compactionSignals = 0;
  let weakCompaction = false;
  let modelSlug = typeof data.default_model_slug === 'string' ? data.default_model_slug : null;
  for (const item of measurements) {
    historicalCharacters += item.characters;
    roleTokens[item.role] += item.estimatedTokens;
    roleMessages[item.role] += 1;
    if (item.hidden) hiddenMessages += 1;
    compactionSignals += item.compactionSignals;
    weakCompaction ||= item.weakCompactionCandidate;
    if (item.modelSlug) modelSlug = item.modelSlug;
  }
  const state = status.measurementState ?? 'complete';
  const structuralPressureRaw = Math.max(0, roleMessages.assistant + roleMessages.tool + Math.ceil(roleMessages.reasoning / 4) - Math.ceil(hiddenMessages / 2));
  return {
    schemaVersion: 1,
    conversationId: typeof data.id === 'string' ? data.id : typeof data.conversation_id === 'string' ? data.conversation_id : null,
    modelSlug,
    activeBranchNodes,
    activeBranchMessages: measurements.length,
    historicalCharacters,
    historicalTokensEstimate: ROLES.reduce((total, role) => total + roleTokens[role], 0),
    roleTokens,
    roleMessages,
    hiddenMessages,
    compactionSignals,
    compactionSignalLevel: compactionSignals > 0 ? 'observed' : weakCompaction ? 'possible' : 'unknown',
    structuralPressureRaw,
    measuredAt: new Date().toISOString(),
    measurementState: state,
    pagesLoaded: status.pagesLoaded ?? 1,
    messagesMeasured: status.messagesMeasured ?? measurements.length,
    hasMoreHistory: status.hasMoreHistory ?? false,
  };
}

function activeBranch(mapping: UnknownRecord, currentNode: unknown): Array<{ id: string; node: UnknownRecord }> | null {
  if (typeof currentNode !== 'string' || !isRecord(mapping[currentNode])) return null;
  const reversed: Array<{ id: string; node: UnknownRecord }> = [];
  const seen = new Set<string>();
  let id: string | null = currentNode;
  while (id !== null) {
    if (seen.has(id)) return null;
    const node: unknown = mapping[id];
    if (!isRecord(node)) return null;
    seen.add(id); reversed.push({ id, node });
    if (node.parent == null) id = null;
    else if (typeof node.parent === 'string') id = node.parent;
    else return null;
  }
  return reversed.reverse();
}

export function analyzeConversation(data: unknown, status: MeasurementStatus = {}): ConversationMetrics | null {
  if (!isRecord(data)) return null;
  if (isRecord(data.mapping)) {
    const branch = activeBranch(data.mapping, data.current_node);
    if (!branch) return null;
    const measurements = branch.flatMap(({ id, node }) => isRecord(node.message) ? [measureMessage(node.message, id)] : []);
    return aggregateMeasurements(data, measurements, branch.length, status);
  }
  if (Array.isArray(data.messages)) {
    const measurements = measureMessages(data.messages);
    return aggregateMeasurements(data, measurements, measurements.length, status);
  }
  return null;
}

export function withConversationId(metrics: ConversationMetrics, expectedId: string): ConversationMetrics | null {
  if (metrics.conversationId && metrics.conversationId !== expectedId) return null;
  return metrics.conversationId ? metrics : { ...metrics, conversationId: expectedId };
}
