import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';

import {
  FLAG_ORDER,
  flagMessage,
  hasFlag,
  isFlagSupported,
  layoutRailroad,
  parseFlags,
  parsePattern,
  parsePatternInput,
  renderSvg,
  resolveLocale,
  translate,
  withFlag
} from '@x-ac/regex-core';
import type { Locale, MessageKey, RegexFlag, SvgTheme } from '@x-ac/regex-core';

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
  /** 语言候选（宿主传 `[...navigator.languages]`）；core 不读 navigator，故在此注入。 */
  localeCandidates?: readonly string[];
  /** 导出的 SVG 配色。宿主想跟随系统时自行传值（core 不读 matchMedia）。 */
  svgTheme?: SvgTheme;
  onPatternChange?: (value: string) => void;
  onFlagsChange?: (value: string) => void;
}

/** 组件实例句柄：透传到根 `div`，供宿主定位与测量。 */
export type RegexHandle = HTMLDivElement;

export const Regex = forwardRef<RegexHandle, RegexProps>(function Regex(props, ref) {
  const {
    pattern = '',
    flags = 'g',
    localeCandidates = [],
    svgTheme = 'light',
    onPatternChange,
    onFlagsChange
  } = props;

  // 依赖用 join 后的字符串而非数组本身：调用方常传字面量数组，引用每轮都变。
  const candidateKey = localeCandidates.join(',');
  const locale = useMemo<Locale>(
    () => resolveLocale(candidateKey === '' ? [] : candidateKey.split(',')),
    [candidateKey]
  );
  const t = useMemo<(key: MessageKey) => string>(() => (key) => translate(locale, key), [locale]);

  const [source, setSource] = useState<string>(pattern);
  const [flagsModel, setFlagsModel] = useState<string>(flags);

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

  /** 铁路图 SVG。pattern 非法（或被复验拒绝）时为空串，界面退回占位提示。 */
  const diagram = useMemo<string>(() => {
    const result = parsePattern(parsed.pattern, parsed.flags);
    if (!result.ok) return '';
    return renderSvg(layoutRailroad(result.ast, { locale }), { theme: svgTheme });
  }, [parsed, svgTheme, locale]);

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
    <div className="x-ac-regex-root" ref={ref}>
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

      <div className="x-ac-regex-diagram" data-backend="svg">
        {diagram === '' ? (
          <p className="x-ac-regex-diagram__empty">{t('view.emptyDiagram')}</p>
        ) : (
          <div
            className="x-ac-regex-diagram__svg-host"
            dangerouslySetInnerHTML={{ __html: diagram }}
          />
        )}
      </div>
    </div>
  );
});
