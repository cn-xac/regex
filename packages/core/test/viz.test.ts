import { describe, expect, it } from 'vitest';

import { parsePattern, stringifyAst } from '../src/parser';
import type { AstNode } from '../src/parser';
import { DEFAULT_METRICS, layoutRailroad } from '../src/layout';
import type { BoxTone, Diagram, DiagramBox, DiagramPath } from '../src/layout';
import type { Locale } from '../src/i18n';
import { applyCanvasOps, escapeXml, lineKindOf, renderCanvasOps, renderSvg, roundedPathD } from '../src/painter';
import type { CanvasOp, PaintContext } from '../src/painter';

const PATTERNS: readonly string[] = [
  '',
  'a',
  'abc',
  '\\d{4}-\\d{2}-\\d{2}',
  '(?<year>\\d{4})-(\\d{2})',
  'a|b|c',
  '(a|b)*c',
  '[^a-z]',
  '(?=a)(?!b)(?<=c)(?<!d)a',
  'a+?b{2,}c??',
  '(a)(?:b)(?<n>c)\\1\\k<n>',
  '^\\w+\\s\\w+$',
  '[\\]]',
  '😀'
];

const TONES: readonly string[] = [
  'text',
  'characterClass',
  'escape',
  'anchor',
  'assertion',
  'backreference',
  'dot',
  'group',
  'nonCapturing',
  'choice',
  'tagQuantifier',
  'tagGroupPrefix'
];

function diagramFor(pattern: string): Diagram {
  const r = parsePattern(pattern);
  if (!r.ok) throw new Error(`测试前提不成立：${pattern}`);
  return layoutRailroad(r.ast);
}

function astFor(pattern: string): AstNode {
  const r = parsePattern(pattern);
  if (!r.ok) throw new Error(`测试前提不成立：${pattern}`);
  return r.ast;
}

function boxesOf(pattern: string, locale: Locale = 'zh-CN'): readonly DiagramBox[] {
  return layoutRailroad(astFor(pattern), { locale }).boxes;
}

/** 回环 / 旁路的贪懒性由 `lazy` 布尔表达（对标 Regulex：实线 vs 虚线，不再画箭头）。 */
const loopOf = (d: Diagram): DiagramPath | undefined => d.paths.find((p) => p.tone === 'loop');
const bypassesOf = (d: Diagram): readonly DiagramPath[] => d.paths.filter((p) => p.tone === 'bypass');
const choiceOf = (d: Diagram): readonly DiagramPath[] => d.paths.filter((p) => p.tone === 'choice');

