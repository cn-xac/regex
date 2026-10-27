/**
 * engine —— 全量匹配与编译校验。
 *
 * 三条不可动摇的设计：
 *
 * 1. **内部恒启 `d`**。捕获组的位置直接取 `exec` 结果的 `.indices`，不做任何二次重算 ——
 *    重算出来的区间有可能与真实匹配不一致。对外 `flags` 仍回显用户原值，
 *    `effectiveFlags` 单独暴露实际用于构造的 flags，不谎称改写了用户的正则。
 * 2. **零宽匹配后 `lastIndex + 1`**，与原生 `String.prototype.matchAll` 行为一致，
 *    并计入 `stats.zeroWidthAdvances`。不这么做，`a*` 这类零宽量词就会原地死循环。
 * 3. **限额是软保护，不是中断**。JS 正则一旦开始执行就无法打断，`deadlineMs` 只能在两次
 *    `exec` 之间生效 —— 单个灾难性回溯（如 `(a+)+b` 遇长串）救不了。这是平台事实，
 *    不是实现瑕疵，README 已如实标注。
 *
 * 另外：内部需要一个带 `g` 的驱动实例来支持 `startAt` 续搜与非 `g` 场景下的统一定位，
 * 但 `effectiveFlags` 不包含这个 `g`（它只是驱动手段，不改变对外语义）。
 */
import type { RegexIssue, SourceRange } from './types';
import { checkFlagSupport, hasFlag, isFlagSupported, normalizeFlags, parseFlags } from './flags';
import { nameByOrdinal, scanGroups } from './groups';

export interface EngineLimits {
  maxMatches: number;
  maxIterations: number;
  maxPatternLength: number;
  maxTextLength: number;
  /** 两次 exec 之间检查的墙钟预算；无法中断单次回溯。 */
  deadlineMs: number;
}

/** 默认限额。frozen 且数值被测试钉死 —— 改动它是行为变更，必须显式承认。 */
export const DEFAULT_LIMITS: EngineLimits = Object.freeze({
  maxMatches: 5000,
  maxIterations: 200_000,
  maxPatternLength: 2000,
  maxTextLength: 2_000_000,
  deadlineMs: 200
});

export interface MatchOptions {
  limits?: Partial<EngineLimits>;
  /** 注入时钟，便于无真实耗时的确定性测试。默认 `Date.now`。 */
  now?: () => number;
  /** 从该偏移开始搜（配合 `y` flag 或「继续上次」）。默认 0。 */
  startAt?: number;
}

export interface CompileOptions {
  limits?: Partial<EngineLimits>;
}

export interface CaptureGroup {
  /** 0 = 整体匹配。 */
  ordinal: number;
  name?: string;
  /** 未参与本次匹配时为 `null`（如 `(a)?b` 匹配 `b`）。 */
  range: SourceRange | null;
  text: string | null;
}

export interface RegexMatch {
  ordinal: number;
  range: SourceRange;
  text: string;
  /** 按 `ordinal` 升序，含 0（整体匹配）。 */
  groups: readonly CaptureGroup[];
  /** 命名组名 → 同一个 `CaptureGroup` 对象引用。 */
  named: Readonly<Record<string, CaptureGroup>>;
  /** 零宽匹配标记。 */
  empty: boolean;
}

export interface MatchStats {
  iterations: number;
  /** 推进过的字符数（= `nextIndex - startAt`，正常收尾时即到文末）。 */
  scanned: number;
  elapsedMs: number;
  zeroWidthAdvances: number;
  /** pattern 里的捕获组数量（不含整体匹配 0 号）。 */
  groupCount: number;
}

export interface MatchSession {
  ok: boolean;
  pattern: string;
  /** 用户提交的 flags。 */
  flags: string;
  /** 实际构造 RegExp 用的 flags（= flags ∪ 'd'）。 */
  effectiveFlags: string;
  matches: readonly RegexMatch[];
  stats: MatchStats;
  /** 命中任一限额即为 true，此时 matches 不完整。 */
  truncated: boolean;
  issues: readonly RegexIssue[];
  /** 供「下一条」续搜用；无更多匹配时等于 `text.length`。 */
  nextIndex: number;
}

export interface CompileCheckResult {
  ok: boolean;
  groupCount: number;
  groupNames: readonly string[];
  issues: readonly RegexIssue[];
}

/**
 * 本仓 `lib` 定为 ES2020，而 `RegExpExecArray.indices` 是 ES2022 随 `d` flag 才引入的，
 * 所以在边界处补一个交叉声明，而不是为了一个字段把整个项目的 lib 抬上去。
 */
