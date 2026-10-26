/**
 * GitHub Pages 构建脚本 —— 只在 CI 里跑。
 *
 * 关键：playground 的 vite.config.ts 保留 base: '/'（本地 dev 直接用）；
 * Pages 挂在 `/<repo>/` 子路径下，不能污染 dev 配置。这里用 vite 的 build
 * API 在内存里覆盖 `base`，输出到独立的 `pages-dist/` 目录，
 * 然后做零断链自检：扫 index.html 里所有以 `/` 开头的绝对路径，
 * 确保每条都带上了 `/${REPO}/` 前缀。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { build } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const playgroundRoot = resolve(repoRoot, 'playground');
const outDir = resolve(repoRoot, 'pages-dist');

const REPO = process.env.PAGES_REPO || 'regex';
const BASE = `/${REPO}/`;

console.log(`[pages] base = ${BASE} (override, playground/vite.config.ts 保持 base: '/')`);
console.log(`[pages] outDir = ${relative(repoRoot, outDir)}`);

await build({
  root: playgroundRoot,
  base: BASE,
  configFile: false,
  plugins: [vue(), react()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      // 明确入口 = playground/index.html（多页时也只这一份，SPA 单入口）
      input: resolve(playgroundRoot, 'index.html')
    }
  },
  logLevel: 'info'
});

/**
 * 零断链自检：
 * 1) index.html 里所有 href/src 若以 `/` 开头（绝对路径），必须以 `${BASE}` 开头
 * 2) 每条 `${BASE}...` 指向的静态文件都要在 outDir 里真实存在（去掉 base 前缀后）
 */
const indexPath = join(outDir, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const absRefs = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => u.startsWith(BASE) || u === '/');

const wrongPrefix = absRefs.filter((u) => !u.startsWith(BASE));
if (wrongPrefix.length) {
  console.error('[pages] 断链：index.html 里有绝对路径没带 base 前缀：');
  for (const u of wrongPrefix) console.error('  -', u);
  process.exit(1);
}

let checked = 0;
let missing = [];
for (const ref of absRefs) {
  const rel = ref.slice(BASE.length).split('?')[0].split('#')[0];
  if (!rel) continue;
  const file = join(outDir, rel);
  if (!existsSync(file) || !statSync(file).isFile()) {
    missing.push(ref);
  } else {
    checked++;
  }
}
if (missing.length) {
  console.error('[pages] 断链：index.html 指向但 pages-dist/ 里不存在的文件：');
  for (const m of missing) console.error('  -', m);
  process.exit(1);
}

// 顺带列出产物
const assetsDir = join(outDir, 'assets');
const assets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
console.log(
  `[pages] 构建完成：index.html + ${assets.length} 个 asset；` +
  `绝对路径自检 ${checked}/${absRefs.length} 通过（BASE=${BASE}）`
);
