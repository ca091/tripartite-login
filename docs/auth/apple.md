# Apple 登录案例

入口：`/`。源码：`app/utils/apple-sdk.ts`、`app/components/auth/AppleLogin.client.vue`、`server/providers/apple.ts`、`server/utils/auth-tokens.ts`。

## 原理

沿用源 Apple JS SDK **popup 模式**。服务端生成随机 state/nonce，SDK 在点击时打开 Apple 弹窗，返回 code、state、id_token。

本例将 code/state 发给 `/api/auth/apple/verify`。服务端消费浏览器绑定挑战、核对 state，用开发者 `.p8` 私钥以 ES256 签发短时 **client secret JWT**（issuer=Team ID，subject=Services ID，audience=`https://appleid.apple.com`，header kid=Key ID）。然后向 `/auth/token` 兑换 code，用 Apple JWKS 验证响应中 ID token 的签名、issuer、audience、有效期和 nonce。

开发者签名的 client secret 与 Apple 签名的 ID token 用途不同。浏览器返回的 token 不直接当作可信身份。本例不保存 access/refresh token，不建立本站会话。

## 两种前端实现：事件监听与 Promise

Apple 官方支持以下两种 popup 授权结果接收方式。两者使用相同的 Apple JS SDK，也都可以取得 `authorization.code`、`authorization.state`、`authorization.id_token`；差异在于按钮触发和结果处理方式，不影响服务端验证要求。

| 对比项 | 事件监听（迁移源项目） | Promise（当前 demo） |
| --- | --- | --- |
| 按钮与触发 | SDK 渲染 `id="appleid-signin"` 的按钮并发起授权 | Nuxt UI 按钮点击后调用 `AppleID.auth.signIn()` |
| 成功结果 | 监听 `AppleIDSignInOnSuccess`，从 `event.detail` 读取 | `await signIn()` 获取结果 |
| 失败结果 | 监听 `AppleIDSignInOnFailure` | `try/catch` 捕获拒绝 |
| 生命周期 | 组件挂载时注册，卸载时移除全局监听 | 无需注册全局结果监听，处理逻辑集中在点击函数中 |
| 适用场景 | 使用 SDK 按钮，由事件回调接收结果 | 使用自定义按钮，集中处理 loading、错误和验证 |

### 方案一：监听 SDK 事件

迁移源的 `app/components/biz/AppleLogin.vue` 使用 SDK 按钮及 `document.addEventListener`。以下是接入当前服务端验证接口的核心示意，**当前 demo 未启用此方案**：

```ts
interface AppleAuthorization {
  code: string
  state: string
  id_token: string
}

function handleSuccess(event: Event) {
  const { authorization } = (event as CustomEvent<{
    authorization: AppleAuthorization
  }>).detail
  void verifyAuthorization(authorization).catch(handleFailure)
}

function handleError(event: Event) {
  handleFailure((event as CustomEvent<{ error: string }>).detail)
}

onMounted(() => {
  document.addEventListener('AppleIDSignInOnSuccess', handleSuccess)
  document.addEventListener('AppleIDSignInOnFailure', handleError)
  // 随后加载 SDK、请求 start、auth.init({ ..., usePopup: true })。
  // 准备完成后展示 SDK 的 appleid-signin 按钮。
})

onUnmounted(() => {
  document.removeEventListener('AppleIDSignInOnSuccess', handleSuccess)
  document.removeEventListener('AppleIDSignInOnFailure', handleError)
})
```

SDK 按钮容器为 `<div id="appleid-signin" data-color="black" data-type="sign-in"></div>`。采用此方案时需让 SDK 管理该按钮，并在准备好挑战前阻止发起授权。事件监听属于 document 全局范围，应只挂载一个负责处理该登录流程的组件，并在组件内防止重复提交。

迁移源成功回调只比较固定的 `state`，然后 `emit('appleLogin', id_token)`；未设置 nonce。其父组件未接收该事件，所检查的示例中没有完整的服务端验证链路。借鉴时应保留当前随机 state/nonce 与服务端校验，不能直接把收到 token 视为身份验证成功。

### 方案二：等待 signIn 的 Promise

当前 `app/components/auth/AppleLogin.client.vue` 采用此方案。SDK 与挑战提前准备完成，用户点击 Nuxt UI 按钮后，直接调用 `signIn()` 打开弹窗，再处理结果：

