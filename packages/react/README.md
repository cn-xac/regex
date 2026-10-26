# @x-ac/regex-react

`@x-ac/regex-core` 的 React 18/19 适配层。**薄封装**——只做 props 透传与 core 纯函数的消费，
任何正则语义都不在这里实现。仅产出 ESM。

> 骨架版本 `0.0.0`：组件目前只渲染标题、pattern 回显与 flags 诊断，M3/M4 接上匹配结果与可视化。

## 安装

```bash
pnpm add @x-ac/regex-react react react-dom
```

## 用法

```tsx
import { Regex } from '@x-ac/regex-react';
import '@x-ac/regex-react/style.css';

export function Demo() {
  return (
    <Regex
      pattern="(?<year>\d{4})-(\d{2})"
      flags="g"
      localeCandidates={[...navigator.languages]}
    />
  );
}
```

样式已随组件 `import`，用 Vite / webpack 等打包器时通常无需手动引。

## Props

| 名称 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `pattern` | `string` | `''` | 正则源串（不含 `/` 定界符） |
| `flags` | `string` | `'g'` | 修饰符；重复字符会被去重并给出 warning |
| `localeCandidates` | `readonly string[]` | `[]` | 语言候选。core 不读 `navigator`，故由宿主传入；空数组即回退 `zh-CN` |

## Ref

组件用 `forwardRef` 把句柄透传到根 `div`：

```tsx
import { useRef } from 'react';
import { Regex } from '@x-ac/regex-react';
import type { RegexHandle, RegexProps } from '@x-ac/regex-react';

const ref = useRef<RegexHandle>(null);
```

## 语言

组件内所有文案走 core 的 `i18n`，随 `localeCandidates` 自动切换（`zh-CN` / `en`，回退 `zh-CN`）。

## re-export

装本包即可直接用引擎，不必再单独声明 core：

```ts
import { parseFlags, resolveLocale, translate } from '@x-ac/regex-react';
```

`react` / `react-dom` / `react/jsx-runtime` / `core` 都在构建时被 `external` 排除。

## License

MIT © [xyj2156](https://github.com/xyj2156)
