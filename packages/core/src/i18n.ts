/**
 * i18n —— 正则领域的双语文案层（zh-CN / en）。
 *
 * 为什么放在 core：这些字符串描述的是**正则语义本身**（flag 的含义、分组构造的类型、
 * issue code 的解释），不是某个界面的措辞。它们必须和 `RegexFlag`、`IssueCode` 这类
 * 类型同源演进，否则新增一个 flag 就会漏翻译 —— 所以放进 core 与类型放在一起。
 * 具体正则样例与演示文本属于内容资产，归 playground，不在本模块。
 *
 * 两条不可混淆的边界：
 *
 * 1. **core 不读 `navigator`**（core 不碰 DOM 是合集铁律）。语言探测由调用方完成，
 *    把 `navigator.languages` 之类的候选数组传进 `resolveLocale()` 即可。
 * 2. **运行时返回值不做本地化**。`matchAll` / `compileCheck` 返回的 `RegexIssue.message`
 *    仍是 V8 原始英文（带字符位置，改写就丢信息）；本模块只提供 `issue.*` 的**解释性**
 *    双语文案，由视图自行决定展示哪个。
 *
 * 一致性保障：`MESSAGES` 的类型是 `Record<Locale, Record<MessageKey, string>>`，
 * 少写任意一种语言的任意一个 key 都会**编译失败**，比运行时审计更早发现问题。
 */

import type { RegexFlag } from './types';

export type Locale = 'zh-CN' | 'en';

/** 未命中任何受支持语言时的回退（合集约定：简体中文）。 */
export const FALLBACK_LOCALE: Locale = 'zh-CN';

export const SUPPORTED_LOCALES: readonly Locale[] = Object.freeze(['zh-CN', 'en']);

/** 界面与引擎文案的 key 全集。新增 flag / issue code 时必须同步扩这里。 */
export type MessageKey =
  // 界面骨架
  | 'app.title'
  | 'app.tagline'
  | 'field.pattern'
  | 'field.flags'
  | 'field.text'
  | 'field.replacement'
  | 'section.matches'
  | 'section.groups'
  | 'section.issues'
  | 'section.replacePreview'
  | 'action.copy'
  | 'action.copied'
  | 'action.reset'
  | 'action.exportSvg'
  | 'action.exportPng'
  // 两种视图（铁路图 / AST 树）
  | 'view.railroad'
  | 'view.ast'
  | 'view.emptyDiagram'
  | 'view.truncated'
  | 'view.matchCount'
  | 'view.normalized'
  | 'note.flagsFromLiteral'
  // 八个 flag 的含义
  | 'flag.d'
  | 'flag.g'
  | 'flag.i'
  | 'flag.m'
  | 'flag.s'
  | 'flag.u'
  | 'flag.y'
  | 'flag.v'
  // 分组构造类型：`()`, `(?:)`, `(?<n>)`, 断言, 反向引用
  | 'group.capturing'
  | 'group.nonCapturing'
  | 'group.named'
  | 'group.lookahead'
  | 'group.lookbehind'
  | 'group.negative'
  | 'group.backreference'
  | 'group.notParticipated'
  | 'group.ordinal'
  | 'group.name'
  // issue code 的解释性文案
  | 'issue.invalidPattern'
  | 'issue.invalidFlag'
  | 'issue.conflictingFlags'
  | 'issue.unsupportedFlag'
  | 'issue.textTooLong'
  | 'issue.patternTooLong'
  | 'issue.tooManyMatches'
  | 'issue.iterationLimit'
  | 'issue.timeLimit'
  | 'issue.invalidReplacement'
  | 'issue.unknownGroupRef'
  | 'issue.partialSession'
  | 'issue.malformedState'
  | 'issue.unsupportedStateVersion'
  // 图上用的字符类别与次数语义
  | 'token.anyChar'
  | 'token.digit'
  | 'token.nonDigit'
  | 'token.wordChar'
  | 'token.nonWordChar'
  | 'token.whitespace'
  | 'token.nonWhitespace'
  | 'token.quantZeroOrMore'
  | 'token.quantOneOrMore'
  | 'token.quantZeroOrOne'
  | 'token.quantExactly'
  | 'token.quantAtLeast'
  | 'token.quantRange'
  | 'token.nonGreedy';

