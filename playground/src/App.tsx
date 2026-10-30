import { useEffect, useMemo, useRef, useState } from 'react';
// React 19 移除了全局 JSX 命名空间，返回类型标注必须显式从 react 取。
import type { JSX } from 'react';
import { createApp } from 'vue';
import type { App as VueAppInstance } from 'vue';

import {
  layoutRailroad,
  normalizeFlags,
  parseFlags,
  parsePattern,
  renderSvg,
  resolveLocale,
  translate
} from '@x-ac/regex-core';
import type { Locale, MessageKey } from '@x-ac/regex-core';
import { Regex as RegexReact } from '@x-ac/regex-react';
import { Regex as RegexVue } from '@x-ac/regex-vue';

/**
 * Playground —— 三个 tab 验证同一颗引擎在三种消费形态下表现一致。
 *
 * - **vanilla**：不经任何框架，直接调 `@x-ac/regex-core` 纯函数 + 原生 DOM 渲染。
 *   这是「core 与框架无关」的活证据，不是凑数的演示。
 * - **vue**：在 React 应用里用 `createApp` 挂 Vue 组件，顺带证明两栈可共存。
 * - **react**：直接用 `@x-ac/regex-react` 组件。
 *
 * 顶部有一排**全局切换器**（主题 / 语言），三个 tab 整体跟随 —— 主题写进
 * `document.documentElement` 的 `data-theme`（CSS 变量随之翻转），并作为
 * `svgTheme` / `renderSvg` 的 `theme` 下传给图；语言改写注入 core 的候选数组。
 *
 * `DEMO_FLAGS` 故意写成 `'ggi'`：这样三个 tab 都会真实展示「重复 flag 降级为 warning
 * 并去重」这条语义，而不是各自渲染一条永远正确的空话。
 */
const DEMO_PATTERN = '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})';
const DEMO_FLAGS = 'ggi';

type ThemeName = 'light' | 'dark';

/**
 * core 不读 `navigator` / `matchMedia`（无 DOM 是铁律），语言与主题的**初值探测**
 * 因此是宿主的职责 —— playground 在这里读，再把结果注入下去。
 */
function browserLocaleCandidates(): string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages.length > 0) return [...navigator.languages];
  return navigator.language ? [navigator.language] : [];
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

type TabId = 'vanilla' | 'vue' | 'react';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'vanilla', label: 'vanilla' },
  { id: 'vue', label: 'vue 3' },
  { id: 'react', label: 'react 19' }
];

const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: 'zh-CN', label: '中文' },
  { id: 'en', label: 'English' }
];

interface GlobalControls {
  readonly theme: ThemeName;
  readonly lang: Locale;
}

function VanillaPanel({
  candidates,
  controls
}: {
  candidates: readonly string[];
  controls: GlobalControls;
}): JSX.Element {
  const outRef = useRef<HTMLPreElement | null>(null);
  const svgRef = useRef<HTMLDivElement | null>(null);
  const [pattern, setPattern] = useState<string>(DEMO_PATTERN);
  const [flags, setFlags] = useState<string>(DEMO_FLAGS);

  useEffect(() => {
    const out = outRef.current;
    if (out === null) return;
    const locale = resolveLocale(candidates);
    const t = (key: MessageKey): string => translate(locale, key);
    const parsed = parseFlags(flags);
    const normalized = normalizeFlags(flags);
    const lines: string[] = [
      `${t('app.title')} [${locale}]`,
      `${t('field.pattern')}: /${pattern}/${normalized}`,
      `${t('field.flags')}: '${flags}' → '${normalized}'`,
      ...parsed.issues.map(
        (issue) => `[${issue.severity}] ${issue.code}@${issue.index ?? '-'} ${issue.message}`
      )
    ];
    out.textContent = lines.join('\n');
  }, [candidates, pattern, flags]);

  // 无框架出图：core 产 SVG 字符串，这里只是 innerHTML 一行的事。theme 跟随全局切换器。
  useEffect(() => {
    const host = svgRef.current;
    if (host === null) return;
    const result = parsePattern(pattern, normalizeFlags(flags));
    host.innerHTML = result.ok
      ? renderSvg(layoutRailroad(result.ast, { locale: resolveLocale(candidates) }), {
          theme: controls.theme
        })
      : '';
  }, [pattern, flags, candidates, controls.theme]);

  return (
    <section className="pg-panel">
      <p className="pg-hint">
        不依赖任何框架，直接 import <code>@x-ac/regex-core</code> 的纯函数并用原生 DOM 渲染。
      </p>
      <label className="pg-field">
        <span>pattern</span>
        <input
          className="pg-mono"
          value={pattern}
          spellCheck={false}
          onChange={(event) => setPattern(event.target.value)}
        />
      </label>
      <label className="pg-field">
        <span>flags</span>
        <input
          className="pg-mono"
          value={flags}
          spellCheck={false}
          onChange={(event) => setFlags(event.target.value)}
        />
      </label>
      <pre ref={outRef} className="pg-out pg-mono" />
      <div ref={svgRef} className="pg-diagram" />
    </section>
  );
}

