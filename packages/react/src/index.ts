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
  SUPPORTED_LOCALES,
  checkFlagSupport,
  createTranslator,
  emptyFlagSet,
  formatFlags,
  hasFlag,
  isFlagSupported,
  normalizeFlags,
  normalizeLocaleTag,
  parseFlags,
  resolveLocale,
  translate,
  withFlag
} from '@x-ac/regex-core';

export type {
  FlagSet,
  FlagsFailed,
  FlagsParsed,
  FlagsResult,
  IssueCode,
  IssueSeverity,
  Locale,
  MessageKey,
  RegexFlag,
  RegexIssue,
  SourceRange,
  TranslateParams
} from '@x-ac/regex-core';
