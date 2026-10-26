import { forwardRef, useMemo } from 'react';

import { parseFlags, resolveLocale, translate } from '@x-ac/regex-core';
import type { Locale, MessageKey } from '@x-ac/regex-core';

import '@x-ac/regex-core/style.css';

/**
 * React 适配层占位组件（M2 骨架）。
 *
 * 与 Vue 侧同构：只做 props → core 纯函数 → JSX 的搬运，不含任何正则语义。
 * M3 挂匹配结果与高亮层，M4 挂 `x-ac-regex-diagram` 的 SVG / Canvas 双后端。
 */
export interface RegexProps {
  pattern?: string;
  flags?: string;
  /** 语言候选（宿主传 `[...navigator.languages]`）；core 不读 navigator，故在此注入。 */
  localeCandidates?: readonly string[];
}

/** 组件实例句柄：透传到根 `div`，供宿主定位与测量。 */
export type RegexHandle = HTMLDivElement;

export const Regex = forwardRef<RegexHandle, RegexProps>(function Regex(props, ref) {
  const { pattern = '', flags = 'g', localeCandidates = [] } = props;

  // 依赖用 join 后的字符串而非数组本身：调用方常传字面量数组，引用每轮都变。
  const candidateKey = localeCandidates.join(',');
  const locale = useMemo<Locale>(
    () => resolveLocale(candidateKey === '' ? [] : candidateKey.split(',')),
    [candidateKey]
  );
  const t = useMemo<(key: MessageKey) => string>(() => (key) => translate(locale, key), [locale]);

  const parsed = useMemo(() => parseFlags(flags), [flags]);
  const normalizedFlags = parsed.ok ? parsed.flags : '';

  return (
    <div className="x-ac-regex-root" ref={ref}>
      <h2 className="x-ac-regex-title">{t('app.title')}</h2>
      <p className="x-ac-regex-tagline">{t('app.tagline')}</p>

      <label className="x-ac-regex-field">
        <span>{t('field.pattern')}</span>
        <code className="x-ac-regex-mono x-ac-regex-pattern">
          {`/${pattern}/${normalizedFlags}`}
        </code>
      </label>

      <label className="x-ac-regex-field">
        <span>{t('field.flags')}</span>
        <code className="x-ac-regex-mono">{flags}</code>
      </label>

      {parsed.issues.length > 0 ? (
        <ul className="x-ac-regex-issues">
          {parsed.issues.map((issue) => (
            <li
              key={`${issue.code}-${issue.message}`}
              className={`x-ac-regex-issue x-ac-regex-issue--${issue.severity}`}
            >
              <span className="x-ac-regex-issue__code">{issue.code}</span>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="x-ac-regex-diagram">
        <p className="x-ac-regex-diagram__empty">{t('view.emptyDiagram')}</p>
      </div>
    </div>
  );
});
