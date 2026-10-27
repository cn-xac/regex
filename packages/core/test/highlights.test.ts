import { describe, expect, it } from 'vitest';

import { matchAll } from '../src/engine';
import type { MatchSession } from '../src/engine';
import { computeHighlights, spansAtOffset, toLineColumns, toRenderChunks } from '../src/highlights';
import type { HighlightSpan } from '../src/highlights';

function session(text: string, pattern: string, flags = 'g'): MatchSession {
  return matchAll(text, pattern, flags);
}

describe('computeHighlights 基本形状', () => {
  it('每个 match 恰有一个 match span，外加各组 span', () => {
    const spans = computeHighlights(session('a1 b2', '\\w(\\d)', 'g'));
    expect(spans.filter((s) => s.kind === 'match').map((s) => s.text ?? s.start)).toHaveLength(2);
    const matchSpans = spans.filter((s) => s.kind === 'match');
    expect(matchSpans.map((s) => [s.start, s.end])).toEqual([
      [0, 2],
      [3, 5]
    ]);
    const groupSpans = spans.filter((s) => s.kind === 'group');
    expect(groupSpans.map((s) => [s.start, s.end, s.groupOrdinal])).toEqual([
      [1, 2, 1],
      [4, 5, 1]
    ]);
  });

  it('命名组标成 named-group 并带 label', () => {
    const spans = computeHighlights(session('2026-10', '(?<y>\\d{4})', ''));
    const named = spans.find((s) => s.kind === 'named-group');
    expect(named?.label).toBe('y');
    expect(named?.start).toBe(0);
    expect(named?.end).toBe(4);
  });

  it('includeGroups:false 只出整段匹配', () => {
    const spans = computeHighlights(session('a1', '\\w(\\d)'), { includeGroups: false });
    expect(spans.every((s) => s.kind === 'match')).toBe(true);
  });

  it('namedOnly 只保留有名字的组', () => {
    const spans = computeHighlights(session('ab', '(a)(?<n>b)'), { namedOnly: true });
    expect(spans.filter((s) => s.kind === 'group')).toHaveLength(0);
    expect(spans.filter((s) => s.kind === 'named-group')).toHaveLength(1);
  });

  it('未参与匹配的组不出 span，而不是画一个零长假框', () => {
    const spans = computeHighlights(session('b', '(a)?b', ''));
    expect(spans.filter((s) => s.kind === 'match')).toHaveLength(1);
    expect(spans.filter((s) => s.kind !== 'match')).toHaveLength(0);
  });

  it('ok:false 的 session 得到空数组', () => {
    expect(computeHighlights(session('x', '(', 'g'))).toEqual([]);
  });
});

