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
  /** 标注盒用较小字号；未设时 painter 用主体字号。 */
  readonly fontSize?: number;
  readonly depth: number;
}

export interface DiagramEdge {
  readonly id: string;
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

/**
 * 连线的语义色调。**留扩展位**而非枚举死：未来"匹配步骤"视图会给同一批 path
 * 上"已匹配 / 回溯中 / 失败"三色（见仓 AGENTS.md 架构约束）。当前 SVG/Canvas 按 tone
 * + `lazy` 从主题取线色与虚线（对标 Regulex 以颜色 + 虚线区分贪懒，无箭头）。
 */
export type PathTone = 'loop' | 'bypass' | 'choice';

/**
 * 一段**可圆角的折线路径**（回环 / min=0 旁路 / 交替分歧线）。
 *
 * 与 `DiagramEdge`（两点直线）的区别：一条 path 是 ≥2 个拐点组成的折线，painter 在
 * 每个内拐点按 `radius` 用二次贝塞尔倒圆，观感对标 Regulex 的圆角连线。**贪婪性由
 * `lazy` 表达**（对齐 Regulex：实线=贪婪、虚线=非贪婪，且非贪婪回环/旁路另取一色），
 * 不再画箭头。SVG 与 Canvas 共用同一几何与同一 `radius`。
 */
export interface DiagramPath {
  readonly id: string;
  /** 折线顶点序列（绝对坐标）。至少 2 点；相邻点不得重合。 */
  readonly points: readonly (readonly [number, number])[];
  /** 内拐点倒圆半径（px）。相邻段太短时 painter 会 clamp，不会自交。 */
  readonly radius: number;
  /** 非贪婪（lazy）标记：仅对 loop/bypass 有意义；choice 恒 false。 */
  readonly lazy: boolean;
  readonly tone: PathTone;
  readonly source?: SourceRange;
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
  /** 主体文字字号。 */
  readonly fontSize: number;
  /** 标注文字字号（次数、组编号）。**小一号**是有意的：中文标签按主体字号会宽到把序列撑开。 */
  readonly tagFontSize: number;
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
  readonly paths: readonly DiagramPath[];
}

export const DEFAULT_METRICS: DiagramMetrics = Object.freeze({
  charWidth: 9,
  lineHeight: 17,
  leafHeight: 28,
  padX: 9,
  padY: 9,
  gapX: 10,
  gapY: 14,
  minWidth: 26,
  fontSize: 13,
  tagFontSize: 11
});

/** 回环 / 旁路折线的内拐点倒圆半径（px）。**实测自 Regulex 可视化源码**：其圆角偏移量
 *  x=10，故取 10 精确对标；roundedPathD 仍会按相邻段长再 clamp，段短处收窄、不会自交。 */
const RAIL_RADIUS = 10;

interface Ctx {
  readonly m: DiagramMetrics;
  readonly locale: Locale;
}

interface Placed {
  boxes: DiagramBox[];
  edges: DiagramEdge[];
  paths: DiagramPath[];
  width: number;
  height: number;
  /** 主体**上方**已被标签/回环占用的高度，用于让嵌套的标注互相错开而不打架。 */
  above: number;
  /** 主体**下方**已占用的高度（`min === 0` 的旁路弧走下面）。 */
  below: number;
}

/** 只含主体盒、没有任何上方/下方标注的占位结果。 */
function bare(boxes: DiagramBox[], edges: DiagramEdge[], width: number, height: number): Placed {
  return { boxes, edges, paths: [], width, height, above: 0, below: 0 };
}

/**
 * 文字宽度估算。**必须区分 CJK 双宽**：早先一律按 charWidth 估，中文标签（如
 * 「0次以上·非贪婪」）被低估约 40%，文字直接溢出 viewBox 被裁掉尾部。
 * 这里按「码位 > U+2E7F 记 2 个单位」粗判宽字符，够排版用且无需测量 DOM。
 */
function textUnits(label: string): number {
  let units = 0;
  for (const ch of label) {
    const cp = ch.codePointAt(0) ?? 0;
    units += cp > 0x2e7f ? 2 : 1;
  }
  return units;
}

function leafWidth(label: string, m: DiagramMetrics): number {
  return Math.max(m.minWidth, textUnits(label) * m.charWidth + m.padX * 2);
}

/** 标注文字的等效宽度：按 tagFontSize 与主体字号的比例折算（小一号 → 更窄）。 */
function tagWidth(label: string, m: DiagramMetrics): number {
  return textUnits(label) * m.charWidth * (m.tagFontSize / m.fontSize);
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
  escaped?: string,
  fontSize?: number
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
    ...(escaped === undefined ? {} : { escaped }),
    ...(fontSize === undefined ? {} : { fontSize })
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
      const greedy = q?.greedy ?? true;
      const canSkip = (q?.min ?? 1) === 0;
      const m = ctx.m;
      const arcH = m.lineHeight + 4;
      const base = inner.above + 4; // 回环水平段的上沿（从 inner.above 起叠，避免与组标签同层）
      const topY = -(base + arcH);
      const boxes: DiagramBox[] = [...inner.boxes];
      const paths: DiagramPath[] = [...inner.paths];

      // 弧的起落点取**被包元素的外缘**，而不是主体内容的 0 线：量化一个分组时，组框
      // 为了让出 `#N` 标签行而向上扩到负 y，只有从框顶起落才是「弧包框」；反过来组内
      // 含量词时弧在框内、框在外 —— 谁包谁由嵌套关系自动决定，不需要特判。
      const frameTop = -inner.above;
      const frameBottom = inner.height + inner.below;
      // 弧必须**向外让开**：left/right 若正好等于组框左右边，回环与旁路就会和框边重合，
      // 看起来像框上又叠了一个框。
      const inset = 6;
      const left = -inset;
      const right = inner.width + inset;
      const slotWidth = inner.width + inset * 2;

      // 回环：一条折线包住被包元素，四个直角拐点交由 painter 倒圆。点序固定
      // [右框顶 → 右上 → 左上 → 左框顶]。**贪婪性用 lazy 表达**（对标 Regulex：实线 vs 虚线），
      // 不再画箭头。
      paths.push({
        id: `${idPath}.r`,
        points: [
          [right, frameTop],
          [right, topY],
          [left, topY],
          [left, frameTop]
        ],
        radius: RAIL_RADIUS,
        lazy: !greedy,
        tone: 'loop',
        source: { start: node.start, end: node.end }
      });

      let labelW = 0;
      if (label !== '') {
        labelW = tagWidth(label, m);
        // 居中于弧跨距；**允许左右溢出** —— 标签撑宽会把序列里的后续元素推老远
        // （`(a|b)*?c+` 里 c 曾被推走），占位宽度只由被包元素与弧 inset 决定。
        boxes.push(
          box(
            `${idPath}.q`,
            (slotWidth - labelW) / 2,
            topY - m.lineHeight,
            labelW,
            m.lineHeight,
            label,
            'tagQuantifier',
            depth,
            { start: node.start, end: node.end },
            q?.source,
            m.tagFontSize
          )
        );
      }

      let below = inner.below;
      if (canSkip) {
        // min === 0 的「可以整段跳过」走下方旁路，不与回环抢上方空间；起落点同样用框底。
        const skipDepth = inner.below + 4 + arcH;
        const sy = inner.height + skipDepth;
        // 旁路：左框底 → 下 → 右 → 上回右框底；同样以 lazy（虚线/非贪婪）表达，不画箭头。
        paths.push({
          id: `${idPath}.s`,
          points: [
            [left, frameBottom],
            [left, sy],
            [right, sy],
            [right, frameBottom]
          ],
          radius: RAIL_RADIUS,
          lazy: !greedy,
          tone: 'bypass',
          source: { start: node.start, end: node.end }
        });
        below = skipDepth;
      }

      return {
        boxes,
        edges: inner.edges,
        paths,
        // 占位宽只由被包元素 + 弧 inset 决定，**不含标签宽**（标签可溢出，见上注释）
        width: slotWidth,
        height: inner.height,
        above: base + arcH + (label === '' ? 0 : m.lineHeight),
        below
      };
    }
    case 'group': {
      const inner = place(node.children[0] as AstNode, `${idPath}.0`, depth + 1, ctx);
      const isAssertion = (node.group ?? 'capturing').startsWith('look');
      const padX = ctx.m.padX + 6;
      const padY = ctx.m.padY;
      const tagH = ctx.m.lineHeight;
      const tag = groupTag(node);
      const tagW = tagWidth(tag, ctx.m) + 4;
      // 标签行叠在 inner.above 之上：组内的回环弧占了一层，`#N` 必须再高一层才不会压上去。
      const tagBase = inner.above + 4;
      const containerY = -(tagBase + tagH + padY);
      const containerH = tagBase + tagH + padY + inner.height + padY + inner.below;
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
            { start: node.start, end: node.end },
            undefined,
            ctx.m.tagFontSize
          ),
          ...shift(inner.boxes, padX, 0)
        ],
        edges: [...shiftEdges(inner.edges, padX, 0)],
        paths: shiftPaths(inner.paths, padX, 0),
        width: inner.width + padX * 2,
        height: inner.height,
        above: tagBase + tagH + padY,
        below: inner.below + padY
      };
    }
    default: {
      const { label, tone, escaped } = leafLabel(node, ctx);
      const w = leafWidth(label, ctx.m);
      return bare(
        [
          box(idPath, 0, 0, w, ctx.m.leafHeight, label, tone, depth, {
            start: node.start,
            end: node.end
          }, escaped)
        ],
        [],
        w,
        ctx.m.leafHeight
      );
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
  const paths: DiagramPath[] = [];
  // 必须先量完所有子项再居中：边推进边抬高 height 会让越靠右的盒子基准越高。
  const height = placed.reduce((max, p) => Math.max(max, p.height), ctx.m.leafHeight);
  let x = 0;
  placed.forEach((p, i) => {
    const offsetY = Math.round((height - p.height) / 2);
    boxes.push(...shift(p.boxes, x, offsetY));
    edges.push(...shiftEdges(p.edges, x, offsetY));
    paths.push(...shiftPaths(p.paths, x, offsetY));
    if (i > 0) {
      edges.push({
        id: `${idPath}.c${i}`,
        from: { x: x - ctx.m.gapX, y: height / 2 },
        to: { x, y: offsetY + p.height / 2 }
      });
    }
    x += p.width + ctx.m.gapX;
  });
  const above = placed.reduce((max, p) => Math.max(max, p.above), 0);
  const below = placed.reduce((max, p) => Math.max(max, p.below), 0);
  return { boxes, edges, paths, width: Math.max(0, x - ctx.m.gapX), height, above, below };
}

