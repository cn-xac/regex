/**
 * parser —— pattern 源串 → AST。可视化（铁路图 / AST 树）的唯一结构来源。
 *
 * 与 `new RegExp` 的分工要划清楚，这是本模块最重要的一条：
 *
 * - **本解析器不裁决合法性**。它只做结构切分；真正的语法判定交给 `new RegExp`。
 *   因此对外的不变量是「解析成功 ⇒ `new RegExp` 也能构造」，反向不成立也无所谓 ——
 *   测试 `parser.test.ts` 里用整批 pattern 对这条不变量做差分，防止解析器
 *   自己发明一套 JS 里并不存在的语法（那会让可视化图与用户实际得到的行为不一致）。
 * - 严格语法细节（`v` 模式的 `[a--b]`、字符串类、identity escape 白名单、量词
 *   嵌套限制）**有意不实现**。遇到时按传统字符类/宽松转义切分，把判非法留给 `RegExp`。
 *   理由是：解析器越宽松，越可能在真正非法的 pattern 上画出一张看似正确的图。
 *
 * 每个节点都带 `start`/`end`（UTF-16 code unit 下标，与全仓索引基一致），
 * 因为视图要做「点图上某个节点 → 反查 pattern 里对应片段」的联动。
 */
import type { RegexIssue, SourceRange } from './types';
import { normalizeFlags } from './flags';

export type AstNodeKind =
  | 'disjunction'
  | 'alternative'
  | 'assertion'
  | 'quantified'
  | 'group'
  | 'backreference'
  | 'characterClass'
  | 'escape'
  | 'literal'
  | 'dot';

/** 分组的四种形态，视图按此选不同记号（这是「支持分组」在图上的落点）。 */
export type GroupKind =
  | 'capturing'
  | 'nonCapturing'
  | 'named'
  | 'lookahead'
  | 'negativeLookahead'
  | 'lookbehind'
  | 'negativeLookbehind';

/** `min` 为下界，`max` 为 `null` 表示无上界。`{,n}` 的 min 按规范视为 0。 */
export interface Quantifier {
  min: number;
  max: number | null;
  greedy: boolean;
  /** 源串里的写法，便于图上原样标注（`*` / `+?` / `{2,3}` …）。 */
  source: string;
}

export interface AstNode {
  readonly kind: AstNodeKind;
  readonly start: number;
  readonly end: number;
  readonly children: readonly AstNode[];
  /** kind 专属数据：字面量字符 / 锚点符号 / 转义字母。 */
  readonly text?: string;
  readonly group?: GroupKind;
  /** 捕获组序号（1 起）；反向引用时表示它指向的组号。 */
  readonly ordinal?: number;
  readonly name?: string;
  readonly quantifier?: Quantifier;
  /** 字符类是否取反（`[^...]`）、断言是否为否定式。 */
  readonly negated?: boolean;
  /** 字符类内容原样保留（含 `a-z` 区间与转义），图上直接排版。 */
  readonly classBody?: string;
}

export type ParseResult =
  | { ok: true; ast: AstNode; groupCount: number; issues: readonly RegexIssue[] }
  | { ok: false; issues: readonly RegexIssue[] };

interface Parser {
  src: string;
  pos: number;
  /** 已见的捕获组数，用于给 group 节点标 ordinal。 */
  groups: number;
  names: string[];
}

const BS = String.fromCharCode(92);

class ParseAbort extends Error {
  constructor(readonly detail: string, readonly at: number) {
    super(detail);
  }
}

function node(partial: Partial<AstNode> & { kind: AstNodeKind; start: number; end: number }): AstNode {
  return Object.freeze({ children: [], ...partial }) as AstNode;
}

function fail(detail: string, at: number): { ok: false; issues: readonly RegexIssue[] } {
  return {
    ok: false,
    issues: [
      { code: 'invalid-pattern', severity: 'error', message: detail, index: at }
    ]
  };
}

