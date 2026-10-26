# 贡献指南

## 环境

- Node `>= 20.19`（各包 `>= 18`）
- pnpm `12.14.0`（`packageManager` 已锁，别用 npm / yarn 安装）

```bash
pnpm install
pnpm build          # 全新 clone 必须先 build，三包的 exports["."] 都指向 dist
```

## 门禁（提交前必须全绿）

顺序固定，**逐条单独取退出码**——管道里 `cmd | tail` 报的是 `tail` 的退出码：

```bash
pnpm build
pnpm verify:dist
pnpm typecheck
pnpm test
pnpm --filter playground typecheck
PAGES_REPO=regex node tools/pages.mjs
```

三条容易踩的点：

1. 根脚本的 filter 必须写成 JSON 转义双引号 `--filter \"./packages/**\"`。Windows 下 pnpm
   不剥单引号，filter 会被当字面量 → 匹配 0 个项目 → **退出码仍是 0**，build/typecheck/test
   三道门禁集体假绿灯。
2. `verify:dist` 是判断"真跑了没有"的唯一硬守卫（11 个产物存在且非 0 字节）。本机 pnpm
   不打印 `Scope:` 行，不要指望它。
3. `playground` 不在 `packages/**` 覆盖范围内，typecheck 要单独跑。

## 分层规矩

- 正则语义只在 `packages/core`。适配层出现任何正则逻辑（哪怕一行 `test()`）即为分层破口。
- core **零运行时依赖**且不引用 `document` / `window` / `navigator`；`test/index.test.ts`
  里有对应断言，别绕过。
- 语言探测由宿主完成：把 `navigator.languages` 之类的候选数组传给 `resolveLocale()`。
- UI 文案与正则领域术语进 core 的 `i18n.ts`；**具体正则样例与演示文本进 playground**，
  不属于对外 API。
- 新增技术栈（Web Worker、适配层测试框架、第三种语言）须先与维护者确认，不要自行扩展。

## 提交规范

- 信息格式 `type(scope): 中文描述`，type 取 `feat` / `fix` / `test` / `docs` / `refactor` / `chore`。
- **必须签名**：`git commit -s`。
- 任何提交前跑全量测试。
- 新功能与缺陷修复同步补测试。

## 发版

版本遵循 SemVer。以下动作**只由维护者执行**：`git tag`、push tag、`npm publish`、dist-tag 变更。

### 首次占位发布

可信发布者（Trusted Publisher）发不了某包的第一个版本，所以首版必须手工发：

```bash
pnpm build && pnpm verify:dist
pnpm -r --filter "./packages/**" publish --access public --tag stage --no-git-checks
```

两个硬性注意点：

- 占位版本只能是 `0.0.0`。`0.0.0-stage` 会撞 npm Staged Publishing 的保留字，registry 返 403。
  **必须带 `--tag stage`**，否则 `0.0.0` 会被设成 `latest`。
- 本仓是 pnpm workspace、根 `package.json` 无 `workspaces` 字段，所以
  `npm publish -w <pkg>` 必然失败（`No workspaces found`），只能走上面的 `pnpm -r --filter`。

手工首发后，在 npm 网页给三个包配置 GitHub Trusted Publisher（owner `cn-xac`、仓库 `regex`，
workflow 名须与 `publish.yml` 的 `name` 一致），此后 `v*` tag 即由 CI 自动发版。
`publish.yml` 的 `workflow_dispatch` 默认 `dry_run=true`，手动触发不会真碰 registry。

## GitHub Pages

推 `main` → `pages.yml` 构建三包并部署到 <https://cn-xac.github.io/regex/>。
新开仓首次必挂：组织策略禁止 `GITHUB_TOKEN` 建站，需维护者一次性执行
`gh api -X POST repos/cn-xac/regex/pages -f build_type=workflow` 后 rerun。