type ExecResult = RegExpExecArray & {
  readonly indices?: ReadonlyArray<readonly [number, number] | undefined>;
};

function resolveLimits(partial?: Partial<EngineLimits>): EngineLimits {
  return { ...DEFAULT_LIMITS, ...partial };
}

/**
 * 构造一个失败 session：`matches` 恒空，不给半成品。
 * `flags` 字段仍回显用户原值，便于界面把错误标回输入框。
 */
function failed(
  pattern: string,
  flags: string,
  issues: readonly RegexIssue[],
  elapsedMs: number
): MatchSession {
  return freezeSession({
    ok: false,
    pattern,
    flags,
    effectiveFlags: '',
    matches: [],
    stats: {
      iterations: 0,
      scanned: 0,
      elapsedMs,
      zeroWidthAdvances: 0,
      groupCount: 0
    },
    truncated: false,
    issues,
    nextIndex: 0
  });
}

/** 深冻结：UI 侧误改在开发期即暴露，而不是产出一个悄悄变形的状态。 */
function freezeSession(session: MatchSession): MatchSession {
  for (const match of session.matches) {
    Object.freeze(match.range);
    for (const group of match.groups) {
      if (group.range !== null) Object.freeze(group.range);
      Object.freeze(group);
    }
    Object.freeze(match.groups);
    Object.freeze(match.named);
    Object.freeze(match);
  }
  Object.freeze(session.matches);
  Object.freeze(session.stats);
  Object.freeze(session.issues);
  return Object.freeze(session);
}

/**
 * 编译校验，不跑匹配。输入框逐字符提示用。
 *
 * 与 `matchAll` 共享同一套前置判定（长度、flags、可构造性），保证"校验说 OK 的
 * 一定真能跑"，不会出现绿了校验红了执行。
 */
export function compileCheck(
  pattern: string,
  flags: string,
  options: CompileOptions = {}
): CompileCheckResult {
  const limits = resolveLimits(options.limits);
  const issues: RegexIssue[] = [];

  if (pattern.length > limits.maxPatternLength) {
    issues.push({
      code: 'pattern-too-long',
      severity: 'error',
      message: `Pattern length ${pattern.length} exceeds limit ${limits.maxPatternLength}`,
      detail: { limit: limits.maxPatternLength, length: pattern.length }
    });
    return { ok: false, groupCount: 0, groupNames: [], issues };
  }

  const parsedFlags = parseFlags(flags);
  issues.push(...parsedFlags.issues);
  if (!parsedFlags.ok) {
    return { ok: false, groupCount: 0, groupNames: [], issues };
  }
  issues.push(...checkFlagSupport(parsedFlags.flags));

  try {
    void new RegExp(pattern, parsedFlags.flags);
  } catch (error: unknown) {
    issues.push({
      code: 'invalid-pattern',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error)
    });
    return { ok: false, groupCount: 0, groupNames: [], issues };
  }

  const scan = scanGroups(pattern);
  return {
    ok: true,
    groupCount: scan.groupCount,
    groupNames: Object.freeze(scan.named.map((entry) => entry.name)),
    issues
  };
}

/**
 * 全量匹配。永不抛异常：语法错误、超限、不支持的 flag 一律转成结构化 `issues` +
 * `ok: false`。
 */