/** 单字符 atom。 */
function parseCharacter(state: Parser): AstNode {
  const ch = state.src.charAt(state.pos);
  const start = state.pos;
  state.pos += 1;

  if (ch === '.') return node({ kind: 'dot', start, end: state.pos, text: '.' });
  if (ch === '^') return node({ kind: 'assertion', start, end: state.pos, text: '^' });
  if (ch === '$') return node({ kind: 'assertion', start, end: state.pos, text: '$' });

  // 注意：函数开头已经 `state.pos += 1`，所以此刻 `state.pos` 正指向被转义的那个字符。
  // 之前这里写成 `charAt(state.pos + 1)`，等于跳过一位，导致 `\bword\b` 从第一个转义
  // 起全线错位（stringify 与源串对不上、位置乱序的连锁失败都源于此）。
  if (ch === BS) {
    const next = state.src.charAt(state.pos);
    if (next === '') throw new ParseAbort('Pattern ends with a trailing backslash', start);
    state.pos += 1; // 消费被转义字符，现在 pos === start + 2

    // 反向引用：\1 .. \99（最多两位，与 V8 的十进制回溯引用一致）
    if (next >= '1' && next <= '9') {
      let digits = next;
      while (isDigit(state.src.charAt(state.pos)) && digits.length < 2) {
        digits += state.src.charAt(state.pos);
        state.pos += 1;
      }
      return node({
        kind: 'backreference',
        start,
        end: state.pos,
        text: digits,
        ordinal: Number(digits)
      });
    }
    if (next === 'k' && state.src.charAt(state.pos) === '<') {
      const close = state.src.indexOf('>', state.pos + 1);
      if (close === -1) throw new ParseAbort('Unterminated \\k<name> backreference', start);
      const name = state.src.slice(state.pos + 1, close);
      state.pos = close + 1;
      return node({ kind: 'backreference', start, end: state.pos, text: `k<${name}>`, name });
    }
    // 带参数的转义必须整体收下，否则剩下的 hex 位会被当成新 atom，节点区间就对不上源串了。
    if (next === 'x') {
      const hex = state.src.slice(state.pos, state.pos + 2);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) state.pos += 2;
      return node({ kind: 'escape', start, end: state.pos, text: `x${hex}` });
    }
    if (next === 'u') {
      if (state.src.charAt(state.pos) === '{') {
        const close = state.src.indexOf('}', state.pos);
        if (close !== -1) {
          const body = state.src.slice(state.pos + 1, close);
          state.pos = close + 1;
          return node({ kind: 'escape', start, end: state.pos, text: `u{${body}}` });
        }
      } else {
        const hex = state.src.slice(state.pos, state.pos + 4);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          state.pos += 4;
          return node({ kind: 'escape', start, end: state.pos, text: `u${hex}` });
        }
      }
    }
    if (next === 'c' && /[a-zA-Z]/.test(state.src.charAt(state.pos))) {
      const letter = state.src.charAt(state.pos);
      state.pos += 1;
      return node({ kind: 'escape', start, end: state.pos, text: `c${letter}` });
    }
    // \b / \B 是词边界断言；其余 \d \w \s \n \\ \. 等归为 escape 原子。
    // \k 后面不是 '<' 时也落到这里，按 identity escape 的字面 k 处理。
    if (next === 'b' || next === 'B') {
      return node({ kind: 'assertion', start, end: state.pos, text: next });
    }
    return node({ kind: 'escape', start, end: state.pos, text: next });
  }

  return node({ kind: 'literal', start, end: state.pos, text: ch });
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** 字符类：`[...]`，内部按传统语义宽松切分，`-` 区间原样保留给视图排版。 */
function parseCharacterClass(state: Parser): AstNode {
  const start = state.pos;
  state.pos += 1; // consume '['

  let negated = false;
  if (state.src.charAt(state.pos) === '^') {
    negated = true;
    state.pos += 1;
  }
  // 类内**任何** `]` 都关闭类，没有"首个 ] 当字面量"的例外（实测 V8：`[]]` 是空类
  // 加一个游离 `]`，整体永不匹配；`[^]` 是"任意字符"，`[^]]` 则要求两字符）。
  let body = '';
  let closed = false;
  while (state.pos < state.src.length) {
    const ch = state.src.charAt(state.pos);
    if (ch === BS) {
      const next = state.src.charAt(state.pos + 1);
      if (next === '') throw new ParseAbort('Pattern ends with a trailing backslash', state.pos);
      body += ch + next;
      state.pos += 2;
      continue;
    }
    if (ch === ']') {
      state.pos += 1;
      closed = true;
      break;
    }
    body += ch;
    state.pos += 1;
  }
  if (!closed) throw new ParseAbort('Unterminated character class', start);
  // 取反标记与 body 分字段存，视图不必再解析一次
  void negated;
  return node({ kind: 'characterClass', start, end: state.pos, classBody: body, negated });
}

