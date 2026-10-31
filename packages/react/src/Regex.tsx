import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import {
  FLAG_ORDER,
  chunkPresentation,
  computeHighlights,
  flagMessage,
  hasFlag,
  isFlagSupported,
  layoutRailroad,
  matchAll,
  parseFlags,
  parsePattern,
  parsePatternInput,
  renderSvg,
  resolveLocale,
  toRenderChunks,
  translate,
  withFlag
} from '@x-ac/regex-core';
import type { Diagram, Locale, MessageKey, RegexFlag, TranslateParams } from '@x-ac/regex-core';
import { paintDiagramOnCanvas } from './canvas-ctx';

import '@x-ac/regex-core/style.css';

/**
 * React 适配层（M3）—— 与 Vue 侧行为刻意保持一致，改动必须两边同步：
 * - pattern 输入框不篡改原文，允许 `/abc/gi` 字面量，交给 `parsePatternInput`；
 * - flags 用八个勾选控件表达；
 * - 铁路图由 core 的 `parsePattern → layoutRailroad → renderSvg` 产出字符串，
 *   这里只负责挂载；Canvas 后端与 SVG 共用同一份几何。
 *
 * 关于 `dangerouslySetInnerHTML`：内容全部来自 `renderSvg`，其中每个 label 都过了
 * `escapeXml`，不含用户可注入的原始标记。
 */
export interface RegexProps {
  pattern?: string;
  flags?: string;
  /** 测试文本。 */
  text?: string;
  /** 语言候选（宿主传 `[...navigator.languages]`）；core 不读 navigator，故在此注入。 */
  localeCandidates?: readonly string[];
  /** 导出的 SVG/Canvas 配色主题名。内置 'light' / 'dark'，也可传已注册的自定义主题名。 */
  svgTheme?: string;
  /** 渲染后端：`'svg'`（默认）或 `'canvas'`。 */
  backend?: 'svg' | 'canvas';
  onPatternChange?: (value: string) => void;
  onFlagsChange?: (value: string) => void;
  onTextChange?: (value: string) => void;
}

/** 组件实例句柄：透传到根 `div`，供宿主定位与测量。 */
export type RegexHandle = HTMLDivElement;

