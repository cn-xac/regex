import { describe, expect, it } from 'vitest';

import { nameByOrdinal, scanGroups } from '../src/groups';

/**
 * 差分基准：`exec` 结果的数组长度减 1 就是原生认定的捕获组数（0 号是整体匹配），
 * `result.groups` 的键就是原生认定的命名组。扫描器的正确性以这两个真值为准 ——
 * 手写期望值会把扫描器自己的错固化成断言。
 */
const CASES: ReadonlyArray<{ pattern: string; sample: string }> = [
  { pattern: 'a', sample: 'a' },
  { pattern: '(a)', sample: 'a' },
  { pattern: '(a)(b)', sample: 'ab' },
  { pattern: '(a)(b)(c)(d)(e)', sample: 'abcde' },
  { pattern: '(?:a)(b)', sample: 'ab' },
  { pattern: '(?<x>a)', sample: 'a' },
  { pattern: '(?<a>x)(?<b>y)', sample: 'xy' },
  { pattern: '(?<g>a)(b)(?<h>c)', sample: 'abc' },
  // 字符类内的括号不是组
  { pattern: '[(]', sample: '(' },
  { pattern: '[(](a)', sample: '(a' },
  { pattern: '[(a-z)](b)', sample: '(b' },
  { pattern: '([^)])(x)', sample: 'ax' },
  // 注意：V8 把 `[]` 解析为**空类**（永不匹配），所以想测"类内含右括号"必须写 `[\]]`，
  // 写成 `[]]]` 会让整串永不匹配、差分前提不成立。
  { pattern: '[\\]](q)', sample: ']q' },
  // 转义的括号不是组
  { pattern: '\\(a', sample: '(a' },
  { pattern: '\\((a)\\)', sample: '(a)' },
  // 断言与非捕获不产生序号
  // 断言与非捕获不产生序号。注意 `(?=a)(b)` 这种写法永远匹配不上（断言不消耗字符，
  // 紧接的 (b) 就得在同一位置既吞 a 又吞 b），所以断言后要接能被它放行的实体会消耗。
  { pattern: '(?=a)(a)(b)', sample: 'ab' },
  { pattern: '(?!z)(b)', sample: 'b' },
  { pattern: '(?<=a)(b)', sample: 'ab' },
  { pattern: '(?<!z)(b)', sample: 'b' },
  // 嵌套与混合
  { pattern: '(a(?:b(c)))', sample: 'abc' },
  { pattern: '((?:[a-z)]))', sample: ')' },
  { pattern: '(a)(?<n>b)', sample: 'ab' },
  { pattern: 'a{2}(b)', sample: 'aab' },
  { pattern: '(a)\\1(b)', sample: 'aab' },
  { pattern: '(?<g>a)(b)\\k<g>', sample: 'aba' },
  { pattern: '(\\d{4})-(\\d{2})-(?<day>\\d{2})', sample: '2026-10-27' }
];

describe('scanGroups 与原生 RegExp 差分', () => {
  it('捕获组数量与 exec 结果长度一致', () => {
    for (const { pattern, sample } of CASES) {
      const exec = new RegExp(pattern).exec(sample);
      // case 本身必须真匹配，否则差分没有意义（先钉住前提）
      expect(exec, `样例未匹配：pattern=${pattern} sample=${sample}`).not.toBeNull();
      expect(scanGroups(pattern).groupCount, `pattern=${pattern}`).toBe((exec?.length ?? 1) - 1);
    }
  });

  it('命名组顺序与名称同 result.groups 的键一致', () => {
    for (const { pattern, sample } of CASES) {
      const exec = new RegExp(pattern).exec(sample);
      expect(scanGroups(pattern).named.map((n) => n.name), `pattern=${pattern}`).toEqual(
        Object.keys(exec?.groups ?? {})
      );
    }
  });

  it('命名组的 ordinal 与 exec 中该组实际所在的槽位一致', () => {
    for (const { pattern, sample } of CASES) {
      const exec = new RegExp(pattern).exec(sample);
      for (const { name, ordinal } of scanGroups(pattern).named) {
        expect(exec?.[ordinal], `pattern=${pattern} name=${name}`).toBe(
          exec?.groups?.[name] ?? undefined
        );
      }
    }
  });
});

describe('scanGroups 边角', () => {
  it('悬挂的 ( 与不完整 (? 不计数也不抛', () => {
    expect(scanGroups('(').groupCount).toBe(1); // 未闭合交由 RegExp 判非法
    expect(scanGroups('(?').groupCount).toBe(0);
    expect(scanGroups('(?<').groupCount).toBe(0);
    expect(scanGroups('(?<a').groupCount).toBe(0);
  });

  it('空 pattern 零组', () => {
    expect(scanGroups('')).toEqual({ groupCount: 0, named: [] });
  });

  it('nameByOrdinal 给出序号到名称的反查', () => {
    const scan = scanGroups('(?<y>\\d{4})-(\\d{2})-(?<d>\\d{2})');
    expect(nameByOrdinal(scan)).toEqual({ 1: 'y', 3: 'd' });
  });
});
