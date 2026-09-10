import { describe, expect, it } from 'vitest';
import { aggregateMeasurements, analyzeConversation, estimateTokens, measureMessages, withConversationId } from '../lib/analyze';
import { upsertLimitObservation, type LimitObservation } from '../lib/calibration';
import { nextPageCursor, parsePageInfo } from '../lib/pagination';
import { conversationDetailId, conversationIdFromPath } from '../lib/routes';
import { thresholdReached } from '../lib/settings';

function node(parent: string | null, role?: string, text?: string, metadata: Record<string, unknown> = {}) {
  return {
    parent,
    children: [],
    message: role
      ? {
          author: { role },
          content: { content_type: 'text', parts: text ? [text] : [] },
          metadata,
        }
      : null,
  };
}

describe('estimateTokens', () => {
  it('returns a rough positive estimate and handles CJK', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    expect(estimateTokens('你好世界')).toBeGreaterThan(0);
  });
});

describe('analyzeConversation', () => {
  it('uses only the current active branch', () => {
    const data = {
      id: 'conv-1',
      current_node: 'a2',
      mapping: {
        root: node(null),
        u1: node('root', 'user', 'question'),
        a1: node('u1', 'assistant', 'old regenerated answer'),
        a2: node('u1', 'assistant', 'current answer'),
      },
    };

    const result = analyzeConversation(data);
    expect(result).not.toBeNull();
    expect(result?.activeBranchNodes).toBe(3);
    expect(result?.activeBranchMessages).toBe(2);
    expect(result?.roleMessages.user).toBe(1);
    expect(result?.roleMessages.assistant).toBe(1);
  });

  it('rejects a broken parent chain', () => {
    const data = {
      current_node: 'a1',
      mapping: {
        a1: node('missing', 'assistant', 'answer'),
      },
    };
    expect(analyzeConversation(data)).toBeNull();
  });

  it('rejects a parent cycle', () => {
    const data = {
      current_node: 'a',
      mapping: {
        a: node('b', 'assistant', 'a'),
        b: node('a', 'user', 'b'),
      },
    };
    expect(analyzeConversation(data)).toBeNull();
  });

  it('classifies reasoning without calling reasoning_recap a compaction signal', () => {
    const data = {
      current_node: 'r1',
      mapping: {
        root: node(null),
        r1: {
          parent: 'root',
          children: [],
          message: {
            author: { role: 'assistant' },
            content: { content_type: 'reasoning_recap', parts: ['reasoning summary'] },
            metadata: {},
          },
        },
      },
    };

    const result = analyzeConversation(data);
    expect(result?.roleMessages.reasoning).toBe(1);
    expect(result?.compactionSignals).toBe(0);
  });

  it('counts explicit hidden and compaction candidate metadata conservatively', () => {
    const data = {
      current_node: 'a1',
      mapping: {
        root: node(null),
        a1: node('root', 'assistant', 'answer', {
          is_visually_hidden_from_conversation: true,
          context_summary: 'present',
        }),
      },
    };

    const result = analyzeConversation(data);
    expect(result?.hiddenMessages).toBe(1);
    expect(result?.compactionSignals).toBe(1);
  });

  it('recognizes model_editable_context as system-like content', () => {
    const data = {
      current_node: 'm1',
      mapping: {
        root: node(null),
        m1: {
          parent: 'root',
          children: [],
          message: {
            author: { role: 'assistant' },
            content: { content_type: 'model_editable_context', parts: ['context'] },
            metadata: {},
          },
        },
      },
    };

    const result = analyzeConversation(data);
    expect(result?.roleMessages.system).toBe(1);
    expect(result?.compactionSignalLevel).toBe('possible');
  });

  it('aggregates hidden, tool, reasoning, structured, CJK, and code content', () => {
    const data = {
      id: 'mixed', default_model_slug: 'gpt-4o', current_node: 'tool',
      mapping: {
        root: node(null),
        user: node('root', 'user', '你好世界'),
        assistant: node('user', 'assistant', '```ts\nconst answer = 1\n```'),
        reasoning: { parent: 'assistant', message: { author: { role: 'assistant' }, content: { content_type: 'thoughts', parts: [{ text: 'internal reasoning' }] }, metadata: { is_hidden: true } } },
        tool: { parent: 'reasoning', message: { author: { role: 'tool' }, content: { content_type: 'computer_output', parts: [{ output: 'search result' }, { asset_pointer: 'file-id' }] }, metadata: {} } },
      },
    };
    const result = analyzeConversation(data);
    expect(result?.roleMessages.user).toBe(1);
    expect(result?.roleMessages.assistant).toBe(1);
    expect(result?.roleMessages.tool).toBe(1);
    expect(result?.roleMessages.reasoning).toBe(1);
    expect(result?.roleTokens.tool).toBeGreaterThan(0);
    expect(result?.hiddenMessages).toBe(1);
    expect(result?.modelSlug).toBe('gpt-4o');
  });

  it('supports incomplete messages and unknown structured content without counting IDs', () => {
    const data = {
      id: 'structured', current_node: 'x',
      mapping: {
        root: node(null),
        x: { parent: 'root', message: { author: { role: 'assistant' }, content: { content_type: 'future_type', id: 'not text', payload: { value: 'kept text' } }, metadata: {} } },
      },
    };
    const result = analyzeConversation(data);
    expect(result?.activeBranchMessages).toBe(1);
    expect(result?.historicalCharacters).toBe('kept text'.length);
  });

  it('recognizes an explicit compaction marker as observed', () => {
    const data = { id: 'compact', current_node: 'x', mapping: { root: node(null), x: node('root', 'assistant', 'summary', { context_truncated: true }) } };
    expect(analyzeConversation(data)?.compactionSignalLevel).toBe('observed');
    expect(analyzeConversation(data)?.compactionSignals).toBe(1);
  });

  it('uses the most specific model slug seen on the active branch', () => {
    const data = { id: 'models', default_model_slug: 'old-model', current_node: 'x', mapping: { root: node(null), x: node('root', 'assistant', 'answer', { resolved_model_slug: 'new-model' }) } };
    expect(analyzeConversation(data)?.modelSlug).toBe('new-model');
  });

  it('analyzes a paginated messages page and preserves equivalent aggregates', () => {
    const messages = [
      { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['question'] }, metadata: {} },
      { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['answer'] }, metadata: {} },
    ];
    const result = analyzeConversation({ conversation_id: 'page-1', current_node: 'a1', messages, page_info: { has_previous_page: false, start_cursor: null } });
    const legacy = analyzeConversation({ id: 'page-1', current_node: 'a1', mapping: { root: node(null), u1: node('root', 'user', 'question'), a1: node('u1', 'assistant', 'answer') } });
    expect(result?.historicalCharacters).toBe(legacy?.historicalCharacters);
    expect(result?.historicalTokensEstimate).toBe(legacy?.historicalTokensEstimate);
    expect(result?.measurementState).toBe('complete');
  });

  it('measures empty and overlapping pages by stable ID', () => {
    const first = measureMessages([{ id: 'a', author: { role: 'assistant' }, content: { parts: ['one'] } }]);
    const second = measureMessages([{ id: 'a', author: { role: 'assistant' }, content: { parts: ['changed duplicate'] } }, { id: 'b', author: { role: 'user' }, content: { parts: ['two'] } }]);
    const unique = new Map([...first, ...second].map((item) => [item.id, item]));
    expect(unique.size).toBe(2);
    expect(measureMessages([])).toEqual([]);
  });

  it('represents a paginated partial page and a complete merged history', () => {
    const pageOne = [{ id: 'new', author: { role: 'assistant' }, content: { parts: ['new'] } }];
    const pageTwo = [{ id: 'old', author: { role: 'user' }, content: { parts: ['old'] } }, ...pageOne];
    const partial = analyzeConversation({ conversation_id: 'paged', messages: pageOne, page_info: { has_previous_page: true, start_cursor: 'cursor-1' } }, { measurementState: 'partial', pagesLoaded: 1, hasMoreHistory: true });
    const merged = [...measureMessages(pageOne), ...measureMessages(pageTwo.filter((message) => message.id !== 'new'))];
    const complete = aggregateMeasurements({ conversation_id: 'paged' }, merged, merged.length, { measurementState: 'complete', pagesLoaded: 2, hasMoreHistory: false });
    expect(partial?.measurementState).toBe('partial');
    expect(complete.measurementState).toBe('complete');
    expect(complete.messagesMeasured).toBe(2);
    expect(complete.hasMoreHistory).toBe(false);
  });

  it('uses the endpoint ID when the graph omits its conversation ID', () => {
    const metrics = analyzeConversation({ current_node: 'x', mapping: { root: node(null), x: node('root', 'user', 'hello') } });
    expect(metrics).not.toBeNull();
    expect(withConversationId(metrics!, 'endpoint-id')?.conversationId).toBe('endpoint-id');
    expect(withConversationId({ ...metrics!, conversationId: 'payload-id' }, 'endpoint-id')).toBeNull();
  });
});