function VuePanel({
  candidates,
  controls
}: {
  candidates: readonly string[];
  controls: GlobalControls;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const candidateKey = candidates.join(',');
  const { theme } = controls;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const instance: VueAppInstance = createApp(RegexVue, {
      pattern: DEMO_PATTERN,
      flags: DEMO_FLAGS,
      localeCandidates: candidateKey === '' ? [] : candidateKey.split(','),
      svgTheme: theme
    });
    instance.mount(host);
    return () => {
      instance.unmount();
    };
  }, [candidateKey, theme]);

  return <div ref={hostRef} />;
}

export function App(): JSX.Element {
  const detectedCandidates = useMemo<string[]>(browserLocaleCandidates, []);
  const [tab, setTab] = useState<TabId>('vanilla');
  const [theme, setTheme] = useState<ThemeName>(systemPrefersDark() ? 'dark' : 'light');
  const [lang, setLang] = useState<Locale>(resolveLocale(detectedCandidates));

  // 全局语言：把用户选定的 locale 当作唯一候选注入下游，页面所有文字随它切换。
  const candidates = useMemo<readonly string[]>(() => [lang], [lang]);
  const controls: GlobalControls = { theme, lang };

  // 主题写进根节点，CSS 变量（含 body 背景）随之翻转。
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const shellLocale = resolveLocale(candidates);

  return (
    <div className="pg-shell">
      <header className="pg-header">
        <h1>{translate(shellLocale, 'app.title')} · Playground</h1>
        <p>{translate(shellLocale, 'app.tagline')}</p>
      </header>

      <div className="pg-toolbar" role="group" aria-label="display controls">
        <span className="pg-toolbar__group">
          <span className="pg-toolbar__label">主题</span>
          {(['light', 'dark'] as const).map((name) => (
            <button
              key={name}
              type="button"
              className="pg-chip"
              aria-pressed={theme === name}
              onClick={() => setTheme(name)}
            >
              {name === 'light' ? '浅色' : '深色'}
            </button>
          ))}
        </span>
        <span className="pg-toolbar__group">
          <span className="pg-toolbar__label">语言</span>
          {LOCALES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="pg-chip"
              aria-pressed={lang === item.id}
              onClick={() => setLang(item.id)}
            >
              {item.label}
            </button>
          ))}
        </span>
      </div>

      <div className="pg-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="pg-tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'vanilla' ? <VanillaPanel candidates={candidates} controls={controls} /> : null}
      {tab === 'vue' ? <VuePanel candidates={candidates} controls={controls} /> : null}
      {tab === 'react' ? (
        <section className="pg-panel">
          <RegexReact
            pattern={DEMO_PATTERN}
            flags={DEMO_FLAGS}
            localeCandidates={[...candidates]}
            svgTheme={theme}
          />
        </section>
      ) : null}
    </div>
  );
}
