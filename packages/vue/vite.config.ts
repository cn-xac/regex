import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import dts from 'vite-plugin-dts';
import { defineConfig } from 'vite';

/**
 * Vue 包 lib 模式构建：
 * - JS bundle：vite lib + plugin-vue 编译 SFC；vue/core 走 external 不重复打包
 * - `.d.ts`：vite-plugin-dts 从 .vue / .ts 源码提取类型并 rollup 成单文件，
 *   让下游纯 tsc 环境（不装 vue-tsc）也能拿到 Regex 组件的完整类型。
 *   dts 层需要 `@vue/language-core` 解析 SFC；由 vue 包 devDeps 提供。
 *
 * 适配层保持薄封装：只做 props/emit/ref 的搬运，正则语义一律留在 @x-ac/regex-core。
 *
 * Vite 8 ESM config 无 __dirname，用 fileURLToPath。
 */
const entryFile = fileURLToPath(new URL('./src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [
    vue(),
    dts({
      include: ['src/**/*.ts', 'src/**/*.vue'],
      outDir: 'dist',
      insertTypesEntry: true,
      rollupTypes: true
    })
  ],
  build: {
    lib: {
      entry: entryFile,
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: ['vue', '@x-ac/regex-core']
    },
    sourcemap: true,
    emptyOutDir: true,
    target: 'es2020',
    minify: false
  }
});
