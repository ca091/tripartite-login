import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { microsoftRedirectUri } from '../shared/microsoft.ts'

const filename = new URL('../app/components/auth/MicrosoftLogin.client.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const compiled = compileScript(descriptor, { id: 'microsoft-login-test', inlineTemplate: true })
const source = ts.transpileModule(compiled.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const identity = { provider: 'microsoft', subject: 'personal-user', name: null, email: null, emailVerified: false }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await Vue.nextTick() }
const element = type => ({ type, props: {}, children: [], parent: null, text: '' })

// Run the real SFC; replace only SDK/browser/HTTP boundaries.
function mount({ configured = true, initialize, fetch, popup } = {}) {
  const requests = [], verified = [], popups = [], initializations = []
  let starts = 0, started = 0, clears = 0
  const sdk = {
    loginPopup: options => {
      popups.push(options)
      return popup ? popup(options) : Promise.resolve({ idToken: 'signed-id-token', accessToken: 'never-submit', account: { username: 'private' } })
    },
    clearCache: async () => { clears++ }
  }
  const previousWindow = globalThis.window
  globalThis.window = { location: { origin: 'http://localhost:3000' } }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'useRuntimeConfig', '$fetch', source)(
    name => {
      if (name === 'vue') return Vue
      if (name === '~~/shared/microsoft') return { microsoftRedirectUri }
      if (name === '~/utils/microsoft-sdk') return { createMicrosoftClient: (...args) => {
        initializations.push(args)
        return initialize ? initialize(sdk) : Promise.resolve(sdk)
      } }
      throw new Error(`Unexpected dependency ${name}`)
    }, module, module.exports,
    () => ({ public: { microsoftClientId: 'our-client', microsoftRedirectUri: '' } }),
    (url, options) => {
      requests.push({ url, options })
      if (fetch) return fetch(url, options)
      return Promise.resolve(url.endsWith('/start') ? { nonce: `nonce-${++starts}`, state: 'not-used-by-component' } : identity)
    }
  )
  const renderer = Vue.createRenderer({
    createElement: element,
    createText: text => ({ ...element('#text'), text }),
    createComment: text => ({ ...element('#comment'), text }),
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text; node.children = [] },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    patchProp: (node, key, previous, next) => { node.props[key] = next },
    insert: (node, parent, anchor = null) => {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
    },
    remove: node => { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null }
  })
  const root = element('root')
  const app = renderer.createApp(module.exports.default, {
    configured, onStarted: () => started++, onVerified: value => verified.push(value)
  })
  app.component('UButton', Vue.defineComponent({
    props: { disabled: Boolean, loading: Boolean }, emits: ['click'],
    setup: (props, { emit, slots }) => () => Vue.h('button', {
      disabled: props.disabled || props.loading, onClick: () => emit('click')
    }, slots.default?.())
  }))
  app.mount(root)
  const all = (node = root) => [node, ...node.children.flatMap(child => all(child))]
  return {
    sdk, requests, verified, popups, initializations,
    get clears() { return clears }, get started() { return started },
    click: () => all().find(node => node.type === 'button').props.onClick(),
    text: () => all().map(node => node.text).join(''),
    button: () => all().find(node => node.type === 'button'),
    unmount: () => {
      app.unmount()
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    }
  }
}

test('unconfigured Microsoft button does not initialize SDK or request a challenge', async () => {
  const page = mount({ configured: false })
  await flush()
  assert.equal(page.button().props.disabled, true)
  assert.equal(page.initializations.length, 0)
  assert.equal(page.requests.length, 0)
  page.unmount()
})

