import { describe, expect, it } from 'vitest';

import {
  PATTERN_METACHARACTERS,
  escapeLiteral,
  escapeReplacement,
  unescapeLiteral
} from '../src/escape';

const BS = String.fromCharCode(92);

/** 覆盖元字符、非元字符标点、CJK、代理对 emoji、空白与裸反斜杠。 */
const SAMPLES: readonly string[] = [
  '',
  'a',
  '^$.|?*+()[]{}',
  BS,
  'a' + BS + 'b',
  'price=$5 & 100%',
  'a-b_c!d#e;f<g,h:i@j~k',
  '[a-z]',
  '(?<name>x)',
  '\\d{2,3}',
  '中文与标点（全角）',
  '😀 emoji 代理对',
  'line1\nline2\ttab',
  '/',
  '///',
  // v 模式顶层对连续双标点（ClassSetReservedDoublePunctuator）无限制，实测不抛，故不需转义
  'a!!b--c##d&&e'
];

describe('escapeLiteral', () => {
  it("转义后的串在 '' / u / v 三种模式下都能编译且精确匹配原串", () => {
    for (const sample of SAMPLES) {
      const escaped = escapeLiteral(sample);
      for (const flag of ['', 'u', 'v'] as const) {
        let re: RegExp;
        try {
          re = new RegExp(escaped, flag);
        } catch (error: unknown) {
          throw new Error(
            `flag='${flag}' 下无法编译 ${JSON.stringify(escaped)}（源 ${JSON.stringify(sample)}）：` +
              String(error)
          );
        }
        const m = re.exec(sample);
        expect(m?.[0], `flag='${flag}' 未整串匹配 ${JSON.stringify(sample)}`).toBe(sample);
      }
    }
  });

  /**
   * 这条锁住探针结论：`-` `!` `#` `%` `&` `'` `,` `:` `;` `<` `=` `>` `@` `_` `` ` `` `~`
   * 加上反斜杠后在 u / v 模式下是 SyntaxError，**过度转义会把 pattern 弄坏**。
   */
  it('对非元字符标点一律不加转义', () => {
    for (const ch of [..."-!#%&,<>:;@_`'~="]) {
      expect(escapeLiteral(ch), `不该转义 ${ch}`).toBe(ch);
    }
  });

  it('对每个元字符都加转义', () => {
    for (const ch of PATTERN_METACHARACTERS) {
      expect(escapeLiteral(ch)).toBe(BS + ch);
    }
  });

  /**
   * 逐一点名 14 个 ECMAScript SyntaxCharacter 加 `/`。
   * 第一版把转义集写成一个手抄字符串，结果漏了 `*`，pattern 变成 `\|` 后接量词 `*`、
   * 整串语义崩坏 —— 这条断言就是为了让"漏一个字符"当场变红。
   */
  it('转义集恰好是 15 个成员，逐个点名', () => {
    const REQUIRED = ['^', '$', BS, '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '/'];
    expect(PATTERN_METACHARACTERS).toHaveLength(REQUIRED.length);
    for (const ch of REQUIRED) {
      expect(PATTERN_METACHARACTERS, `转义集缺少 ${ch === BS ? '反斜杠' : ch}`).toContain(ch);
    }
  });

  it('空串与无元字符串保持原样', () => {
    expect(escapeLiteral('')).toBe('');
    expect(escapeLiteral('abc123')).toBe('abc123');
  });

  it('元字符表含反斜杠且已冻结', () => {
    expect(PATTERN_METACHARACTERS).toContain(BS);
    expect(Object.isFrozen(PATTERN_METACHARACTERS)).toBe(true);
    // 反斜杠必须在表内，否则 `\\` 会变成 `\` + 转义下一个字符，语义全错
    expect(escapeLiteral(BS + 'd')).toBe(BS + BS + 'd');
  });
});

describe('unescapeLiteral', () => {
  it('roundtrip：unescape(escape(s)) === s', () => {
    for (const sample of SAMPLES) {
      const result = unescapeLiteral(escapeLiteral(sample));
      expect(result.ok, `roundtrip 失败：${JSON.stringify(sample)}`).toBe(true);
      if (result.ok) expect(result.value).toBe(sample);
    }
  });

  it('解析常见控制转义与 \\x / \\u / \\u{}', () => {
    // 无反斜杠的普通字符原样返回
    expect(unescapeLiteral('n')).toEqual({ ok: true, value: 'n' });
    expect(unescapeLiteral(BS + BS)).toEqual({ ok: true, value: BS });
    const r = unescapeLiteral(`${BS}n${BS}t${BS}x41${BS}u0042${BS}u{1F600}`);
    expect(r.ok && r.value).toBe('\n\tAB😀');
  });

  it('identity escape 宽松还原', () => {
    expect(unescapeLiteral(BS + 'a')).toEqual({ ok: true, value: 'a' });
  });

  it('结尾裸反斜杠判失败并给出位置', () => {
    const r = unescapeLiteral('abc' + BS);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue.code).toBe('invalid-pattern');
      expect(r.issue.index).toBe(3);
    }
  });

  /** `\b` 在类外是词边界、类内是退格符，脱离上下文无法判定，必须拒绝而非二选一。 */
  it('歧义转义 \\b 判失败', () => {
    const r = unescapeLiteral(BS + 'b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.message).toContain('Ambiguous');
  });

  it('残缺或越界的 \\x / \\u 序列判失败而不抛', () => {
    for (const bad of [BS + 'xZZ', BS + 'x4', BS + 'u12', BS + 'uZZZZ', BS + 'u{}', BS + 'u{110000}', BS + 'u{']) {
      expect(unescapeLiteral(bad).ok, `应判失败：${bad}`).toBe(false);
    }
  });
});

describe('escapeReplacement', () => {
  /** 与原生 String.prototype.replace 差分：转义后的串必须原样产出，不展开任何 $ 记号。 */
  it('转义后的 replacement 逐字面输出（与原生 replace 行为差分一致）', () => {
    for (const raw of [
      'plain',
      '$&',
      "$1",
      '$<name>',
      '$$',
      '$`',
      "$'",
      'cost $5 & $& end',
      '$$$$',
      '',
      '$0'
    ]) {
      const escaped = escapeReplacement(raw);
      expect('X'.replace(/X/, escaped), `replacement 未原样产出 ${JSON.stringify(raw)}`).toBe(raw);
    }
  });

  it('只转义 $，不动其他字符（含 / 与反斜杠）', () => {
    const literal = 'a/b' + BS + 'c[d]^';
    expect(escapeReplacement('')).toBe('');
    expect(escapeReplacement('a')).toBe('a');
    expect(escapeReplacement('$')).toBe('$$');
    // replacement 里只有 $ 特殊，pattern 元字符在此不需转义
    expect(escapeReplacement(literal)).toBe(literal);
  });
});