/** 分组与零宽断言。 */
function parseGroup(state: Parser): AstNode {
  const start = state.pos;
  state.pos += 1; // consume '('
  let group: GroupKind = 'capturing';
  let name: string | undefined;
  let ordinal: number | undefined;

  if (state.src.charAt(state.pos) === '?') {
    state.pos += 1;
    const kind = state.src.charAt(state.pos);
    if (kind === ':') {
      group = 'nonCapturing';
      state.pos += 1;
    } else if (kind === '=') {
      group = 'lookahead';
      state.pos += 1;
    } else if (kind === '!') {
      group = 'negativeLookahead';
      state.pos += 1;
    } else if (kind === '<') {
      state.pos += 1;
      const inner = state.src.charAt(state.pos);
      if (inner === '=') {
        group = 'lookbehind';
        state.pos += 1;
      } else if (inner === '!') {
        group = 'negativeLookbehind';
        state.pos += 1;
      } else {
        const close = state.src.indexOf('>', state.pos);
        if (close === -1) throw new ParseAbort('Unterminated named group', start);
        name = state.src.slice(state.pos, close);
        if (name === '') throw new ParseAbort('Named group has an empty name', start);
        group = 'named';
        state.pos = close + 1;
      }
    } else {
      // 未知前缀（如 `(?>`、`(??`）：本解析器按非捕获组收下并跳过该字符，
      // 是否合法交给 RegExp 复验 —— 不在这里发明判定。
      group = 'nonCapturing';
      state.pos += 1;
    }
  }
  // 捕获组与命名组**都**占一个序号（命名组本质就是捕获组，只是多了个名字）；
  // 非捕获组与零宽断言不占。第一版只在 `(a)` 分支里递增，导致 (?<name>a) 没有 ordinal。
  if (group === 'capturing' || group === 'named') {
    state.groups += 1;
    ordinal = state.groups;
    if (name !== undefined) state.names.push(name);
  }

  const inner = parseDisjunction(state);
  if (state.src.charAt(state.pos) !== ')') {
    throw new ParseAbort('Unterminated group', start);
  }
  state.pos += 1;

  const isAssertion =
    group === 'lookahead' ||
    group === 'negativeLookahead' ||
    group === 'lookbehind' ||
    group === 'negativeLookbehind';

  return node({
    kind: 'group',
    start,
    end: state.pos,
    children: [inner],
    group,
    ...(ordinal === undefined ? {} : { ordinal }),
    ...(name === undefined ? {} : { name }),
    ...(isAssertion ? { negated: group.startsWith('negative') } : {})
  });
}

