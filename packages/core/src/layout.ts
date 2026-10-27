/**
 * layout —— AST → DOM-free 几何（铁路图）。
 *
 * 为什么单独一层：SVG 后端要产出标记字符串、Canvas 后端要产出绘制指令序列，如果各自
 * 去算坐标，两栈必然漂移。所以这里一次性把 AST 摊平成「盒子 + 连线」的纯数据，
 * painter 只负责照着描，不做任何布局判断。
 *
 * 三条约束：
 * - **确定性**：同输入必得同输出，id 走路径编码（`'0.2.1'`）而不是自增计数器，
 *   否则两次布局的 id 不同会让测试与前端缓存都失稳；
 * - **不重叠**：sequence 内 x 严格递增、choice 内 y 严格递增，由测试钉住；
 * - **等宽假设**：pattern 用等宽字体排版（core 的 style.css 已把 `.x-ac-regex-mono`
 *   设为等宽），所以宽度按字符数估算即可，不需要测量文本。
 */
import type { AstNode } from './parser';
import type { SourceRange } from './types';

export type BoxTone =
  | 'literal'
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
  /** 容器盒没有对应片段；叶子盒带上它，供视图反查。 */
  readonly source?: SourceRange;
  /** 嵌套深度，视图用它决定层级配色（不只靠颜色区分）。 */
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

export interface Diagram {
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly DiagramBox[];
  readonly edges: readonly DiagramEdge[];
}

export const DEFAULT_METRICS: DiagramMetrics = Object.freeze({
  charWidth: 9,
  lineHeight: 18,
  leafHeight: 28,
  padX: 8,
  padY: 10,
  gapX: 10,
  gapY: 12,
  minWidth: 26
});

/** 内部可写结构，输出前统一冻结。 */
interface Placed {
  boxes: DiagramBox[];
  edges: DiagramEdge[];
  width: number;
  height: number;
}

function leafWidth(label: string, m: DiagramMetrics): number {
  return Math.max(m.minWidth, label.length * m.charWidth + m.padX * 2);
}

function leafLabel(node: AstNode): { label: string; tone: BoxTone } {
  switch (node.kind) {
    case 'literal':
      return { label: node.text ?? '', tone: 'literal' };
    case 'dot':
      return { label: '.', tone: 'dot' };
    case 'characterClass':
      return { label: `[${node.negated === true ? '^' : ''}${node.classBody ?? ''}]`, tone: 'characterClass' };
    case 'escape':
      return { label: `\\${node.text ?? ''}`, tone: 'escape' };
    case 'backreference':
      return {
        label: node.name !== undefined ? `\\k<${node.name}>` : `\\${node.text ?? ''}`,
        tone: 'backreference'
      };
    case 'assertion':
      return {
        label: node.text === '^' || node.text === '$' ? node.text : `\\${node.text ?? ''}`,
        tone: 'anchor'
      };
    case 'group': {
      const kind = node.group ?? 'capturing';
      if (kind.startsWith('look')) {
        return { label: groupTag(kind), tone: 'assertion' };
      }
      return { label: groupTag(kind), tone: 'group' };
    }
    default:
      return { label: '', tone: 'literal' };
  }
}

