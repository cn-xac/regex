/**
 * 三包产物存在性自检 —— CI 在 `pnpm build` 之后立刻跑，本地也可手动跑。
 *
 * 为什么需要它：pnpm 的 `--filter` 匹配到 0 个项目时**只打印一行提示、退出码仍是 0**，
 * 于是根脚本 `pnpm build` 会静默空跑。这个坑在 Windows 上真实发生过 ——
 * package.json 脚本里的 filter 用单引号（`--filter './packages/**'`）时，pnpm 在
 * Windows 下不会剥单引号（`shell-emulator` true/false 实测都不剥），filter 收到
 * 字面量后匹配 0 个包，build / typecheck / test 三道门禁全是假绿灯。
 * 这里用「产物必须存在且非空」把空跑变成硬失败。
 *
 * 用法：node tools/verify-dist.mjs [rootDir]
 *   rootDir 默认 = 仓库根；传别的目录仅用于本地彩排失败分支。
 */
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(process.argv[2] ?? resolve(here, '..'));

/** 每个包必须产出的文件（对齐三包 vite.config 的 formats / dts / css 约定）。 */
const REQUIRED = {
  core: ['index.js', 'index.cjs', 'index.umd.js', 'index.iife.js', 'index.d.ts'],
  vue: ['index.js', 'index.d.ts', 'index.css'],
  react: ['index.js', 'index.d.ts', 'index.css']
};

const problems = [];
let checked = 0;
let totalBytes = 0;

console.log(`[verify-dist] root = ${repoRoot}`);

for (const [pkg, files] of Object.entries(REQUIRED)) {
  for (const f of files) {
    const abs = join(repoRoot, 'packages', pkg, 'dist', f);
    const label = `packages/${pkg}/dist/${f}`;
    let size = 0;
    try {
      const st = statSync(abs);
      if (!st.isFile()) {
        problems.push(`${label} : 不是普通文件`);
        continue;
      }
      size = st.size;
    } catch {
      problems.push(`${label} : 缺失（build 未产出该文件）`);
      continue;
    }
    if (size === 0) {
      problems.push(`${label} : 0 字节（空产物）`);
      continue;
    }
    checked++;
    totalBytes += size;
    console.log(`[verify-dist] ok      ${label.padEnd(34)} ${size} B`);
  }
}

if (problems.length) {
  console.error(
    `[verify-dist] 失败：${problems.length} 个必需产物缺失或为空` +
      `（通过 ${checked}/${checked + problems.length}）。`
  );
  for (const p of problems) console.error(`[verify-dist]   - ${p}`);
  console.error(
    '[verify-dist] 多半是 `pnpm build` 空跑：检查根 package.json 里 ' +
      '`--filter` 的引号写法（Windows 下 pnpm 不剥单引号，须用双引号或无引号）。'
  );
  process.exit(1);
}

console.log(
  `[verify-dist] 通过：core+vue+react 共 ${checked} 个必需产物全部存在且非空，合计 ${totalBytes} B`
);
