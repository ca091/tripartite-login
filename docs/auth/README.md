# 第三方登录示例

本目录说明当前仓库的 Google、Apple、GitHub 登录实现。技术栈为 Nuxt 4、Vue 3、TypeScript、Nuxt UI；三个 provider 各有独立客户端组件，首页只组合入口和展示结果。

示例的终点是“第三方授权 → 服务端确认身份 → 展示脱敏信息”。不创建本站账户、数据库或持久登录会话；刷新后清空页面结果，第三方平台自身的登录状态由平台管理。

## 入口与运行

```bash
pnpm install
# 首次运行时复制 .env.example 为 .env；已有 .env 时保留原文件。
pnpm dev
```

`nuxt.config.ts` 中开发端口为 `3000`，实际地址以终端输出为准。Google 本地测试建议统一访问 `http://localhost:3000`，并在对应 OAuth client 中登记该来源。

| 路径 | 当前行为 |
| --- | --- |
| `/` | 唯一体验页，展示三个登录入口、各自文档链接和身份结果 |
| `/auth/callback-github` | 客户端处理 GitHub 回调，验证后返回 `/` |

首页通过 `<client-only>` 挂载 `AuthLoginCollection`。该组件请求配置状态，显式排列三个登录组件。配置缺失时禁用对应按钮；状态请求失败时提供重试。配置齐全仅表示所需值存在且回调 URL 通过本地格式检查，不代表平台后台已经允许当前站点。

## 环境变量

`.env` 与 `.env.example` 按 Google → Apple → GitHub 分组，变量逐行对应。修改配置后重启开发服务；`NUXT_PUBLIC_*` 会暴露给浏览器，服务端秘密使用不带 PUBLIC 的变量。

| Provider | 浏览器公开配置 | 服务端专用配置 |
| --- | --- | --- |
| Google | `NUXT_PUBLIC_GOOGLE_CLIENT_ID`、`NUXT_PUBLIC_GOOGLE_ONE_TAP_ENABLED` | 无 |
| Apple | `NUXT_PUBLIC_APPLE_CLIENT_ID`、`NUXT_PUBLIC_APPLE_REDIRECT_URI` | `NUXT_APPLE_TEAM_ID`、`NUXT_APPLE_KEY_ID`、`NUXT_APPLE_PRIVATE_KEY` |
| GitHub | `NUXT_PUBLIC_GITHUB_CLIENT_ID`、`NUXT_PUBLIC_GITHUB_REDIRECT_URI` | `NUXT_GITHUB_CLIENT_SECRET` |

