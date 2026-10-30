/**
 * painter —— 几何 → **SVG 标记字符串** / **Canvas 指令序列**，两者都不碰 DOM。
 *
 * 为什么两个后端都要：
 * - SVG 可命中测试（点某个盒子反查它对应 pattern 的哪一段）、可复制、可另存为矢量图；
 * - Canvas 在大图和步数多时不回堆 DOM 节点，性能可控，且能直接 `toDataURL` 出 PNG。
 * 两者消费的是同一份 `Diagram` 几何，因此画出来的形状必然一致 —— 这是把它们放在
 * 同一层、而不是各写一遍布局的意义。
 *
 * 导出场景要留意：宿主页面的 CSS 不会跟着 `innerHTML` 走，所以 SVG 里**内联**了按 tone
 * 分配的颜色，同时保留 `class` 与 `data-*` 让宿主可选择性覆盖。
 */
import type { Diagram, DiagramBox, DiagramPath, BoxTone } from './layout';

export type SvgTheme = 'light' | 'dark';

export interface PaintOptions {
  readonly theme?: SvgTheme;
  readonly fontFamily?: string;
  readonly fontSize?: number;
}

interface Paint {
  readonly stroke: string;
  readonly fill: string;
  readonly text: string;
}

const LIGHT: Readonly<Record<BoxTone, Paint>> = Object.freeze({
  text: Object.freeze({ stroke: '#475569', fill: '#ffffff', text: '#0f172a' }),
  dot: Object.freeze({ stroke: '#475569', fill: '#e2e8f0', text: '#0f172a' }),
  escape: Object.freeze({ stroke: '#1c63b5', fill: '#e7f0fa', text: '#123a63' }),
  characterClass: Object.freeze({ stroke: '#6741d9', fill: '#f1e9fd', text: '#3d2580' }),
  anchor: Object.freeze({ stroke: '#b8860b', fill: '#fdf3d8', text: '#6b4e05' }),
  assertion: Object.freeze({ stroke: '#2b8a3e', fill: '#e6f5e9', text: '#175c28' }),
  backreference: Object.freeze({ stroke: '#c2410c', fill: '#fdeadd', text: '#7c2a08' }),
  group: Object.freeze({ stroke: '#1c63b5', fill: '#00000000', text: '#123a63' }),
  choice: Object.freeze({ stroke: '#94a3b8', fill: '#00000000', text: '#0f172a' }),
  tagQuantifier: Object.freeze({ stroke: '#00000000', fill: '#00000000', text: '#b8860b' }),
  tagGroupPrefix: Object.freeze({ stroke: '#00000000', fill: '#00000000', text: '#1c63b5' })
});

const DARK: Readonly<Record<BoxTone, Paint>> = Object.freeze({
  text: Object.freeze({ stroke: '#94a3b8', fill: '#1b2028', text: '#e6eaf0' }),
  dot: Object.freeze({ stroke: '#94a3b8', fill: '#252c37', text: '#e6eaf0' }),
  escape: Object.freeze({ stroke: '#74c0fc', fill: '#16283c', text: '#bfe0ff' }),
  characterClass: Object.freeze({ stroke: '#b197fc', fill: '#251a3d', text: '#ddcdff' }),
  anchor: Object.freeze({ stroke: '#ffd43b', fill: '#33290c', text: '#ffe9a8' }),
  assertion: Object.freeze({ stroke: '#69db7c', fill: '#12291a', text: '#c6f5d0' }),
  backreference: Object.freeze({ stroke: '#ffa94d', fill: '#341a08', text: '#ffd8b0' }),
  group: Object.freeze({ stroke: '#74c0fc', fill: '#00000000', text: '#bfe0ff' }),
  choice: Object.freeze({ stroke: '#64748b', fill: '#00000000', text: '#e6eaf0' }),
  tagQuantifier: Object.freeze({ stroke: '#00000000', fill: '#00000000', text: '#ffd43b' }),
  tagGroupPrefix: Object.freeze({ stroke: '#00000000', fill: '#00000000', text: '#74c0fc' })
});

const EDGE_COLOR: Readonly<Record<SvgTheme, string>> = Object.freeze({
  // 实测自 Regulex bundle：主干与回环用深灰近黑（#333）、线宽 2。浅色主题取近黑的 #333，
  // 深色主题相应提亮以保证在深背景上仍是「轨道」而非浅灰细线。
  light: '#333333',
  dark: '#c9d1d9'
});

/** 连线的统一粗细（px）。对标 Regulex 的轨道线宽。 */
const EDGE_WIDTH = 2;

const DEFAULT_FONT = "ui-monospace, SFMono-Regular, 'Cascadia Mono', Consolas, monospace";

/** 箭头三角形的边长（px）。 */
const ARROW_SIZE = 6;