describe('layout 不变量', () => {
  it('尺寸恒为正，且所有盒子与连线都落在画布内', () => {
    for (const pattern of PATTERNS) {
      const d = diagramFor(pattern);
      expect(d.width).toBeGreaterThan(0);
      expect(d.height).toBeGreaterThan(0);
      for (const box of d.boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.w).toBeGreaterThan(0);
        expect(box.h).toBeGreaterThan(0);
        expect(box.x + box.w).toBeLessThanOrEqual(d.width);
        expect(box.y + box.h).toBeLessThanOrEqual(d.height);
      }
      for (const edge of d.edges) {
        expect(edge.from.x).toBeGreaterThanOrEqual(0);
        expect(edge.to.x).toBeLessThanOrEqual(d.width);
        expect(edge.from.y).toBeGreaterThanOrEqual(0);
        expect(edge.to.y).toBeLessThanOrEqual(d.height);
      }
      // 圆角是内缩拐角，折线顶点是外接上界 → 顶点在画布内即整条曲线也在画布内。
      for (const path of d.paths) {
        for (const [x, y] of path.points) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(d.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(d.height);
        }
      }
      // 首尾锚点圆点整体（含半径）落在画布内；y 恒等于贯穿主轨 railY。
      for (const a of d.anchors) {
        expect(a.x - a.r).toBeGreaterThanOrEqual(0);
        expect(a.x + a.r).toBeLessThanOrEqual(d.width);
        expect(a.y - a.r).toBeGreaterThanOrEqual(0);
        expect(a.y + a.r).toBeLessThanOrEqual(d.height);
        expect(a.y).toBe(d.railY);
      }
    }
  });

  it('id 全局唯一（含容器、叶子与标签）', () => {
    for (const pattern of PATTERNS) {
      const ids = diagramFor(pattern).boxes.map((b) => b.id);
      expect(new Set(ids).size, `pattern=${pattern}`).toBe(ids.length);
    }
  });

  it('主轨连通：所有连线为水平线段，首尾恰有两枚锚点端口落在 railY 上', () => {
    for (const pattern of PATTERNS.filter((p) => p !== '')) {
      const d = diagramFor(pattern);
      expect(d.anchors, `pattern=${pattern}`).toHaveLength(2);
      expect(d.anchors[0]?.kind).toBe('start');
      expect(d.anchors[1]?.kind).toBe('end');
      expect(d.anchors[0]?.y).toBe(d.railY);
      expect(d.anchors[1]?.y).toBe(d.railY);
      for (const e of d.edges) {
        // 主干线一律水平（from.y===to.y）：贯穿主轨 + 相邻元素 gap 短线 + 各元素自带主线。
        // （分支内部叶子主线落在各自分支中心线，非全局 railY，故只断言水平，不强求同一 y。）
        expect(e.from.y, `pattern=${pattern} id=${e.id}`).toBe(e.to.y);
      }
    }
  });

  it('不产出退化边（from 与 to 同坐标的占位线是噪音）', () => {
    for (const pattern of PATTERNS) {
      for (const edge of diagramFor(pattern).edges) {
        const degenerate = edge.from.x === edge.to.x && edge.from.y === edge.to.y;
        expect(degenerate, `pattern=${pattern} id=${edge.id}`).toBe(false);
      }
    }
  });

  it('同输入两次布局结果完全一致（确定性）', () => {
    for (const pattern of PATTERNS) {
      expect(diagramFor(pattern)).toEqual(diagramFor(pattern));
    }
  });

  it('tone 只取受支持枚举，且结构被冻结', () => {
    for (const pattern of PATTERNS) {
      const d = diagramFor(pattern);
      expect(Object.isFrozen(d)).toBe(true);
      expect(Object.isFrozen(d.boxes)).toBe(true);
      for (const box of d.boxes) {
        expect(TONES).toContain(box.tone);
      }
    }
  });

  it('非空 pattern 必有盒子；空 pattern 布局为空图（无原子，属正确结果）', () => {
    expect(diagramFor('').boxes).toHaveLength(0);
    for (const pattern of PATTERNS) {
      if (pattern === '') continue;
      const d = diagramFor(pattern);
      expect(d.boxes.length, `pattern=${pattern}`).toBeGreaterThan(0);
      for (const box of d.boxes) {
        if (box.source === undefined) continue;
        expect(box.source.start).toBeGreaterThanOrEqual(0);
        expect(box.source.end).toBeLessThanOrEqual(pattern.length);
        expect(box.source.end).toBeGreaterThanOrEqual(box.source.start);
      }
    }
  });

  it('交替分支垂直堆叠、序列水平推进（几何与 AST 形态一致）', () => {
    const choice = diagramFor('aaaa|bbbbbb|cc');
    const ys = choice.boxes.filter((b) => b.tone === 'text').map((b) => b.y);
    expect(new Set(ys).size).toBeGreaterThan(1);

    const seq = diagramFor('abcdef');
    const xs = seq.boxes.filter((b) => b.tone === 'text').map((b) => b.x);
    const sorted = [...xs].sort((a, b) => a - b);
    expect(xs).toEqual(sorted);
  });

  /**
   * 垂直基线不变量：同一序列里的主体盒子必须共用一条水平中线。
   * 这条断言就是预览图「上下错位」的捕获者 —— 无论错因是逐步抬高 height，
   * 还是标签占了垂直分配空间，它都会红。
   */
  /** 使用者反馈 1：`a|bb|ccc` 不该把 bb / ccc 逐字符拆盒。 */
  it('连续字面量折成一个盒子', () => {
    const texts = boxesOf('a|bb|ccc').filter((b) => b.tone === 'text');
    expect(texts.map((b) => b.label).sort()).toEqual(['a', 'bb', 'ccc']);
    expect(texts.map((b) => b.source?.start)).toEqual([0, 2, 5]);
    // `ab+c`：a 与 c 被量化的 b 隔开，不得并成一个「ac」；
    // b 自己在 quantified 内部仍出一个 text 盒，所以顺序是 a、b、c。
    expect(boxesOf('ab+c').filter((b) => b.tone === 'text').map((b) => b.label)).toEqual(['a', 'b', 'c']);
  });

  /** 使用者反馈 2：`\d` `\w` `.` 在中文界面下要读出语义，原始写法另存字段。 */
  it('转义与点号按语言出语义标签，且保留原始写法', () => {
    const zh = boxesOf('\\d\\w.', 'zh-CN').filter((b) => b.tone === 'escape' || b.tone === 'dot');
    expect(zh.map((b) => b.label)).toEqual(['数字', '字母', '任意字符']);
    expect(zh.map((b) => b.escaped)).toEqual(['\\d', '\\w', '.']);
    const en = boxesOf('\\d\\w.', 'en').filter((b) => b.tone === 'escape' || b.tone === 'dot');
    expect(en.map((b) => b.label)).toEqual(['digit', 'letter', 'any char']);
    // 没有专门词条的转义必须退回原写法，不能被瞎猜翻译
    expect(boxesOf('\\s\\+', 'zh-CN').map((b) => b.label)).toEqual(['空白', '\\+']);
  });

  /** \b / \B 含义隐晦，图上给中文语义并保留原始写法可逆；^ $ 仍是符号。 */
  it('词边界 \\b/\\B 出语义标签，^ $ 保持符号', () => {
    const anchors = (p: string, locale: Locale = 'zh-CN') =>
      boxesOf(p, locale).filter((b) => b.tone === 'anchor');
    expect(anchors('\\b\\B').map((b) => b.label)).toEqual(['单词边界', '非单词边界']);
    expect(anchors('\\b\\B').map((b) => b.escaped)).toEqual(['\\b', '\\B']);
    expect(anchors('\\b', 'en').map((b) => b.label)).toEqual(['word boundary']);
    // ^ $ 不翻译
    expect(anchors('^$').map((b) => b.label)).toEqual(['^', '$']);
  });

  /** 使用者反馈 3：组框上方标 #N；非捕获与断言用通俗中文短语，裸符号存 escaped 保可逆。 */
  it('捕获组标 #N、命名组带名字，非捕获与断言出中文语义短语', () => {
    const tags = (p: string, locale: Locale = 'zh-CN') =>
      boxesOf(p, locale).filter((b) => b.tone === 'tagGroupPrefix');
    expect(tags('(?<year>a)').map((b) => b.label)).toEqual(['#1 year']);
    expect(tags('(a)(b)').map((b) => b.label)).toEqual(['#1', '#2']);
    expect(tags('(?<x>a)(b)(c)').map((b) => b.label)).toEqual(['#1 x', '#2', '#3']);
    const g = tags('(?:a)(?=b)(?<=c)(?!d)');
    expect(g.map((b) => b.label)).toEqual(['不捕获', '后面跟着', '前面是', '后面不跟']);
    // 裸符号仍可从 escaped 取回（悬停/反查用），语义标签不丢可逆信息
    expect(g.map((b) => b.escaped)).toEqual(['(?:', '(?=', '(?<=', '(?!']);
    // 英文走同一套短语（本地化，非硬编码中文）
    expect(tags('(?=x)(?<!y)', 'en').map((b) => b.label)).toEqual(['followed by', 'not preceded by']);
  });

  /** 使用者反馈：非捕获组「不是分组」→ 容器 tone 必须与捕获组、断言三者可辨。 */
  it('容器分三态：捕获=group、非捕获=nonCapturing、断言=assertion', () => {
    const tone = (p: string) =>
      boxesOf(p).find((b) => b.tone === 'group' || b.tone === 'nonCapturing' || b.tone === 'assertion')?.tone;
    expect(tone('(a)')).toBe('group');
    expect(tone('(?<n>a)')).toBe('group');
    expect(tone('(?:a)')).toBe('nonCapturing');
    expect(tone('(?=a)')).toBe('assertion');
    expect(tone('(?!a)')).toBe('assertion');
    expect(tone('(?<=a)')).toBe('assertion');
    expect(tone('(?<!a)')).toBe('assertion');
  });

  /** 使用者反馈 3 的另一半：次数与贪婪性由回环表达，不摆一行文字在屁股后面。 */
  it('次数与回环：弧包住主体、次数写在弧上、贪婪性由 lazy（实/虚线）区分', () => {
    const plus = diagramFor('a+');
    const body = plus.boxes.find((b) => b.label === 'a');
    const tag = plus.boxes.find((b) => b.tone === 'tagQuantifier');
    expect(tag?.label).toBe('一次以上');
    if (body === undefined || tag === undefined) throw new Error('缺主体或次数标签');
    // 次数标签落在主体上方的弧段附近，而不是右侧
    expect(tag.y + tag.h).toBeLessThanOrEqual(body.y + 1);
    expect(Math.abs(tag.x + tag.w / 2 - (body.x + body.w / 2))).toBeLessThan(body.w);
    // 回环折线跨过主体：顶部弧段在主体上方，两端的腿落在中心线（贯穿主轨）上、横向包住主体。
    const loop = loopOf(plus);
    if (loop === undefined) throw new Error('缺回环路径');
    expect(Math.min(...loop.points.map((pt) => pt[1]))).toBeLessThan(body.y); // 弧顶高于盒顶
    // 端点落在主体垂直中心线（railY）上，与贯穿主轨同一 y → 天然连通。
    expect(Math.max(...loop.points.map((pt) => pt[1]))).toBeCloseTo(body.y + body.h / 2, 0);
    expect(Math.min(...loop.points.map((pt) => pt[0]))).toBeLessThanOrEqual(body.x + 1);
    expect(Math.max(...loop.points.map((pt) => pt[0]))).toBeGreaterThanOrEqual(body.x + body.w - 1);
    // 贪婪性由 lazy 表达（对标 Regulex：无箭头，靠实线 vs 虚线区分）：贪婪 false、非贪婪 true。
    const lazy = loopOf(diagramFor('a+?'));
    if (lazy === undefined) throw new Error('缺非贪婪回环路径');
    expect(loop.lazy).toBe(false);
    expect(lazy.lazy).toBe(true);
    // 内拐点倒圆半径对标 Regulex 可视化源码实测值（圆角偏移 x=10）。
    expect(loop.radius).toBe(10);
    // 两栈线档映射：贪婪回环走 loop 实线、非贪婪走 loopLazy 虚线（painter 单测另覆盖取色）。
    expect(lineKindOf(loop.tone, loop.lazy)).toBe('loop');
    expect(lineKindOf(lazy.tone, lazy.lazy)).toBe('loopLazy');
    // 文案仍按说话法
    expect(tag.escaped).toBe('+');
    const labelOf = (p: string) => diagramFor(p).boxes.find((b) => b.tone === 'tagQuantifier')?.label;
    expect(labelOf('a*')).toBe('0次以上');
    expect(labelOf('a?')).toBe('0或1次');
    expect(labelOf('a{3}')).toBe('恰好3次');
    expect(labelOf('a{2,}')).toBe('2次以上');
    expect(labelOf('a{2,4}')).toBe('2到4次');
    expect(labelOf('a+?')).toBe('一次以上·非贪婪');
  });

  it('min 为 0 的量词在主体下方画出旁路弧（表示可整段跳过）', () => {
    const skip = diagramFor('a*');
    const body = skip.boxes.find((b) => b.label === 'a');
    const bypass = bypassesOf(skip);
    expect(bypass).toHaveLength(1);
    if (body === undefined) throw new Error('缺主体');
    const path = bypass[0] as DiagramPath;
    // 旁路的水平段落在主体下方；`a*` 是贪婪量词，旁路 lazy=false（实线）。
    expect(Math.max(...path.points.map((pt) => pt[1]))).toBeGreaterThan(body.y + body.h - 1);
    expect(path.lazy).toBe(false);
    expect(path.radius).toBe(10);
    // `+` 的 min 是 1，不该有旁路
    expect(bypassesOf(diagramFor('a+'))).toHaveLength(0);
  });

  /** 使用者反馈：量化一个分组时，回环与组框要互相包裹 —— 此时弧在外、框在内。 */
  it('量化分组时回环包住组框（竖直段从组框顶边起落，横向跨过整框）', () => {
    const d = diagramFor('(a|b)*?');
    const container = d.boxes.find((b) => b.tone === 'group');
    const loop = loopOf(d);
    const prefix = d.boxes.find((b) => b.tone === 'tagGroupPrefix');
    const qLabel = d.boxes.find((b) => b.tone === 'tagQuantifier');
    if (container === undefined || loop === undefined) throw new Error('缺组框或回环路径');
    if (prefix === undefined || qLabel === undefined) throw new Error('缺组标签或次数标签');
    const pts = loop.points;
    // **中心线（贯穿主轨）模型 + 圆弧汇入脚**：回环两腿落在 railY 上，弧顶高于组框顶，
    // 于是与贯穿主轨在同一 y 相接 → 连通。railY 上的顶点含「腿」(极值) 与内侧「脚」。
    const railPts = pts.filter((p) => p[1] === d.railY);
    const legL = Math.min(...railPts.map((p) => p[0]));
    const legR = Math.max(...railPts.map((p) => p[0]));
    expect(Math.min(...pts.map((p) => p[1]))).toBeLessThan(container.y); // 弧顶高于组框顶
    // 两腿在组框外缘之外（量化整组时回环横向跨过整框）。
    expect(legR).toBeGreaterThan(container.x + container.w - 0.01);
    expect(legL).toBeLessThan(container.x + 0.01);
    // 接触圆弧：每条腿内侧都存在落在 railY 上的「脚」顶点（硬直角 → 汇入弧的证据）。
    const innerFeet = railPts.filter((p) => p[0] > legL + 0.01 && p[0] < legR - 0.01);
    expect(innerFeet.length).toBeGreaterThanOrEqual(2);
    // 层位：次数标签（弧上）→ 组标签 → 组框顶，不重叠
    expect(qLabel.y + qLabel.h).toBeLessThanOrEqual(prefix.y);
    expect(prefix.y).toBeGreaterThanOrEqual(container.y);
  });

  /** 反过来的嵌套：组内含量词时，弧必须留在框内，不能外溢。 */
  it('组内含量词时回环留在框内，不外溢', () => {
    const d = diagramFor('(?<x>a+)');
    const container = d.boxes.find((b) => b.tone === 'group');
    if (container === undefined) throw new Error('缺组框');
    const arcs = d.paths.filter((p) => p.tone === 'loop');
    expect(arcs.length).toBeGreaterThan(0);
    for (const p of arcs) {
      for (const [x] of p.points) {
        expect(x).toBeGreaterThanOrEqual(container.x - 0.5);
        expect(x).toBeLessThanOrEqual(container.x + container.w + 0.5);
      }
    }
    // 框顶仍在弧之上（组标签占最外层）
    const prefix = d.boxes.find((b) => b.tone === 'tagGroupPrefix');
    const arcTop = Math.min(...arcs.flatMap((p) => p.points.map((pt) => pt[1])));
    expect(prefix !== undefined && prefix.y <= arcTop).toBe(true);
  });

  it('中文标签按双宽 + 小一号字计宽，且不撑开序列占位', () => {
    const tag = boxesOf('a+?').find((b) => b.tone === 'tagQuantifier');
    if (tag === undefined) throw new Error('缺次数标签');
    // 宽字符按双宽计（否则文字溢出被 viewBox 裁），再按较小字号折算（否则撑宽序列）
    expect(tag.fontSize).toBe(DEFAULT_METRICS.tagFontSize);
    expect(tag.fontSize).toBeLessThan(DEFAULT_METRICS.fontSize);
    const ratio = DEFAULT_METRICS.tagFontSize / DEFAULT_METRICS.fontSize;
    expect(tag.w).toBeGreaterThanOrEqual(14 * DEFAULT_METRICS.charWidth * ratio);
    expect(tag.x).toBeGreaterThanOrEqual(0);
    // 关键回归：标签不得把后续元素推远，序列间距只由元素本身与 gapX 决定
    const d = diagramFor('(a|b)*?c+');
    const group = d.boxes.find((b) => b.tone === 'group');
    const c = d.boxes.find((b) => b.label === 'c');
    if (group === undefined || c === undefined) throw new Error('缺组框或 c');
    expect(c.x - (group.x + group.w)).toBeLessThanOrEqual(DEFAULT_METRICS.gapX + 12);
    // 回环向外让开：竖直腿/弧（非 railY 上的顶点）必须跨在组框左右缘之外，不与框边重合
    // （否则像叠了第二个框）。圆弧汇入的「脚」是 railY 上的水平段，不构成压竖直框边，豁免。
    const arcs = d.paths.filter((p) => p.tone === 'loop');
    expect(arcs.length).toBeGreaterThan(0);
    expect(
      arcs.every(
        (p) =>
          p.points.every(
            ([x, y]) => y === d.railY || x <= group.x + 0.01 || x >= group.x + group.w - 0.01
          )
      )
    ).toBe(true);
    // 旁路 lazy 标注：a* 旁路 lazy=false（贪婪），a+ 无旁路
    const starBypass = bypassesOf(diagramFor('a*'))[0];
    expect(starBypass?.lazy).toBe(false);
    expect(bypassesOf(diagramFor('a+'))).toHaveLength(0);
  });

  /** 使用者反馈 4：内容与分组框之间留白，且内容在内容区垂直居中。 */
  it('组内容四周留白、左右对称，且不与标签重叠', () => {
    const boxes = boxesOf('(?<x>ab)');
    const container = boxes.find((b) => b.tone === 'group');
    const inner = boxes.find((b) => b.tone === 'text');
    const tag = boxes.find((b) => b.tone === 'tagGroupPrefix');
    expect(container !== undefined && inner !== undefined && tag !== undefined).toBe(true);
    if (container === undefined || inner === undefined || tag === undefined) return;
    const leftGap = inner.x - container.x;
    const rightGap = container.x + container.w - (inner.x + inner.w);
    const bottomGap = container.y + container.h - (inner.y + inner.h);
    expect(leftGap).toBe(rightGap);
    expect(leftGap).toBeGreaterThan(0);
    expect(bottomGap).toBeGreaterThan(0);
    // 内容与组标签之间也要有间隙，不能压在标签上
    expect(inner.y).toBeGreaterThan(tag.y + tag.h);
  });

  it('同一序列内的主体盒子垂直中心一致（基线对齐）', () => {
    const LEAF: readonly string[] = ['text', 'escape', 'dot', 'characterClass', 'backreference', 'anchor'];
    for (const pattern of ['abcdef', '\\d+abc', 'a(b)c', '(?<x>a)b', '[a-z]+\\d', '(a)(b)(c)']) {
      const centers = new Set(
        diagramFor(pattern)
          .boxes.filter((b) => LEAF.includes(b.tone))
          .map((b) => Math.round((b.y + b.h / 2) * 100) / 100)
      );
      expect([...centers], `pattern=${pattern} 主体中心分散`).toHaveLength(1);
    }
  });

  it('交替的入口与出口汇聚在同一条水平中线上', () => {
    for (const pattern of ['a|bb|ccc', '(?:x|y)+']) {
      const d = diagramFor(pattern);
      const spineYs = choiceOf(d)
        .map((p) => (p.id.includes('.in') ? p.points[0]?.[1] : p.points[p.points.length - 1]?.[1]))
        .filter((y): y is number => y !== undefined);
      expect(spineYs.length).toBeGreaterThan(0);
      expect(new Set(spineYs).size, `pattern=${pattern}`).toBe(1);
    }
  });

  it('量词与组前缀标签悬浮在主体上方，不压低主体基线', () => {
    const bare = diagramFor('ab');
    const quantified = diagramFor('a+b');
    const center = (d: Diagram, label: string): number => {
      const box = d.boxes.find((b) => b.label === label);
      return box === undefined ? Number.NaN : Math.round((box.y + box.h / 2) * 100) / 100;
    };
    // 回环需要画布空间，图会变高；不变量是**主体中心仍对齐**（上一条已测），
    // 而不是图总高不变 —— 弧与组标签都画在主体上方，不参与主体的垂直分配。
    expect(quantified.height).toBeGreaterThan(bare.height);
    expect(center(quantified, 'a')).toBe(center(quantified, 'b'));
    expect(center(bare, 'a')).toBe(center(bare, 'b'));
    // 次数标签落在主体上方；而组标签必须再高一层，否则会和组内元素的回环弧叠在一起
    const tag = quantified.boxes.find((b) => b.tone === 'tagQuantifier');
    const body = quantified.boxes.find((b) => b.label === 'a');
    if (tag === undefined || body === undefined) throw new Error('缺次数标签或主体');
    expect(tag.y + tag.h).toBeLessThanOrEqual(body.y + 1);
    const nested = boxesOf('(?<x>a+)');
    const prefix = nested.find((b) => b.tone === 'tagGroupPrefix');
    const innerTag = nested.find((b) => b.tone === 'tagQuantifier');
    const innerBody = nested.find((b) => b.label === 'a');
    if (prefix === undefined || innerTag === undefined || innerBody === undefined) throw new Error('缺组标签/内层标签/主体');
    // 核心不变量「不压低主体基线」：组标签与内层次数标签都悬浮在主体上方，主体中心仍在 railY。
    expect(prefix.y + prefix.h).toBeLessThanOrEqual(innerBody.y + 1);
    expect(innerTag.y + innerTag.h).toBeLessThanOrEqual(innerBody.y + 1);
    expect(innerBody.y + innerBody.h / 2).toBe(diagramFor('(?<x>a+)').railY);
  });

  it('量词与组前缀各自产出标签盒', () => {
    const d = diagramFor('\\d{2,}');
    expect(d.boxes.some((b) => b.tone === 'tagQuantifier' && b.label === '2次以上')).toBe(true);
    const g = diagramFor('(?<year>\\d{4})');
    expect(g.boxes.some((b) => b.tone === 'tagGroupPrefix' && b.label === '#1 year')).toBe(true);
  });

  it('metrics 可调且默认值冻结', () => {
    expect(Object.isFrozen(DEFAULT_METRICS)).toBe(true);
    const wide = layoutRailroad(astFor('abc'), { metrics: { charWidth: 20 } });
    const narrow = layoutRailroad(astFor('abc'));
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  /**
   * 回归不变量（使用者反馈：分组和次数标签有重叠）：任意 pattern 下，组前缀标签盒
   * 与次数量词标签盒都不得矩形交叠。根因是 `placeSequence` 曾把 `above` 报成中心线
   * 高度而非内容盒上方净空，使外层分组按不足的 above 摆放组标签、压在内层量化标签上。
   */
  it('组前缀标签与次数标签永不交叠', () => {
    const hit = (a: DiagramBox, b: DiagramBox): boolean =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const nested = ['(a+)', '(a+)+', '(?<n>a+)+', '(?<t>a*)+', 'a+', 'a+b', '(a|b)+', '(?<x>a)?', 'ab+c'];
    for (const pattern of nested) {
      const boxes = diagramFor(pattern).boxes;
      const prefixes = boxes.filter((b) => b.tone === 'tagGroupPrefix');
      const quants = boxes.filter((b) => b.tone === 'tagQuantifier');
      for (const p of prefixes) {
        for (const q of quants) {
          expect(hit(p, q), `pattern=${pattern} "${p.label}" 压 "${q.label}"`).toBe(false);
        }
      }
    }
  });
});

describe('SVG painter', () => {
  it('产出合法 SVG 骨架，且不含 undefined / NaN', () => {
    for (const pattern of PATTERNS) {
      const svg = renderSvg(diagramFor(pattern));
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).toContain('role="img"');
      expect(svg).toContain('<title>');
      expect(svg).not.toContain('undefined');
      expect(svg).not.toContain('NaN');
    }
  });

  it('label 里的尖括号必须转义（反向引用写法必然带 <>）', () => {
    const svg = renderSvg(diagramFor('(?<x>a)\\k<x>'));
    expect(svg).toContain('\\k&lt;x&gt;');
    expect(svg).not.toContain('\\k<x>');
    expect(escapeXml('<&">')).toBe('&lt;&amp;&quot;&gt;');
  });

  it('叶子节点带 data-start/data-end，供点击反查源片段', () => {
    const svg = renderSvg(diagramFor('a|b'));
    expect(svg).toMatch(/data-start="\d+" data-end="\d+"/);
  });

  it('SVG 文本落在盒子中心并交给 dominant-baseline，不叠加半个字号位移', () => {
    const d = diagramFor('abc');
    const svg = renderSvg(d, { fontSize: 20 });
    expect(svg).toContain('dominant-baseline="central"');
    for (const box of d.boxes.filter((b) => b.label !== '')) {
      const center = Math.round((box.y + box.h / 2) * 100) / 100;
      expect(svg).toContain(`y="${center}"`);
    }
  });

  it('两次渲染字符串完全相同，且深浅色版不同', () => {
    const d = diagramFor('\\d+');
    expect(renderSvg(d)).toBe(renderSvg(d));
    expect(renderSvg(d, { theme: 'dark' })).not.toBe(renderSvg(d, { theme: 'light' }));
  });
});