describe('local calibration and thresholds', () => {
  const observation = (id: string, pressure: number): LimitObservation => ({ conversationId: id, measuredAt: `${id}-${pressure}`, historicalTokensEstimate: 10, structuralPressureRaw: pressure, activeBranchMessages: 1 });

  it('replaces an existing observation for the same conversation', () => {
    expect(upsertLimitObservation([observation('same', 1)], observation('same', 2))).toEqual([observation('same', 2)]);
  });

  it('keeps disabled thresholds neutral', () => {
    expect(thresholdReached(1000, null)).toBe(false);
    expect(thresholdReached(1000, 1000)).toBe(true);
  });
});

describe('route matching', () => {
  it('matches normal and Project-style conversation routes without accepting new chat', () => {
    expect(conversationIdFromPath('/c/abc123')).toBe('abc123');
    expect(conversationIdFromPath('/g/project/c/abc123')).toBe('abc123');
    expect(conversationIdFromPath('/')).toBeNull();
  });

  it('matches current conversation detail URL variants', () => {
    expect(conversationDetailId('/backend-api/conversation/abc')).toBe('abc');
    expect(conversationDetailId('/backend-api/f/conversations/abc')).toBe('abc');
    expect(conversationDetailId('/backend-api/conversation')).toBeNull();
  });
});

describe('pagination guards', () => {
  it('rejects malformed page info and prevents cursor loops/cap overflow', () => {
    expect(parsePageInfo({ has_previous_page: true })).toEqual({ hasPreviousPage: true, startCursor: null });
    expect(parsePageInfo({ has_previous_page: 'true' })).toBeNull();
    const seen = new Set<string>();
    expect(nextPageCursor({ hasPreviousPage: true, startCursor: 'c1' }, seen, 1, 100)).toBe('c1');
    expect(nextPageCursor({ hasPreviousPage: true, startCursor: 'c1' }, seen, 2, 100)).toBeNull();
    expect(nextPageCursor({ hasPreviousPage: true, startCursor: 'c2' }, seen, 100, 100)).toBeNull();
  });
});