function pt(v: readonly [number, number]): string {
  return `${round(v[0])} ${round(v[1])}`;
}

/**
 * 折线顶点 → **圆角 SVG path 的 `d` 字符串**。这是 SVG / Canvas 共用的圆角几何口径：
 * 每个内拐点按 `radius` 用二次贝塞尔倒圆，相邻段太短时把 `radius` clamp 到半段长
 * （否则贝塞尔控制点越过邻点、路径自交），共线拐点不产生曲线（退化为直线）。
 *
 * 点数退化约定：0 → `''`；1 → `M`；2 → `M L`（无拐点故无圆角）。
 */
export function roundedPathD(points: readonly (readonly [number, number])[], radius: number): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pt(points[0] as readonly [number, number])}`;
  if (n === 2) {
    return `M ${pt(points[0] as readonly [number, number])} L ${pt(points[1] as readonly [number, number])}`;
  }
  const parts: string[] = [`M ${pt(points[0] as readonly [number, number])}`];
  for (let i = 1; i < n - 1; i++) {
    const prev = points[i - 1] as readonly [number, number];
    const cur = points[i] as readonly [number, number];
    const next = points[i + 1] as readonly [number, number];
    const d1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const d2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    // 共线（叉积≈0）或退化段长（相邻点重合，d 为 0）→ 直接连到拐点，不画圆角。
    if (r <= 0 || Math.abs(cross) < 1e-6) {
      parts.push(`L ${pt(cur)}`);
      continue;
    }
    const a: readonly [number, number] = [
      cur[0] + (prev[0] - cur[0]) * (r / d1),
      cur[1] + (prev[1] - cur[1]) * (r / d1)
    ];
    const b: readonly [number, number] = [
      cur[0] + (next[0] - cur[0]) * (r / d2),
      cur[1] + (next[1] - cur[1]) * (r / d2)
    ];
    parts.push(`L ${pt(a)}`);
    parts.push(`Q ${pt(cur)} ${pt(b)}`);
  }
  parts.push(`L ${pt(points[n - 1] as readonly [number, number])}`);
  return parts.join(' ');
}

/**
 * path 的箭头落点与朝向角（弧度）。`'none'` 或点数不足返回 null。
 *
 * 朝向即流动方向：`'head'` 取末段方向、尖在末点；`'tail'` 取首段方向、尖在首点。
 * 回环用它区分贪婪性（head 落左端朝下接回入口 / tail 落右端朝上指离元素）。
 */
export function arrowHead(path: DiagramPath): { x: number; y: number; angle: number } | null {
  if (path.arrow === 'none') return null;
  const pts = path.points;
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1] as readonly [number, number];
  const secondLast = pts[pts.length - 2] as readonly [number, number];
  const first = pts[0] as readonly [number, number];
  const second = pts[1] as readonly [number, number];
  const tip = path.arrow === 'head' ? last : first;
  const from = path.arrow === 'head' ? secondLast : second;
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  if (dx === 0 && dy === 0) return null;
  return { x: tip[0], y: tip[1], angle: Math.atan2(dy, dx) };
}

/** 以 (x,y) 为尖、沿 angle 方向展开的实心三角的 SVG `d`（与 arrowHead 共用同一朝向）。 */
export function trianglePathD(x: number, y: number, angle: number, size = ARROW_SIZE): string {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const bx = x - ux * size;
  const by = y - uy * size;
  const px = -uy * (size / 2);
  const py = ux * (size / 2);
  return (
    `M ${round(x)} ${round(y)} ` +
    `L ${round(bx + px)} ${round(by + py)} ` +
    `L ${round(bx - px)} ${round(by - py)} Z`
  );
}

/** XML 文本转义。label 里必然出现 `<` `>` `&`（如 `(?<year>`），漏转义会直接产坏 XML。 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function palette(options: PaintOptions): Readonly<Record<BoxTone, Paint>> {
  return options.theme === 'dark' ? DARK : LIGHT;
}

/** 供两个后端共用的字号解析。 */
function fontSizeOf(options: PaintOptions): number {
  return options.fontSize ?? 13;
}

/** 标签类盒子不画框，只写字。 */
function isTagTone(tone: BoxTone): boolean {
  return tone === 'tagQuantifier' || tone === 'tagGroupPrefix';
}

/**
 * 铁路图 → SVG 标记字符串。
 *
 * 带 `role="img"` 与 `<title>`（无障碍：图形必须有可读替代），每个盒子带
 * `data-start` / `data-end` / `data-tone`，视图挂事件后即可做点击反查。
 */
export function renderSvg(diagram: Diagram, options: PaintOptions = {}): string {
  const colors = palette(options);
  const font = options.fontFamily ?? DEFAULT_FONT;
  const size = fontSizeOf(options);
  const edge = EDGE_COLOR[options.theme === 'dark' ? 'dark' : 'light'];

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${diagram.width}" height="${diagram.height}"`,
    ` viewBox="0 0 ${diagram.width} ${diagram.height}" role="img" class="x-ac-regex-diagram__svg"`,
    ` data-theme="${options.theme === 'dark' ? 'dark' : 'light'}">`,
    '<title>Regular expression railroad diagram</title>'
  ];

  parts.push('<g class="x-ac-regex-diagram__edges" stroke="' + edge + '" stroke-width="' + EDGE_WIDTH + '" fill="none">');
  for (const e of diagram.edges) {
    parts.push(
      `<line data-id="${escapeXml(e.id)}" x1="${round(e.from.x)}" y1="${round(e.from.y)}"` +
        ` x2="${round(e.to.x)}" y2="${round(e.to.y)}"/>`
    );
  }
  parts.push('</g>');

  // 圆角折线（回环 / 旁路 / 分歧线）与实心三角箭头。箭头单独 fill 连线色、无描边。
  parts.push('<g class="x-ac-regex-diagram__paths" stroke="' + edge + '" stroke-width="' + EDGE_WIDTH + '" fill="none">');
  for (const p of diagram.paths) {
    const d = roundedPathD(p.points, p.radius);
    // 非贪婪回环用虚线标识（对标 Regulex 以实线/虚线区分贪懒）；旁路与分歧线仍为实线。
    const dash = p.tone === 'loop' && p.arrow === 'tail';
    if (d !== '') {
      parts.push(
        `<path data-id="${escapeXml(p.id)}" data-tone="${p.tone}"` +
          (dash ? ' stroke-dasharray="5 4"' : '') +
          ` d="${d}"/>`
      );
    }
    const head = arrowHead(p);
    if (head !== null) {
      parts.push(
        `<path class="x-ac-regex-diagram__arrow" d="${trianglePathD(head.x, head.y, head.angle)}"` +
          ` fill="${edge}" stroke="none"/>`
      );
    }
  }
  parts.push('</g>');

  parts.push(`<g class="x-ac-regex-diagram__boxes" font-family="${escapeXml(font)}" font-size="${size}">`);
  for (const box of diagram.boxes) {
    const paint = colors[box.tone];
    const tag = isTagTone(box.tone);
    const attrs =
      (box.source === undefined ? '' : ` data-start="${box.source.start}" data-end="${box.source.end}"`) +
      // 图上显示的是本地化语义（如「数字」），原始写法用 data-escaped 保留可逆信息
      (box.escaped === undefined ? '' : ` data-escaped="${escapeXml(box.escaped)}"`);
    parts.push(
      `<g class="x-ac-regex-node x-ac-regex-node--${box.tone}" data-id="${escapeXml(box.id)}"` +
        ` data-tone="${box.tone}" data-depth="${box.depth}"${attrs}>`
    );
    if (!tag) {
      parts.push(
        `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.w)}" height="${round(box.h)}"` +
          ` rx="8" fill="${paint.fill}" stroke="${paint.stroke}"/>`
      );
    }
    if (box.label !== '') {
      // 垂直居中只做一次：交给 dominant-baseline，不再叠加半个字号的位移。
      // 标注盒用几何层带来的较小字号（字号属于排版决定，painter 不自行发明）。
      const fs = box.fontSize ?? size;
      parts.push(
        `<text x="${round(box.x + (tag ? 0 : 6))}" y="${round(box.y + box.h / 2)}"` +
          ` font-size="${fs}" dominant-baseline="central" text-anchor="start" fill="${paint.text}">` +
          `${escapeXml(box.label)}</text>`
      );
    }
    parts.push('</g>');
  }
  parts.push('</g></svg>');

  return parts.join('');
}

