import { describe, expect, it } from 'vitest';

import { parsePattern, stringifyAst } from '../src/parser';
import type { AstNode } from '../src/parser';
import { DEFAULT_METRICS, layoutRailroad } from '../src/layout';
import type { BoxTone, Diagram, DiagramBox } from '../src/layout';
import type { Locale } from '../src/i18n';
import { applyCanvasOps, escapeXml, renderCanvasOps, renderSvg } from '../src/painter';
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
    }
  });

  it('id 全局唯一（含容器、叶子与标签）', () => {
    for (const pattern of PATTERNS) {
      const ids = diagramFor(pattern).boxes.map((b) => b.id);
      expect(new Set(ids).size, `pattern=${pattern}`).toBe(ids.length);
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

  /** 使用者反馈 3：组框上方标 #N；非捕获与断言不标编号。 */
  it('捕获组标 #N、命名组带名字，非捕获与断言不标编号', () => {
    const tags = (p: string) =>
      boxesOf(p).filter((b) => b.tone === 'tagGroupPrefix').map((b) => b.label);
    expect(tags('(?<year>a)')).toEqual(['#1 year']);
    expect(tags('(a)(b)')).toEqual(['#1', '#2']);
    expect(tags('(?<x>a)(b)(c)')).toEqual(['#1 x', '#2', '#3']);
    expect(tags('(?:a)(?=b)(?<=c)(?!d)')).toEqual(['(?:', '(?=', '(?<=', '(?!']);
  });

  /** 使用者反馈 3 的另一半：次数说人话，且放在内容后面而不是浮在上方。 */
  it('次数标识跟在内容右侧，用「一次以上 / 0次以上」的说法', () => {
    const plus = boxesOf('a+');
    const body = plus.find((b) => b.label === 'a');
    const tag = plus.find((b) => b.tone === 'tagQuantifier');
    expect(tag?.label).toBe('一次以上');
    expect(body !== undefined && tag !== undefined && tag.x >= body.x + body.w - 1).toBe(true);
    // 与主体同一水平带（不再抬高基线）
    expect(body !== undefined && tag !== undefined && Math.abs((tag.y + tag.h / 2) - (body.y + body.h / 2)) < 1).toBe(true);
    expect(boxesOf('a*').find((b) => b.tone === 'tagQuantifier')?.label).toBe('0次以上');
    expect(boxesOf('a?').find((b) => b.tone === 'tagQuantifier')?.label).toBe('0或1次');
    expect(boxesOf('a{3}').find((b) => b.tone === 'tagQuantifier')?.label).toBe('恰好3次');
    expect(boxesOf('a{2,}').find((b) => b.tone === 'tagQuantifier')?.label).toBe('2次以上');
    expect(boxesOf('a{2,4}').find((b) => b.tone === 'tagQuantifier')?.label).toBe('2到4次');
    expect(boxesOf('a+?').find((b) => b.tone === 'tagQuantifier')?.label).toBe('一次以上·非贪婪');
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
      const spineYs = d.edges
        .filter((e) => e.id.includes('.in') || e.id.includes('.out'))
        .map((e) => (e.id.includes('.in') ? e.from.y : e.to.y));
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
    // 量词改为跟在右侧：占宽度、**不占高度**（这正是「不压低基线」的表达）
    expect(quantified.width).toBeGreaterThan(bare.width);
    expect(quantified.height).toBe(bare.height);
    expect(center(quantified, 'a')).toBe(center(quantified, 'b'));
    expect(center(bare, 'a')).toBe(center(bare, 'b'));
    const tag = quantified.boxes.find((b) => b.tone === 'tagQuantifier');
    const body = quantified.boxes.find((b) => b.label === 'a');
    expect(tag !== undefined && body !== undefined && tag.x >= body.x + body.w - 1).toBe(true);
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
    'strokeRect',
    'fillText',
    'beginPath',
    'moveTo',
    'lineTo',
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
      strokeRect: () => calls.push('strokeRect'),
      fillText: (text) => {
        calls.push('fillText');
        labels.push(text);
      },
      beginPath: () => calls.push('beginPath'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      stroke: () => calls.push('stroke')
    };
    const ops = renderCanvasOps(d);
    applyCanvasOps(ops, ctx);
    // setStroke / setFill / setLineWidth / setFont 只做属性赋值，不产生方法调用
    const DRAW: readonly string[] = ['strokeRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke'];
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