/** `*` `+` `?` `{m,n}`，以及尾随的懒惰标记。 */
function parseQuantifier(state: Parser): Quantifier | null {
  const start = state.pos;
  const ch = state.src.charAt(state.pos);
  let min: number;
  let max: number | null;

  if (ch === '*') {
    min = 0;
    max = null;
    state.pos += 1;
  } else if (ch === '+') {
    min = 1;
    max = null;
    state.pos += 1;
  } else if (ch === '?') {
    min = 0;
    max = 1;
    state.pos += 1;
  } else if (ch === '{') {
    const close = state.src.indexOf('}', state.pos + 1);
    if (close === -1) return null; // 无闭合则按字面 '{' 处理（JS 同样如此）
    const body = state.src.slice(state.pos + 1, close);
    const parsed = /^(\d*)(?:,(\d*))?$/.exec(body);
    if (parsed === null) return null; // 不是量词形态
    const lowRaw = parsed[1] ?? '';
    const highRaw = parsed[2] ?? '';
    min = lowRaw === '' ? 0 : Number(lowRaw);
    if (body.includes(',')) {
      max = highRaw === '' ? null : Number(highRaw);
    } else {
      max = min;
    }
    state.pos = close + 1;
  } else {
    return null;
  }

  let greedy = true;
  if (state.src.charAt(state.pos) === '?') {
    greedy = false;
    state.pos += 1;
  }
  // 占有量词 `*+` 之类不在 ES 里（实测 V8 也抛），这里不特殊处理：后面的 `+` 会被
  // 当成一个新 atom 收进 alternative，最终由 RegExp 复验判非法。

  return { min, max, greedy, source: state.src.slice(start, state.pos) };
}

function parseTerm(state: Parser): AstNode | null {
  const atom = parseAtom(state);
  if (atom === null) return null;
  const quantifier = parseQuantifier(state);
  if (quantifier === null) return atom;
  return node({
    kind: 'quantified',
    start: atom.start,
    end: quantifier.source === '' ? atom.end : state.pos,
    // 被量化对象就是 children[0]，不再另存 target —— 两个字段指向同一节点会构成
    // 循环引用，深比较与序列化都会炸。
    children: [atom],
    quantifier
  });
}

/** 一个不可再分的匹配单元。 */
function parseAtom(state: Parser): AstNode | null {
  const ch = state.src.charAt(state.pos);
  switch (ch) {
    case '':
      return null;
    case '(':
      return parseGroup(state);
    case '[':
      return parseCharacterClass(state);
    case '|':
    case ')':
      return null; // 由上层处理
    case '*':
    case '+':
    case '?':
    case '{':
      // 出现在没有可量化对象的位置。是否算错**不由这里判**：按字面量收下，
      // 交给 parsePattern 末尾的 RegExp 复验裁决（实测 V8 对 `/*/`、`/{2,3}/` 抛错，
      // 却接受 `/{/` 与 `/{,2}/` 当字面量，历史包袱细碎，复刻不如交给引擎）。
      return parseCharacter(state);
    default:
      return parseCharacter(state);
  }
}

/** Alternative := Term* */
function parseAlternative(state: Parser): AstNode {
  const start = state.pos;
  const terms: AstNode[] = [];
  for (;;) {
    const before = state.pos;
    const term = parseTerm(state);
    if (term === null) break;
    terms.push(term);
    if (state.pos === before) {
      throw new ParseAbort(`Parser made no progress at offset ${state.pos}`, state.pos);
    }
  }
  return node({ kind: 'alternative', start, end: state.pos, children: terms });
}

/** Disjunction := Alternative ('|' Alternative)* */
function parseDisjunction(state: Parser): AstNode {
  const start = state.pos;
  const branches: AstNode[] = [parseAlternative(state)];
  while (state.src.charAt(state.pos) === '|') {
    state.pos += 1;
    branches.push(parseAlternative(state));
  }
  if (branches.length === 1) return branches[0] as AstNode;
  return node({ kind: 'disjunction', start, end: state.pos, children: branches });
}