```ts
async function login() {
  try {
    // 在用户点击处理器中直接执行；不要先等待 start 等网络请求。
    const result = await window.AppleID!.auth.signIn()
    await verifyAuthorization(result.authorization)
  } catch (error: unknown) {
    handleFailure(error)
  }
}
```

以上两个示意共用的验证逻辑如下；`AuthIdentity` 类型来自 `shared/types/auth`，`emit` 由组件声明。`handleFailure` 代表组件自己的错误处理，应包含取消提示、尽力调用 `/api/auth/apple/cancel` 和恢复界面状态；实际组件还包含 busy/ready、防止重复点击及重新准备逻辑，见后文“组件行为与复用”。

```ts
async function verifyAuthorization(authorization: { code: string, state: string }) {
  const identity = await $fetch<AuthIdentity>('/api/auth/apple/verify', {
    method: 'POST',
    body: { code: authorization.code, state: authorization.state }
  })
  emit('verified', identity)
}
```

同一轮授权只选择一种方式提交验证，避免事件回调与 Promise 成功分支同时请求 verify；挑战和授权码均只能使用一次。当前保留 Promise 方案，便于配合 Nuxt UI 按钮集中管理状态。

### 接收方式与验证链路的关系

```mermaid
flowchart TD
    P[加载 SDK、请求 start 获取随机 state/nonce、初始化 popup] --> E[SDK 按钮发起授权]
    P --> F[Nuxt UI 按钮调用 auth.signIn]
    E --> G[事件监听：成功读取 event.detail，失败处理错误]
    F --> H[Promise：成功取得 result，失败进入 catch]
    G -->|授权成功| V[提交 code/state 到本站 verify]
    H -->|授权成功| V
    V --> C[校验挑战与 state，生成 client secret，向 Apple 换码]
    C --> T[验证换码 ID token 的签名、声明和 nonce]
    T --> I[返回已验证的脱敏身份]
```

**Team ID、Key ID、Private Key 的必要性由服务端验证路线决定，与监听或 Promise 无关。** 单独打开弹窗只需要公开的 Services ID、已登记的 Return URL 等初始化参数；本 demo 的完整流程还需这三个值签发 `client_secret`，才能调用 Apple `/auth/token`。改成监听方式仍然需要它们。

如果改为服务端直接验证浏览器返回的 ID token，则验签使用 Apple 公钥，本身不需要开发者私钥；但这属于另一种验证路线，需要调整接口及验证设计，当前 demo 未实现。只在前端 decode token 或通过组件 emit 传出 token，不等于完成可信身份验证。

## 完整流程图

