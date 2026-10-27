/**
 * highlights —— 把 MatchSession 摊平成视图可直接消费的区间列表。
 *
 * 为什么区间计算放 core 而不是各适配层各写一遍：排序稳定性、嵌套不被吞、零宽不被合并、
 * 越界防御，这几条全是纯逻辑且最容易出 bug 的地方，必须能离线单测。三个适配层各写一遍
 * 必然漂移，最后表现为"同一份 pattern 在 vue 里高亮对、在 react 里少一块"。
 *
 * 三条刻意的设计：
 * 1. **span 重叠是允许且必须保留的**（命名组天然嵌套）。扁平化会让 `\b(\d+)-(\d+)\b`
 *    这种 pattern 丢掉分组层级，所以只排序不合并；`depth` 把嵌套层数带出来，
 *    视图据此选层级配色而不是靠"看起来缩进了"。
 * 2. **零宽区间原样保留**（`start === end`），不参与任何合并 —— 它是真实匹配，
 *    合并掉就等于告诉用户"这里没匹配"。
 * 3. `mergeEqualRanges` **只合并 start/end 完全相同**的 span，不做任何"包含即合并"。
 */
import type { MatchSession } from './engine';
import type { SourceRange } from './types';

export type SpanKind = 'match' | 'group' | 'named-group';

export interface HighlightSpan extends SourceRange {
  readonly kind: SpanKind;
  /** 所属 match 的 ordinal。 */
  readonly ordinal: number;
  /** 捕获组序号；整段匹配为 0。 */
  readonly groupOrdinal: number;
  /** 命名组的组名。 */
  readonly label?: string;
  /** 同一 match 内的嵌套层数，0 为最外层。 */
  readonly depth: number;
}

export interface HighlightOptions {
  /** 是否输出捕获组区间，默认 true。 */
  readonly includeGroups?: boolean;
  /** 只输出有名字的组，默认 false。 */
  readonly namedOnly?: boolean;
  /** 合并 start/end 完全相同的 span，默认 false。 */
  readonly mergeEqualRanges?: boolean;
}

export interface PositionedSpan extends HighlightSpan {
  /** 1 起的行号。 */
  readonly line: number;
  /** 1 起的列号（UTF-16 code unit 计数）。 */
  readonly column: number;
}

const KIND_PRIORITY: Readonly<Record<SpanKind, number>> = Object.freeze({
  match: 0,
  group: 1,
  'named-group': 2
});

function compare(a: HighlightSpan, b: HighlightSpan): number {
  return (
    a.start - b.start ||
    KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
    a.depth - b.depth ||
    a.groupOrdinal - b.groupOrdinal ||
    a.end - b.end ||
    a.ordinal - b.ordinal
  );
}

/** 严格包含：outer 包住 inner 且更长（等长互包不算，避免零宽组互相加层）。 */
function strictlyContains(outer: SourceRange, inner: SourceRange): boolean {
  return (
    outer.start <= inner.start &&
    inner.end <= outer.end &&
    outer.end - outer.start > inner.end - inner.start
  );
}

/**
 * 算出每个组区间的嵌套深度：从最长的区间开始，数它被多少个更长的区间包住。
 * 组数量级很小（几十），这里的 O(n²) 比引入区间树的复杂度更划算。
 */
function assignDepths(spans: HighlightSpan[]): HighlightSpan[] {
  const byLength = [...spans].sort((a, b) => b.end - b.start - (a.end - a.start));
  const depth = new Map<HighlightSpan, number>();
  for (const span of byLength) {
    let level = 0;
    for (const other of byLength) {
      if (other === span) continue;
      if (strictlyContains(other, span)) level = Math.max(level, (depth.get(other) ?? 0) + 1);
    }
    depth.set(span, level);
  }
  return spans.map((s) => Object.freeze({ ...s, depth: depth.get(s) ?? 0 }));
}

