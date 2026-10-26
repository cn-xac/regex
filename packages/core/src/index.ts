/**
 * `@x-ac/regex-core` 对外出口 —— 框架无关的正则工作台引擎。
 *
 * 导出面是**手写枚举**而不是 `export *`：这样 `test/index.test.ts` 里的快照断言
 * 能在「新增模块忘了 re-export」时立刻变红。`export *` 会把漏导出藏得很久。
 *
 * 本文件的导出按里程碑增长，M2 只有 i18n 与 flags 两块地基。后续模块计划：
 *
 * | 里程碑 | 模块 | 内容 |
 * | --- | --- | --- |
 * | M3 | `engine` | `compileCheck` / `matchAll`，内部恒启 `d` 拿捕获组区间 |
 * | M3 | `highlights` | 整段匹配 + 各捕获组的区间计算、排序、零宽与嵌套策略 |
 * | M3 | `replace` / `escape` / `state` | 替换预览、转义、URL 分享态 |
 * | M3 | `parser` | pattern → AST，覆盖全部组构造（`()`/`(?:)`/`(?<n>)`/断言/反向引用） |
 * | M4 | `layout` | AST → DOM-free 几何图元（铁路图与 AST 树两套布局） |
 * | M4 | `painters` | 几何 → **SVG 标记字符串** 与 **Canvas 绘制指令序列**；两者都不碰 DOM |
 *
 * 两条铁律，任何时候不得突破：
 * 1. **零运行时依赖**（`package.json` 不写 `dependencies`，测试里有硬断言）；
 * 2. **不碰 DOM** —— 不引用 `document` / `window` / `navigator`，语言候选由调用方传入。
 */

export const CORE_VERSION = '0.0.0';

export type {
  FlagSet,
  IssueCode,
  IssueSeverity,
  RegexFlag,
  RegexIssue,
  SourceRange
} from './types';

export {
  FLAG_ORDER,
  checkFlagSupport,
  emptyFlagSet,
  formatFlags,
  hasFlag,
  isFlagSupported,
  normalizeFlags,
  parseFlags,
  withFlag
} from './flags';

export type { FlagsFailed, FlagsParsed, FlagsResult } from './flags';

export {
  FALLBACK_LOCALE,
  MESSAGES,
  SUPPORTED_LOCALES,
  createTranslator,
  normalizeLocaleTag,
  resolveLocale,
  translate
} from './i18n';

export type { Locale, MessageKey, TranslateParams } from './i18n';
