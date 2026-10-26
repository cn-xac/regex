# regex · 正则测试器

H5 正则小工具：正则可视化（铁路图 / AST 树）+ 基于 JS 的正则测试。`@x-ac` 合集的第一个工具。

> **当前状态：骨架（M2）。** 已落地的是 `i18n` 与 `flags` 两块地基；匹配引擎、parser、
> 可视化与高亮尚未实现，`0.0.0` 是**占位版本**，请勿用于生产。下面「路线图」列了边界。

## 包

| 包 | 说明 |
| --- | --- |
| [`@x-ac/regex-core`](packages/core/README.md) | 框架无关引擎，零运行时依赖，ESM/CJS/UMD/IIFE 四格式 |
| [`@x-ac/regex-vue`](packages/vue/README.md) | Vue 3 适配层，仅 ESM |
| [`@x-ac/regex-react`](packages/react/README.md) | React 18/19 适配层，仅 ESM |

在线演示：<https://cn-xac.github.io/regex/>

## 快速开始

```bash
pnpm add @x-ac/regex-core
```

```ts
import { parseFlags, resolveLocale, translate } from '@x-ac/regex-core';

const locale = resolveLocale([...navigator.languages]); // 未命中回退 'zh-CN'
translate(locale, 'app.title');                        // '正则测试器' / 'Regex Tester'

parseFlags('ggi'); // → { ok: true, flags: 'gi', issues: [warning: Duplicate flag 'g'] }
parseFlags('uv');  // → { ok: false, issues: [error: conflicting-flags] }
```

免构建直接用（IIFE，全局名 `RegexCore`）：

```html
<script src="https://unpkg.com/@x-ac/regex-core/dist/index.iife.js"></script>
<script>
  RegexCore.resolveLocale(['en-GB']); // 'en'
</script>
```

## 设计要点

- **core 不碰 DOM、零运行时依赖**。SVG painter 产出标记字符串、Canvas painter 产出绘制
  指令序列，两者都不引用 `document` / `window`，所以 Worker 与 SSR 下同样可用。
- **语言探测归宿主**。`navigator` 由调用方读取后把候选数组传进 `resolveLocale()`，
  因此 core 在无浏览器的环境里也测得动。
- **修饰符按 JS 真实语义**。重复字符降级为 warning 并去重；未知字符是 error；
  `u` 与 `v` 互斥。判定结果与 `new RegExp()` 的接受/拒绝保持一致，不自创规则。
- **双语文案与类型同源**。`MESSAGES` 的类型是 `Record<Locale, Record<MessageKey, string>>`，
  少一种语言的任意一个 key 会直接编译失败。

## 路线图

| 里程碑 | 内容 |
| --- | --- |
| M2（当前） | 三包骨架、i18n 地基、flags 语义 |
| M3 | `engine`（`compileCheck` / `matchAll`）、`highlights`、`replace`、`escape`、`state` |
| M4 | `parser`（含 `()` / `(?:)` / `(?<name>)` / 断言 / 反向引用的完整组构造）、`layout` |
| M5 | SVG + Canvas 双后端 painter、playground 三 tab 接线 |

明确不做（v0.1）：**匹配过程的动态回放**。JS 原生 `RegExp` 不提供回溯信息，要做只能自研
插桩引擎，与 V8 的行为差异会毁掉测试器的可信度。匹配结果本身仍会清晰呈现（逐条 match、
逐组捕获与区间）。

## 开发

```bash
pnpm install
pnpm build && pnpm verify:dist   # 产物字节是判断是否真跑过的唯一可靠依据
pnpm typecheck && pnpm test
pnpm --filter playground typecheck
```

全新 clone 必须先 `pnpm build` 才能跑 playground —— 三包的 `exports["."]` 都指向 `dist`。
详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 已知边界

- **索引是 UTF-16 code unit**，与 `RegExp` 原生语义同基；一个 emoji 算 2，不是码点计数。
- **只报 JS 语义**，不做 Python / PCRE / RE2 的转译或差异提示。
- **灾难性回溯不可中断**（如 `(a+)+b` 遇长串）。JS 正则跑起来停不掉，限额只能在两次
  `exec` 之间生效，这是平台事实。

## 版本与发布

版本遵循 SemVer；`0.0.0` 为占位（`dist-tag: stage`）。发版由维护者执行，详见
[CONTRIBUTING.md](CONTRIBUTING.md)。安全报告见 [SECURITY.md](SECURITY.md)。

## License

MIT © [xyj2156](https://github.com/xyj2156)