function placeRun(text: string, start: number, end: number, id: string, depth: number, ctx: Ctx): Placed {
  const w = leafWidth(text, ctx.m);
  return bare(
    [box(id, 0, 0, w, ctx.m.leafHeight, text, 'text', depth, { start, end }, text)],
    [],
    w,
    ctx.m.leafHeight
  );
}

function placeChoice(node: AstNode, idPath: string, depth: number, ctx: Ctx): Placed {
  const m = ctx.m;
  const boxes: DiagramBox[] = [];
  const edges: DiagramEdge[] = [];
  const paths: DiagramPath[] = [];
  const branches = node.children.map((child, i) => place(child, `${idPath}.${i}`, depth, ctx));
  const width = branches.reduce((max, b) => Math.max(max, b.width), 0);
  // 每个分支按「上方标注 + 主体 + 下方旁路」占一个槽位，主体落在槽内 ——
  // 若只按主体高度堆叠，上一分支的下旁路会被下一分支的上方回环压住。
  const slotOf = (b: Placed): number => b.above + b.height + b.below;
  const totalSlots =
    branches.reduce((sum, b) => sum + slotOf(b), 0) + m.gapY * Math.max(0, branches.length - 1);

  const mids: number[] = [];
  let offset = 0;
  branches.forEach((branch) => {
    const bodyTop = offset + branch.above;
    boxes.push(...shift(branch.boxes, m.gapX, bodyTop));
    edges.push(...shiftEdges(branch.edges, m.gapX, bodyTop));
    paths.push(...shiftPaths(branch.paths, m.gapX, bodyTop));
    mids.push(bodyTop + branch.height / 2);
    offset = bodyTop + branch.height + branch.below + m.gapY;
  });

  const first = mids[0] ?? m.leafHeight / 2;
  const last = mids[mids.length - 1] ?? first;
  const spineY = (first + last) / 2; // 分歧/汇聚中线取首末主体中线的中点
  const rightEdge = width + m.gapX * 2;

  branches.forEach((branch, i) => {
    const midY = mids[i] ?? spineY;
    // 分歧线：从入口中线 (0, spineY) 斜插到分支中线 (gapX, midY)。两点即直线段（无拐点
    // 不产生圆角），归入 paths 体系，与回环/旁路共用同一套渲染。汇聚线同理镜像。
    // choice 无贪婪性语义，lazy 恒 false。
    paths.push({
      id: `${idPath}.in${i}`,
      points: [
        [0, spineY],
        [m.gapX, midY]
      ],
      radius: 0,
      lazy: false,
      tone: 'choice'
    });
    paths.push({
      id: `${idPath}.out${i}`,
      points: [
        [m.gapX + branch.width, midY],
        [rightEdge, spineY]
      ],
      radius: 0,
      lazy: false,
      tone: 'choice'
    });
  });

  return {
    boxes,
    edges,
    paths,
    width: rightEdge,
    height: Math.max(m.leafHeight, totalSlots),
    above: 0, // 上方标注已内化进 slot，外层不必再扩
    below: 0
  };
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

function shiftPaths(paths: readonly DiagramPath[], dx: number, dy: number): DiagramPath[] {
  return paths.map((p) =>
    Object.freeze({
      ...p,
      points: Object.freeze(
        p.points.map((pt) => Object.freeze([pt[0] + dx, pt[1] + dy] as [number, number]))
      )
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
  // 圆角是**内缩**拐角，故折线顶点是路径的外接上界 —— 用顶点算 bbox 不会裁掉曲线。
  for (const p of placed.paths) {
    for (const [px, py] of p.points) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
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
    // shift/shiftEdges/shiftPaths 内已逐元素冻结，这里只冻结数组本身
    boxes: Object.freeze(shift(placed.boxes, m.padX - minX, m.padY - minY)),
    edges: Object.freeze(shiftEdges(placed.edges, m.padX - minX, m.padY - minY)),
    paths: Object.freeze(shiftPaths(placed.paths, m.padX - minX, m.padY - minY))
  });
}