const ZH: Record<MessageKey, string> = {
  'app.title': '正则测试器',
  'app.tagline': '可视化正则工作台：铁路图、AST 树与匹配结果',
  'field.pattern': '正则表达式',
  'field.flags': '修饰符',
  'field.text': '测试文本',
  'field.replacement': '替换为',
  'section.matches': '匹配结果',
  'section.groups': '捕获组',
  'section.issues': '诊断信息',
  'section.replacePreview': '替换预览',
  'action.copy': '复制',
  'action.copied': '已复制',
  'action.reset': '重置',
  'action.exportSvg': '导出 SVG',
  'action.exportPng': '导出 PNG',
  'view.railroad': '铁路图',
  'view.ast': 'AST 树',
  'view.emptyDiagram': '输入有效的正则表达式后显示结构图',
  'view.truncated': '结果已达上限并被截断，可能还有更多匹配',
  'view.matchCount': '共 {count} 个匹配',
  'view.normalized': '规范化后',
  'note.flagsFromLiteral':
    '检测到 /…/flags 字面量写法，修饰符以字面量为准；去掉首尾斜杠即可用下面的控件勾选。',
  'flag.d': '为捕获组暴露索引（有命名组时隐含启用）',
  'flag.g': '全局搜索，找出所有匹配',
  'flag.i': '忽略大小写',
  'flag.m': '多行模式，^ 与 $ 匹配每行首尾',
  'flag.s': '让 . 也匹配换行符',
  'flag.u': 'Unicode 模式，按码点处理转义与代理对',
  'flag.y': '粘连模式，仅从 lastIndex 处开始匹配',
  'flag.v': 'Unicode 集模式，扩展字符类语法（与 u 互斥）',
  'group.capturing': '捕获组',
  'group.nonCapturing': '非捕获组',
  'group.named': '命名捕获组',
  'group.lookahead': '先行断言',
  'group.lookbehind': '后行断言',
  'group.negative': '否定断言',
  'group.backreference': '反向引用',
  'group.notParticipated': '本次未参与匹配',
  'group.ordinal': '编号',
  'group.name': '名称',
  'issue.invalidPattern': '正则表达式语法错误',
  'issue.invalidFlag': '存在不支持的修饰符',
  'issue.conflictingFlags': 'u 与 v 修饰符互斥，不能同时使用',
  'issue.unsupportedFlag': '当前运行环境不支持该修饰符',
  'issue.textTooLong': '测试文本超出长度上限',
  'issue.patternTooLong': '正则表达式超出长度上限',
  'issue.tooManyMatches': '匹配数量已达上限',
  'issue.iterationLimit': '迭代次数已达上限',
  'issue.timeLimit': '执行时间已达上限',
  'issue.invalidReplacement': '替换串语法无效',
  'issue.unknownGroupRef': '替换串引用了不存在的捕获组',
  'issue.partialSession': '匹配结果不完整，已拒绝在此基础上替换',
  'issue.malformedState': '分享链接已损坏，无法解析',
  'issue.unsupportedStateVersion': '分享链接的版本不受支持',
  'token.anyChar': '任意字符',
  'token.digit': '数字',
  'token.nonDigit': '非数字',
  'token.wordChar': '字母',
  'token.nonWordChar': '非字母',
  'token.whitespace': '空白',
  'token.nonWhitespace': '非空白',
  'token.quantZeroOrMore': '0次以上',
  'token.quantOneOrMore': '一次以上',
  'token.quantZeroOrOne': '0或1次',
  'token.quantExactly': '恰好{count}次',
  'token.quantAtLeast': '{min}次以上',
  'token.quantRange': '{min}到{max}次',
  'token.nonGreedy': '非贪婪'
};