Google One Tap 开关默认 `false`；设为 `true` 后在每轮挑战准备完成时尝试提示，始终保留按钮，且不启用自动登录。组件通过 `prompt` prop 控制提示，pnpm 补丁保留 nonce 验证，详见 [Google One Tap](google.md#google-one-tap-接入说明)。

GitHub 回调变量为空时，服务端使用当前请求 origin 加 `/auth/callback-github`。Apple 必须配置有效 HTTPS 域名回调；完整配置和平台后台操作见各自文档。

Apple 文档另有[事件监听与 Promise 两种实现的对比](apple.md#两种前端实现事件监听与-promise)，包含代码示意和流程图；当前采用 Promise，服务端密钥要求与前端接收方式无关。

`.env.example` 中保留迁移来源的公开 Apple Service ID 和回调作为示例，其余凭证按需填写。示例值不表示当前域名已获授权。`.env` 被 Git 忽略，文档不依赖某台机器的本地凭证状态。

## 组件与结果

| 源码 | 职责 |
| --- | --- |
| `app/pages/index.vue` | 标题、接入文档链接、通过 client-only 加载组合组件 |
| `app/components/auth/LoginCollection.vue` | 获取配置状态、组合三个组件、清空旧结果、展示身份或回调错误 |
| `app/components/auth/GoogleLogin.client.vue` | Google 官方按钮、可选 One Tap、nonce 准备、credential 服务端验证 |
| `app/components/auth/AppleLogin.client.vue` | 预加载 Apple SDK、准备挑战、弹窗授权、code/state 服务端验证 |
| `app/components/auth/GithubLogin.client.vue` | 请求授权地址并整页跳转 GitHub |
| `app/pages/auth/callback-github.vue` | 清理回调参数、验证或取消授权、返回首页 |
| `app/composables/useAuthResult.ts` | 通过键为 `auth-result` 的 useState 在客户端导航间共享身份和消息 |
| `app/components/auth/IdentityResult.vue` | 简洁身份信息，以及默认收起的完整脱敏结果 |

三个登录组件均接收 `configured: boolean`，在发起登录操作时发出 `started`，供组合层清空旧结果。Google、Apple 验证成功后发出 `verified(AuthIdentity)`；GitHub 通过回调页更新 `useAuthResult()`，不发出 verified 事件。初始化、错误和重试留在各自组件内。

Google 按钮通过 ResizeObserver 获取容器宽度，显式设置 outline 主题、large 大小、动态 width、居中 logo 和点击回调，其余文案、语言使用 SDK 默认行为。宽度变化只重绘按钮，不重新初始化或触发 One Tap；按钮与提示共用 nonce。页面容器最大宽度为 400px，小屏随容器缩放。

结果仅存于 Nuxt 应用内存，不写入 localStorage、sessionStorage 或持久 Cookie。默认显示登录方式、用户标识、姓名和脱敏邮箱；“查看完整结果”展开的是以下字段，不含 token 或授权码：

```ts
interface AuthIdentity {
  provider: 'google' | 'apple' | 'github'
  subject: string
  name: string | null
  email: string | null
  emailVerified: boolean
}
```

`subject` 是平台稳定身份标识；Google/Apple 来自已验证 token 的 sub，GitHub 来自用户数字 ID。邮箱统一脱敏为类似 `d***@example.com`；缺失姓名或邮箱返回 null。

## 接口与授权流程

| 接口 | 请求与响应 |
| --- | --- |
| `GET /api/auth/status` | 返回各 provider 的 `provider`、`configured`、`missing`、`redirectUri` |
| `POST /api/auth/:provider/start` | 无需业务请求体；创建 Cookie 绑定挑战，返回 nonce/state，GitHub 另返回 authorizationUrl |
| `POST /api/auth/google/verify` | 请求 `{ credential }`，返回 AuthIdentity |
| `POST /api/auth/apple/verify` | 请求 `{ code, state }`，返回 AuthIdentity |
| `POST /api/auth/github/verify` | 请求 `{ code, state }`，返回 AuthIdentity |
| `POST /api/auth/:provider/cancel` | 清理挑战，幂等返回 `{ cancelled: true }` |

POST 请求必须来自同一 origin，浏览器需携带临时 Cookie。GitHub 的 PKCE verifier 只存于服务端，不在 start 响应或客户端请求体中传递。

| 平台 | 浏览器取得 | 本站服务端处理 | 所需服务端秘密 |
| --- | --- | --- | --- |
| Google | credential，即 ID token | Google JWKS 验签，核对 issuer/audience/exp/nonce | 无 |
| Apple | Apple JS 返回 code、state、id_token；本站提交 code/state | 签发 client secret、兑换 code、验证兑换结果中的 ID token | Team ID、Key ID、PKCS#8 私钥 |
| GitHub | 回调 URL 的 code/state | 用 secret + PKCE 换 token，再调用用户与邮箱接口 | OAuth App client secret |

通用路由位于 `server/api/auth/[provider]/`；verify 路由分发到 `server/providers/` 下的独立处理器。`server/utils/auth.ts` 管理配置、同源检查和 Cookie，`auth-core.ts` 管理挑战与脱敏，`auth-tokens.ts` 管理 JWT 验证和 Apple client secret 签名。

## 临时状态与运行边界

- `ChallengeStore` 使用单进程内存 Map，上限 1000 条，挑战有效期 10 分钟。每个平台每个浏览器只保留一个待完成流程，重新 start 会替换旧挑战。
- Cookie 名为 `oauth_demo_<provider>`，使用 HttpOnly、SameSite=Lax、path=/，HTTPS 时开启 Secure。验证时消费一次并删除 Cookie，失败后需重新开始。
- start/verify/cancel 校验 Origin；身份接口设置 `Cache-Control: no-store` 和 `Referrer-Policy: no-referrer`。
- Google、Apple 验签算法为 RS256，检查 issuer、audience、有效期、必需声明和 nonce；Apple client secret 使用 ES256，当前有效期为 5 分钟。
- 不把 access token、refresh token、授权码或私钥放进结果。只 decode JWT 不能替代验签，邮箱不能替代稳定身份标识。
- 服务重启或热更新可能让旧挑战失效。多实例部署需要共享 TTL 存储和原子消费，并补充流量限制。
- 需要 Nuxt 服务端：`pnpm build` 后运行 `.output/server/index.mjs`，并注入运行环境变量。纯静态 generate 无法提供验证接口；生产进程不会自动加载开发 `.env`。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

现有测试通过 GIS SDK 桩运行真实 Vue 组件及补丁后依赖，覆盖三个发布产物的 Google 开关、nonce、挑战轮次、重复回调、宽度变化和卸载清理。单元测试覆盖 PKCE、挑战单次消费/过期/取消、JWT 签名与声明校验、身份白名单和邮箱脱敏。通过这些检查不代表真实平台授权已成功。

运行开发服务后，执行 `pnpm test:smoke`，默认请求 `http://localhost:3000`；其他地址通过 `AUTH_SMOKE_URL` 指定。脚本检查首页、GitHub 回调页、文档、provider 接口与独立 provider 体验路由返回 404，并使用模拟凭证验证同源、挑战绑定及重复使用防护，不发起真实第三方授权。

浏览器验收包括：未配置按钮禁用、文档可访问、配置读取失败可重试、Google/Apple 失败后可重新准备、GitHub 成功/取消/缺参/失败后返回首页、结果展开收起与刷新清空。真实授权需在平台获准的 origin/回调下测试；Google `400: origin_mismatch` 处理步骤见 [Google 文档](google.md#本地-origin_mismatch-排查)。

## 平台文档

Google 使用 vue3-google-login，Apple 和 GitHub 分别使用独立组件。Google 使用固定版本 `vue3-google-login@2.1.4`，通过组件 props 管理按钮与可选 One Tap，pnpm 补丁修复 nonce 覆盖及宽度更新、卸载处理。

- [Google 接入](google.md)
- [Apple 接入](apple.md)
- [GitHub 接入](github.md)
