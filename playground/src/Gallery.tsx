import { useMemo, useState } from 'react';
// React 19 移除了全局 JSX 命名空间，返回类型标注必须显式从 react 取。
import type { JSX } from 'react';

import { layoutRailroad, parsePattern, renderSvg } from '@x-ac/regex-core';
import type { Locale } from '@x-ac/regex-core';

/**
 * 画廊 tab —— 一批示例 pattern 的铁路图，配语言 / 主题两个下拉，供目视验证可视化层。
 *
 * 与三个「同一引擎多消费形态」tab 不同，这里只走 vanilla 路线（core 纯函数 → renderSvg
 * 字符串 → innerHTML），因为它的目的是**批量对比观感**，不是证明框架可共存。
 *
 * ⚠ 主题一致性：SVG 的配色由 `renderSvg({ theme })` **内联**决定，而 `.x-ac-regex-diagram`
 * 的底色来自 `style.css` 的 `prefers-color-scheme`（跟随系统）。两者若各走各的，会出现
 * 「选了深色主题但系统是浅色 → 浅色文字压在白底上」。所以这里按**选中的主题**内联容器底色，
 * 让底与图配色同源。
 */
const GALLERY_PATTERNS: readonly string[] = [
  '^(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})$',
  '(\\w+)@(\\w+)\\.(com|org)',
  '[^a-z0-9]+',
  '(a|b)*?c+',
  '(?<=\\$)\\d+\\.\\d{2}(?=\\b)',
  'a|bb|ccc',
  '(?<host>[\\w.-]+):(?<port>\\d{2,5})',
  'a(?:bc)d(?=x)(?!y)(?<=p)(?<!q)\\b\\B'
];

const THEME_BG: Record<'light' | 'dark', string> = {
  light: '#ffffff',
  dark: '#14181f'
};

type GalleryItem =
  | { readonly pattern: string; readonly ok: true; readonly svg: string }
  | { readonly pattern: string; readonly ok: false; readonly error: string };

export function Gallery({ candidates }: { candidates: readonly string[] }): JSX.Element {
  // 初始语言跟随浏览器候选（core 不读 navigator，与其余 tab 同一口径由宿主探测后注入）。
  const [locale, setLocale] = useState<Locale>(() => (candidates.includes('en') ? 'en' : 'zh-CN'));
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const items: readonly GalleryItem[] = useMemo(
    () =>
      GALLERY_PATTERNS.map<GalleryItem>((pattern) => {
        const parsed = parsePattern(pattern, '');
        if (!parsed.ok) return { pattern, ok: false, error: parsed.issues[0]?.message ?? '解析失败' };
        const diagram = layoutRailroad(parsed.ast, { locale });
        return { pattern, ok: true, svg: renderSvg(diagram, { theme }) };
      }),
    [locale, theme]
  );

  return (
    <section className="pg-panel">
      <p className="pg-hint">
        示例铁路图画廊：切语言 / 主题验证可视化层（标签语义、前缀居中、边框、明暗配色）。全部走
        <code> core renderSvg </code>产出的内联配色 SVG，与产品导出同一条渲染路径。
      </p>
      <div className="pg-gallery-bar">
        <label className="pg-field">
          <span>语言</span>
          <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
            <option value="zh-CN">中文 (zh-CN)</option>
            <option value="en">English (en)</option>
          </select>
        </label>
        <label className="pg-field">
          <span>主题</span>
          <select value={theme} onChange={(event) => setTheme(event.target.value as 'light' | 'dark')}>
            <option value="light">浅色 (light)</option>
            <option value="dark">深色 (dark)</option>
          </select>
        </label>
      </div>

      {items.map((item) => (
        <figure key={item.pattern} className="pg-gallery-item">
          <figcaption className="pg-mono">/{item.pattern}/</figcaption>
          {item.ok ? (
            <div
              className="x-ac-regex-diagram"
              data-backend="svg"
              style={{ background: THEME_BG[theme] }}
            >
              <div className="x-ac-regex-diagram__svg-host" dangerouslySetInnerHTML={{ __html: item.svg }} />
            </div>
          ) : (
            <p className="x-ac-regex-diagram__empty">解析失败：{item.error}</p>
          )}
        </figure>
      ))}
    </section>
  );
}
