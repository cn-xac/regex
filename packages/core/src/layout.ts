/**
 * layout —— AST → DOM-free 几何（铁路图）。
 *
 * 为什么单独一层：SVG 后端要产出标记字符串、Canvas 后端要产出指令序列，如果各自算坐标
 * 必然漂移。这里一次性把 AST 摊平成「盒子 + 连线」的纯数据，painter 只照着描。
 *
 * 五条排版规则（来自使用者对预览图的反馈，每条都有对应不变量测试）：
 * 1. **连续字面量合并成一个盒子** —— 逐字符拆盒会让 `a|bb|ccc` 的三个分支看起来是
 *    1/2/3 个独立元素，读不出"这是一段文本"。
 * 2. **字符类别走本地化语义** —— 中文下 `\d` 显示「数字」、`.` 显示「任意字符」。
 * 3. **次数标识跟在内容后面**（不再悬浮在上方），并用「一次以上 / 0次以上」这类说法。
 * 4. **分组框上方标 `#1` `#2`**；非捕获组与零宽断言**不标编号**（它们不产生捕获序号，
 *    标了会误导用户去数 group）。
 * 5. **内容与框之间留白，且主体在内容区垂直居中**；标签与量化后缀都不参与垂直分配，
 *    否则同一条序列里的元素会互相错位。
 */
import { quantifierLabel, tokenLabel } from './i18n';
import type { Locale } from './i18n';
import type { AstNode } from './parser';
import type { SourceRange } from './types';

export type BoxTone =
  | 'text'
  | 'characterClass'
  | 'escape'
  | 'anchor'
  | 'assertion'
  | 'backreference'
  | 'dot'
  | 'group'
  | 'choice'
  | 'tagQuantifier'
  | 'tagGroupPrefix';

export interface DiagramBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly label: string;
  readonly tone: BoxTone;
  readonly source?: SourceRange;
  /** 原始转义写法（如 `\d`）：图上显示本地化语义，可逆信息由视图挂到 data-* 上。 */
  readonly escaped?: string;
  readonly depth: number;
}

