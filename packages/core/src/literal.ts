/**
 * literal —— pattern 输入的规范化：既接受裸源串，也接受 `/pattern/flags` 字面量写法。
 *
 * 定界符判定**严格贴 JS 词法**：从开头的 `/` 起，到**第一个未被转义的 `/`** 结束，
 * 字符类内部的 `/` 不豁免（JS 里 `/[/]/` 本身就是非法字面量，工具不该"聪明地"替用户
 * 闭合 —— 静默改写会让本工具与浏览器行为不一致，那是正则测试器最致命的信任损失）。
 * 代价是这类歧义输入必须给 warning 说明我们的读法，而不是无声消化。
 *
 * 三种收尾情形：
 *
 * | 输入 | 处理 |
 * | --- | --- |
 * | 不以 `/` 开头 | 原样作 pattern，flags 只取调用方给的值 |
 * | 完整 `/p/flags` | 剥出 p 与 flags，按 `merge` 策略与调用方 flags 合并 |
 * | 有开头 `/` 却无闭合 | 按裸 pattern 处理 + warning（不猜用户意图） |
 */
import type { RegexIssue } from './types';
import { normalizeFlags, parseFlags } from './flags';

const BS = String.fromCharCode(92);
const SLASH = '/';

/** 字面量里的 flags 与调用方（界面上勾选的）flags 如何合并。 */
export type FlagsMergeStrategy = 'union' | 'literal' | 'current';

export interface PatternInputOptions {
  /** 调用方当前已选 flags（界面上的勾选状态）。 */
  flags?: string;
  /**
   * 合并策略，默认 `union`（并集）：
   * - `union`   勾选的与字面量写的都生效，重叠只留一份；
   * - `literal` 字面量写什么就是什么，忽略勾选值；
   * - `current` 只认勾选值，字面量里的 flags 仅回显不生效。
   *
   * 做成参数而不是写死，是因为这属于界面交互语义；core 三种都支持，由上层定调。
   */
  merge?: FlagsMergeStrategy;
}

export interface ParsedPatternInput {
  ok: boolean;
  /** 剥掉定界符后的 pattern 源串。 */
  pattern: string;
  /** 合并后的最终 flags（已按 FLAG_ORDER 归一化）。 */
  flags: string;
  /** 字面量里显式写出的 flags；未走字面量分支时为 `''`。 */
  literalFlags: string;
  /** 是否按 `/pattern/flags` 字面量解析成功。 */
  literal: boolean;
  /** 调用方传入的原始 pattern 文本（未剥离时与 pattern 相同）。 */
  input: string;
  issues: readonly RegexIssue[];
}

/** 扫描到第一个未被转义的 `/` 的下标；`\\/` 这类转义斜杠跳过，找不到返回 -1。 */
function findClosingSlash(input: string, from: number): number {
  for (let i = from; i < input.length; i++) {
    const ch = input.charAt(i);
    if (ch === BS) {
      i += 1; // 连同被转义的下一个字符一起跳过
      continue;
    }
    if (ch === SLASH) return i;
  }
  return -1;
}

/**
 * 解析 pattern 输入框的原始文本。
 *
 * 纯函数、无 DOM；不做编译校验（那是 `compileCheck` 的职责），只负责把
 * "用户怎么写" 归一成 "pattern + flags" 两个字段。
 */
export function parsePatternInput(
  input: string,
  options: PatternInputOptions = {}
): ParsedPatternInput {
  const current = normalizeFlags(options.flags ?? '');
  const merge: FlagsMergeStrategy = options.merge ?? 'union';
  const issues: RegexIssue[] = [];

  if (!input.startsWith(SLASH)) {
    return {
      ok: true,
      pattern: input,
      flags: current,
      literalFlags: '',
      literal: false,
      input,
      issues
    };
  }

  const close = findClosingSlash(input, 1);
  if (close === -1) {
    // 只写了开头的 /：不猜意图，按裸 pattern 原样交出去，另给一条 warning。
    issues.push({
      code: 'invalid-pattern',
      severity: 'warning',
      message:
        "Looks like a regex literal but the closing '/' is missing; treating the whole input as the pattern source",
      index: 0
    });
    return {
      ok: true,
      pattern: input,
      flags: current,
      literalFlags: '',
      literal: false,
      input,
      issues
    };
  }

  const pattern = input.slice(1, close);
  const literalFlagsRaw = input.slice(close + 1);
  const parsed = parseFlags(literalFlagsRaw);
  let literalFlags = normalizeFlags(literalFlagsRaw);

  if (!parsed.ok) {
    issues.push(...parsed.issues);
    literalFlags = '';
  } else {
    issues.push(...parsed.issues); // 去重之类的 warning 一并透出
  }

  let flags: string;
  if (!parsed.ok) {
    // 字面量尾部不是合法 flags：回退到调用方勾选值，error 已记入 issues。
    flags = current;
  } else if (merge === 'literal') {
    flags = literalFlags;
  } else if (merge === 'current') {
    flags = current;
  } else {
    // union 必须**重新校验**合并结果：勾选 `u` + 字面量 `v` 拼起来是编译不了的 flags，
    // 直接 normalize 会把这层冲突藏掉。
    const merged = parseFlags(current + literalFlags);
    flags = merged.ok ? merged.flags : current;
    for (const issue of merged.issues) {
      // 只透出合并阶段新增的问题（冲突），重复字符之类的 warning 已在 parsed.issues 里报过。
      if (issue.code === 'conflicting-flags') issues.push(issue);
    }
  }

  return {
    ok: parsed.ok,
    pattern,
    flags,
    literalFlags,
    literal: true,
    input,
    issues
  };
}
