import { describe, expect, it } from 'vitest';
import { analyzeConversation, estimateTokens } from '../lib/analyze';

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
  });
});
