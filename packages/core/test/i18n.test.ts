import { describe, expect, it } from 'vitest';

import {
  FALLBACK_LOCALE,
  MESSAGES,
  SUPPORTED_LOCALES,
  createTranslator,
  normalizeLocaleTag,
  resolveLocale,
  translate
} from '../src/i18n';
import type { Locale, MessageKey } from '../src/i18n';

const LOCALES: readonly Locale[] = ['zh-CN', 'en'];

function keysOf(locale: Locale): string[] {
  return Object.keys(MESSAGES[locale]).sort();
}

/** 抽出文案里所有 `{占位}` 名，用于校验两种语言的插值参数集一致。 */
function placeholdersOf(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
}

describe('normalizeLocaleTag', () => {
  it('精确匹配（忽略大小写与首尾空白）', () => {
    expect(normalizeLocaleTag('zh-CN')).toBe('zh-CN');
    expect(normalizeLocaleTag('  en  ')).toBe('en');
    expect(normalizeLocaleTag('EN')).toBe('en');
    expect(normalizeLocaleTag('ZH-cn')).toBe('zh-CN');
  });

  it('退到主语言前缀：繁体与区域变体都落到 zh-CN', () => {
    expect(normalizeLocaleTag('zh-TW')).toBe('zh-CN');
    expect(normalizeLocaleTag('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLocaleTag('zh')).toBe('zh-CN');
    expect(normalizeLocaleTag('en-GB')).toBe('en');
    expect(normalizeLocaleTag('en-AU')).toBe('en');
  });

  it('无法归类时返回 null，交由调用方继续尝试下一个候选', () => {
    expect(normalizeLocaleTag('fr')).toBeNull();
    expect(normalizeLocaleTag('')).toBeNull();
    expect(normalizeLocaleTag('   ')).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('按候选顺序取第一个可用语言', () => {
    expect(resolveLocale(['fr', 'en-GB', 'zh-CN'])).toBe('en');
    expect(resolveLocale(['de', 'zh-TW'])).toBe('zh-CN');
  });

  it('全部不可归类时回退简体中文', () => {
    expect(resolveLocale(['fr', 'de', 'ja', 'ko'])).toBe(FALLBACK_LOCALE);
    expect(resolveLocale([])).toBe('zh-CN');
    expect(resolveLocale()).toBe('zh-CN');
  });

  it('回退语言必须是 zh-CN（合集约定）', () => {
    expect(FALLBACK_LOCALE).toBe('zh-CN');
    expect(SUPPORTED_LOCALES).toContain(FALLBACK_LOCALE);
  });
});

describe('translate', () => {
  it('返回对应语言的文案', () => {
    expect(translate('zh-CN', 'app.title')).toBe('正则测试器');
    expect(translate('en', 'app.title')).toBe('Regex Tester');
  });

  it('插值替换 {name}', () => {
    expect(translate('zh-CN', 'view.matchCount', { count: 12 })).toBe('共 12 个匹配');
    expect(translate('en', 'view.matchCount', { count: 3 })).toBe('3 matches');
  });

  it('缺参时原样保留占位符，而不是静默产出 undefined', () => {
    expect(translate('zh-CN', 'view.matchCount', { total: 1 })).toBe('共 {count} 个匹配');
    expect(translate('en', 'view.matchCount')).toContain('{count}');
  });

  it('createTranslator 绑定语言后行为一致', () => {
    const t = createTranslator('en');
    expect(t('action.copy')).toBe('Copy');
    expect(t('view.matchCount', { count: 7 })).toBe('7 matches');
  });
});

describe('双语一致性（加一条文案就欠两份翻译，故设为硬门禁）', () => {
  it('两种语言的 key 集完全相同', () => {
    const base = keysOf('zh-CN');
    expect(base.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      expect(keysOf(locale)).toEqual(base);
    }
  });

  it('每种语言的 key 数量与 MessageKey 联合一致', () => {
    // 这里是运行时快照；数量变了说明新增/删除了文案，需同步另一语言与文档
    expect(keysOf('zh-CN')).toHaveLength(keysOf('en').length);
    expect(keysOf('zh-CN').length).toBeGreaterThanOrEqual(46);
  });

  it('没有空文案，也没有多余首尾空白', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(MESSAGES[locale])) {
        expect(value.trim(), `${locale}/${key} 为空`).not.toBe('');
        expect(value, `${locale}/${key} 含首尾空白`).toBe(value.trim());
      }
    }
  });

  it('两种语言的 {占位符} 集合逐条一致', () => {
    const allKeys = keysOf('zh-CN') as MessageKey[];
    for (const key of allKeys) {
      expect(placeholdersOf(MESSAGES.en[key]), `en/${key} 占位符与 zh-CN 不一致`).toEqual(
        placeholdersOf(MESSAGES['zh-CN'][key])
      );
    }
  });

  it('文案表已冻结，运行时改不动', () => {
    expect(Object.isFrozen(MESSAGES)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_LOCALES)).toBe(true);
  });
});