describe('Canvas painter', () => {
  const ALLOWED: readonly string[] = [
    'setStroke',
    'setFill',
    'setLineWidth',
    'setFont',
    'setTextBaseline',
    'setTextAlign',
    'setLineDash',
    'rect',
    'circle',
    'fill',
    'fillText',
    'beginPath',
    'moveTo',
    'lineTo',
    'path',
    'stroke'
  ];

  it('指令 kind 全在白名单内，且不含 NaN 坐标', () => {
    for (const pattern of PATTERNS) {
      const ops = renderCanvasOps(diagramFor(pattern));
      expect(ops.length).toBeGreaterThan(0);
      for (const op of ops as readonly (CanvasOp & Record<string, unknown>)[]) {
        expect(ALLOWED, `未知指令 ${op.kind}`).toContain(op.kind);
        for (const key of ['x', 'y', 'w', 'h']) {
          const value = op[key];
          if (typeof value === 'number') {
            expect(Number.isFinite(value), `${op.kind}.${key}`).toBe(true);
          }
        }
      }
    }
  });

  it('applyCanvasOps 落到假 ctx 上调用次数与指令一致，且文本不丢失', () => {
    const d = diagramFor('(?<x>a)[b-z]');
    const calls: string[] = [];
    const labels: string[] = [];
    const ctx: PaintContext = {
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
      font: '',
      textBaseline: '',
      textAlign: '',
      rect: () => calls.push('rect'),
      circle: () => calls.push('circle'),
      fill: () => calls.push('fill'),
      setLineDash: () => calls.push('setLineDash'),
      fillText: (text) => {
        calls.push('fillText');
        labels.push(text);
      },
      beginPath: () => calls.push('beginPath'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      path: () => calls.push('path'),
      stroke: () => calls.push('stroke')
    };
    const ops = renderCanvasOps(d);
    applyCanvasOps(ops, ctx);
    // setStroke / setFill / setLineWidth / setFont / setTextBaseline / setTextAlign 只做属性赋值，不产生方法调用
    const DRAW: readonly string[] = ['rect', 'circle', 'fill', 'setLineDash', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'path', 'stroke'];
    expect(calls).toHaveLength(ops.filter((o) => DRAW.includes(o.kind)).length);
    const expected = d.boxes.filter((b) => b.label !== '').map((b) => b.label);
    expect(labels.sort()).toEqual([...expected].sort());
    // 分组前缀与字符类内容必须真的被画出来
    expect(labels.some((l) => l.includes('#1 x'))).toBe(true);
    expect(labels.some((l) => l.includes('[b-z]'))).toBe(true);
  });

  it('SVG 与 Canvas 消费同一份几何（盒子数一致）', () => {
    const d = diagramFor('(a|b)+c');
    const svg = renderSvg(d);
    const ops = renderCanvasOps(d);
    expect((svg.match(/<g class="x-ac-regex-node/g) ?? []).length).toBe(d.boxes.length);
    expect(ops.filter((o) => o.kind === 'fillText')).toHaveLength(
      d.boxes.filter((b) => b.label !== '').length
    );
  });
});

describe('圆角几何（roundedPathD / 线档映射）', () => {
  it('点数退化：0 点空串、1 点 M、2 点 M L 且无 Q', () => {
    expect(roundedPathD([], 4)).toBe('');
    expect(roundedPathD([[1, 2]], 4)).toBe('M 1 2');
    expect(roundedPathD([[1, 2], [30, 2]], 4)).toBe('M 1 2 L 30 2');
    expect(roundedPathD([[1, 2], [30, 2]], 4)).not.toContain('Q');
  });

  it('直角拐点产生二次贝塞尔 Q', () => {
    const d = roundedPathD([[0, 0], [10, 0], [10, 10]], 4);
    expect(d).toContain('Q');
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('L 10 10')).toBe(true);
  });

  it('radius 大于半段长时 clamp，控制点不越界 / 不产生 NaN', () => {
    const d = roundedPathD([[0, 0], [2, 0], [2, 2]], 100);
    expect(d).not.toContain('NaN');
    const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(nums.length).toBeGreaterThan(0);
    for (const n of nums) expect(Number.isFinite(n)).toBe(true);
    expect(Math.max(...nums)).toBeLessThanOrEqual(2);
  });

  it('共线拐点不产生曲线（退化为直线）', () => {
    expect(roundedPathD([[0, 0], [10, 0], [20, 0]], 5)).toBe('M 0 0 L 10 0 L 20 0');
  });

  it('lineKindOf 按 tone+lazy 选档：loop/loopLazy/bypass/bypassLazy/choice', () => {
    expect(lineKindOf('loop', false)).toBe('loop');
    expect(lineKindOf('loop', true)).toBe('loopLazy');
    expect(lineKindOf('bypass', false)).toBe('bypass');
    expect(lineKindOf('bypass', true)).toBe('bypassLazy');
    expect(lineKindOf('choice', false)).toBe('choice');
  });

  it('SVG 回环渲染成圆角 path，贪婪实线、非贪婪虚线，且无箭头三角', () => {
    const greedy = renderSvg(diagramFor('a+'));
    expect(greedy).toContain('data-tone="loop"');
    expect(greedy).toMatch(/data-tone="loop"[^>]*d="[^"]*Q/); // 内拐点用二次贝塞尔倒圆
    expect(greedy).not.toContain('x-ac-regex-diagram__arrow'); // 箭头已彻底移除
    const lazy = renderSvg(diagramFor('a+?'));
    // 非贪婪回环带 stroke-dasharray（对标 Regulex 以实/虚线区分贪懒）
    expect(lazy).toMatch(/data-tone="loop"[^>]*stroke-dasharray="[^"]+"/);
  });

  it('Canvas 输出 path 指令：贪婪 dash=null、非贪婪带虚线，无 triangle', () => {
    const greedy = renderCanvasOps(diagramFor('a+'));
    expect(greedy.some((o) => o.kind === 'path')).toBe(true);
    expect(greedy.some((o) => o.kind === 'triangle')).toBe(false);
    const lazy = renderCanvasOps(diagramFor('a+?'));
    const lazyDash = lazy.find((o) => o.kind === 'path' && o.dash !== null);
    expect(lazyDash?.kind).toBe('path');
  });
});

describe('端到端：parser → layout → svg', () => {
  it('一个真实日期 pattern 能出图且回环语义不变', () => {
    const source = '(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})';
    const r = parsePattern(source);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = layoutRailroad(r.ast);
    const svg = renderSvg(d);
    expect(svg.length).toBeGreaterThan(200);
    expect(stringifyAst(r.ast)).toBe(source);
    expect(d.boxes.some((b) => b.tone === 'tagGroupPrefix')).toBe(true);
  });
});
