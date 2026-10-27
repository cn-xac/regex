/**
 * groups —— 从 pattern 源串扫描捕获组数量与命名组顺序。
 *
 * 为什么需要它：原生 `RegExp` **不提供**任何"这个 pattern 有几个捕获组 / 组名是什么"的
 * API（没有 match 就没有 `result.length`，也没有 `result.groups` 的键）。而界面必须在
 * 用户还没输入测试文本时就列出组清单。所以只能扫源串。
 *
 * 扫描要避开的四个坑（都有对应差分测试）：
 * - 字符类内部的括号不是组：`[(]` 是 0 组；
 * - 被转义的括号不是组：`\(` 是 0 组；
 * - `(?<=` `(?>` 之类以 `(?<` 开头但不是命名组，不能误判成组名；
 * - 非捕获 `(?:` 与断言 `(?=` `(?!` 都不产生捕获序号。
 *
 * M4 的 `parser` 落地后本模块会被 AST 取代；在此之前，它是组元信息的唯一来源。
 */

export interface NamedGroupRef {
  name: string;
  /** 捕获组序号，与 `CaptureGroup.ordinal` 同基（1 起，0 是整体匹配）。 */
  ordinal: number;
}

export interface GroupScan {
  groupCount: number;
  /** 按 pattern 中出现顺序排列。 */
  named: readonly NamedGroupRef[];
}

/**
 * 扫一遍 pattern。遇到语法不完整的片段（如悬挂的 `(?`）不报错，交给 `new RegExp`
 * 去判非法 —— 本函数只负责"看起来像什么"，合法性不是它的职责。
 */
export function scanGroups(pattern: string): GroupScan {
  let count = 0;
  const named: NamedGroupRef[] = [];
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern.charAt(i);

    if (ch === String.fromCharCode(92)) {
      i += 1; // 连同被转义的下一个字符一起跳过
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch !== '(') continue;

    if (pattern.charAt(i + 1) !== '?') {
      count += 1; // 普通捕获组
      continue;
    }

    const kind = pattern.charAt(i + 2);
    if (kind === ':' || kind === '=' || kind === '!') continue; // (?:  (?=  (?!

    if (kind === '<') {
      const after = pattern.charAt(i + 3);
      if (after === '=' || after === '!') continue; // lookbehind (?<=  (?<!
      // 命名组：`(?<` 占 i、i+1、i+2，组名从 **i+3** 起，到下一个 `>` 止。
      // （`>` 的位置随名字长度变化，不能用固定下标判定；第一版按固定位置查 `>`，
      // 差分测试当场抓到 `(?<name>a)` 被读成了 `ame`。）
      const close = pattern.indexOf('>', i + 3);
      if (close === -1) continue; // 未闭合，交给 RegExp 判非法
      const name = pattern.slice(i + 3, close);
      count += 1;
      if (name !== '') named.push({ name, ordinal: count });
      i = close;
      continue;
    }
  }

  return { groupCount: count, named };
}

/** 组序号 → 组名的反查表（供 `matchAll` 给 `CaptureGroup.name` 赋值）。 */
export function nameByOrdinal(scan: GroupScan): Readonly<Record<number, string>> {
  const out: Record<number, string> = {};
  for (const entry of scan.named) {
    out[entry.ordinal] = entry.name;
  }
  return out;
}
