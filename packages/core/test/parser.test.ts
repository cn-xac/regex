import { describe, expect, it } from 'vitest';

import { collectNodes, parsePattern, stringifyAst } from '../src/parser';
import type { AstNode } from '../src/parser';
import { matchAll } from '../src/engine';
import { scanGroups } from '../src/groups';

/** 覆盖字面量、类、量词、各类分组、断言、反向引用、代理对。 */
const VALID: readonly string[] = [
  '',
  'a',
  'abc',
  '.',
  'a.b',
  '^a',
  'a$',
  '^$',
  '\\bword\\b',
  '\\Bna',
  'a*',
  'a+',
  'a?',
  'a{2}',
  'a{2,}',
  'a{1,3}',
  'a{2,3}',
  'a*?',
  'a+?',
  'a??',
  'a{2,3}?',
  '[abc]',
  '[^abc]',
  '[a-z0-9_]',
  '[\\]]',
  '[(]',
  '[a\\-b]',
  '[-a]',
  '[\\d\\s]',
  '[$]',
  '(a)',
  '(a)(b)',
  '(?:ab)',
  '(?<name>a)',
  '(?<a>x)(?<b>y)',
  '(a)?b',
  '(a|b)+',
  '((a))',
  '(((a)))',
  'a|b',
  'a|b|c',
  '|a',
  'a|',
  '||',
  '\\d',
  '\\w',
  '\\s',
  '\\.',
  '\\\\',
  '\\+',
  '\\{2\\}',
  '\\*',
  '\\n',
  '\\t',
  '\\0',
  '\\x41',
  '\\u0041',
  '(a)\\1',
  '(?<x>a)\\k<x>',
  '(?=a)a',
  '(?!b)b',
  '(?<=a)b',
  '(?<!a)b',
  '(?=a)(?!b)(?<g>a)b',
  '[\\u4e00-\\u9fa5]',
  '😀',
  '(?:a|b)*',
  'ab|cd',
  '(a)(?:b(c))',
  '\\d{4}-\\d{2}-\\d{2}',
  '(?<y>\\d{4})-(\\d{2})-(?<d>\\d{2})',
  'x{0}',
  '(a|b)*?c'
];

const INVALID: readonly string[] = [
  '(',
  ')',
  '[',
  '\\',
  'a\\',
  '(?<n>a)(?<n>b)',
  'a**',
  '{2,3}',
  '*',
  '(?',
  '(?<',
  '[a'
];

/** 剥掉位置信息后的结构形状，用于幂等比对。 */
function shape(target: AstNode): unknown {
  return {
    kind: target.kind,
    text: target.text ?? null,
    group: target.group ?? null,
    quantifier: target.quantifier?.source ?? null,
    negated: target.negated ?? null,
    children: target.children.map(shape)
  };
}

function parsed(pattern: string, flags = ''): AstNode {
  const r = parsePattern(pattern, flags);
  if (!r.ok) throw new Error(`测试前提不成立：${pattern} 解析失败`);
  return r.ast;
}

