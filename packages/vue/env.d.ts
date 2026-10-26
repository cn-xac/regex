/// <reference types="vite/client" />

// 保留 .vue 的 ambient 声明：让 vue/src/*.ts 里 `import Regex from './Regex.vue'`
// 能解析；类型层面被简化成 DefineComponent<unknown, unknown, unknown>，
// 具体模板/props 类型由 vite-plugin-dts 从 .vue 提取进 dist/index.d.ts。
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

// TS 7 起 side-effect CSS import 也需要声明；vite/client 已提供，但显式写一份
// 保险（且 core 的 `./style.css` 精确路径 vite/client 不覆盖）。
declare module '*.css';
declare module '@x-ac/regex-core/style.css';
