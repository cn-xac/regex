/**
 * `@x-ac/regex-vue` 出口：组件 + core 关键能力的 re-export。
 *
 * re-export 的意义是让「装了我的包就能直接用引擎」，不必再单独装 `@x-ac/regex-core`。
 * 类型 `FlagsResult` 等一并透出，保证下游纯 tsc 环境拿得到完整契约。
 */
export { default as Regex } from './Regex.vue';

/**
 * 引擎能力整体透传，**不重复维护一份名单** —— 适配层另抄一份导出清单必然会与 core
 * 漂移（漏一个就逼用户去装 core）。导出面是否完整由 core 的 `test/index.test.ts`
 * 快照断言守住，比在这里再列一遍更有效。
 */
export * from '@x-ac/regex-core';