export interface DiagramEdge {
  readonly id: string;
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

export interface DiagramMetrics {
  readonly charWidth: number;
  readonly lineHeight: number;
  readonly leafHeight: number;
  readonly padX: number;
  readonly padY: number;
  readonly gapX: number;
  readonly gapY: number;
  readonly minWidth: number;
}

export interface LayoutOptions {
  readonly metrics?: Partial<DiagramMetrics>;
  /** 图上文字的语言（默认与界面一致由调用方决定，这里不读 navigator）。 */
  readonly locale?: Locale;
}

export interface Diagram {
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly DiagramBox[];
  readonly edges: readonly DiagramEdge[];
}

export const DEFAULT_METRICS: DiagramMetrics = Object.freeze({
  charWidth: 9,
  lineHeight: 17,
  leafHeight: 28,
  padX: 9,
  padY: 9,
  gapX: 10,
  gapY: 14,
  minWidth: 26
});

interface Ctx {
  readonly m: DiagramMetrics;
  readonly locale: Locale;
}

interface Placed {
  boxes: DiagramBox[];
  edges: DiagramEdge[];
  width: number;
  height: number;
}

function leafWidth(label: string, m: DiagramMetrics): number {
  return Math.max(m.minWidth, label.length * m.charWidth + m.padX * 2);
}

/** 分组的框上标签：捕获组带 `#N`，非捕获与断言明确不带编号。 */
function groupTag(node: AstNode): string {
  const kind = node.group ?? 'capturing';
  switch (kind) {
    case 'capturing':
      return `#${node.ordinal ?? 0}`;
    case 'named':
      return `#${node.ordinal ?? 0} ${node.name ?? ''}`;
    case 'nonCapturing':
      return '(?:';
    case 'lookahead':
      return '(?=';
    case 'negativeLookahead':
      return '(?!';
    case 'lookbehind':
      return '(?<=';
    case 'negativeLookbehind':
      return '(?<!';
    default:
      return '(';
  }
}

function leafLabel(node: AstNode, ctx: Ctx): { label: string; tone: BoxTone; escaped?: string } {
  switch (node.kind) {
    case 'dot':
      return { label: tokenLabel(ctx.locale, '.') ?? '.', tone: 'dot', escaped: '.' };
    case 'characterClass':
      return {
        label: `[${node.negated === true ? '^' : ''}${node.classBody ?? ''}]`,
        tone: 'characterClass',
        escaped: `[${node.negated === true ? '^' : ''}${node.classBody ?? ''}]`
      };
    case 'escape': {
      const raw = node.text ?? '';
      const localized = tokenLabel(ctx.locale, raw);
      if (localized !== null) {
        return { label: localized, tone: 'escape', escaped: BS + raw };
      }
      return { label: BS + raw, tone: 'escape', escaped: BS + raw };
    }
    case 'backreference':
      return {
        label: node.name !== undefined ? `\\k<${node.name}>` : `\\${node.text ?? ''}`,
        tone: 'backreference'
      };
    case 'assertion': {
      const text = node.text ?? '';
      return { label: text === '^' || text === '$' ? text : BS + text, tone: 'anchor' };
    }
    default:
      return { label: node.text ?? '', tone: 'text' };
  }
}

const BS = String.fromCharCode(92);

function box(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  tone: BoxTone,
  depth: number,
  source?: SourceRange,
  escaped?: string
): DiagramBox {
  return Object.freeze({
    id,
    x,
    y,
    w,
    h,
    label,
    tone,
    depth,
    ...(source === undefined ? {} : { source }),
    ...(escaped === undefined ? {} : { escaped })
  });
}

function place(node: AstNode, idPath: string, depth: number, ctx: Ctx): Placed {
  switch (node.kind) {
    case 'alternative':
      return placeSequence(node, idPath, depth, ctx);
    case 'disjunction':
      return placeChoice(node, idPath, depth, ctx);
    case 'quantified': {
      const inner = place(node.children[0] as AstNode, `${idPath}.0`, depth, ctx);
      const q = node.quantifier;
      const label = q === undefined ? '' : quantifierLabel(ctx.locale, q);
      const tagW = leafWidth(label, ctx.m);
      const tagH = ctx.m.lineHeight;
      const gap = 4;
      const boxes: DiagramBox[] = [...inner.boxes];
      if (label !== '') {
        // 次数标识跟在内容后面，并与主体垂直对齐 —— 不占垂直分配，避免抬高基线。
        boxes.push(
          box(
            `${idPath}.q`,
            inner.width + gap,
            (inner.height - tagH) / 2,
            tagW,
            tagH,
            label,
            'tagQuantifier',
            depth,
            { start: node.start, end: node.end },
            q?.source
          )
        );
      }
      return {
        boxes,
        edges: inner.edges,
        width: inner.width + (label === '' ? 0 : gap + tagW),
        height: inner.height
      };
    }
    case 'group': {
      const inner = place(node.children[0] as AstNode, `${idPath}.0`, depth + 1, ctx);
      const isAssertion = (node.group ?? 'capturing').startsWith('look');
      const padX = ctx.m.padX + 6;
      const padY = ctx.m.padY;
      const tagH = ctx.m.lineHeight;
      const tag = groupTag(node);
      const tagW = leafWidth(tag, ctx.m);
      // 容器向上扩出「标签行 + 上留白」，主体仍留在 0..inner.height，
      // 于是它在去掉标签行后的内容区里天然垂直居中，且基线不受标签影响。
      const containerY = -(tagH + padY);
      const containerH = tagH + padY + inner.height + padY;
      return {
        boxes: [
          box(
            idPath,
            0,
            containerY,
            inner.width + padX * 2,
            containerH,
            '',
            isAssertion ? 'assertion' : 'group',
            depth,
            { start: node.start, end: node.end }
          ),
          box(
            `${idPath}.p`,
            padX,
            containerY + padY / 2,
            tagW,
            tagH,
            tag,
            'tagGroupPrefix',
            depth,
            { start: node.start, end: node.end }
          ),
          ...shift(inner.boxes, padX, 0)
        ],
        edges: [...shiftEdges(inner.edges, padX, 0)],
        width: inner.width + padX * 2,
        height: inner.height
      };
    }
    default: {
      const { label, tone, escaped } = leafLabel(node, ctx);
      const w = leafWidth(label, ctx.m);
      return {
        boxes: [
          box(idPath, 0, 0, w, ctx.m.leafHeight, label, tone, depth, {
            start: node.start,
            end: node.end
          }, escaped)
        ],
        edges: [],
        width: w,
        height: ctx.m.leafHeight
      };
    }
  }
}

type Item = { readonly kind: 'node'; readonly node: AstNode } | { readonly kind: 'run'; readonly text: string; readonly start: number; readonly end: number };

/**
 * 把同一 sequence 里**相邻且未被量化**的字面量折成一个 run。
 * 只折 literal：`\d\d` 折成「数字数字」并不可读，锚点/类/组也必须各自成框。
 */
function foldLiterals(children: readonly AstNode[]): Item[] {
  const items: Item[] = [];
  for (const child of children) {
    if (child.kind === 'literal') {
      const last = items[items.length - 1];
      if (last !== undefined && last.kind === 'run') {
        items[items.length - 1] = { kind: 'run', text: last.text + (child.text ?? ''), start: last.start, end: child.end };
        continue;
      }
      items.push({ kind: 'run', text: child.text ?? '', start: child.start, end: child.end });
      continue;
    }
    items.push({ kind: 'node', node: child });
  }
  return items;
}

function placeSequence(node: AstNode, idPath: string, depth: number, ctx: Ctx): Placed {
  const items = foldLiterals(node.children);
  const placed = items.map((item, i) =>
    item.kind === 'node'
      ? place(item.node, `${idPath}.${i}`, depth, ctx)
      : placeRun(item.text, item.start, item.end, `${idPath}.${i}`, depth, ctx)
  );

  const boxes: DiagramBox[] = [];
  const edges: DiagramEdge[] = [];
  // 必须先量完所有子项再居中：边推进边抬高 height 会让越靠右的盒子基准越高。
  const height = placed.reduce((max, p) => Math.max(max, p.height), ctx.m.leafHeight);
  let x = 0;
  placed.forEach((p, i) => {
    const offsetY = Math.round((height - p.height) / 2);
    boxes.push(...shift(p.boxes, x, offsetY));
    edges.push(...shiftEdges(p.edges, x, offsetY));
    if (i > 0) {
      edges.push({
        id: `${idPath}.c${i}`,
        from: { x: x - ctx.m.gapX, y: height / 2 },
        to: { x, y: offsetY + p.height / 2 }
      });
    }
    x += p.width + ctx.m.gapX;
  });
  return { boxes, edges, width: Math.max(0, x - ctx.m.gapX), height };
}

function placeRun(text: string, start: number, end: number, id: string, depth: number, ctx: Ctx): Placed {
  const w = leafWidth(text, ctx.m);
  return {
    boxes: [box(id, 0, 0, w, ctx.m.leafHeight, text, 'text', depth, { start, end }, text)],
    edges: [],
    width: w,
    height: ctx.m.leafHeight
  };
}

function placeChoice(node: AstNode, idPath: string, depth: number, ctx: Ctx): Placed {
  const m = ctx.m;
  const boxes: DiagramBox[] = [];
  const edges: DiagramEdge[] = [];
  const branches = node.children.map((child, i) => place(child, `${idPath}.${i}`, depth, ctx));
  const width = branches.reduce((max, b) => Math.max(max, b.width), 0);
  const totalHeight = branches.reduce((sum, b) => sum + b.height, 0) + m.gapY * Math.max(0, branches.length - 1);
  const spineY = totalHeight / 2;

  let y = 0;
  branches.forEach((branch, i) => {
    boxes.push(...shift(branch.boxes, m.gapX, y));
    edges.push(...shiftEdges(branch.edges, m.gapX, y));
    const midY = y + branch.height / 2;
    edges.push({ id: `${idPath}.in${i}`, from: { x: 0, y: spineY }, to: { x: m.gapX, y: midY } });
    edges.push({
      id: `${idPath}.out${i}`,
      from: { x: m.gapX + branch.width, y: midY },
      to: { x: width + m.gapX * 2, y: spineY }
    });
    y += branch.height + m.gapY;
  });

  return { boxes, edges, width: width + m.gapX * 2, height: Math.max(m.leafHeight, totalHeight) };
}

function shift(boxes: readonly DiagramBox[], dx: number, dy: number): DiagramBox[] {
  return boxes.map((b) => Object.freeze({ ...b, x: b.x + dx, y: b.y + dy }));
}

function shiftEdges(edges: readonly DiagramEdge[], dx: number, dy: number): DiagramEdge[] {
  return edges.map((e) =>
    Object.freeze({
      id: e.id,
      from: Object.freeze({ x: e.from.x + dx, y: e.from.y + dy }),
      to: Object.freeze({ x: e.to.x + dx, y: e.to.y + dy })
    })
  );
}

/**
 * 把 AST 布局成铁路图几何。纯函数、无 DOM、结果全冻结。
 * 输出的 boxes/edges 已是绝对坐标的扁平数组，视图一次遍历即可画完。
 */
export function layoutRailroad(ast: AstNode, options: LayoutOptions = {}): Diagram {
  const ctx: Ctx = {
    m: { ...DEFAULT_METRICS, ...options.metrics },
    locale: options.locale ?? 'zh-CN'
  };
  const m = ctx.m;
  const placed = place(ast, 'r', 0, ctx);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const b of placed.boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  for (const e of placed.edges) {
    minX = Math.min(minX, e.from.x, e.to.x);
    minY = Math.min(minY, e.from.y, e.to.y);
    maxX = Math.max(maxX, e.from.x, e.to.x);
    maxY = Math.max(maxY, e.from.y, e.to.y);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = m.minWidth;
    maxY = m.leafHeight;
  }
  const pad = m.padX + m.padY;

  return Object.freeze({
    width: Math.max(m.minWidth, maxX - minX + pad),
    height: Math.max(m.leafHeight, maxY - minY + pad),
    // shift/shiftEdges 内已逐元素冻结，这里只冻结数组本身
    boxes: Object.freeze(shift(placed.boxes, m.padX - minX, m.padY - minY)),
    edges: Object.freeze(shiftEdges(placed.edges, m.padX - minX, m.padY - minY))
  });
}
