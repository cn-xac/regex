/**
 * `@x-ac/regex-react` 出口：组件 + Props/Handle + core 关键能力的 re-export。
 *
 * re-export 让「装了我的包就能直接用引擎」，不必再单独声明 `@x-ac/regex-core`。
 */
export { Regex } from './Regex';
export type { RegexHandle, RegexProps } from './Regex';

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
