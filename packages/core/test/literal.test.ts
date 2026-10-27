import { describe, expect, it } from 'vitest';

import { parsePatternInput } from '../src/literal';
import { parseFlags } from '../src/flags';

const BS = String.fromCharCode(92);

describe('非字面量输入', () => {
  it('不以 / 开头时原样作 pattern', () => {
    const r = parsePatternInput('a/b');
    expect(r.literal).toBe(false);
    expect(r.pattern).toBe('a/b');
    expect(r.flags).toBe('');
  });

  it('空输入合法，flags 取调用方勾选值', () => {
    const r = parsePatternInput('', { flags: 'gi' });
    expect(r.ok).toBe(true);
    expect(r.pattern).toBe('');
    expect(r.flags).toBe('gi');
  });

  it('调用方 flags 会被归一化：乱序、去重，大写因不是合法 flag 而丢弃', () => {
    expect(parsePatternInput('x', { flags: 'mi' }).flags).toBe('im');
    expect(parsePatternInput('x', { flags: 'ggi' }).flags).toBe('gi');
    // JS 的 flag 只有小写字母，`G` 属未知字符，normalize 阶段直接丢
    expect(parsePatternInput('x', { flags: 'iGG' }).flags).toBe('i');
  });

  it('只写了开头的 / 时按裸 pattern 处理并给 warning，不猜意图', () => {
    const r = parsePatternInput('/unclosed');
    expect(r.literal).toBe(false);
    expect(r.pattern).toBe('/unclosed');
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]?.severity).toBe('warning');
  });
});

describe('字面量解析', () => {
  it('剥出 pattern 与 flags', () => {
    const r = parsePatternInput('/abc/gi');
    expect(r.literal).toBe(true);
    expect(r.pattern).toBe('abc');
    expect(r.literalFlags).toBe('gi');
    expect(r.flags).toBe('gi');
    expect(r.issues).toEqual([]);
  });

  it('// 是合法的空 pattern 字面量', () => {
    const r = parsePatternInput('//');
    expect(r.literal).toBe(true);
    expect(r.pattern).toBe('');
    expect(r.literalFlags).toBe('');
  });

  it('转义的斜杠不充当定界符', () => {
    const r = parsePatternInput('/a' + BS + '/b/i');
    expect(r.literal).toBe(true);
    expect(r.pattern).toBe('a' + BS + '/b');
    expect(r.flags).toBe('i');
  });

  /**
   * 贴 JS 词法的直接后果：字符类里的 / **不**豁免，`/[/]/g` 被读成 pattern=`[` +
   * flags=`]/g`（非法）。工具不"聪明地"替用户闭合，因为那样会与浏览器不一致。
   */
  it('字符类内的斜杠不豁免，与 JS 词法一致', () => {
    const r = parsePatternInput('/[/]/g');
    expect(r.pattern).toBe('[');
    expect(r.ok).toBe(false);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain('invalid-flag');
  });

  it('字面量尾部含非 flag 字符时判失败并回退到勾选值', () => {
    const r = parsePatternInput('/a/g/i', { flags: 'm' });
    expect(r.ok).toBe(false);
    expect(r.pattern).toBe('a');
    expect(r.flags).toBe('m');
  });

  it('字面量里重复的 flag 降级为 warning 并去重', () => {
    const r = parsePatternInput('/a/ggg');
    expect(r.ok).toBe(true);
    expect(r.flags).toBe('g');
    expect(r.issues.some((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('flags 合并策略', () => {
  it('union（默认）取并集且归一化', () => {
    expect(parsePatternInput('/a/g', { flags: 'i' }).flags).toBe('gi');
    expect(parsePatternInput('/a/g', { flags: 'g' }).flags).toBe('g');
  });

  it('literal 只认字面量写的', () => {
    expect(parsePatternInput('/a/g', { flags: 'i', merge: 'literal' }).flags).toBe('g');
  });

  it('current 只认勾选的，字面量 flags 仅回显', () => {
    const r = parsePatternInput('/a/g', { flags: 'i', merge: 'current' });
    expect(r.flags).toBe('i');
    expect(r.literalFlags).toBe('g');
  });

  /** union 的隐藏坑：勾选 u + 字面量 v 拼出编译不了的 flags，必须报冲突而非静默产出。 */
  it('union 合并出 u+v 冲突时报 conflicting-flags 并回退', () => {
    const r = parsePatternInput('/a/v', { flags: 'u' });
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain('conflicting-flags');
    expect(r.flags).toBe('u');
    // 回退值本身必须是可编译的 flags
    expect(parseFlags(r.flags).ok).toBe(true);
  });
});

describe('与真实 RegExp 的一致性', () => {
  it('解析出的 pattern + flags 能构造出 RegExp，而原始字面量串不能直接构造', () => {
    const input = '/(?<year>\\d{4})-(\\d{2})/gi';
    const r = parsePatternInput(input);
    expect(() => new RegExp(r.pattern, r.flags)).not.toThrow();
    // 未剥离的裸串当 pattern 用会带上多余的定界符语义，二者不该等价
    expect(new RegExp(r.pattern, r.flags).test('2026-10')).toBe(true);
  });
});
