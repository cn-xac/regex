/**
 * 跨模块守卫 —— 导出面快照、零依赖、无 DOM、版本一致、code↔文案对齐。
 *
 * 这些断言不属于任何功能，而是**防止包层面腐烂**的门禁，所以单独一个文件。
 * 其中「零运行时依赖」与「不碰 DOM」是 core 的立身卖点，最容易在加功能时被无意破坏。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as api from '../src/index';
import { FALLBACK_LOCALE, MESSAGES, SUPPORTED_LOCALES, resolveLocale, translate } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
};

/** 手写期望清单：新增导出忘了登记进 index.ts 会红，反之漏登记也会红。 */
const EXPECTED_VALUE_EXPORTS = [
  'CORE_VERSION',
  'DEFAULT_LIMITS',
  'DEFAULT_METRICS',
  'FALLBACK_LOCALE',
  'FLAG_ORDER',
  'MESSAGES',
  'PATTERN_METACHARACTERS',
  'SUPPORTED_LOCALES',
  'applyCanvasOps',
  'checkFlagSupport',
  'collectNodes',
  'compileCheck',
  'computeHighlights',
  'createTranslator',
  'emptyFlagSet',
  'escapeLiteral',
  'escapeReplacement',
  'escapeXml',
  'flagMessage',
  'formatFlags',
  'hasFlag',
  'isFlagSupported',
  'layoutRailroad',
  'matchAll',
  'nodeRange',
  'normalizeFlags',
  'normalizeLocaleTag',
  'parseFlags',
  'parsePattern',
  'parsePatternInput',
  'quantifierLabel',
  'renderCanvasOps',
  'renderSvg',
  'resolveLocale',
  'spansAtOffset',
  'stringifyAst',
  'toLineColumns',
  'toRenderChunks',
  'tokenLabel',
  'translate',
  'unescapeLiteral',
  'withFlag'
].sort();

describe('导出面', () => {
  it('值导出与快照完全一致', () => {
    expect(Object.keys(api).sort()).toEqual(EXPECTED_VALUE_EXPORTS);
  });

  it('包名与 scope 符合合集约定', () => {
    expect(pkg.name).toBe('@x-ac/regex-core');
  });
});

describe('core 铁律', () => {
  it('零运行时依赖（dependencies 字段不存在或为空对象）', () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('devDependencies 里不含任何框架包', () => {
    const dev = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys(dev.devDependencies ?? {});
    expect(names.filter((n) => /vue|react|svelte|angular|preact/.test(n))).toEqual([]);
  });

  /**
   * 扫描策略：先剥掉整行注释（行首 `//`、`*`、`/*`）再匹配 DOM 全局，
   * 因为 i18n 的文档注释里合法地提到了 `navigator.languages`。
   * 局限：行尾注释不在覆盖范围内，新增此类写法时需同步调整本守卫。
   */
  it('src 下所有 .ts 都不引用 DOM 全局', () => {
    const srcRoot = join(pkgRoot, 'src');
    const files = readdirSync(srcRoot).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    const domPattern = /\b(document|window|navigator|localStorage|sessionStorage)\b/;
    for (const file of files) {
      const code = readFileSync(join(srcRoot, file), 'utf8')
        .split(/\r?\n/)
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      expect(domPattern.test(code), `src/${file} 出现了 DOM 全局引用`).toBe(false);
    }
  });

  it('style.css 存在且非空（适配层 dist/index.css 的唯一来源）', () => {
    const cssPath = join(pkgRoot, 'src', 'style.css');
    expect(existsSync(cssPath)).toBe(true);
    const css = readFileSync(cssPath, 'utf8');
    expect(css.length).toBeGreaterThan(0);
    expect(css).toContain('.x-ac-regex-');
    // 前缀必须是 x-ac-regex-*，不能退化成模板带来的 .game-sudoku-*
    expect(css).not.toMatch(/\.game-|sudoku/);
  });
});

describe('版本一致性', () => {
  it('CORE_VERSION 与 package.json 完全一致', () => {
    expect(api.CORE_VERSION).toBe(pkg.version);
  });

  /**
   * 只守真不变量，不钉具体数字 —— 钉死某个版本会让每次正常发版都变成假报警。
   * 要求三段式干净 semver、无预发布后缀：占位版靠 **dist-tag**（`stage`）区分，
   * 而不是靠 `0.0.0-stage` 这种版本号形态 —— 后者会去碰 npm Staged Publishing 的保留字。
   */
  it('版本号是三段式 semver，不带预发布后缀', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('IssueCode 与双语文案对齐', () => {
  /** 与 src/types.ts 的 IssueCode 联合一一对应；新增 code 未配文案即红。 */
  const ISSUE_CODES = [
    'invalid-pattern',
    'invalid-flag',
    'conflicting-flags',
    'unsupported-flag',
    'pattern-too-long',
    'text-too-long',
    'too-many-matches',
    'iteration-limit',
    'time-limit',
    'invalid-replacement',
    'unknown-group-ref',
    'partial-session',
    'malformed-state',
    'unsupported-state-version'
  ] as const;

  function camel(code: string): string {
    return code.replace(/-([a-z])/g, (_all, ch: string) => ch.toUpperCase());
  }

  it('每个 IssueCode 都有 zh-CN 与 en 两条解释文案', () => {
    for (const code of ISSUE_CODES) {
      const key = `issue.${camel(code)}` as const;
      for (const locale of SUPPORTED_LOCALES) {
        const table = MESSAGES[locale] as Record<string, string | undefined>;
        expect(table[key], `${locale} 缺少 ${key}`).toBeTruthy();
      }
    }
  });
});

describe('冒烟：模块协作', () => {
  it('未提供的浏览器语言环境回退到 zh-CN 并取到中文标题', () => {
    const locale = FALLBACK_LOCALE;
    expect(resolveLocale(['fr-FR', 'de'])).toBe(locale);
    expect(translate(locale, 'app.title')).toBe('正则测试器');
  });
});
