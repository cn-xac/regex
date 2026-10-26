/**
 * flags —— 修饰符的解析、归一化与环境探测。
 *
 * JS 的 flags 是 8 个固定字母（`d g i m s u y v`），规则简单但边界不少：重复字符、
 * 未知字符、`u` 与 `v` 互斥、老运行时不认识 `v`。这里把四类情况一次收敛，让上层
 * 只面对「结构化 issues」而不是抛出的 `SyntaxError`。
 *
 * 语义约定（与产品方案一致，勿改）：
 * - 重复字符（`'ggi'`）→ **warning** 后去重，仍然 `ok: true`；
 * - 未知字符（`'x'`）→ **error**，`ok: false`；
 * - `u` 与 `v` 同时出现 → **error**（`new RegExp('', 'uv')` 本身就会抛）。
 */
import type { FlagSet, IssueCode, RegexFlag, RegexIssue } from './types';

/** 规范化输出顺序：字母升序，与 `d g i m s u y v` 一致。 */
export const FLAG_ORDER: readonly RegexFlag[] = Object.freeze([
  'd',
  'g',
  'i',
  'm',
  's',
  'u',
  'y',
  'v'
] as const);

/** 受支持的 flag 集合（用于 O(1) 判定未知字符）。 */
const KNOWN_FLAGS: ReadonlySet<string> = new Set<string>(FLAG_ORDER);

/** 生成一个全 false 的可写 flag 记录。 */
export function emptyFlagSet(): Record<RegexFlag, boolean> {
  return { d: false, g: false, i: false, m: false, s: false, u: false, y: false, v: false };
}

function toFlagSet(present: ReadonlySet<string>): FlagSet {
  const base = emptyFlagSet();
  for (const flag of FLAG_ORDER) {
    if (present.has(flag)) base[flag] = true;
  }
  return base;
}

export interface FlagsParsed {
  ok: true;
  /** 归一化后的 flags 串（去重 + `FLAG_ORDER` 顺序）。 */
  flags: string;
  set: FlagSet;
  /** 只含 warning；`ok: true` 时不会含 error。 */
  issues: readonly RegexIssue[];
}

export interface FlagsFailed {
  ok: false;
  issues: readonly RegexIssue[];
}

export type FlagsResult = FlagsParsed | FlagsFailed;

/**
 * 解析用户输入的 flags 串。
 *
 * 逐项扫描而非 `includes` 拼接，是为了拿到**每一个**未知字符的原始位置，
 * 便于界面把错误标到具体那个字符上。
 */
export function parseFlags(input: string): FlagsResult {
  const issues: RegexIssue[] = [];
  const seen = new Set<string>();
  const unknown = new Set<string>();
  const duplicated = new Set<string>();

  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (!KNOWN_FLAGS.has(ch)) {
      unknown.add(ch);
      issues.push({
        code: 'invalid-flag',
        severity: 'error',
        message: `Invalid regular expression flags: unknown flag '${ch}'`,
        index: i
      });
      continue;
    }
    if (seen.has(ch)) {
      if (!duplicated.has(ch)) {
        duplicated.add(ch);
        issues.push({
          code: 'invalid-flag',
          severity: 'warning',
          message: `Duplicate flag '${ch}' ignored`,
          index: i
        });
      }
      continue;
    }
    seen.add(ch);
  }

  if (unknown.size > 0) {
    // 未知字符直接判失败：此时归一化结果没有意义，不给半成品。
    return { ok: false, issues };
  }

  if (seen.has('u') && seen.has('v')) {
    issues.push({
      code: 'conflicting-flags',
      severity: 'error',
      message: "The 'u' and 'v' regex flags can't be used together"
    });
    return { ok: false, issues };
  }

  const flags = formatFlags(toFlagSet(seen));
  return { ok: true, flags, set: toFlagSet(seen), issues };
}

/** 按 `FLAG_ORDER` 输出 flags 串。未出现的键视为 false。 */
export function formatFlags(set: Partial<FlagSet>): string {
  let out = '';
  for (const flag of FLAG_ORDER) {
    if (set[flag] === true) out += flag;
  }
  return out;
}

/**
 * 宽松归一化：去重 + 排序 + 丢弃未知字符，**永不报错**。
 * 需要知道输入是否合法时用 `parseFlags`；本函数只用于「把手写串变规范」的场景。
 */
export function normalizeFlags(input: string): string {
  const seen = new Set<string>();
  for (const ch of input) {
    if (KNOWN_FLAGS.has(ch)) seen.add(ch);
  }
  return formatFlags(toFlagSet(seen));
}

export function hasFlag(flags: string, flag: RegexFlag): boolean {
  return flags.indexOf(flag) !== -1;
}

/** 开启 / 关闭某个 flag，返回归一化结果；对未知 flag 字符保持原样不动。 */
export function withFlag(flags: string, flag: RegexFlag, on: boolean): string {
  const set = emptyFlagSet();
  for (const ch of normalizeFlags(flags)) {
    if (ch === 'd') set.d = true;
    else if (ch === 'g') set.g = true;
    else if (ch === 'i') set.i = true;
    else if (ch === 'm') set.m = true;
    else if (ch === 's') set.s = true;
    else if (ch === 'u') set.u = true;
    else if (ch === 'y') set.y = true;
    else if (ch === 'v') set.v = true;
  }
  set[flag] = on;
  return formatFlags(set);
}

/**
 * 当前运行时是否认识某个 flag（老引擎不认 `v`）。用空 pattern 试探构造，
 * `SyntaxError` 即为不支持 —— 其它错误类型一律视为支持。
 */
export function isFlagSupported(flag: RegexFlag): boolean {
  try {
    void new RegExp('', flag);
    return true;
  } catch (error: unknown) {
    return !(error instanceof SyntaxError);
  }
}

/** 把不支持的 flag 汇总成 `unsupported-flag` 诊断，供编译前预检使用。 */
export function checkFlagSupport(flags: string): readonly RegexIssue[] {
  const issues: RegexIssue[] = [];
  for (const ch of flags) {
    if (isFlagSupported(ch as RegexFlag)) continue;
    issues.push({
      code: 'unsupported-flag' satisfies IssueCode,
      severity: 'error',
      message: `This runtime does not support the '${ch}' flag`,
      detail: { flag: ch }
    });
  }
  return issues;
}
