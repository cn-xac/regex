import { useEffect, useMemo, useRef, useState } from 'react';
// React 19 移除了全局 JSX 命名空间，返回类型标注必须显式从 react 取。
import type { JSX } from 'react';
import { createApp } from 'vue';
import type { App as VueAppInstance } from 'vue';

import { normalizeFlags, parseFlags, resolveLocale, translate } from '@x-ac/regex-core';
import type { MessageKey } from '@x-ac/regex-core';
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
 * `DEMO_FLAGS` 故意写成 `'ggi'`：这样三个 tab 都会真实展示「重复 flag 降级为 warning
 * 并去重」这条语义，而不是各自渲染一条永远正确的空话。
 */
const DEMO_PATTERN = '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})';
const DEMO_FLAGS = 'ggi';

/**
 * core 不读 `navigator`（无 DOM 是铁律），语言探测因此是宿主的职责 ——
 * playground 在这里读，再把候选数组注入下去。
 */
function browserLocaleCandidates(): string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages.length > 0) return [...navigator.languages];
  return navigator.language ? [navigator.language] : [];
}

type TabId = 'vanilla' | 'vue' | 'react';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'vanilla', label: 'vanilla' },
  { id: 'vue', label: 'vue 3' },
  { id: 'react', label: 'react 19' }
];

function VanillaPanel({ candidates }: { candidates: readonly string[] }): JSX.Element {
  const outRef = useRef<HTMLPreElement | null>(null);
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
    </section>
  );
}

function VuePanel({ candidates }: { candidates: readonly string[] }): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const candidateKey = candidates.join(',');

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const instance: VueAppInstance = createApp(RegexVue, {
      pattern: DEMO_PATTERN,
      flags: DEMO_FLAGS,
      localeCandidates: candidateKey === '' ? [] : candidateKey.split(',')
    });
    instance.mount(host);
    return () => {
      instance.unmount();
    };
  }, [candidateKey]);

  return <div ref={hostRef} />;
}

export function App(): JSX.Element {
  const candidates = useMemo<string[]>(browserLocaleCandidates, []);
  const [tab, setTab] = useState<TabId>('vanilla');
  const locale = resolveLocale(candidates);

  return (
    <div className="pg-shell">
      <header className="pg-header">
        <h1>{translate(locale, 'app.title')} · Playground</h1>
        <p>{translate(locale, 'app.tagline')}</p>
      </header>

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

      {tab === 'vanilla' ? <VanillaPanel candidates={candidates} /> : null}
      {tab === 'vue' ? <VuePanel candidates={candidates} /> : null}
      {tab === 'react' ? (
        <section className="pg-panel">
          <RegexReact pattern={DEMO_PATTERN} flags={DEMO_FLAGS} localeCandidates={candidates} />
        </section>
      ) : null}
    </div>
  );
}