下图描述当前 Promise 方案，区分浏览器弹窗响应与服务端换码响应。本站只验证换码取得的 ID token；开发者签发的 client secret 仅用于向 Apple 证明应用身份。

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant B as 浏览器 / AppleLogin
    participant S as Nuxt 服务端
    participant M as 服务端挑战存储
    participant A as Apple SDK / 授权与 token 服务

    B->>S: GET /api/auth/status
    alt 状态请求失败
        S-->>B: 请求错误
        B-->>U: 显示配置读取失败，提供重试
    else Apple 配置缺失或回调格式无效
        S-->>B: configured = false
        B-->>U: 禁用 Apple 登录按钮
    else Apple 配置齐全
        S-->>B: configured = true
        B->>A: 加载或复用 Apple JS SDK
        alt SDK 加载失败或超时
            B-->>U: 显示初始化失败，可重新准备
        else SDK 就绪
            B->>S: POST /api/auth/apple/start
            S->>S: 校验同源 Origin 和 provider 配置
            alt start 失败
                S-->>B: 错误响应
                B-->>U: 显示初始化失败，可重新准备
            else start 成功
                S->>M: 替换旧挑战，保存 state/nonce/redirect URI，10 分钟有效
                S-->>B: state/nonce + HttpOnly 挑战 Cookie
                B->>A: auth.init：client ID、redirect URI、name email、state/nonce、popup
                alt SDK 初始化抛错
                    B-->>U: 显示初始化失败，可重新准备
                else SDK 初始化成功，ready = true
                U->>B: 点击 Sign in with Apple
                B->>B: 发出 started，清空上次结果
                B->>A: 在点击处理器中直接调用 auth.signIn()
                alt 取消授权、关闭弹窗或 SDK 报错
                    A-->>B: signIn 拒绝，返回错误
                    B->>B: 设置取消或失败提示
                    B->>S: POST /api/auth/apple/cancel（尽力清理）
                    S->>M: 清理挑战，并删除 Cookie
                    S-->>B: cancelled = true，清理请求失败也继续恢复界面
                else 弹窗授权成功
                    A-->>B: code、state、id_token，可能含首次授权资料
                    Note over B,S: 浏览器只提交 code/state，不直接信任弹窗 id_token 或姓名
                    B->>S: POST /api/auth/apple/verify，携带 code/state 和 Cookie
                    S->>S: 校验同源 Origin 和配置
                    S->>M: 按 Cookie 一次性消费挑战，并删除 Cookie
                    S->>S: 检查参数并比对 state
                    alt 挑战、参数或 state 无效
                        S-->>B: 验证错误
                    else 本站挑战校验通过
                        S->>S: 用 p8 私钥签发 ES256 client secret（有效期 5 分钟）
                        S->>A: POST /auth/token：code、client ID/secret、redirect URI
                        A-->>S: 换码响应或错误
                        opt 换码成功且包含 id_token
                            S->>A: 获取 Apple JWKS（可复用缓存）
                            A-->>S: Apple 公钥
                            S->>S: 校验 ID token 的 RS256、issuer、audience、有效期、必需声明、nonce
                        end
                        alt 签名、换码或 token 校验失败
                            S-->>B: 验证错误
                        else 身份可信
                            S-->>B: AuthIdentity（sub、可选资料、脱敏邮箱等）
                        end
                    end
                    alt verify 失败或请求异常
                        B->>B: 设置登录未完成提示
                        B->>S: POST /api/auth/apple/cancel（尽力清理）
                        S->>M: 清理剩余挑战，并删除 Cookie
                    else verify 成功
                        B->>B: 发出 verified，保存到 useAuthResult
                        B-->>U: 展示脱敏身份
                    end
                end
                B->>B: finally：busy = false，ready = false
                Note over U,B: 点击“重新准备 Apple 登录”重新加载 SDK/挑战；准备完成后再次点击才开弹窗
                end
            end
        end
    end
    Note over U,B: 身份结果只存内存；刷新页面后清空，不建立本站登录会话
```

## 平台后台配置

1. 在 Apple Developer 中为关联 App ID 启用 Sign in with Apple，关联 primary App ID。
2. 配置 **Services ID** 作为 Web client ID，关联相应 App ID。
3. 在 Web Authentication Configuration 登记网站域名与 **Return URLs**。
4. 创建 Sign in with Apple 密钥，记录 **Team ID**、**Key ID**，下载并安全保存 `.p8` 私钥。
5. 确保实际站点与回调满足后台约束。Return URL 必须使用 HTTPS 域名，不能是 IP、localhost 或含 `#`。

`.env.example` 保留迁移来源的公开示例配置：

```dotenv
NUXT_PUBLIC_APPLE_CLIENT_ID=com.YunFang.PhotoGrid.SignInWithApple
NUXT_PUBLIC_APPLE_REDIRECT_URI=https://www.photogrid.app
```

这些属于源应用，不表示当前站点已获准。使用受你控制的 HTTPS 测试域名时，需要同步修改平台后台和环境变量，并通过该站点访问本应用；不能把 localhost 填作 Apple Return URL。

## 环境变量与运行