export function matchAll(
  text: string,
  pattern: string,
  flags: string,
  options: MatchOptions = {}
): MatchSession {
  const limits = resolveLimits(options.limits);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const issues: RegexIssue[] = [];

  if (pattern.length > limits.maxPatternLength) {
    issues.push({
      code: 'pattern-too-long',
      severity: 'error',
      message: `Pattern length ${pattern.length} exceeds limit ${limits.maxPatternLength}`,
      detail: { limit: limits.maxPatternLength, length: pattern.length }
    });
    return failed(pattern, flags, issues, now() - startedAt);
  }
  if (text.length > limits.maxTextLength) {
    issues.push({
      code: 'text-too-long',
      severity: 'error',
      message: `Text length ${text.length} exceeds limit ${limits.maxTextLength}`,
      detail: { limit: limits.maxTextLength, length: text.length }
    });
    return failed(pattern, flags, issues, now() - startedAt);
  }

  const parsedFlags = parseFlags(flags);
  issues.push(...parsedFlags.issues);
  if (!parsedFlags.ok) {
    return failed(pattern, flags, issues, now() - startedAt);
  }
  issues.push(...checkFlagSupport(parsedFlags.flags));

  // 恒启 d 拿组区间；老运行时不支持 d 时降级（区间给 null）并明确报 warning，
  // 而不是假装拿到了位置。
  const supportsIndices = isFlagSupported('d');
  if (!supportsIndices) {
    issues.push({
      code: 'unsupported-flag',
      severity: 'warning',
      message: 'This runtime does not support the d flag; capture group ranges are unavailable',
      detail: { flag: 'd' }
    });
  }
  const effectiveFlags = supportsIndices
    ? normalizeFlags(parsedFlags.flags + 'd')
    : parsedFlags.flags;

  let driver: RegExp;
  try {
    // 校验可构造性 + 准备驱动实例：非 g 场景额外建一个带 g 的实例来统一定位，
    // 但 effectiveFlags 不含这个 g —— 它只是驱动手段，不改变对外语义。
    driver = new RegExp(pattern, effectiveFlags);
    if (!hasFlag(effectiveFlags, 'g')) {
      // 无 g 时也统一用带 g 的实例驱动：非 g 只取第一条（循环里显式 break），
      // 有 y 无 g 则靠 g 让 lastIndex 生效才能连续定位。
      driver = new RegExp(pattern, normalizeFlags(`${effectiveFlags}g`));
    }
  } catch (error: unknown) {
    issues.push({
      code: 'invalid-pattern',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error)
    });
    return failed(pattern, flags, issues, now() - startedAt);
  }

  // 越界的 startAt 只做 clamp，不产生 issue：这是调用方参数误用，不属于正则诊断码，
  // 硬塞进 IssueCode 会让界面把它当成 pattern 的问题来展示。
  const from = Math.min(Math.max(options.startAt ?? 0, 0), text.length);

  const scan = scanGroups(pattern);
  const names = nameByOrdinal(scan);
  const matches: RegexMatch[] = [];
  let truncated = false;
  let iterations = 0;
  let zeroWidthAdvances = 0;
  let reached = from;

  driver.lastIndex = from;

  for (;;) {
    if (iterations >= limits.maxIterations) {
      truncated = true;
      issues.push({
        code: 'iteration-limit',
        severity: 'warning',
        message: `Stopped after ${limits.maxIterations} iterations; results are incomplete`,
        detail: { limit: limits.maxIterations }
      });
      break;
    }
    if (now() - startedAt > limits.deadlineMs) {
      truncated = true;
      issues.push({
        code: 'time-limit',
        severity: 'warning',
        message: `Stopped after ${limits.deadlineMs}ms; results are incomplete`,
        detail: { limit: limits.deadlineMs }
      });
      break;
    }

    iterations += 1;
    const result = driver.exec(text) as ExecResult | null;
    if (result === null) break;

    // 原生在空匹配时不推进 lastIndex，这里手动 +1 并记账（与 matchAll 一致）。
    const matchedText = result[0] ?? '';
    const start = result.index;
    const end = start + matchedText.length;
    if (matchedText.length === 0) {
      zeroWidthAdvances += 1;
      driver.lastIndex = start + 1;
    }
    reached = Math.max(reached, driver.lastIndex);

    const groups: CaptureGroup[] = [];
    const named: Record<string, CaptureGroup> = {};
    for (let gi = 0; gi < result.length; gi++) {
      const raw = result[gi];
      const indices = result.indices?.[gi];
      const groupName = names[gi];
      const group: CaptureGroup = Object.freeze({
        ordinal: gi,
        ...(groupName === undefined ? {} : { name: groupName }),
        range: indices === undefined ? null : Object.freeze({ start: indices[0], end: indices[1] }),
        text: raw === undefined ? null : raw
      });
      groups.push(group);
      if (groupName !== undefined) named[groupName] = group;
    }

    matches.push(
      Object.freeze({
        ordinal: matches.length,
        range: Object.freeze({ start, end }),
        text: matchedText,
        groups: Object.freeze(groups),
        named: Object.freeze(named),
        empty: matchedText.length === 0
      })
    );

    // 非 g / 非 y 只要第一条，与原生 `exec` 语义一致。
    if (!hasFlag(effectiveFlags, 'g') && !hasFlag(effectiveFlags, 'y')) break;

    if (matches.length >= limits.maxMatches) {
      truncated = true;
      issues.push({
        code: 'too-many-matches',
        severity: 'warning',
        message: `Stopped at ${limits.maxMatches} matches; results are incomplete`,
        detail: { limit: limits.maxMatches }
      });
      break;
    }
  }

  return freezeSession({
    ok: true,
    pattern,
    flags: parsedFlags.flags,
    effectiveFlags,
    matches,
    stats: {
      iterations,
      scanned: reached - from,
      elapsedMs: now() - startedAt,
      zeroWidthAdvances,
      groupCount: scan.groupCount
    },
    truncated,
    issues,
    nextIndex: truncated ? reached : text.length
  });
}
