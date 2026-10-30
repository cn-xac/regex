/**
 * theme —— 铁路图配色的**可注册 token 系统**（取代此前硬编码在 painter 的 LIGHT/DARK 两张表）。
 *
 * 为什么独立成一层（见仓 AGENTS.md「方向变更」要求 2 + 为「匹配步骤」预留的架构约束）：
 * - 配色不得再钉死在绘制代码里；至少提供 light / dark 两档内置，并留自定义扩展位。
 * - 几何参数（`DiagramMetrics`）与配色（`ThemePalette`）分离；步骤视图将来会自带
 *   「已匹配 / 回溯中 / 失败」三色，届时注册一个新 palette 即可，不必改 painter。
 * - `line` 按**连线语义**（主干 / 交替 / 贪婪回环 / 非贪婪回环 / 旁路 / 非贪婪旁路）分档，
 *   对标 Regulex 以「颜色 + 虚线」区分贪懒的做法；当前内置档先统一到主干色，
 *   观感对齐增量再逐档填 Regulex 实色。
 */
import type { BoxTone } from './layout';

/**
 * 单个盒子三要素 + 观感几何。对标 Regulex「填充圆角矩形无描边、文字叠上、按语义分半径」：
 * - `radius`：圆角半径（实测源码：`.` r10 / 反向引用 r8 / 组容器 r6 / 类成员与预定义类 r5）；
 * - `dash`：容器型盒子（透明填充 + 虚线描边，如捕获组 / 断言）的边框虚线，`null`=实线填充盒。
 * `#00000000` 表示透明；透明填充即视为容器（painter 据此走「描边」而非「填充」）。
 */
export interface BoxPaint {
  readonly stroke: string;
  readonly fill: string;
  readonly text: string;
  readonly radius: number;
  readonly dash: readonly number[] | null;
}

/** 连线的语义档位。回环/旁路按贪婪性拆分，非贪婪档带虚线。 */
export type LineKind = 'trunk' | 'choice' | 'loop' | 'loopLazy' | 'bypass' | 'bypassLazy';

export interface LinePaint {
  readonly stroke: string;
  readonly width: number;
  /** SVG `stroke-dasharray` / Canvas `setLineDash`；`null` 为实线。 */
  readonly dash: readonly number[] | null;
}

export interface ThemePalette {
  readonly name: string;
  readonly box: Readonly<Record<BoxTone, BoxPaint>>;
  readonly line: Readonly<Record<LineKind, LinePaint>>;
}

/** 内置主题名。自定义主题用任意字符串名（走注册表）。 */
export type SvgTheme = 'light' | 'dark';

const box = (
  stroke: string,
  fill: string,
  text: string,
  radius: number,
  dash: readonly number[] | null = null
): BoxPaint => Object.freeze({ stroke, fill, text, radius, dash });

/** 容器型（透明填充 + 虚线描边）边框虚线。 */
const CONTAINER_DASH: readonly number[] = [2, 3];

/** 连线档：stroke 色 + 宽 2 + 可选虚线（对标 Regulex 轨道线宽与实/虚分贪懒）。 */
const line = (stroke: string, dash: readonly number[] | null = null): LinePaint =>
  Object.freeze({ stroke, width: 2, dash });

/**
 * 连线的六档配色。对标 Regulex「无箭头、以颜色 + 虚线区分贪懒」的做法：
 * - 回环：贪婪 maroon 实线 / 非贪婪 brown 虚线；
 * - 旁路（min=0）：#333 实线 / 非贪婪 darkgreen 虚线；
 * - 主干与交替分歧：近黑 #333（深色主题提亮）。
 * 深色主题用同族但更亮的等价色，保证在深底上仍是「轨道」而非隐入背景。
 */
function lines(
  trunk: string,
  greedyLoop: string,
  lazyLoop: string,
  bypassLazy: string
): Readonly<Record<LineKind, LinePaint>> {
  return Object.freeze({
    trunk: line(trunk),
    choice: line(trunk),
    loop: line(greedyLoop),
    loopLazy: line(lazyLoop, [4, 4]),
    bypass: line(trunk),
    bypassLazy: line(bypassLazy, [4, 4])
  });
}

export const LIGHT: ThemePalette = Object.freeze({
  name: 'light',
  box: Object.freeze({
    text: box('#00000000', '#eef2f7', '#0f172a', 6),
    dot: box('#00000000', '#c2e0c2', '#143414', 10),
    escape: box('#00000000', '#a3d0a3', '#123a1e', 5),
    characterClass: box('#00000000', '#c8b6f0', '#2d1660', 5),
    anchor: box('#00000000', '#f2d38a', '#5a3d05', 6),
    assertion: box('#2b8a3e', '#00000000', '#175c28', 6, CONTAINER_DASH),
    backreference: box('#00000000', '#86a7d6', '#10233f', 8),
    group: box('#1c63b5', '#00000000', '#123a63', 6, CONTAINER_DASH),
    choice: box('#94a3b8', '#00000000', '#0f172a', 6, CONTAINER_DASH),
    tagQuantifier: box('#00000000', '#00000000', '#b8860b', 0),
    tagGroupPrefix: box('#00000000', '#00000000', '#1c63b5', 0)
  }),
  line: lines('#333333', '#800000', '#a52a2a', '#006400')
});

export const DARK: ThemePalette = Object.freeze({
  name: 'dark',
  box: Object.freeze({
    text: box('#00000000', '#252c37', '#e6eaf0', 6),
    dot: box('#00000000', '#274d33', '#c6f5d0', 10),
    escape: box('#00000000', '#274d33', '#c6f5d0', 5),
    characterClass: box('#00000000', '#3a2c66', '#ddcdff', 5),
    anchor: box('#00000000', '#4a3d12', '#ffe9a8', 6),
    assertion: box('#69db7c', '#00000000', '#c6f5d0', 6, CONTAINER_DASH),
    backreference: box('#00000000', '#4d3a1a', '#ffd8b0', 8),
    group: box('#74c0fc', '#00000000', '#bfe0ff', 6, CONTAINER_DASH),
    choice: box('#64748b', '#00000000', '#e6eaf0', 6, CONTAINER_DASH),
    tagQuantifier: box('#00000000', '#00000000', '#ffd43b', 0),
    tagGroupPrefix: box('#00000000', '#00000000', '#74c0fc', 0)
  }),
  line: lines('#c9d1d9', '#e5534b', '#d3966f', '#6fbf73')
});

const registry = new Map<string, ThemePalette>();
registry.set(LIGHT.name, LIGHT);
registry.set(DARK.name, DARK);

/** 注册（或覆盖）一个命名主题，供后续 `renderSvg`/`renderCanvasOps` 按名消费。 */
export function registerTheme(palette: ThemePalette): void {
  registry.set(palette.name, palette);
}

/** 已注册主题名列表（只读快照）。 */
export function listThemes(): readonly string[] {
  return Object.freeze([...registry.keys()]);
}

/**
 * 解析主题名 → palette。未知名回退 `light`；`undefined` 亦回退 `light`。
 * 大小写不敏感，便于宿主直接透传 CSS `prefers-color-scheme` 之类字符串。
 */
export function resolveTheme(name?: string): ThemePalette {
  if (name === undefined) return LIGHT;
  const key = name.toLowerCase();
  return registry.get(key) ?? registry.get(name) ?? LIGHT;
}