test('prepares before click, directly opens popup with server nonce, and submits only the ID token', async () => {
  const response = deferred()
  const page = mount({ popup: () => response.promise })
  await flush()
  assert.deepEqual(page.initializations, [['our-client', 'http://localhost:3000/auth/callback-microsoft']])
  assert.equal(page.requests.length, 1)
  page.click()
  // No await/network request between the gesture and loginPopup.
  assert.deepEqual(page.popups, [{ nonce: 'nonce-1', scopes: ['openid', 'profile', 'email'], prompt: 'select_account', redirectUri: 'http://localhost:3000/auth/callback-microsoft' }])
  page.click()
  assert.equal(page.popups.length, 1)
  response.resolve({ idToken: 'id-token', accessToken: 'access-token', account: { username: 'private' } })
  await flush()
  assert.deepEqual(page.requests.find(item => item.url.endsWith('/verify')).options.body, { credential: 'id-token' })
  assert.deepEqual(page.verified, [identity])
  assert.equal(page.started, 1)
  assert.equal(page.clears, 1)
  page.unmount()
})

test('SDK cancel, blocked popup and timeout clear the challenge and permit a fresh attempt', async () => {
  for (const [errorCode, message] of [['user_cancelled', /已取消/], ['popup_window_error', /允许弹窗/], ['timed_out', /超时/]]) {
    let attempts = 0
    const page = mount({ popup: () => ++attempts === 1 ? Promise.reject({ errorCode }) : Promise.resolve({ idToken: 'retry-token' }) })
    await flush()
    page.click()
    await flush()
    assert.match(page.text(), message)
    assert.equal(page.requests.filter(item => item.url.endsWith('/cancel')).length, 1)
    assert.equal(page.requests.filter(item => item.url.endsWith('/verify')).length, 0)
    page.click()
    await flush()
    page.click()
    await flush()
    assert.equal(page.popups[1].nonce, 'nonce-2')
    assert.deepEqual(page.verified, [identity])
    page.unmount()
  }
})

test('an SDK response without an ID token never reaches verification', async () => {
  const page = mount({ popup: () => Promise.resolve({ accessToken: 'not-an-id-token' }) })
  await flush()
  page.click()
  await flush()
  assert.equal(page.requests.filter(item => item.url.endsWith('/verify')).length, 0)
  assert.equal(page.requests.filter(item => item.url.endsWith('/cancel')).length, 1)
  assert.equal(page.verified.length, 0)
  assert.match(page.text(), /未完成/)
  page.unmount()
})

test('start and verification failures expose retry and use a new nonce', async () => {
  let starts = 0, verifies = 0
  const page = mount({ fetch: url => {
    if (url.endsWith('/start')) return ++starts === 1 ? Promise.reject(new Error('Network')) : Promise.resolve({ nonce: `nonce-${starts}` })
    if (url.endsWith('/verify')) return ++verifies === 1 ? Promise.reject(new Error('Expired')) : Promise.resolve(identity)
    return Promise.resolve({ cancelled: true })
  } })
  await flush()
  assert.match(page.text(), /初始化失败/)
  page.click(); await flush(); page.click(); await flush()
  assert.match(page.text(), /验证失败/)
  page.click(); await flush(); page.click(); await flush()
  assert.deepEqual(page.popups.map(item => item.nonce), ['nonce-2', 'nonce-3'])
  assert.deepEqual(page.verified, [identity])
  page.unmount()
})

test('unmount ignores pending SDK initialization, challenge, popup and verification results', async () => {
  for (const boundary of ['initialize', 'start', 'popup', 'verify']) {
    const pending = deferred()
    let sdk
    const page = mount({
      initialize: value => { sdk = value; return boundary === 'initialize' ? pending.promise : Promise.resolve(value) },
      fetch: url => {
        if (url.endsWith(`/${boundary}`)) return pending.promise
        return Promise.resolve(url.endsWith('/start') ? { nonce: 'nonce-1' } : identity)
      },
      popup: () => boundary === 'popup' ? pending.promise : Promise.resolve({ idToken: 'id-token' })
    })
    await flush()
    if (boundary === 'popup' || boundary === 'verify') { page.click(); await flush() }
    page.unmount()
    pending.resolve(boundary === 'initialize' ? sdk : boundary === 'start' ? { nonce: 'old-nonce' } : boundary === 'popup' ? { idToken: 'old-token' } : identity)
    await flush()
    assert.equal(page.verified.length, 0)
    if (boundary === 'popup') assert.equal(page.requests.filter(item => item.url.endsWith('/verify')).length, 0)
    assert.ok(page.clears >= 1)
  }
})