function groupTag(kind: string): string {
  switch (kind) {
    case 'nonCapturing':
      return '(?:';
    case 'named':
      return '(?<';
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

function place(node: AstNode, idPath: string, depth: number, m: DiagramMetrics): Placed {
  switch (node.kind) {
    case 'alternative':
      return placeSequence(node, idPath, depth, m);
    case 'disjunction':
      return placeChoice(node, idPath, depth, m);
    case 'quantified': {
      const inner = place(node.children[0] as AstNode, `${idPath}.0`, depth, m);
      const tag = node.quantifier?.source ?? '';
      const tagW = leafWidth(tag, m);
      const boxes: DiagramBox[] = [
        ...inner.boxes,
        {
          id: `${idPath}.q`,
          x: inner.width - tagW,
          y: -m.leafHeight - 2,
          w: tagW,
          h: m.leafHeight * 0.7,
          label: tag,
          tone: 'tagQuantifier',
          source: { start: node.start, end: node.end },
          depth
        }
      ];
      // 量化对象上方留出标签空间
      const top = -m.leafHeight - 2 - m.padY;
      return {
        boxes,
        edges: inner.edges,
        width: Math.max(inner.width, tagW),
        height: inner.height - Math.min(top, 0)
      };
    }
    case 'group': {
      const inner = place(node.children[0] as AstNode, `${idPath}.0`, depth + 1, m);
      const kind = node.group ?? 'capturing';
      const isAssertion = kind.startsWith('look');
      const pad = m.padX + 6;
      const label =
        kind === 'named' ? `(?<${node.name ?? ''}>` : kind === 'capturing' ? `(${node.ordinal ?? ''})` : groupTag(kind);
      const innerTop = isAssertion ? 0 : m.lineHeight + m.padY;
      const boxes: DiagramBox[] = [
        {
          id: idPath,
          x: 0,
          y: 0,
          w: inner.width + pad * 2,
          h: innerTop + inner.height + m.padY,
          label: '',
          tone: isAssertion ? 'assertion' : 'group',
          source: { start: node.start, end: node.end },
          depth
        },
        {
          id: `${idPath}.p`,
          x: pad,
          y: m.padY / 2,
          w: leafWidth(label, m),
          h: m.lineHeight,
          label,
          tone: 'tagGroupPrefix',
          source: { start: node.start, end: node.end },
          depth
        },
        ...shift(inner.boxes, pad, innerTop)
      ];
      // group 的进出连线由外层 sequence 统一处理，这里只搬运内层边 ——
      // 不要在这里补占位边（曾有一条 from===to 的零长度线，纯噪音）。
      const edges: DiagramEdge[] = [...shiftEdges(inner.edges, pad, innerTop)];
      return { boxes, edges, width: inner.width + pad * 2, height: innerTop + inner.height + m.padY };
    }
    default: {
      const { label, tone } = leafLabel(node);
      const w = leafWidth(label, m);
      return {
        boxes: [
          {
            id: idPath,
            x: 0,
            y: 0,
            w,
            h: m.leafHeight,
            label,
            tone,
            source: { start: node.start, end: node.end },
            depth
          }
        ],
        edges: [],
        width: w,
        height: m.leafHeight
      };
    }
  }
}

function placeSequence(node: AstNode, idPath: string, depth: number, m: DiagramMetrics): Placed {
  const boxes: DiagramBox[] = [];
  const edges: DiagramEdge[] = [];
  let x = 0;
  let height = m.leafHeight;
  let prevBottomY = m.leafHeight / 2;

  node.children.forEach((child, i) => {
    const placed = place(child, `${idPath}.${i}`, depth, m);
    const offsetY = Math.round((height - placed.height) / 2);
    boxes.push(...shift(placed.boxes, x, offsetY));
    edges.push(...shiftEdges(placed.edges, x, offsetY));
    if (i > 0) {
      edges.push({
        id: `${idPath}.c${i}`,
        from: { x: x - m.gapX, y: prevBottomY },
        to: { x, y: offsetY + placed.height / 2 }
      });
    }
    x += placed.width + m.gapX;
    height = Math.max(height, placed.height);
    prevBottomY = offsetY + placed.height / 2;
  });

  return { boxes, edges, width: Math.max(0, x - m.gapX), height };
}

function placeChoice(node: AstNode, idPath: string, depth: number, m: DiagramMetrics): Placed {
  const boxes: DiagramBox[] = [];
  const edges: DiagramEdge[] = [];
  let width = 0;
  let y = 0;
  const branches = node.children.map((child, i) => place(child, `${idPath}.${i}`, depth, m));

  for (const branch of branches) width = Math.max(width, branch.width);

  branches.forEach((branch, i) => {
    const offsetY = y + Math.round((m.leafHeight - branch.height) / 2);
    boxes.push(...shift(branch.boxes, m.gapX, offsetY));
    edges.push(...shiftEdges(branch.edges, m.gapX, offsetY));
    const midY = offsetY + branch.height / 2;
    edges.push({ id: `${idPath}.in${i}`, from: { x: 0, y: m.leafHeight / 2 }, to: { x: m.gapX, y: midY } });
    edges.push({
      id: `${idPath}.out${i}`,
      from: { x: m.gapX + branch.width, y: midY },
      to: { x: width + m.gapX * 2, y: m.leafHeight / 2 }
    });
    y += branch.height + m.gapY;
  });

  return { boxes, edges, width: width + m.gapX * 2, height: Math.max(m.leafHeight, y - m.gapY) };
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
 *
 * 返回值里的 `boxes` 与 `edges` 是**已解算绝对坐标**的扁平数组，
 * 视图侧一次遍历即可画完，不需要再理解 AST 结构。
 */
export function layoutRailroad(ast: AstNode, metrics?: Partial<DiagramMetrics>): Diagram {
  const m: DiagramMetrics = { ...DEFAULT_METRICS, ...metrics };
  const placed = place(ast, 'r', 0, m);

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
  const ox = m.padX - minX;
  const oy = m.padY - minY;
  const pad = m.padX + m.padY;

  return Object.freeze({
    width: Math.max(m.minWidth, maxX - minX + pad),
    height: Math.max(m.leafHeight, maxY - minY + pad),
    // shift/shiftEdges 内部已逐元素冻结，这里只冻结数组本身
    // （再套一层 map(Object.freeze) 会把元素类型压成 Readonly<unknown>，丢类型）。
    boxes: Object.freeze(shift(placed.boxes, ox, oy)),
    edges: Object.freeze(shiftEdges(placed.edges, ox, oy))
  });
}