```dotenv
NUXT_PUBLIC_APPLE_CLIENT_ID=<Services ID>
NUXT_PUBLIC_APPLE_REDIRECT_URI=<registered HTTPS Return URL>
NUXT_APPLE_TEAM_ID=<Team ID>
NUXT_APPLE_KEY_ID=<Key ID>
NUXT_APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

在被忽略的 `.env` 中可用带引号、含字面量 `\n` 的单行 PEM，服务端导入前还原换行。不能把私钥放到 NUXT_PUBLIC 配置、提交 `.p8` 或贴入文档。

`.env.example` 中 Team ID、Key ID 和私钥留空。在 `.env` 的 Apple 分组补齐上述五项，修改后重启开发服务。缺项或回调 URL 不符合本地校验时，页面禁用 Apple 登录入口并提示未配置；填齐不代表 Apple 后台已允许当前站点。

| 服务端配置 | 用途 | 获取位置 |
| --- | --- | --- |
| `NUXT_APPLE_TEAM_ID` | client secret 的 `iss`，标识开发者团队 | Apple Developer 团队信息 |
| `NUXT_APPLE_KEY_ID` | client secret JWT header 的 `kid`，标识签名密钥 | Apple Developer 的 Sign in with Apple 密钥详情 |
| `NUXT_APPLE_PRIVATE_KEY` | 使用 ES256 签署 client secret | 上述密钥下载的 `.p8` 私钥内容 |

开发服务默认端口为 `3000`，实际地址以终端输出为准。真实 Apple 登录需使用已登记的 HTTPS 站点，不应仅按默认 localhost 地址验收。

## 组件行为与复用

1. 组件挂载且配置齐全时，加载 Apple JS SDK，再向 `/api/auth/apple/start` 请求 state/nonce。
2. SDK 初始化使用公开 client ID、redirect URI、`scope: 'name email'`、state/nonce 和 `usePopup: true`。
3. 准备完成后，用户点击按钮直接调用 `signIn()`，避免先等待网络请求而丢失用户手势。组件发出 `started` 清空旧结果。
4. 将返回的 code/state 提交服务端，验证成功发出 `verified(AuthIdentity)`。取消或失败时显示反馈，并尽力请求 `/api/auth/apple/cancel` 清理挑战。
5. 一次尝试结束后恢复为未准备状态。点击“重新准备 Apple 登录”仅执行准备，准备完成后再次点击“Sign in with Apple”打开弹窗。

SDK 加载器复用同一个加载 Promise，已有 `window.AppleID` 时直接使用；加载超时为 15 秒，失败后移除 script 并允许重试。

父组件局部模板：

```vue
<AuthAppleLogin
  :configured="status.configured"
  @started="resetResult"
  @verified="identity = $event"
/>
```

`status`、`resetResult` 和 `identity` 由父组件提供，同时保留 Apple start/verify/cancel 接口及 runtimeConfig。完整组合见 `app/components/auth/LoginCollection.vue`。返回字段与公共状态机制见 [总览](README.md#组件与结果)。

## 用户资料特殊性

Apple 通常只在首次授权返回含姓名的 user 对象；之后可能没有姓名。用户可隐藏邮箱，获得私密转送地址。

本例不持久化资料，不把浏览器提交的、未包含在签名身份 token 中的姓名当成已验证事实，因此姓名可显示“平台未提供”。如将来要保留首次姓名，应另行设计输入校验与资料存储。身份使用已验证 token 的 sub。

## 常见问题

| 现象 | 排查 |
| --- | --- |
| 配置齐全但授权失败 | 检查当前域名、Services ID、Return URL 关联；旧回调不自动授权新站点 |
| invalid_client | Team ID、Key ID、Services ID、私钥与 client secret 签名 |
| invalid_grant | code 已使用、已过期或 redirect_uri 不一致；重新准备并授权 |
| 弹窗被拦截/关闭 | 允许弹窗、从用户点击触发，重新准备登录 |
| SDK 加载失败 | 检查 Apple CDN 网络/CSP，使用页面重试入口 |
| 姓名缺失/relay 邮箱 | 属于正常首次授权与隐私行为 |

## 验收

在密钥和已登记 HTTPS 站点就绪前，可检查页面、缺项提示、构建及离线密码学测试。真实验收需完成弹窗授权、服务端验证并展示脱敏身份，还应覆盖取消、失败后重新准备、错误 state/nonce、过期与重复 code。公共检查命令及 smoke 脚本说明见 [总览](README.md#验证)。

## 官方参考

- [配置网页与 popup 响应](https://developer.apple.com/documentation/signinwithapple/configuring-your-webpage-for-sign-in-with-apple)
- [开发者环境、Services ID 与密钥](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple)
- [验证用户](https://developer.apple.com/documentation/signinwithapple/verifying-a-user)
- [兑换授权码](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens)
- [ClientConfigI](https://developer.apple.com/documentation/signinwithapplejs/clientconfigi)