describe('不变量一：解析器不发明语法', () => {
  it('ok:true 者必能被 new RegExp 构造', () => {
    for (const pattern of [...VALID, ...INVALID, '(?>a)', 'a*+', '[^]', '[]]']) {
      const r = parsePattern(pattern);
      if (!r.ok) continue;
      expect(() => new RegExp(pattern), `parser 放过了非法 pattern=${pattern}`).not.toThrow();
    }
  });

  it('合法 pattern 全部解析成功（不过度拒绝）', () => {
    for (const pattern of VALID) {
      const r = parsePattern(pattern);
      expect(r.ok, `${pattern} 应解析成功：${r.ok ? '' : r.issues[0]?.message}`).toBe(true);
    }
  });

  it('已知非法 pattern 一律拒绝，且带位置或原生 message', () => {
    for (const pattern of INVALID) {
      const r = parsePattern(pattern);
      expect(r.ok, `${pattern} 应被拒绝`).toBe(false);
      if (r.ok) continue;
      expect(r.issues[0]?.code).toBe('invalid-pattern');
      expect(r.issues[0]?.severity).toBe('error');
    }
  });

  it('复验会随 flags 收紧（引擎在 u/v 下更严时结论必须跟着变）', () => {
    // 均为探针实测值：[^]] 在非 u 可构造、u 下抛；[-a] 在非 v 可构造、v 下抛。
    expect(parsePattern('[^]]', '').ok).toBe(true);
    expect(parsePattern('[^]]', 'u').ok).toBe(false);
    expect(parsePattern('[-a]', '').ok).toBe(true);
    expect(parsePattern('[-a]', 'v').ok).toBe(false);
    // `[^]` 单独出现时 u 下也合法（任意字符），不能凭"带 ^ 的类"就判它错
    expect(parsePattern('[^]', 'u').ok).toBe(true);
  });
});

describe('不变量二：每个节点的 stringify 就是它的源片段', () => {
  it('stringifyAst(node) === pattern.slice(node.start, node.end)', () => {
    for (const pattern of VALID) {
      for (const node of collectNodes(parsed(pattern))) {
        expect(stringifyAst(node), `pattern=${pattern} kind=${node.kind}`).toBe(
          pattern.slice(node.start, node.end)
        );
      }
    }
  });

  it('区间不越界，且每个父节点的子节点按源串顺序不减', () => {
    for (const pattern of VALID) {
      const root = parsed(pattern);
      for (const node of collectNodes(root)) {
        expect(node.start).toBeGreaterThanOrEqual(0);
        expect(node.end).toBeLessThanOrEqual(pattern.length);
        expect(node.end).toBeGreaterThanOrEqual(node.start);
      }
      for (const parent of collectNodes(root)) {
        let cursor = -1;
        for (const child of parent.children) {
          expect(
            child.start >= cursor,
            `pattern=${pattern} 子节点区间乱序：${child.start} < ${cursor}`
          ).toBe(true);
          cursor = child.start;
        }
      }
    }
  });
});

describe('不变量三：parse → stringify → parse 幂等', () => {
  it('反拼串结构等价且 stringify 稳定', () => {
    for (const pattern of VALID) {
      const first = parsed(pattern);
      const rebuilt = stringifyAst(first);
      expect(rebuilt).toBe(pattern);

      const again = parsed(rebuilt);
      expect(shape(again)).toEqual(shape(first));
      expect(stringifyAst(again)).toBe(rebuilt);
    }
  });

  it('反拼串与原 pattern 在同一批文本上匹配结果完全一致（语义等价）', () => {
    const texts = ['2026-10-27 a1 b2 😀 x', '', 'aaa-111\nbbb-222'];
    for (const pattern of VALID) {
      const rebuilt = stringifyAst(parsed(pattern));
      for (const text of texts) {
        const a = matchAll(text, pattern, 'g');
        const b = matchAll(text, rebuilt, 'g');
        expect(b.ok).toBe(a.ok);
        if (!a.ok || !b.ok) continue;
        expect(b.matches.map((m) => [m.range.start, m.range.end, m.text]), `pattern=${pattern}`).toEqual(
          a.matches.map((m) => [m.range.start, m.range.end, m.text])
        );
      }
    }
  });
});

describe('组数与既有模块交叉', () => {
  it('parsePattern.groupCount 与 scanGroups 一致', () => {
    for (const pattern of VALID) {
      const r = parsePattern(pattern);
      if (!r.ok) continue;
      expect(r.groupCount, `pattern=${pattern}`).toBe(scanGroups(pattern).groupCount);
    }
  });
});