/**
 * 解析 pattern 源串。永不抛异常（内部异常一律转成 `ok: false` + 带位置的 issue）。
 *
 * `flags` 只用于末尾的复验：`u` / `v` 模式下引擎的语法约束更严（实测 `[^]`、`[-a]`、
 * 裸 `{` 在 `v` 下都会抛），同一个 pattern 在不同 flags 下合法性不同。
 *
 * **复验是本模块的正确性基石**：结构切分故意宽松（便于在非法输入上也能画出尽量接近的
 * 部分图），但语法合法性一律由 `new RegExp` 裁决后再放行。于是对外不变量是硬的 ——
 * `ok: true` ⟹ `new RegExp(pattern, flags)` 必定可构造。视图因此永远不会给一个
 * "跑不起来的 pattern"配一张看似正确的图。
 */
export function parsePattern(pattern: string, flags = ''): ParseResult {
  const state: Parser = { src: pattern, pos: 0, groups: 0, names: [] };
  try {
    const ast = parseDisjunction(state);
    if (state.pos < pattern.length) {
      const ch = pattern.charAt(state.pos);
      return fail(`Unexpected '${ch}' at offset ${state.pos}`, state.pos);
    }
    try {
      void new RegExp(pattern, normalizeFlags(flags));
    } catch (error: unknown) {
      return {
        ok: false,
        issues: [
          {
            code: 'invalid-pattern',
            severity: 'error',
            message: error instanceof Error ? error.message : String(error)
          }
        ]
      };
    }
    return {
      ok: true,
      ast,
      groupCount: state.groups,
      issues: []
    };
  } catch (error: unknown) {
    if (error instanceof ParseAbort) return fail(error.message, error.at);
    return fail(error instanceof Error ? error.message : String(error), state.pos);
  }
}

/**
 * AST → pattern 源串（反拼）。
 *
 * 用途有两个：`parser.test.ts` 靠它做「parse → unparse → parse 结构等价」的幂等差分；
 * 以及 AST 视图里展示节点对应的原始片段。它刻意**保留原写法**（量词用 `quantifier.source`、
 * 字符类用 `classBody` 原文），因此反拼结果可能与输入不完全等值（如 `{2,}` 与 `{2,}`），
 * 但语义必须等价 —— 这一点由测试用 RegExp 行为比对来钉。
 */
export function stringifyAst(target: AstNode): string {
  switch (target.kind) {
    case 'disjunction':
      return target.children.map(stringifyAst).join('|');
    case 'alternative':
      return target.children.map(stringifyAst).join('');
    case 'quantified': {
      const inner = stringifyAst(target.children[0] as AstNode);
      return inner + (target.quantifier?.source ?? '');
    }
    case 'group': {
      const inner = stringifyAst(target.children[0] as AstNode);
      const prefix = groupPrefix(target.group, target.name);
      return `(${prefix}${inner})`;
    }
    case 'assertion': {
      if (target.text === '^' || target.text === '$') return target.text;
      return BS + (target.text ?? '');
    }
    case 'characterClass':
      return `[${target.negated === true ? '^' : ''}${target.classBody ?? ''}]`;
    case 'backreference':
      return target.name !== undefined ? `\\k<${target.name}>` : `\\${target.text ?? ''}`;
    case 'escape':
      return BS + (target.text ?? '');
    case 'dot':
      return '.';
    case 'literal':
    default:
      return target.text ?? '';
  }
}

function groupPrefix(kind: GroupKind | undefined, name: string | undefined): string {
  switch (kind) {
    case 'nonCapturing':
      return '?:';
    case 'named':
      return `?<${name ?? ''}>`;
    case 'lookahead':
      return '?=';
    case 'negativeLookahead':
      return '?!';
    case 'lookbehind':
      return '?<=';
    case 'negativeLookbehind':
      return '?<!';
    default:
      return '';
  }
}

/** 收集全部节点（视图做命中测试与统计时用）。 */
export function collectNodes(root: AstNode, into: AstNode[] = []): readonly AstNode[] {
  into.push(root);
  for (const child of root.children) collectNodes(child, into);
  return into;
}

/** 节点区间（视图与高亮层共用 `SourceRange` 形状）。 */
export function nodeRange(target: AstNode): SourceRange {
  return { start: target.start, end: target.end };
}
