import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * Playground 同时启用 Vue 与 React 插件：
 * - .vue 走 plugin-vue
 * - .tsx 走 plugin-react
 *
 * ⚠ 依赖解析真相（对齐 core/vue/react 三包 package.json）：
 * 三个包的 `exports["."]` 都指向 `./dist/*`，而 `dist/` 被 gitignore。所以本 playground
 * 不是「workspace 源码直连」——无论 dev 还是 build，都必须**先 build 三包**才能解析到它们。
 * 根脚本 `pnpm dev` = `pnpm build && pnpm --filter playground dev` 已保证这点；
 * 只有确认各包的 dist 目录已存在时，才可直接 `pnpm dev:play` 跳过重复构建。
 * 全新 clone 若只跑 `pnpm dev:play`，会 `Cannot find module '@x-ac/regex-core'`。
 */
export default defineConfig({
  plugins: [vue(), react()],
  server: {
    port: 5173,
    strictPort: false,
    host: '127.0.0.1'
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true
  }
});