/** Canvas 指令。上层用 `applyCanvasOps` 或直接 switch 落到真实 ctx 上。 */
export type CanvasOp =
  | { readonly kind: 'setStroke'; readonly value: string }
  | { readonly kind: 'setFill'; readonly value: string }
  | { readonly kind: 'setLineWidth'; readonly value: number }
  | { readonly kind: 'setFont'; readonly value: string }
  | { readonly kind: 'setTextBaseline'; readonly value: string }
  | { readonly kind: 'strokeRect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: 'fillText'; readonly text: string; readonly x: number; readonly y: number }
  | { readonly kind: 'beginPath' }
  | { readonly kind: 'moveTo'; readonly x: number; readonly y: number }
  | { readonly kind: 'lineTo'; readonly x: number; readonly y: number }
  | {
      readonly kind: 'path';
      readonly points: readonly (readonly [number, number])[];
      readonly radius: number;
      readonly dash: boolean;
    }
  | { readonly kind: 'triangle'; readonly x: number; readonly y: number; readonly angle: number }
  | { readonly kind: 'stroke' };

/**
 * 铁路图 → Canvas 指令序列（DOM-free：这里不 import 也不引用任何 canvas 对象）。
 * 序列是线性的，正好对应 Canvas 的命令式 API，上层照着执行即可。
 */
export function renderCanvasOps(diagram: Diagram, options: PaintOptions = {}): readonly CanvasOp[] {
  const colors = palette(options);
  const font = options.fontFamily ?? DEFAULT_FONT;
  const size = fontSizeOf(options);
  const edge = EDGE_COLOR[options.theme === 'dark' ? 'dark' : 'light'];
  const ops: CanvasOp[] = [{ kind: 'setLineWidth', value: EDGE_WIDTH }];

  ops.push({ kind: 'setStroke', value: edge }, { kind: 'beginPath' });
  for (const e of diagram.edges) {
    ops.push({ kind: 'moveTo', x: round(e.from.x), y: round(e.from.y) });
    ops.push({ kind: 'lineTo', x: round(e.to.x), y: round(e.to.y) });
  }
  ops.push({ kind: 'stroke' });

  // 每条 path 单独成一条 beginPath…stroke（多条回环不能连成一团）。箭头是实心三角，单独 fill。
  for (const p of diagram.paths) {
    ops.push(
      { kind: 'setLineWidth', value: EDGE_WIDTH },
      { kind: 'setStroke', value: edge },
      { kind: 'beginPath' },
      { kind: 'path', points: p.points, radius: p.radius, dash: p.tone === 'loop' && p.arrow === 'tail' },
      { kind: 'stroke' }
    );
    const head = arrowHead(p);
    if (head !== null) {
      ops.push({ kind: 'setFill', value: edge }, { kind: 'triangle', x: head.x, y: head.y, angle: head.angle });
    }
  }

  ops.push(
    { kind: 'setFont', value: `${size}px ${font}` },
    // 与 SVG 后端同一套居中口径：由 baseline 负责，不叠加半个字号位移
    { kind: 'setTextBaseline', value: 'middle' }
  );
  for (const box of diagram.boxes) {
    const paint = colors[box.tone];
    const tag = isTagTone(box.tone);
    if (!tag) {
      ops.push({ kind: 'setFill', value: paint.fill }, { kind: 'setStroke', value: paint.stroke });
      ops.push({ kind: 'strokeRect', x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) });
    }
    if (box.label !== '') {
      // 字号随几何层给出的值下发，保证 Canvas 与 SVG 用同一套字号
      ops.push(
        { kind: 'setFont', value: `${box.fontSize ?? size}px ${font}` },
        { kind: 'setFill', value: paint.text }
      );
      ops.push({
        kind: 'fillText',
        text: box.label,
        x: round(box.x + (tag ? 0 : 6)),
        y: round(box.y + box.h / 2)
      });
    }
  }
  return Object.freeze(ops);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 把指令序列落到一个最小的 ctx 形状上（便于测试用假 ctx 记录调用）。 */
export interface PaintContext {
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  font: string;
  textBaseline: string;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  /** 画一条圆角折线（宿主用 arcTo / quadraticCurveTo 落地，radius 为内拐点倒圆半径；
   *  dash=true 时宿主应 setLineDash 画虚线，用于非贪婪回环）。 */
  path(points: readonly (readonly [number, number])[], radius: number, dash: boolean): void;
  /** 画一个实心三角（以 (x,y) 为尖、angle 为朝向，用于回环箭头）。 */
  triangle(x: number, y: number, angle: number): void;
  stroke(): void;
}

export function applyCanvasOps(ops: readonly CanvasOp[], ctx: PaintContext): void {
  for (const op of ops) {
    switch (op.kind) {
      case 'setStroke':
        ctx.strokeStyle = op.value;
        break;
      case 'setFill':
        ctx.fillStyle = op.value;
        break;
      case 'setLineWidth':
        ctx.lineWidth = op.value;
        break;
      case 'setFont':
        ctx.font = op.value;
        break;
      case 'setTextBaseline':
        ctx.textBaseline = op.value;
        break;
      case 'strokeRect':
        ctx.strokeRect(op.x, op.y, op.w, op.h);
        break;
      case 'fillText':
        ctx.fillText(op.text, op.x, op.y);
        break;
      case 'beginPath':
        ctx.beginPath();
        break;
      case 'moveTo':
        ctx.moveTo(op.x, op.y);
        break;
      case 'lineTo':
        ctx.lineTo(op.x, op.y);
        break;
      case 'path':
        ctx.path(op.points, op.radius, op.dash);
        break;
      case 'triangle':
        ctx.triangle(op.x, op.y, op.angle);
        break;
      case 'stroke':
        ctx.stroke();
        break;
    }
  }
}

export type { DiagramBox };
