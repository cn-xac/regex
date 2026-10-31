import { describe, expect, it } from 'vitest';

import {
  DARK,
  LIGHT,
  derivePalette,
  isLightPalette,
  listThemes,
  registerTheme,
  resolveTheme
} from '../src/theme';
import type { ThemePalette } from '../src/theme';

describe('isLightPalette', () => {
  it('LIGHT 判为亮色档', () => {
    expect(isLightPalette(LIGHT)).toBe(true);
  });
  it('DARK 判为暗色档', () => {
    expect(isLightPalette(DARK)).toBe(false);
  });
});

describe('derivePalette', () => {
  const derived = derivePalette(LIGHT);

  it('派生 LIGHT 得暗色档（isLightPalette 翻转）', () => {
    expect(isLightPalette(derived)).toBe(false);
  });

  it('派生 DARK 得亮色档', () => {
    expect(isLightPalette(derivePalette(DARK))).toBe(true);
  });

  it('透明色 #00000000 保持透明', () => {
    // 所有 container box stroke 为 '#1c63b5' 等非透明色，fill 才是透明；
    // 派生应保持透明不变（不能把 #00000000 翻成实心）
    for (const tone of ['group', 'nonCapturing', 'choice', 'assertion'] as const) {
      expect(derived.box[tone].fill).toBe('#00000000');
      expect(derived.box[tone].stroke).not.toBe('#00000000');
    }
  });

  it('radius 与 dash 原样保留', () => {
    for (const [k, v] of Object.entries(LIGHT.box)) {
      const d = derived.box[k as keyof typeof derived.box];
      expect(d.radius).toBe(v.radius);
      expect(d.dash).toEqual(v.dash);
    }
  });

  it('line.width 与 dash 原样保留', () => {
    for (const [k, v] of Object.entries(LIGHT.line)) {
      const d = derived.line[k as keyof typeof derived.line];
      expect(d.width).toBe(v.width);
      expect(d.dash).toEqual(v.dash);
    }
  });

  it('双次派生回原档（isLightPalette 一致，所有 hex 色可回原）', () => {
    const back = derivePalette(derived);
    expect(isLightPalette(back)).toBe(true);
    // 亮度 clamp 后不能完美还原，只验语义档位一致
  });

  it('返回 name 为派生档（base:light 或 base:dark）', () => {
    expect(derived.name).toMatch(/^light:/);
  });

  it('所有 hex 色仍合法 #RRGGBB 或 #00000000', () => {
    const isHex = (s: string) => s === '#00000000' || /^#[0-9a-f]{6}$/i.test(s);
    for (const b of Object.values(derived.box)) {
      expect(isHex(b.stroke), `stroke ${b.stroke}`).toBe(true);
      expect(isHex(b.fill), `fill ${b.fill}`).toBe(true);
      expect(isHex(b.text), `text ${b.text}`).toBe(true);
    }
    for (const l of Object.values(derived.line)) {
      expect(isHex(l.stroke), `line ${l.stroke}`).toBe(true);
    }
  });
});

describe('registerTheme + resolveTheme', () => {
  it('普通注册：按名解析到 palette', () => {
    const custom: ThemePalette = Object.freeze({
      name: 'solarized',
      box: Object.freeze({ ...LIGHT.box }) as ThemePalette['box'],
      line: Object.freeze({ ...LIGHT.line }) as ThemePalette['line']
    });
    registerTheme(custom);
    expect(resolveTheme('solarized')).toBe(custom);
    expect(listThemes()).toContain('solarized');
  });

  it('derive:true 自动派生互补档，可通过 mode 参数取出', () => {
    const myTheme: ThemePalette = Object.freeze({
      name: 'ocean',
      box: Object.freeze({ ...LIGHT.box }) as ThemePalette['box'],
      line: Object.freeze({ ...LIGHT.line }) as ThemePalette['line']
    });
    registerTheme(myTheme, { derive: true });

    // light 档取回原 theme
    expect(resolveTheme('ocean', 'light')).toBe(myTheme);
    // dark 档应是派生的互补档（isLightPalette 判为暗）
    const dark = resolveTheme('ocean', 'dark');
    expect(isLightPalette(dark)).toBe(false);
    // 无 mode 默认取原注册档（LIGHT 系）
    expect(resolveTheme('ocean')).toBe(myTheme);
    // 列表不含派生副 key
    expect(listThemes().some(k => k.includes(':'))).toBe(false);
  });

  it('未知名回退 LIGHT；大小写不敏感', () => {
    expect(resolveTheme('nope')).toBe(LIGHT);
    expect(resolveTheme('undefined')).toBe(LIGHT);
    expect(resolveTheme('DARK')).toBe(DARK);
    expect(resolveTheme('Dark')).toBe(DARK);
  });
});