/** 全量匹配 + 各捕获组 → 稳定排序的区间列表。session 非法时返回空数组。 */
export function computeHighlights(
  session: MatchSession,
  options: HighlightOptions = {}
): readonly HighlightSpan[] {
  if (!session.ok) return [];
  const includeGroups = options.includeGroups ?? true;
  const namedOnly = options.namedOnly ?? false;

  const out: HighlightSpan[] = [];
  for (const match of session.matches) {
    out.push(
      Object.freeze({
        kind: 'match' as SpanKind,
        start: match.range.start,
        end: match.range.end,
        ordinal: match.ordinal,
        groupOrdinal: 0,
        depth: 0
      })
    );
    if (!includeGroups) continue;

    const groups: HighlightSpan[] = [];
    for (const group of match.groups) {
      if (group.ordinal === 0) continue;
      // 未参与本次匹配的组没有区间，跳过而不是画一个 0 长的假框
      if (group.range === null) continue;
      if (namedOnly && group.name === undefined) continue;
      groups.push({
        kind: group.name === undefined ? 'group' : 'named-group',
        start: group.range.start,
        end: group.range.end,
        ordinal: match.ordinal,
        groupOrdinal: group.ordinal,
        ...(group.name === undefined ? {} : { label: group.name }),
        depth: 0
      });
    }
    out.push(...assignDepths(groups));
  }

  const sorted = out.sort(compare);
  if (options.mergeEqualRanges !== true) return Object.freeze(sorted);

  const merged: HighlightSpan[] = [];
  for (const span of sorted) {
    const prev = merged[merged.length - 1];
    if (
      prev !== undefined &&
      prev.kind === span.kind &&
      prev.start === span.start &&
      prev.end === span.end &&
      prev.label === span.label &&
      prev.depth === span.depth
    ) {
      continue;
    }
    merged.push(span);
  }
  return Object.freeze(merged);
}

/** 某个字符偏移上生效的所有区间（文本编辑器里做 hover / 点击定位用）。 */
export function spansAtOffset(
  spans: readonly HighlightSpan[],
  offset: number
): readonly HighlightSpan[] {
  return Object.freeze(
    spans.filter((s) => {
      if (s.start === s.end) return offset === s.start;
      return offset >= s.start && offset < s.end;
    })
  );
}

/** 渲染片段：一段连续文本 + 覆盖它的所有区间。视图按此线性铺 DOM，不必自己算边界。 */
export interface RenderChunk {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** 覆盖本片段的区间，按 depth 升序（视图取末位作主色，或用全部生成 data-* 索引）。 */
  readonly spans: readonly HighlightSpan[];
}

/**
 * 把 `text` 按所有 span 边界切成不重叠片段。
 *
 * 放 core 而不是让三个适配层各写一遍：边界收集、零宽附着、越界裁剪这几步一旦各写，
 * 就会出现「同一 pattern 在 vue 里高亮对、在 react 里少一块」。视图侧只负责把 chunk
 * 铺成节点，不再做任何区间运算。
 *
 * 不变量：`chunks.map(c => c.text).join('') === text`（不吞字符、不重复），测试钉住。
 */
export function toRenderChunks(
  text: string,
  spans: readonly HighlightSpan[]
): readonly RenderChunk[] {
  const bounds = new Set<number>([0, text.length]);
  for (const span of spans) {
    // 越界防御：视图传进来的 spans 可能来自另一份文本（用户刚编辑过）
    if (span.start >= 0 && span.start <= text.length) bounds.add(span.start);
    if (span.end >= 0 && span.end <= text.length) bounds.add(span.end);
  }
  const points = [...bounds].sort((a, b) => a - b);
  const out: RenderChunk[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i] as number;
    const end = points[i + 1] as number;
    if (end <= start) continue;
    const covering = spans
      .filter((s) => s.start < s.end && s.start <= start && end <= s.end)
      .sort((a, b) => a.depth - b.depth);
    // 零宽区间不产生片段，而是附着到它所在位置的片段上（否则用户看不到空匹配）
    const atPoint = spans.filter((s) => s.start === s.end && s.start === start);
    out.push(
      Object.freeze({
        text: text.slice(start, end),
        start,
        end,
        spans: Object.freeze([...covering, ...atPoint])
      })
    );
  }
  if (out.length === 0) {
    return Object.freeze([Object.freeze({ text: '', start: 0, end: 0, spans: Object.freeze([]) })]);
  }
  return Object.freeze(out);
}

/** 行起始偏移表。行终止符按 JS 的语义识别（含 \\r\\n 与 U+2028/U+2029）。 */
function lineStartsOf(text: string): number[] {
  const starts: number[] = [0];
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === '\r') {
      i += text.charAt(i + 1) === '\n' ? 2 : 1;
      starts.push(i);
      continue;
    }
    if (ch === '\n' || ch === '\u2028' || ch === '\u2029') {
      i += 1;
      starts.push(i);
      continue;
    }
    i += 1;
  }
  return starts;
}

/**
 * 把区间的字符偏移换算成行列，供「第 3 行第 12 列」这类展示与诊断定位。
 * 行、列都从 1 起，列按 UTF-16 code unit 计（与全仓索引基一致）。
 */
export function toLineColumns(
  text: string,
  spans: readonly HighlightSpan[]
): readonly PositionedSpan[] {
  const starts = lineStartsOf(text);
  const locate = (offset: number): { line: number; column: number } => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
  };
  return Object.freeze(
    spans.map((span) => {
      const at = locate(span.start);
      return Object.freeze({ ...span, line: at.line, column: at.column });
    })
  );
}
