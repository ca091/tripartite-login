# 三方登录实验室

Nuxt 4 + Vue 3 + TypeScript + Nuxt UI 的第三方登录案例。首批从 `lewo_frontend/nuxt-v4` 迁移 Google、Apple、GitHub，补齐服务端身份验证与逐平台文档。

## 运行

需要 Node.js 24+ 和 pnpm。

```bash
pnpm install
cp .env.example .env # 已有 .env 时不要覆盖
pnpm dev
```

打开终端提示的地址（通常为 `http://localhost:3000`）。首页直接体验三种登录；未配置的平台会禁用登录入口并提示未配置，具体配置见对应文档。

本次迁移已将源项目已有的必要配置映射到本机、被 Git 忽略的 `.env`，没有整体复制源 `.env`。Google/GitHub 配置仍需验证允许域名；Apple 沿用原 Service ID 与 `https://www.photogrid.app`，缺少的 Team ID、Key ID 和私钥预留为空。新克隆需自行填写 `.env`。

## 案例与文档

| 平台 | 演示路由 | 使用文档 |
| --- | --- | --- |
| Google | `/` | [Google 接入](docs/auth/google.md) |
| Apple | `/` | [Apple 接入](docs/auth/apple.md) |
| GitHub | `/` | [GitHub 接入](docs/auth/github.md) |

首页 `/` 组合三个独立组件：`AuthGoogleLogin`、`AuthAppleLogin`、`AuthGithubLogin`，所有登录方式共用此入口。登录后展示简洁身份信息，可展开完整脱敏结果；刷新后清空。文档通过 `/docs/auth/<provider>.md` 提供原始 Markdown 阅读，构建时直接打包 `docs/auth/`，不维护额外副本。

先读 [原理、配置与迁移说明](docs/auth/README.md)。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm build
```

运行本地服务后，可用 `AUTH_SMOKE_URL=http://localhost:3000 pnpm test:smoke` 检查页面、文档、路由与防护接口。它不会跳转第三方或提交真实授权。

自动测试覆盖 PKCE、一次性挑战、JWT 验签/受众/签发者/有效期/nonce 和结果脱敏。通过测试不等于真实平台授权通过，真实登录需有正确后台配置及浏览器账号。

## 边界

案例终点是服务端确认第三方身份并展示脱敏结果，不创建本站账户、数据库或持久登录态。临时挑战存于单个 Node 进程内，10 分钟有效，验证后消费；服务重启会清空。多实例部署前需改成共享原子存储，不能直接作为生产账户系统。

必须使用有 Nuxt 服务端的部署：`pnpm build` 后运行 `.output/server/index.mjs`。部署时使用平台环境变量；构建产物不会自动加载开发 `.env`。纯静态 `generate` 无法运行身份验证接口。
