/**
 * 共享类型 —— core 各模块与三个适配层之间的契约面。
 *
 * 这里只放类型，不放实现，也不放任何 DOM 相关声明。索引一律是 **UTF-16 code unit
 * 下标**，与 `RegExp.prototype.exec` 的原生语义同基（一个 emoji 占 2），写进 README
 * 是因为用户常把它当码点，从而误报 bug。
 */

export type RegexFlag = 'd' | 'g' | 'i' | 'm' | 's' | 'u' | 'y' | 'v';

/** 归一化后的 flag 集合；键按 `FLAG_ORDER` 固定顺序，保证同输入同输出。 */
export type FlagSet = Readonly<Record<RegexFlag, boolean>>;

export interface SourceRange {
  /** UTF-16 code unit 下标，与 RegExp 原生 index 同基。 */
  start: number;
  /** 不含端点；零宽匹配时 `start === end`。 */
  end: number;
}

export type IssueSeverity = 'error' | 'warning';

/**
 * 结构化诊断码。`message` 字段透出平台原始英文（含字符位置），core **不改写**；
 * 面向用户的解释性双语文案在 `i18n.ts` 的 `issue.*`，两者按 code 对应。
 */
export type IssueCode =
  | 'invalid-pattern'
  | 'invalid-flag'
  | 'conflicting-flags'
  | 'unsupported-flag'
  | 'pattern-too-long'
  | 'text-too-long'
  | 'too-many-matches'
  | 'iteration-limit'
  | 'time-limit'
  | 'invalid-replacement'
  | 'unknown-group-ref'
  | 'partial-session'
  | 'malformed-state'
  | 'unsupported-state-version';

export interface RegexIssue {
  code: IssueCode;
  severity: IssueSeverity;
  /** 平台原始 message（英文），原样透出，core 不做本地化。 */
  message: string;
  /** pattern 内字符偏移，取不到时省略。 */
  index?: number;
  /** 附带上下文，如 `{ limit: 5000 }`。 */
  detail?: Readonly<Record<string, string | number | boolean>>;
}
