/**
 * `@x-ac/regex-vue` 出口：组件 + core 关键能力的 re-export。
 *
 * re-export 的意义是让「装了我的包就能直接用引擎」，不必再单独装 `@x-ac/regex-core`。
 * 类型 `FlagsResult` 等一并透出，保证下游纯 tsc 环境拿得到完整契约。
 */
export { default as Regex } from './Regex.vue';

export {
  CORE_VERSION,
  FALLBACK_LOCALE,
  FLAG_ORDER,
  MESSAGES,
  PATTERN_METACHARACTERS,
  SUPPORTED_LOCALES,
  checkFlagSupport,
  createTranslator,
  emptyFlagSet,
  escapeLiteral,
  escapeReplacement,
  flagMessage,
  formatFlags,
  hasFlag,
  isFlagSupported,
  normalizeFlags,
  normalizeLocaleTag,
  parseFlags,
  parsePatternInput,
  resolveLocale,
  translate,
  unescapeLiteral,
  withFlag
} from '@x-ac/regex-core';

export type {
  FlagSet,
  FlagsFailed,
  FlagsMergeStrategy,
  FlagsParsed,
  FlagsResult,
  IssueCode,
  IssueSeverity,
  Locale,
  MessageKey,
  ParsedPatternInput,
  PatternInputOptions,
  RegexFlag,
  RegexIssue,
  SourceRange,
  TranslateParams,
  UnescapeResult
} from '@x-ac/regex-core';
