/**
 * escape —— 字面量 ↔ pattern / replacement 的安全转换。
 *
 * 转义集是**实测**出来的，不是照着"正则特殊字符表"想当然写的。探针结论
 * （见 `pages-dist/probe.mjs` 的可复现逻辑，结论固化在此）：
 *
 * 1. 不转义就无法编译的真元字符：`( ) * + ? [ ] { } \`；另有 `^ $ . |` 能编译但会
 *    改变语义，同样必须转义；`/` 为字面量写法 `/.../` 场景一并转。
 * 2. **绝不可**扩展 `-` `!` `#` `%` `&` `'` `,` `:` `;` `<` `=` `>` `@` `_` `` ` `` `~`：
 *    这些字符加上反斜杠后在 `u` / `v` 模式下是 **SyntaxError**（非 identity escape）。
 *    所以方案里"转义 v 模式额外中括号类字符"的设想在**字符类外**不成立 —— 想要那种
 *    转义只能在 `[...]` 内部单独构造，不属于本函数的职责。
 *
 * 因此本模块的转义集对 `''` / `'u'` / `'v'` 三种 flag 同样安全，测试里逐字符实证。
 */
import type { RegexIssue } from './types';

const BS = String.fromCharCode(92);

/**
 * 必须转义的字符集（含反斜杠本身）。
 *
 * 写成逐字符数组而非一个手抄字符串 —— 本模块的第一版就是用字符串写的，结果**漏了 `*`**，
 * 导致 `\|` 后面紧跟量词 `*`、整个 pattern 语义崩坏。逐字符列出可数、可 review。
 */
export const PATTERN_METACHARACTERS: readonly string[] = Object.freeze([
  '^',
  '$',
  BS,
  '.',
  '*',
  '+',
  '?',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '|',
  '/'
]);

const META: ReadonlySet<string> = new Set<string>(PATTERN_METACHARACTERS);

/**
 * 任意字符串 → 在 pattern 中按字面量匹配的转义串。
 *
 * 反斜杠最先处理已由 `META` 含 `BS` 保证逐字符判定，无需担心二次转义。
 */
export function escapeLiteral(input: string): string {
  let out = '';
  for (const ch of input) {
    out += META.has(ch) ? BS + ch : ch;
  }
  return out;
}

/**
 * 任意字符串 → 在 replacement 中按字面量出现（转义 `$`）。
 *
 * replacement 里唯一有特殊含义的是 `$`，而 `$$` 表示一个字面 `$`，所以要翻倍。
 */
export function escapeReplacement(input: string): string {
  let out = '';
  for (const ch of input) {
    out += ch === '$' ? '$$' : ch;
  }
  return out;
}

/** `\` + 单字符的控制转义表；`\b` 刻意不在其中，见 `unescapeLiteral` 说明。 */
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  n: '\n',
  r: '\r',
  t: '\t',
  f: '\f',
  v: '\v',
  '0': '\0'
});

export type UnescapeResult =
  | { ok: true; value: string }
  | { ok: false; issue: RegexIssue };

function fail(message: string, index: number): UnescapeResult {
  return {
    ok: false,
    issue: {
      // 沿用 `invalid-pattern` 而非新造 code：转义串本身就是一个（局部）非法 pattern，
      // 扩展 IssueCode 联合要同时动 types 与两份语言的文案表，收益不抵成本。
      code: 'invalid-pattern',
      severity: 'error',
      message,
      index
    }
  };
}

function hex(code: string): number {
  return Number.isNaN(Number.parseInt(code, 16)) ? -1 : Number.parseInt(code, 16);
}

/**
 * pattern 字面量 → 原文。解析 `\\`、`\n\r\t\f\v0`、`\xHH`、`\uHHHH`、`\u{...}`
 * 以及对其余字符的 identity escape（`\a` → `a`）。
 *
 * 两类输入判失败而非猜：
 * - 结尾裸反斜杠（转义序列不完整）；
 * - `\b` —— 它在 pattern 顶层是**词边界断言**、只在字符类内才是退格符，脱离上下文
 *   无法判定，静默任选一种都会出错，所以直接拒绝并给出原因。
 *
 * roundtrip 恒等：对任意输入，`unescapeLiteral(escapeLiteral(s))` 必得 `s`。
 */
export function unescapeLiteral(input: string): UnescapeResult {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (ch !== BS) {
      out += ch;
      continue;
    }
    const next = input.charAt(i + 1);
    if (next === '') return fail('Pattern ends with a trailing backslash', i);

    if (next === BS || META.has(next)) {
      out += next;
      i += 1;
      continue;
    }
    if (next === 'b') {
      return fail(
        'Ambiguous escape \\b: it asserts a word boundary outside a character class but means U+0008 inside one',
        i
      );
    }
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      out += simple;
      i += 1;
      continue;
    }
    if (next === 'x') {
      const code = input.slice(i + 2, i + 4);
      const value = code.length === 2 ? hex(code) : -1;
      if (value < 0) return fail(`Invalid \\x escape near offset ${i}`, i);
      out += String.fromCharCode(value);
      i += 3;
      continue;
    }
    if (next === 'u') {
      const brace = input.charAt(i + 2);
      if (brace === '{') {
        const close = input.indexOf('}', i + 3);
        if (close === -1) return fail(`Unterminated \\u{...} escape near offset ${i}`, i);
        const value = hex(input.slice(i + 3, close));
        if (value < 0 || value > 0x10ffff) return fail(`Invalid \\u{...} escape near offset ${i}`, i);
        out += String.fromCodePoint(value);
        i = close;
        continue;
      }
      const code = input.slice(i + 2, i + 6);
      const value = code.length === 4 ? hex(code) : -1;
      if (value < 0) return fail(`Invalid \\u escape near offset ${i}`, i);
      out += String.fromCharCode(value);
      i += 5;
      continue;
    }
    // identity escape：`\a` → `a`。宽松接受，因为转义一个非元字符在多数 flag 下合法，
    // 而把它判成错误会让 `escapeLiteral` 的历史输出无法回解。
    out += next;
    i += 1;
  }
  return { ok: true, value: out };
}
