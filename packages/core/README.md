# @x-ac/regex-core

框架无关的正则工作台引擎。**零运行时依赖，不碰 DOM**，ESM / CJS / UMD / IIFE 四格式产出，
IIFE 全局名 `RegexCore`。

> 当前是骨架版本 `0.0.0`：已实现 `i18n` 与 `flags`，匹配引擎与可视化在 M3/M4 落地。

## 安装

```bash
pnpm add @x-ac/regex-core
```

## 已实现 API

### i18n（`zh-CN` / `en`，回退 `zh-CN`）

```ts
import { resolveLocale, translate, createTranslator, SUPPORTED_LOCALES } from '@x-ac/regex-core';

resolveLocale(['fr-FR', 'en-GB']);  // 'en'
resolveLocale(['zh-TW']);           // 'zh-CN'（主语言前缀退化）
resolveLocale(['de']);              // 'zh-CN'（回退）
resolveLocale();                    // 'zh-CN' —— core 不读 navigator，候选由宿主传入

const t = createTranslator('zh-CN');
t('app.title');                     // '正则测试器'
t('view.matchCount', { count: 12 }); // '共 12 个匹配'
```

语义约定：

- `normalizeLocaleTag()` 无法归类时返回 `null` 而非直接回退，以便继续尝试下一个候选；
- 插值占位符缺参时**原样保留** `{name}`，让漏参暴露出来而不是静默产出 `undefined`；
- `MESSAGES` 类型强制「每种语言、每个 key 都在」，漏翻译是编译错误不是运行时惊喜；
- **运行时返回值不做本地化**：`RegexIssue.message` 保留 V8 原始英文（含字符位置），
  `issue.*` 文案是供视图自行选择的解释性翻译。

### flags

```ts
import { parseFlags, normalizeFlags, withFlag, isFlagSupported } from '@x-ac/regex-core';

parseFlags('ggi');
// { ok: true, flags: 'gi', set: {...}, issues: [{ severity: 'warning', ... }] }

parseFlags('x');   // { ok: false, issues: [{ code: 'invalid-flag', severity: 'error', index: 0 }] }
parseFlags('uv');  // { ok: false, issues: [{ code: 'conflicting-flags', ... }] }

normalizeFlags('ggi!x'); // 'gi' —— 宽松归一，永不报错，也不管 u/v 互斥
withFlag('im', 'd', true); // 'dim' —— 始终按 FLAG_ORDER 归一
```

四类边界（与 `new RegExp()` 的真实接受性一致）：

| 输入 | 结果 |
| --- | --- |
| 重复字符 `ggi` | warning + 去重，`ok: true` |
| 未知字符 `x` | error，`ok: false`，带 `index` |
| `u` + `v` | error `conflicting-flags` |
| 运行时不认识的 flag | `isFlagSupported()` 判 false，`checkFlagSupport()` 汇总成 issue |

## 样式

`@x-ac/regex-core/style.css` 是高亮层与结构图容器的基线皮肤，类名前缀 `x-ac-regex-`，
所有色值走自定义属性挂在 `.x-ac-regex-root` 上（不污染宿主页面的 `:root`），换主题只需覆盖变量。
适配层已内置该 import，通常不需要手动引。

## 约定

- `FLAG_ORDER` 为 `d g i m s u y v`（字母升序），决定所有 flags 串的规范化输出顺序。
- 索引一律 UTF-16 code unit 下标，与 `RegExp.prototype.exec` 同基（emoji 占 2）。
- 返回对象 `Object.freeze`，UI 侧误改在开发期即暴露。

## 路线图

M3 `engine` / `highlights` / `replace` / `escape` / `state` → M4 `parser` / `layout` →
M5 SVG + Canvas `painters`。均为 DOM-free：painter 产出字符串与指令序列，挂载留给上层。

## License

MIT © [阿杰很厉害](https://github.com/xyj2156)