const EN: Record<MessageKey, string> = {
  'app.title': 'Regex Tester',
  'app.tagline': 'A visual regex workbench: railroad diagram, AST tree and match results',
  'field.pattern': 'Pattern',
  'field.flags': 'Flags',
  'field.text': 'Test string',
  'field.replacement': 'Replace with',
  'section.matches': 'Matches',
  'section.groups': 'Capture groups',
  'section.issues': 'Diagnostics',
  'section.replacePreview': 'Replacement preview',
  'action.copy': 'Copy',
  'action.copied': 'Copied',
  'action.reset': 'Reset',
  'action.exportSvg': 'Export SVG',
  'action.exportPng': 'Export PNG',
  'view.railroad': 'Railroad diagram',
  'view.ast': 'AST tree',
  'view.emptyDiagram': 'Enter a valid pattern to see its structure',
  'view.truncated': 'Results hit the limit and were truncated; more matches may exist',
  'view.matchCount': '{count} matches',
  'view.normalized': 'Normalized',
  'note.flagsFromLiteral':
    'A /…/flags literal was detected, so flags come from the literal; drop the surrounding slashes to edit them with the controls below.',
  'flag.d': 'Expose capture group indices (implied by named groups)',
  'flag.g': 'Global search, find all matches',
  'flag.i': 'Case-insensitive',
  'flag.m': 'Multiline, ^ and $ match each line',
  'flag.s': 'Make . also match line terminators',
  'flag.u': 'Unicode mode, escapes and surrogates by code point',
  'flag.y': 'Sticky, match only from lastIndex',
  'flag.v': 'Unicode sets mode with extended class syntax (mutually exclusive with u)',
  'group.capturing': 'Capturing group',
  'group.nonCapturing': 'Non-capturing group',
  'group.named': 'Named capturing group',
  'group.lookahead': 'Lookahead',
  'group.lookbehind': 'Lookbehind',
  'group.negative': 'Negative assertion',
  'group.backreference': 'Backreference',
  'group.notParticipated': 'Did not participate in this match',
  'group.ordinal': 'Index',
  'group.name': 'Name',
  'issue.invalidPattern': 'Invalid regular expression syntax',
  'issue.invalidFlag': 'Unsupported flag',
  'issue.conflictingFlags': 'The u and v flags are mutually exclusive',
  'issue.unsupportedFlag': 'This flag is not supported by the current runtime',
  'issue.textTooLong': 'Test string exceeds the length limit',
  'issue.patternTooLong': 'Pattern exceeds the length limit',
  'issue.tooManyMatches': 'Match count reached the limit',
  'issue.iterationLimit': 'Iteration count reached the limit',
  'issue.timeLimit': 'Execution time reached the limit',
  'issue.invalidReplacement': 'The replacement string is not valid',
  'issue.unknownGroupRef': 'The replacement references a capture group that does not exist',
  'issue.partialSession': 'Matches are incomplete, so replacement was refused',
  'issue.malformedState': 'The shared link is corrupted and cannot be parsed',
  'issue.unsupportedStateVersion': 'The shared link uses an unsupported version',
  'token.anyChar': 'any char',
  'token.digit': 'digit',
  'token.nonDigit': 'non-digit',
  'token.wordChar': 'letter',
  'token.nonWordChar': 'non-letter',
  'token.whitespace': 'whitespace',
  'token.nonWhitespace': 'non-whitespace',
  'token.quantZeroOrMore': '0 or more',
  'token.quantOneOrMore': '1 or more',
  'token.quantZeroOrOne': '0 or 1',
  'token.quantExactly': 'exactly {count}',
  'token.quantAtLeast': '{min} or more',
  'token.quantRange': '{min} to {max}',
  'token.nonGreedy': 'non-greedy'
};

/** 语言 → 文案表。类型保证每种语言、每个 key 都在，缺一个就编译不过。 */
export const MESSAGES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> =
  Object.freeze({ 'zh-CN': Object.freeze(ZH), en: Object.freeze(EN) });

/** 主语言前缀 → 受支持语言。目前只做中英双语，新增语言时扩这里与 SUPPORTED_LOCALES。 */
const LANG_PREFIX: Readonly<Record<string, Locale>> = Object.freeze({
  zh: 'zh-CN',
  en: 'en'
});

/**
 * 把单个 BCP-47 语言标签归一为受支持语言，无法归类时返回 `null`。
 *
 * 先精确匹配（忽略大小写），再退到主语言前缀：`zh-TW` / `zh-Hans-CN` → `zh-CN`，
 * `en-GB` → `en`。返回 `null` 而不是直接回退，是为了让 `resolveLocale` 能继续
 * 尝试候选数组里的下一个标签。
 */