describe('排序与嵌套', () => {
  it('同 start 时按 match < group < named-group 的稳定次序', () => {
    const spans = computeHighlights(session('ab', '(?<n>a)(b)?', ''));
    const atZero = spans.filter((s) => s.start === 0);
    expect(atZero.map((s) => s.kind)).toEqual(['match', 'named-group']);
  });

  it('嵌套组的 depth 递增且外层不变', () => {
    const spans = computeHighlights(session('abc', '((a)(b))(c)', ''));
    const depthOf = new Map<number, number>();
    for (const s of spans) {
      if (s.kind === 'match') continue;
      depthOf.set(s.groupOrdinal, s.depth);
    }
    // 组 1 = (a)(b) 最外，组 2/3 = a/b 在其内，组 4 = c 与组 1 平级
    expect(depthOf.get(1)).toBe(0);
    expect(depthOf.get(2)).toBe(1);
    expect(depthOf.get(3)).toBe(1);
    expect(depthOf.get(4)).toBe(0);
  });

  it('start 全局升序（视图按此线性铺区间）', () => {
    const spans = computeHighlights(session('a1 b2 c3', '\\w(\\d)', 'g'));
    const starts = spans.map((s) => s.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('区间重叠被保留而不是被扁平化', () => {
    const spans = computeHighlights(session('12-34', '\\b(\\d+)-(\\d+)\\b', ''));
    expect(spans.length).toBeGreaterThanOrEqual(3);
    const ranges = spans.filter((s) => s.kind !== 'match').map((s) => [s.start, s.end]);
    expect(ranges).toEqual([
      [0, 2],
      [3, 5]
    ]);
  });
});

describe('零宽与合并策略', () => {
  it('零宽匹配保留 start===end 的 span，不被丢掉', () => {
    const spans = computeHighlights(session('ab', 'b*', 'g'));
    expect(spans.some((s) => s.start === s.end)).toBe(true);
  });

  it('mergeEqualRanges 只合并完全相同的区间', () => {
    const base = computeHighlights(session('ab', '(?<x>a)(a)?', ''));
    const merged = computeHighlights(session('ab', '(?<x>a)(a)?', ''), { mergeEqualRanges: true });
    expect(merged.length).toBeLessThanOrEqual(base.length);
    const keys = merged.map((s) => `${s.kind}:${s.start}-${s.end}:${s.groupOrdinal}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('两个同区间不同组号的 span 在默认策略下都保留', () => {
    const spans = computeHighlights(session('a', '(?<n>a)(a)?', ''));
    const atZero = spans.filter((s) => s.kind !== 'match' && s.start === 0 && s.end === 1);
    expect(atZero.map((s) => s.groupOrdinal).sort()).toEqual([1, 2].filter((n) => atZero.some((s) => s.groupOrdinal === n)));
  });
});

describe('spansAtOffset', () => {
  it('命中覆盖该偏移的区间，含零宽区间只在自己的起点上命中', () => {
    const spans = computeHighlights(session('a1 b2', '\\w(\\d)', 'g'));
    const at1 = spansAtOffset(spans, 1);
    expect(at1.length).toBeGreaterThan(0);
    expect(at1.every((s) => s.start <= 1 && 1 < s.end)).toBe(true);
    expect(spansAtOffset(spans, 2)).toHaveLength(0);

    const zeroWidth = [{ ...spans[0], start: 5, end: 5 }] as HighlightSpan[];
    expect(spansAtOffset(zeroWidth, 5)).toHaveLength(1);
    expect(spansAtOffset(zeroWidth, 4)).toHaveLength(0);
  });
});

describe('toLineColumns', () => {
  it('对 \\n、\\r\\n、U+2028 都给出行列（均 1 起）', () => {
    const text = 'ab\r\ncd\n ef\u2028xy';
    const spans = computeHighlights(session(text, 'cd|ef|xy', 'g'));
    const positioned = toLineColumns(text, spans.filter((s) => s.kind === 'match'));
    expect(positioned.map((p) => [p.line, p.column])).toEqual([
      [2, 1],
      [3, 2],
      [4, 1]
    ]);
  });

  it('列按 UTF-16 code unit 计，emoji 占两列', () => {
    const text = '😀ab';
    const positioned = toLineColumns(text, spansAtOffset(computeHighlights(session(text, 'b', '')), 3));
    expect(positioned[0]?.column).toBe(4);
  });

  it('空文本与首行都落在第 1 行', () => {
    const positioned = toLineColumns('abc', computeHighlights(session('abc', 'a', '')));
    expect(positioned.every((p) => p.line === 1)).toBe(true);
    expect(positioned[0]?.column).toBe(1);
  });
});

describe('toRenderChunks', () => {
  const CASES: ReadonlyArray<[string, string, string]> = [
    ['a1 b2', '\\w(\\d)', 'g'],
    ['', 'x', 'g'],
    ['ab', 'b*', 'g'],
    ['😀ab', '(.)', ''],
    ['2026-10-27', '(?<y>\\d{4})-(\\d{2})', 'g'],
    ['aaa', 'a(a)?', 'g']
  ];

  it('片段拼回原文，不吞字符也不重复', () => {
    for (const [text, pattern, flags] of CASES) {
      const chunks = toRenderChunks(text, computeHighlights(session(text, pattern, flags)));
      expect(chunks.map((c) => c.text).join(''), `text=${text}`).toBe(text);
      // 片段必须连续无缝
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i]?.start).toBe(chunks[i - 1]?.end);
      }
    }
  });

  it('每个 chunk 携带的 span 都真正覆盖它', () => {
    for (const [text, pattern, flags] of CASES) {
      const chunks = toRenderChunks(text, computeHighlights(session(text, pattern, flags)));
      for (const chunk of chunks) {
        for (const span of chunk.spans) {
          if (span.start === span.end) {
            expect(span.start).toBe(chunk.start);
            continue;
          }
          expect(span.start <= chunk.start && chunk.end <= span.end).toBe(true);
        }
        expect([...chunk.spans].map((s) => s.depth)).toEqual(
          [...chunk.spans].map((s) => s.depth).sort((a, b) => a - b)
        );
      }
    }
  });

  it('零宽区间附着到所在片段，而不是被丢掉', () => {
    const chunks = toRenderChunks('ab', computeHighlights(session('ab', 'b*', 'g')));
    const withZeroWidth = chunks.filter((c) => c.spans.some((s) => s.start === s.end));
    expect(withZeroWidth.length).toBeGreaterThan(0);
  });

  it('无匹配时整段一个片段；输出全冻结', () => {
    const chunks = toRenderChunks('hello', computeHighlights(session('hello', 'zzz', 'g')));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe('hello');
    expect(Object.isFrozen(chunks)).toBe(true);
    expect(Object.isFrozen(chunks[0])).toBe(true);
    expect(Object.isFrozen(chunks[0]?.spans)).toBe(true);
  });

  it('越界 span 不会撑破边界（视图可能传入编辑前的旧区间）', () => {
    const spans = computeHighlights(session('abcdef', 'c(d)', ''));
    const chunks = toRenderChunks('ab', spans);
    expect(chunks.map((c) => c.text).join('')).toBe('ab');
  });
});

describe('不可变性', () => {
  it('输出数组与每个 span 都被冻结', () => {
    const spans = computeHighlights(session('a1', '\\w(\\d)', 'g'));
    expect(Object.isFrozen(spans)).toBe(true);
    expect(Object.isFrozen(spans[0])).toBe(true);
    const positioned = toLineColumns('a1', spans);
    expect(Object.isFrozen(positioned)).toBe(true);
    expect(Object.isFrozen(positioned[0])).toBe(true);
  });
});
