import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, compileCheck, matchAll } from '../src/engine';
import { hasFlag, normalizeFlags } from '../src/flags';

/**
 * 原生基准：`String.prototype.matchAll` 语义（内部总带 g）。
 * 非 g / 非 y 时本工具只取第一条，与裸 `exec` 一致。
 */
function nativeMatches(text: string, pattern: string, flags: string): RegExpMatchArray[] {
  const iterator = text.matchAll(new RegExp(pattern, normalizeFlags(`${flags}g`)));
  const all = Array.from(iterator);
  return hasFlag(flags, 'g') || hasFlag(flags, 'y') ? all : all.slice(0, 1);
}

/** 覆盖字面量、字符类、量词贪懒、锚点、各类分组、断言、反向引用、unicode、空白边界。 */
const PATTERNS: readonly string[] = [
  '',
  'a',
  'abc',
  '.',
  'a.c',
  '^a',
  'a$',
  '^$',
  'a*',
  'a+',
  'a?',
  'a{2}',
  'a{2,}',
  'a{1,3}',
  'a*?',
  'a+?',
  '[abc]',
  '[^abc]',
  '[a-z0-9_]',
  '[]]',
  '[(]',
  '[\\]]',
  '(a)',
  '(a)(b)',
  '(?:ab)',
  '(?<name>a)',
  '(?<y1>a)(?<z2>b)',
  '(a)?b',
  'a|b',
  '(a|b)+',
  '\\d',
  '\\D',
  '\\w',
  '\\W',
  '\\s',
  '\\S',
  '\\.',
  '\\\\',
  '\\1(a)',
  '(a)\\1',
  '(?<x>a)\\k<x>',
  '(?=a)a',
  '(?!b)a',
  '(?<=a)b',
  '(?<!a)b',
  '\\bword\\b',
  '\\Bna',
  '[\\u4e00-\\u9fa5]',
  '😀',
  'a{2,3}|b',
  '(a(b(c)))',
  '\\A',
  'x*'
];

const TEXTS: readonly string[] = [
  '2026-10-27 09:15 user=xyj2156 status=ok 😀 done aaa-111',
  '',
  'aaa-111\nbbb-222\r\nCCC-333 价格 100.50 元 (含 8.8% 税) word banana'
];

describe('matchAll 与原生引擎差分', () => {
  it(`${PATTERNS.length} 个 pattern × ${TEXTS.length} 个文本逐字段一致`, () => {
    for (const pattern of PATTERNS) {
      for (const text of TEXTS) {
        for (const flags of ['g', 'gi', 'gm'] as const) {
          const ours = matchAll(text, pattern, flags);
          const where = `pattern=${JSON.stringify(pattern)} text=${JSON.stringify(text)} flags=${flags}`;
          expect(ours.ok, `${where} 应可编译`).toBe(true);

          const theirs = nativeMatches(text, pattern, flags);
          expect(ours.matches.length, `${where} 条数`).toBe(theirs.length);

          ours.matches.forEach((match, i) => {
            const native = theirs[i];
            if (native === undefined) return;
            expect(match.range.start, `${where} #${i} start`).toBe(native.index);
            expect(match.text, `${where} #${i} text`).toBe(native[0] ?? '');
            expect(match.groups.length, `${where} #${i} 组数`).toBe(native.length);

            match.groups.forEach((group, gi) => {
              const raw = native[gi];
              expect(group.text, `${where} #${i} g${gi} text`).toBe(raw ?? null);
              // 区间必须真的能切回那段文本 —— 这是 d flag 用对了的硬证据
              const sliced =
                group.range === null ? null : text.slice(group.range.start, group.range.end);
              expect(sliced, `${where} #${i} g${gi} range`).toBe(raw ?? null);
            });

            expect(Object.keys(match.named).sort(), `${where} #${i} named`).toEqual(
              Object.keys(native.groups ?? {}).sort()
            );
          });
        }
      }
    }
  });

  it('零宽匹配不死循环且与 matchAll 前进规则一致', () => {
    const ours = matchAll('aaa', 'a*', 'g');
    expect(ours.ok).toBe(true);
    expect(ours.matches.length).toBe(Array.from('aaa'.matchAll(/a*/g)).length);
    expect(ours.stats.zeroWidthAdvances).toBeGreaterThan(0);
    expect(ours.matches.some((m) => m.empty)).toBe(true);
  });

  it('带 g 全量、不带 g 只第一条', () => {
    expect(matchAll('aaa', 'a', 'g').matches).toHaveLength(3);
    expect(matchAll('aaa', 'a', '').matches).toHaveLength(1);
    expect(matchAll('aaa', 'a', 'i').truncated).toBe(false);
  });

  it('nextIndex 正常收尾等于文本长度，截断时可用于续搜', () => {
    expect(matchAll('a1', '\\w+', 'g').nextIndex).toBe(2);

    const first = matchAll('a1 b2 c3', '\\w+\\d', 'g', { limits: { maxMatches: 1 } });
    expect(first.truncated).toBe(true);
    expect(first.nextIndex).toBeGreaterThan(0);
    const rest = matchAll('a1 b2 c3', '\\w+\\d', 'g', { startAt: first.nextIndex });
    expect(rest.matches.map((m) => m.text)).toEqual(['b2', 'c3']);
  });

  it('y flag 只在 lastIndex 处匹配，命中后连续推进', () => {
    const s = matchAll('aaa bbb', 'a', 'gy');
    expect(s.matches.map((m) => m.range.start)).toEqual([0, 1, 2]);
  });

  it('内部恒启 d：用户没写 d 也能拿到捕获组区间', () => {
    const s = matchAll('2026-10', '(\\d{4})-(\\d{2})', '');
    expect(s.flags).toBe('');
    expect(s.effectiveFlags).toBe('d');
    expect(s.matches[0]?.groups[1]?.range).toEqual({ start: 0, end: 4 });
    expect(s.matches[0]?.groups[2]?.range).toEqual({ start: 5, end: 7 });
  });

  it('未参与匹配的组 text 与 range 均为 null', () => {
    const s = matchAll('b', '(a)?b', '');
    expect(s.matches[0]?.groups[1]?.text).toBeNull();
    expect(s.matches[0]?.groups[1]?.range).toBeNull();
  });

  it('多行 flag 下 ^ 与 $ 命中每行首尾', () => {
    const s = matchAll('a\nb\n', '^\\w$', 'gm');
    expect(s.matches.map((m) => m.text)).toEqual(['a', 'b']);
  });

  it('u flag 下代理对索引按 UTF-16 code unit 计', () => {
    const s = matchAll('😀a', '(.).', 'u');
    const first = s.matches[0];
    expect(first?.text).toBe('😀a');
    // 一个 emoji 占 2 个 code unit，这是 JS 原生语义、不是 bug
    expect(first?.groups[1]?.range).toEqual({ start: 0, end: 2 });
  });

  it('重复调用同一输入结果一致（不污染外部 RegExp 状态）', () => {
    const a = matchAll('aaa', 'a+', 'g');
    const b = matchAll('aaa', 'a+', 'g');
    expect(b).toEqual(a);
  });
});

