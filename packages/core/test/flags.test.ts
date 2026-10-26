import { describe, expect, it } from 'vitest';

import {
  FLAG_ORDER,
  checkFlagSupport,
  emptyFlagSet,
  formatFlags,
  hasFlag,
  isFlagSupported,
  normalizeFlags,
  parseFlags,
  withFlag
} from '../src/flags';
import type { FlagsParsed } from '../src/flags';

describe('FLAG_ORDER', () => {
  it('是固定的 8 个字母且已冻结', () => {
    expect(FLAG_ORDER).toEqual(['d', 'g', 'i', 'm', 's', 'u', 'y', 'v']);
    expect(Object.isFrozen(FLAG_ORDER)).toBe(true);
  });
});

describe('parseFlags', () => {
  it('接受归一化顺序', () => {
    const result = parseFlags('gi');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flags).toBe('gi');
    expect(result.issues).toEqual([]);
  });

  it('把乱序输入排成规范顺序', () => {
    // 空格不是合法 flag 字符，必须判失败而不是被静默忽略
    expect(parseFlags('im dg').ok).toBe(false);
    const clean = parseFlags('imdg') as FlagsParsed;
    expect(clean.ok).toBe(true);
    expect(clean.flags).toBe('dgim');
  });

  it('空串是合法的无 flag 输入', () => {
    const result = parseFlags('') as FlagsParsed;
    expect(result.ok).toBe(true);
    expect(result.flags).toBe('');
    expect(result.set).toEqual(emptyFlagSet());
  });

  it('重复 flag 只降级为 warning 并去重', () => {
    const result = parseFlags('ggi') as FlagsParsed;
    expect(result.ok).toBe(true);
    expect(result.flags).toBe('gi');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.severity).toBe('warning');
    expect(result.issues[0]?.code).toBe('invalid-flag');
  });

  it('同一个重复字符只报一次 warning', () => {
    const result = parseFlags('gggg') as FlagsParsed;
    expect(result.issues).toHaveLength(1);
  });

  it('未知 flag 是 error 且不给半成品', () => {
    const result = parseFlags('gx') as FlagsParsed;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.severity).toBe('error');
    expect(result.issues[0]?.index).toBe(1);
  });

  it('u 与 v 互斥', () => {
    const result = parseFlags('uv') as FlagsParsed;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('conflicting-flags');
  });

  it('与真实 RegExp 构造结果保持一致', () => {
    // 'uv' 必须让原生 RegExp 也抛，否则我们的互斥判定就是自己发明的语义
    expect(() => new RegExp('a', 'uv')).toThrow(SyntaxError);
    expect(parseFlags('gi').ok).toBe(true);
    expect(parseFlags('xyz').ok).toBe(false);
  });
});

describe('formatFlags / normalizeFlags', () => {
  it('parse → format 往返稳定', () => {
    for (const input of ['', 'g', 'gi', 'dgi', 'gimsuy']) {
      const parsed = parseFlags(input);
      if (!parsed.ok) continue;
      expect(normalizeFlags(parsed.flags)).toBe(parsed.flags);
      expect(formatFlags(parsed.set)).toBe(parsed.flags);
    }
  });

  it('normalizeFlags 宽松丢弃未知字符且不报错', () => {
    expect(normalizeFlags('ggi!x')).toBe('gi');
    expect(normalizeFlags('')).toBe('');
    // 宽松归一化**不**负责 u/v 互斥判定，那是 parseFlags 的职责
    expect(normalizeFlags('vug')).toBe('guv');
  });

  it('formatFlags 把未出现的键视为 false', () => {
    expect(formatFlags({ g: true })).toBe('g');
    expect(formatFlags({})).toBe('');
    expect(formatFlags({ v: true, d: true, i: undefined })).toBe('dv');
  });
});

describe('hasFlag / withFlag', () => {
  it('hasFlag 判定单个 flag', () => {
    expect(hasFlag('gi', 'g')).toBe(true);
    expect(hasFlag('gi', 'm')).toBe(false);
  });

  it('withFlag 开关后仍保持规范顺序且幂等', () => {
    expect(withFlag('', 'g', true)).toBe('g');
    expect(withFlag('g', 'g', true)).toBe('g');
    expect(withFlag('gi', 'g', false)).toBe('i');
    expect(withFlag('im', 'd', true)).toBe('dim');
    expect(withFlag('gg', 'i', true)).toBe('gi');
  });
});

describe('运行时能力探测', () => {
  it('isFlagSupported 对标准 flag 为真且对未知字符不抛', () => {
    expect(isFlagSupported('g')).toBe(true);
    expect(isFlagSupported('i')).toBe(true);
    // 不认识的字符走的是 catch 分支，返回值取决于错误类型，只要求不抛
    expect(() => isFlagSupported('q' as never)).not.toThrow();
  });

  it('checkFlagSupport 对常规 flag 不报问题', () => {
    expect(checkFlagSupport('gi')).toEqual([]);
  });
});
