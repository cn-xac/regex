# @x-ac/regex-vue

`@x-ac/regex-core` 的 Vue 3 适配层。**薄封装**——只做 props 透传与 core 纯函数的消费，
任何正则语义都不在这里实现。仅产出 ESM。

> 骨架版本 `0.0.0`：组件目前只渲染标题、pattern 回显与 flags 诊断，M3/M4 接上匹配结果与可视化。

## 安装

```bash
pnpm add @x-ac/regex-vue vue
```

## 用法

```vue
<script setup lang="ts">
import { Regex } from '@x-ac/regex-vue';
import '@x-ac/regex-vue/style.css';
</script>

<template>
  <Regex
    pattern="(?&lt;year>\d{4})-(\d{2})"
    flags="g"
    :locale-candidates="[...navigator.languages]"
  />
</template>
```

样式已随组件 `import`，用 Vite / webpack 等打包器时通常无需手动引；
需要精确控制样式加载顺序时可显式引入 `@x-ac/regex-vue/style.css`。

## Props

| 名称 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `pattern` | `string` | `''` | 正则源串（不含 `/` 定界符） |
| `flags` | `string` | `'g'` | 修饰符；重复字符会被去重并给出 warning |
| `localeCandidates` | `readonly string[]` | `[]` | 语言候选。core 不读 `navigator`，故由宿主传入；空数组即回退 `zh-CN` |

## 语言

组件内所有文案走 core 的 `i18n`，随 `localeCandidates` 自动切换（`zh-CN` / `en`，回退 `zh-CN`）。

## re-export

装本包即可直接用引擎，不必再单独声明 core：

```ts
import { parseFlags, resolveLocale, translate } from '@x-ac/regex-vue';
```

`core` 与 `vue` 都在构建时被 `external` 排除，不会重复打包。

## License

MIT © [阿杰很厉害](https://github.com/xyj2156)