export function normalizeLocaleTag(tag: string): Locale | null {
  const lowered = tag.trim().toLowerCase();
  if (lowered === '') return null;
  for (const locale of SUPPORTED_LOCALES) {
    if (locale.toLowerCase() === lowered) return locale;
  }
  const primary = lowered.split('-')[0];
  if (primary === undefined) return null;
  return LANG_PREFIX[primary] ?? null;
}

/**
 * 按候选顺序解析出应使用的语言，全部无法归类时回退 `FALLBACK_LOCALE`（zh-CN）。
 *
 * `candidates` 由调用方提供（例如 `[...navigator.languages, navigator.language]`）；
 * core 不触碰 `navigator`，因此在 Node、Worker、SSR 下同样可用，传空数组即得回退值。
 */
export function resolveLocale(candidates: readonly string[] = []): Locale {
  for (const candidate of candidates) {
    const locale = normalizeLocaleTag(candidate);
    if (locale !== null) return locale;
  }
  return FALLBACK_LOCALE;
}

export type TranslateParams = Readonly<Record<string, string | number>>;

/**
 * 取一条文案。`params` 用 `{name}` 占位插值，占位符缺参时**原样保留**（便于发现漏参，
 * 而不是静默产出 `undefined`）。
 */
export function translate(locale: Locale, key: MessageKey, params?: TranslateParams): string {
  const template = MESSAGES[locale][key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole: string, name: string): string => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** 便捷闭包：绑定语言后直接 `t(key, params)`，适配层与 playground 用它避免每处传 locale。 */
export function createTranslator(locale: Locale): (key: MessageKey, params?: TranslateParams) => string {
  return (key: MessageKey, params?: TranslateParams): string => translate(locale, key, params);
}

/**
 * 取某个 flag 的说明文案（`flag.d` … `flag.v`）。
 *
 * 存在的理由是把 `'flag.' + flag` 到 `MessageKey` 的收窄 **cast 收在 core 内部**：
 * 字符串拼接的结果是 `string`，让三个适配层各自 `as MessageKey` 等于把不安全的一面
 * 复制三遍。这里集中一次，且入参类型是 `RegexFlag`，取值必然落在八个 `flag.*` 之内。
 */
export function flagMessage(locale: Locale, flag: RegexFlag): string {
  return translate(locale, ('flag.' + flag) as MessageKey);
}

/**
 * 字符类别转义的图上标签（`\d` → 数字 / digit）。
 *
 * 返回 `null` 表示**没有专门词条**，调用方应退回原始写法（如 `\.`、`\a`）。
 * 注意 `en` 也走同一张表：英文下这些语义与写法几乎等长，没必要特殊处理。
 * 图上只留中文语义会丢失可逆性，所以原始写法由视图放进 `data-escaped`。
 */
const TOKEN_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
  d: 'token.digit',
  D: 'token.nonDigit',
  w: 'token.wordChar',
  W: 'token.nonWordChar',
  s: 'token.whitespace',
  S: 'token.nonWhitespace'
});

export function tokenLabel(locale: Locale, escaped: string): string | null {
  if (escaped === '.') return translate(locale, 'token.anyChar');
  const key = TOKEN_KEYS[escaped];
  return key === undefined ? null : translate(locale, key);
}

/** 量词的次数语义（按使用者要求：`+` 说「一次以上」、`*` 说「0次以上」，懒惰追加「非贪婪」）。 */
export function quantifierLabel(
  locale: Locale,
  quantifier: { min: number; max: number | null; greedy: boolean }
): string {
  const { min, max, greedy } = quantifier;
  let base: string;
  if (min === 0 && max === null) base = translate(locale, 'token.quantZeroOrMore');
  else if (min === 1 && max === null) base = translate(locale, 'token.quantOneOrMore');
  else if (min === 0 && max === 1) base = translate(locale, 'token.quantZeroOrOne');
  else if (max === null) base = translate(locale, 'token.quantAtLeast', { min });
  else if (min === max) base = translate(locale, 'token.quantExactly', { count: min });
  else base = translate(locale, 'token.quantRange', { min, max });
  return greedy ? base : `${base}·${translate(locale, 'token.nonGreedy')}`;
}
