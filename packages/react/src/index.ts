/**
 * `@x-ac/regex-react` 出口：组件 + Props/Handle + core 关键能力的 re-export。
 *
 * re-export 让「装了我的包就能直接用引擎」，不必再单独声明 `@x-ac/regex-core`。
 */
export { Regex } from './Regex';
export type { RegexHandle, RegexProps } from './Regex';

/**
 * 引擎能力整体透传，**不重复维护一份名单** —— 适配层另抄一份导出清单必然会与 core
 * 漂移（漏一个就逼用户去装 core）。导出面是否完整由 core 的 `test/index.test.ts`
 * 快照断言守住，比在这里再列一遍更有效。
 */
export * from '@x-ac/regex-core';