export const Regex = forwardRef<RegexHandle, RegexProps>(function Regex(props, ref) {
  const {
    pattern = '',
    flags = 'g',
    text = '',
    localeCandidates = [],
    svgTheme = 'light',
    backend = 'svg',
    onPatternChange,
    onFlagsChange,
    onTextChange
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 依赖用 join 后的字符串而非数组本身：调用方常传字面量数组，引用每轮都变。
  const candidateKey = localeCandidates.join(',');
  const locale = useMemo<Locale>(
    () => resolveLocale(candidateKey === '' ? [] : candidateKey.split(',')),
    [candidateKey]
  );
  const t = useMemo<(key: MessageKey, params?: TranslateParams) => string>(
    () => (key, params) => translate(locale, key, params),
    [locale]
  );

  const [source, setSource] = useState<string>(pattern);
  const [flagsModel, setFlagsModel] = useState<string>(flags);
  const [textModel, setTextModel] = useState<string>(text);

  useEffect(() => {
    setTextModel(text);
  }, [text]);

  useEffect(() => {
    setSource(pattern);
  }, [pattern]);
  useEffect(() => {
    setFlagsModel(flags);
  }, [flags]);

  /** 是否按 `/pattern/flags` 字面量书写 —— 决定勾选控件可否点击。 */
  const isLiteral = useMemo(() => parsePatternInput(source, {}).literal, [source]);

  const parsed = useMemo(
    () =>
      parsePatternInput(source, {
        flags: flagsModel,
        merge: isLiteral ? 'literal' : 'current'
      }),
    [source, flagsModel, isLiteral]
  );

  const issues = useMemo(
    () => [...parsed.issues, ...parseFlags(parsed.flags).issues],
    [parsed]
  );

  /** 铁路图几何（Diagram）；pattern 非法时为 null。 */
  const diagramData = useMemo<Diagram | null>(() => {
    const result = parsePattern(parsed.pattern, parsed.flags);
    if (!result.ok) return null;
    return layoutRailroad(result.ast, { locale, flags: parsed.flags });
  }, [parsed, locale]);

  /** SVG 字符串（backend='svg' 时用）。 */
  const diagramSvg = useMemo<string>(() => {
    if (diagramData === null) return '';
    return renderSvg(diagramData, { theme: svgTheme });
  }, [diagramData, svgTheme]);

  /** Canvas 后端：diagramData 或 theme 变化时重绘。 */
  useEffect(() => {
    if (backend !== 'canvas') return;
    const canvas = canvasRef.current;
    if (canvas === null || diagramData === null) return;
    paintDiagramOnCanvas(canvas, diagramData, svgTheme);
  }, [backend, diagramData, svgTheme]);

  /** 匹配结果 → 区间 → 渲染片段；三步全在 core，视图只负责铺节点。 */
  const session = useMemo(
    () => matchAll(textModel, parsed.pattern, parsed.flags),
    [textModel, parsed]
  );
  const chunks = useMemo(
    () => toRenderChunks(textModel, computeHighlights(session)),
    [textModel, session]
  );

  const onTextInput = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      const value = event.target.value;
      setTextModel(value);
      onTextChange?.(value);
    },
    [onTextChange]
  );

  const onSourceInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const value = event.target.value;
      setSource(value);
      onPatternChange?.(value);
    },
    [onPatternChange]
  );

  const toggleFlag = useCallback(
    (flag: RegexFlag): void => {
      if (isLiteral) return;
      setFlagsModel((prev) => {
        const next = withFlag(prev, flag, !hasFlag(prev, flag));
        onFlagsChange?.(next);
        return next;
      });
    },
    [isLiteral, onFlagsChange]
  );

  return (
    <div className="x-ac-regex-root" data-theme={svgTheme} ref={ref}>
      <h2 className="x-ac-regex-title">{t('app.title')}</h2>
      <p className="x-ac-regex-tagline">{t('app.tagline')}</p>

      <label className="x-ac-regex-field">
        <span>{t('field.pattern')}</span>
        <input
          className="x-ac-regex-mono x-ac-regex-input"
          type="text"
          value={source}
          spellCheck={false}
          autoComplete="off"
          onChange={onSourceInput}
        />
      </label>

      <p className="x-ac-regex-note">
        {t('view.normalized')}:{' '}
        <code className="x-ac-regex-mono">{`/${parsed.pattern}/${parsed.flags}`}</code>
      </p>

      <fieldset className="x-ac-regex-flags" aria-disabled={isLiteral ? 'true' : 'false'}>
        <legend>{t('field.flags')}</legend>
        {FLAG_ORDER.map((flag) => (
          <label
            key={flag}
            className={`x-ac-regex-flag${isFlagSupported(flag) ? '' : ' is-unsupported'}`}
          >
            <input
              type="checkbox"
              checked={hasFlag(parsed.flags, flag)}
              disabled={isLiteral || !isFlagSupported(flag)}
              onChange={() => toggleFlag(flag)}
            />
            <code className="x-ac-regex-flag__code">{flag}</code>
            <span className="x-ac-regex-flag__hint">{flagMessage(locale, flag)}</span>
          </label>
        ))}
      </fieldset>

      {isLiteral ? <p className="x-ac-regex-note">{t('note.flagsFromLiteral')}</p> : null}

      {issues.length > 0 ? (
        <ul className="x-ac-regex-issues">
          {issues.map((issue, idx) => (
            <li
              key={`${issue.code}-${idx}`}
              className={`x-ac-regex-issue x-ac-regex-issue--${issue.severity}`}
            >
              <span className="x-ac-regex-issue__code">{issue.code}</span>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="x-ac-regex-field">
        <span>{t('field.text')}</span>
        <textarea
          className="x-ac-regex-mono x-ac-regex-input"
          rows={4}
          value={textModel}
          spellCheck={false}
          onChange={onTextInput}
        />
      </label>

      <p className="x-ac-regex-summary" data-truncated={session.truncated ? 'true' : 'false'}>
        {t('view.matchCount', { count: session.matches.length })}
        {session.truncated ? ` · ${t('view.truncated')}` : ''}
      </p>

      <pre className="x-ac-regex-highlight x-ac-regex-mono">
        {chunks.map((chunk) => {
          const pres = chunkPresentation(chunk);
          return (
            <span
              key={chunk.start}
              className={pres.classes.join(' ')}
              data-depth={pres.depth}
              data-groups={pres.groupOrdinals.length > 0 ? pres.groupOrdinals.join(',') : undefined}
            >
              {chunk.text}
            </span>
          );
        })}
      </pre>

      <div className="x-ac-regex-diagram" data-backend={backend}>
        {diagramSvg === '' && diagramData === null ? (
          <p className="x-ac-regex-diagram__empty">{t('view.emptyDiagram')}</p>
        ) : (
          <>
            <div
              className="x-ac-regex-diagram__svg-host"
              dangerouslySetInnerHTML={{ __html: diagramSvg }}
            />
            <canvas ref={canvasRef} className="x-ac-regex-diagram__canvas" />
          </>
        )}
      </div>
    </div>
  );
});
