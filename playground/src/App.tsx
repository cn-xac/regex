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
import type { Diagram, Locale, MessageKey } from '@x-ac/regex-core';
import { Regex as RegexReact } from '@x-ac/regex-react';
import { Regex as RegexVue } from '@x-ac/regex-vue';
import { renderDiagramToCanvas } from './canvas-painter';

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
/** 渲染后端：SVG（矢量字符串）或 Canvas（core 指令序列 → 2D ctx）。 */
type RenderMode = 'svg' | 'canvas';

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
  readonly renderMode: RenderMode;
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pattern, setPattern] = useState<string>(DEMO_PATTERN);
  const [flags, setFlags] = useState<string>(DEMO_FLAGS);
  const normalizedFlags = normalizeFlags(flags);

  useEffect(() => {
    const out = outRef.current;
    if (out === null) return;
    const locale = resolveLocale(candidates);
    const t = (key: MessageKey): string => translate(locale, key);
    const parsed = parseFlags(flags);
    const lines: string[] = [
      `${t('app.title')} [${locale}]`,
      `${t('field.pattern')}: /${pattern}/${normalizedFlags}`,
      `${t('field.flags')}: '${flags}' → '${normalizedFlags}'`,
      ...parsed.issues.map(
        (issue) => `[${issue.severity}] ${issue.code}@${issue.index ?? '-'} ${issue.message}`
      )
    ];
    out.textContent = lines.join('\n');
  }, [candidates, pattern, flags, normalizedFlags]);

  // 无框架出图：一次算好几何 Diagram，SVG / Canvas 两个后端都从它出发（同一引擎、两种形态）。
  const diagram = useMemo<Diagram | null>(() => {
    const result = parsePattern(pattern, normalizedFlags);
    return result.ok
      ? layoutRailroad(result.ast, { locale: resolveLocale(candidates), flags: normalizedFlags })
      : null;
  }, [pattern, normalizedFlags, candidates]);

  // SVG 后端：core 产标记字符串，宿主只管 innerHTML。
  useEffect(() => {
    if (controls.renderMode !== 'svg') return;
    const host = svgRef.current;
    if (host === null) return;
    host.innerHTML = diagram === null ? '' : renderSvg(diagram, { theme: controls.theme });
  }, [diagram, controls.renderMode, controls.theme]);

  // Canvas 后端：core 产指令序列，经 canvas-painter 适配层落到 2D ctx。
  useEffect(() => {
    if (controls.renderMode !== 'canvas') return;
    const canvas = canvasRef.current;
    if (canvas === null || diagram === null) return;
    renderDiagramToCanvas(canvas, diagram, controls.theme);
  }, [diagram, controls.renderMode, controls.theme]);

  return (
    <section className="pg-panel">
      <p className="pg-hint">
        不依赖任何框架，直接 import <code>@x-ac/regex-core</code> 的纯函数并用原生 DOM 渲染。
        顶部「渲染」切换器决定这块用 <b>SVG</b> 还是 <b>Canvas</b>——两者都出自同一颗 core 引擎。
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
      {controls.renderMode === 'svg' ? (
        <div ref={svgRef} className="pg-diagram" />
      ) : (
        <div className="pg-diagram">
          <canvas ref={canvasRef} className="pg-canvas" />
        </div>
      )}
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

  return (
    <section className="pg-panel">
      <div ref={hostRef} />
    </section>
  );
}

export function App(): JSX.Element {
  const detectedCandidates = useMemo<string[]>(browserLocaleCandidates, []);
  const [tab, setTab] = useState<TabId>('vanilla');
  const [theme, setTheme] = useState<ThemeName>(systemPrefersDark() ? 'dark' : 'light');
  const [lang, setLang] = useState<Locale>(resolveLocale(detectedCandidates));
  const [renderMode, setRenderMode] = useState<RenderMode>('svg');

  // 全局语言：把用户选定的 locale 当作唯一候选注入下游，页面所有文字随它切换。
  const candidates = useMemo<readonly string[]>(() => [lang], [lang]);
  const controls: GlobalControls = { theme, lang, renderMode };

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
        <span className="pg-toolbar__group">
          <span className="pg-toolbar__label">渲染</span>
          {(['svg', 'canvas'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="pg-chip"
              aria-pressed={renderMode === mode}
              onClick={() => setRenderMode(mode)}
            >
              {mode === 'svg' ? 'SVG' : 'Canvas'}
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