describe('限额与截断', () => {
  it('maxMatches 命中即 truncated 且只留规定条数', () => {
    const s = matchAll('a a a a a', 'a', 'g', { limits: { maxMatches: 2 } });
    expect(s.truncated).toBe(true);
    expect(s.matches).toHaveLength(2);
    expect(s.issues.some((i) => i.code === 'too-many-matches')).toBe(true);
  });

  it('maxIterations 命中即 truncated', () => {
    const s = matchAll('a a a a a', 'a', 'g', { limits: { maxIterations: 3 } });
    expect(s.truncated).toBe(true);
    expect(s.issues.some((i) => i.code === 'iteration-limit')).toBe(true);
    expect(s.stats.iterations).toBeLessThanOrEqual(3);
  });

  it('注入的时钟越界时报 time-limit 且不真等', () => {
    let clock = 0;
    const s = matchAll('a a a a a', 'a', 'g', {
      limits: { deadlineMs: 50 },
      now: () => (clock += 30)
    });
    expect(s.truncated).toBe(true);
    expect(s.issues.some((i) => i.code === 'time-limit')).toBe(true);
  });

  it('pattern 与 text 超长各自报对应 code', () => {
    const long = 'a'.repeat(3000);
    expect(
      matchAll('x', long, 'g').issues.some((i) => i.code === 'pattern-too-long')
    ).toBe(true);
    expect(
      matchAll(long, 'a', 'g', { limits: { maxTextLength: 100 } }).issues.some(
        (i) => i.code === 'text-too-long'
      )
    ).toBe(true);
  });
});

describe('失败路径不抛异常', () => {
  it('非法 pattern → ok:false + invalid-pattern', () => {
    const s = matchAll('x', '(?P<name>a)', 'g');
    expect(s.ok).toBe(false);
    expect(s.matches).toEqual([]);
    expect(s.issues.some((i) => i.code === 'invalid-pattern' && i.severity === 'error')).toBe(true);
  });

  it('未知 flag → ok:false', () => {
    const s = matchAll('x', 'a', 'q');
    expect(s.ok).toBe(false);
    expect(s.issues.some((i) => i.code === 'invalid-flag')).toBe(true);
  });

  it('u 与 v 同时出现 → ok:false', () => {
    expect(matchAll('x', 'a', 'uv').ok).toBe(false);
  });

  it('空 pattern 是合法的（匹配空串）', () => {
    const s = matchAll('ab', '', 'g');
    expect(s.ok).toBe(true);
    expect(s.matches.length).toBeGreaterThan(0);
  });
});

describe('不可变性', () => {
  it('session 及其内部结构全部冻结', () => {
    const s = matchAll('a1', '(\\w)(\\d)', 'g');
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.matches)).toBe(true);
    expect(Object.isFrozen(s.matches[0])).toBe(true);
    expect(Object.isFrozen(s.matches[0]?.groups)).toBe(true);
    expect(Object.isFrozen(s.stats)).toBe(true);
    expect(Object.isFrozen(s.issues)).toBe(true);
  });

  it('DEFAULT_LIMITS 冻结且数值钉死', () => {
    expect(Object.isFrozen(DEFAULT_LIMITS)).toBe(true);
    expect(DEFAULT_LIMITS).toEqual({
      maxMatches: 5000,
      maxIterations: 200_000,
      maxPatternLength: 2000,
      maxTextLength: 2_000_000,
      deadlineMs: 200
    });
  });
});

describe('compileCheck', () => {
  it('给出组数与组名，不跑匹配', () => {
    const r = compileCheck('(?<y>\\d{4})-(\\d{2})', 'g');
    expect(r.ok).toBe(true);
    expect(r.groupCount).toBe(2);
    expect(r.groupNames).toEqual(['y']);
  });

  it('非法 pattern 返回 ok:false 且不抛', () => {
    const r = compileCheck('[', '');
    expect(r.ok).toBe(false);
    expect(r.groupCount).toBe(0);
    expect(r.issues.some((i) => i.code === 'invalid-pattern')).toBe(true);
  });

  it('与 matchAll 的可编译判定一致（校验说行的必然能跑）', () => {
    for (const pattern of PATTERNS) {
      const checked = compileCheck(pattern, 'g');
      const run = matchAll('abc', pattern, 'g');
      expect(run.ok, `pattern=${JSON.stringify(pattern)}`).toBe(checked.ok);
    }
  });
});
