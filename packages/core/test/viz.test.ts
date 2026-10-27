import { describe, expect, it } from 'vitest';

import { parsePattern, stringifyAst } from '../src/parser';
import type { AstNode } from '../src/parser';
import { DEFAULT_METRICS, layoutRailroad } from '../src/layout';
import type { BoxTone, Diagram } from '../src/layout';
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
  'literal',
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
    const ys = choice.boxes.filter((b) => b.tone === 'literal').map((b) => b.y);
    expect(new Set(ys).size).toBeGreaterThan(1);

    const seq = diagramFor('abcdef');
    const xs = seq.boxes.filter((b) => b.tone === 'literal').map((b) => b.x);
    const sorted = [...xs].sort((a, b) => a - b);
    expect(xs).toEqual(sorted);
  });

  it('量词与组前缀各自产出标签盒', () => {
    const d = diagramFor('\\d{2,}');
    expect(d.boxes.some((b) => b.tone === 'tagQuantifier' && b.label === '{2,}')).toBe(true);
    const g = diagramFor('(?<year>\\d{4})');
    expect(g.boxes.some((b) => b.tone === 'tagGroupPrefix' && b.label === '(?<year>')).toBe(true);
  });

  it('metrics 可调且默认值冻结', () => {
    expect(Object.isFrozen(DEFAULT_METRICS)).toBe(true);
    const wide = layoutRailroad(astFor('abc'), { charWidth: 20 });
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

  it('label 里的尖括号与 & 必须转义（正则分组符号必然出现）', () => {
    const svg = renderSvg(diagramFor('(?<year>a)'));
    expect(svg).toContain('(?&lt;year&gt;');
    expect(svg).not.toContain('(?<year>)');
    expect(escapeXml('<&">')).toBe('&lt;&amp;&quot;&gt;');
  });

  it('叶子节点带 data-start/data-end，供点击反查源片段', () => {
    const svg = renderSvg(diagramFor('a|b'));
    expect(svg).toMatch(/data-start="\d+" data-end="\d+"/);
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
    expect(labels.some((l) => l.includes('(?<x>'))).toBe(true);
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