describe('结构细节', () => {
  it('命名捕获组带 name 与 ordinal', () => {
    const root = parsed('(?<year>\\d{4})');
    const group = root.children[0] as AstNode;
    expect(group.kind).toBe('group');
    expect(group.group).toBe('named');
    expect(group.name).toBe('year');
    expect(group.ordinal).toBe(1);
    const quantified = (group.children[0] as AstNode).children[0] as AstNode;
    expect(quantified.kind).toBe('quantified');
    expect(quantified.quantifier).toEqual({ min: 4, max: 4, greedy: true, source: '{4}' });
    const atom = quantified.children[0] as AstNode;
    expect(atom.kind).toBe('escape');
    expect(atom.text).toBe('d');
  });

  it('七种分组形态各自可辨', () => {
    const kinds: Array<[string, string]> = [
      ['(a)', 'capturing'],
      ['(?:a)', 'nonCapturing'],
      ['(?<n>a)', 'named'],
      ['(?=a)', 'lookahead'],
      ['(?!a)', 'negativeLookahead'],
      ['(?<=a)', 'lookbehind'],
      ['(?<!a)', 'negativeLookbehind']
    ];
    for (const [pattern, expected] of kinds) {
      const group = (parsed(pattern).children[0] as AstNode).group;
      expect(group, `pattern=${pattern}`).toBe(expected);
    }
  });

  it('捕获组序号按出现顺序递增且嵌套正确', () => {
    const nodes = collectNodes(parsed('(a)(b(c))(?<n>d)'));
    const groups = nodes.filter((n) => n.group === 'capturing' || n.group === 'named');
    expect(groups.map((g) => [g.group, g.ordinal, g.name ?? null])).toEqual([
      ['capturing', 1, null],
      ['capturing', 2, null],
      ['capturing', 3, null],
      ['named', 4, 'n']
    ]);
  });

  it('字符类保留 negated 与 body 原文', () => {
    // 单分支时根是 alternative 包装，类节点在 children[0]
    const plain = parsed('[a-z]').children[0] as AstNode;
    expect(plain.kind).toBe('characterClass');
    expect(plain.classBody).toBe('a-z');
    expect(plain.negated).toBe(false);

    const neg = parsed('[^\\]]').children[0] as AstNode;
    expect(neg.negated).toBe(true);
    expect(neg.classBody).toBe('\\]');
  });

  it('懒惰与贪婪量词区分，source 原样保留', () => {
    const lazy = (parsed('a+?') as AstNode).children[0] as AstNode;
    expect(lazy.quantifier).toEqual({ min: 1, max: null, greedy: false, source: '+?' });
    const open = (parsed('a{2,}') as AstNode).children[0] as AstNode;
    expect(open.quantifier).toEqual({ min: 2, max: null, greedy: true, source: '{2,}' });
  });

  it('反向引用记录组号或组名', () => {
    const numeric = collectNodes(parsed('(a)\\1')).find((n) => n.kind === 'backreference');
    expect(numeric?.ordinal).toBe(1);
    const named = collectNodes(parsed('(?<x>a)\\k<x>')).find((n) => n.kind === 'backreference');
    expect(named?.name).toBe('x');
  });

  it('交替的分支数正确', () => {
    const root = parsed('a|b|c');
    expect(root.kind).toBe('disjunction');
    expect(root.children).toHaveLength(3);
  });

  it('单个分支不产生多余的 disjunction 包装', () => {
    expect(parsed('abc').kind).toBe('alternative');
  });
});

describe('健壮性', () => {
  it('对超长与畸形输入不抛异常', () => {
    for (const junk of ['('.repeat(200), '[', '(?P<n>a)', '\\p{L}', '\\k<>', '(?<>)', '(((((']) {
      expect(() => parsePattern(junk)).not.toThrow();
    }
  });

  it('collectNodes 覆盖全树且无重复（quantified 不双计）', () => {
    const nodes = collectNodes(parsed('a+b*'));
    const kinds = nodes.map((n) => n.kind);
    expect(kinds.filter((k) => k === 'quantified')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'literal')).toHaveLength(2);
    expect(new Set(nodes).size).toBe(nodes.length);
  });
});
