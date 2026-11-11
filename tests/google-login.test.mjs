import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'

// Mount the real SFC AND installed, patched library. Only GIS, HTTP and the
// browser DOM/measurement are replaced; all package formats use their real code.
const filename = new URL('../app/components/auth/GoogleLogin.client.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const compiled = compileScript(descriptor, { id: 'google-login-test', inlineTemplate: true })
const source = ts.transpileModule(compiled.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const require = createRequire(import.meta.url)
const packageDir = dirname(require.resolve('vue3-google-login/package.json'))
const identity = { provider: 'google', subject: '123', name: null, email: null, emailVerified: false }

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve))
  await Vue.nextTick()
}

function element(type) {
  return {
    type, props: {}, children: [], parent: null, text: '',
    getBoundingClientRect: () => ({ width: 400 }),
    replaceChildren() { this.children = [] }
  }
}

function mount({ flag = false, configured = true, fetch, format = 'cjs', loadSDK = true, promptThrows = false } = {}) {
  const initialized = [], buttons = [], requests = [], verified = []
  let prompts = 0, cancels = 0, starts = 0, started = 0, observer
  const scripts = []
  const previousWindow = globalThis.window, previousDocument = globalThis.document
  const sdk = {
    initialize: options => initialized.push(options),
    renderButton: (target, options) => buttons.push({ target, options }),
    prompt: () => { prompts++; if (promptThrows) throw new Error('Unavailable') },
    cancel: () => { cancels++ }
  }
  globalThis.window = { google: { accounts: { id: sdk } } }
  globalThis.document = {
    createElement: tag => ({ tag, events: {}, addEventListener(name, fn) { this.events[name] = fn }, appendChild() {} }),
    createTextNode: text => ({ text }),
    head: { appendChild(node) {
      if (!node.src) return
      scripts.push(node)
      if (loadSDK) queueMicrotask(() => node.events.load())
    } }
  }
  let packageSource = readFileSync(join(packageDir, `dist/index.${format}.js`), 'utf8')
  if (format === 'esm') packageSource = ts.transpileModule(packageSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const dependency = { exports: {} }
  new Function('require', 'module', 'exports', packageSource)(
    name => { assert.equal(name, 'vue'); return Vue }, dependency, dependency.exports
  )
  const fetchAPI = (url, options) => {
    requests.push({ url, options })
    if (fetch) return fetch(url, options)
    if (url.endsWith('/start')) return Promise.resolve({ nonce: `nonce-${++starts}`, state: 'unused' })
    return Promise.resolve(identity)
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; observer = this }
    observe() {}
    disconnect() { this.disconnected = true }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'useRuntimeConfig', '$fetch', 'ResizeObserver', source)(
    name => {
      if (name === 'vue') return Vue
      if (name === 'vue3-google-login') return dependency.exports
      throw new Error(`Unexpected dependency: ${name}`)
    },
    module, module.exports,
    () => ({ public: { googleClientId: 'test-client', googleOneTapEnabled: flag } }),
    fetchAPI, ResizeObserver
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
    remove: node => {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = null
    }
  })
  const root = element('root')
  const app = renderer.createApp(module.exports.default, {
    configured,
    onStarted: () => started++,
    onVerified: result => verified.push(result)
  })
  app.component('UButton', Vue.defineComponent({
    props: ['disabled', 'loading'],
    emits: ['click'],
    setup: (props, { emit, slots }) => () => Vue.h('button', {
      disabled: props.disabled || props.loading,
      onClick: () => emit('click')
    }, slots.default?.())
  }))
  app.mount(root)
  const all = (node = root) => [node, ...node.children.flatMap(child => all(child))]
  return {
    sdk, initialized, buttons, requests, verified, root,
    get prompts() { return prompts },
    get cancels() { return cancels },
    get started() { return started },
    resize: width => observer.callback([{ contentRect: { width } }]),
    retry: () => all().find(node => node.type === 'button').props.onClick(),
    text: () => all().map(node => node.text).join(''),
    loadScript: () => scripts[0].events.load(),
    unmount: () => {
      app.unmount()
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
      if (previousDocument === undefined) delete globalThis.document
      else globalThis.document = previousDocument
    },
    get disconnected() { return observer.disconnected }
  }
}

test('One Tap is opt-in; the real component preserves nonce and disables auto-select for every flag', async () => {
  for (const format of ['cjs', 'esm', 'umd']) {
    for (const flag of [undefined, false, 'false', '', 'TRUE', 1, true, 'true']) {
      const page = mount({ flag, format })
      await flush()
      assert.equal(page.prompts, flag === true || flag === 'true' ? 1 : 0)
      assert.equal(page.initialized.length, 1)
      assert.equal(page.initialized[0].client_id, 'test-client')
      assert.equal(page.initialized[0].nonce, 'nonce-1')
      assert.equal(page.initialized[0].auto_select, false)
      assert.equal(page.buttons.length, 1)
      page.unmount()
    }
  }
  const missing = mount({ flag: true, configured: false })
  await flush()
  assert.equal(missing.requests.length, 0)
  assert.equal(missing.initialized.length, 0)
  assert.equal(missing.prompts, 0)
  missing.unmount()
})

test('resize redraws only the button, leaving the One Tap challenge and prompt unchanged', async () => {
  const page = mount({ flag: true })
  await flush()
  page.resize(320)
  await flush()
  page.resize(320)
  await flush()
  page.resize(375)
  await flush()
  assert.deepEqual(page.buttons.map(item => item.options.width), ['400', '320', '375'])
  assert.equal(page.initialized.length, 1)
  assert.equal(page.prompts, 1)
  assert.equal(page.requests.length, 1)
  page.unmount()
  assert.equal(page.disconnected, true)
  assert.equal(page.cancels, 1)
  page.resize(300)
  assert.equal(page.buttons.length, 3)
})

test('unavailable One Tap leaves the button usable; duplicate credentials cause only one verify', async () => {
  const pending = deferred()
  const page = mount({
    flag: true, promptThrows: true,
    fetch: url => url.endsWith('/start') ? Promise.resolve({ nonce: 'shared-nonce' }) : pending.promise
  })
  await flush()
  assert.equal(page.buttons.length, 1)
  assert.equal(page.text().includes('失败'), false)
  page.buttons[0].options.click_listener()
  const callback = page.initialized[0].callback
  callback({ credential: 'signed-token' })
  callback({ credential: 'signed-token' })
  assert.equal(page.requests.filter(item => item.url.endsWith('/verify')).length, 1)
  assert.deepEqual(page.requests[1].options.body, { credential: 'signed-token' })
  pending.resolve(identity)
  await flush()
  assert.deepEqual(page.verified, [identity])
  assert.ok(page.started > 0)
  page.unmount()
})

test('failed verification can prepare a new nonce; callbacks from the old nonce are ignored', async () => {
  let starts = 0, verifies = 0
  const page = mount({ flag: true, fetch: url => {
    if (url.endsWith('/start')) return Promise.resolve({ nonce: `nonce-${++starts}` })
    return ++verifies === 1 ? Promise.reject(new Error('Expired')) : Promise.resolve(identity)
  } })
  await flush()
  const old = page.initialized[0].callback
  old({ credential: 'expired-token' })
  await flush()
  assert.match(page.text(), /验证失败/)
  page.retry()
  await flush()
  assert.equal(page.initialized[1].nonce, 'nonce-2')
  assert.equal(page.prompts, 2)
  old({ credential: 'stale-token' })
  assert.equal(verifies, 1)
  page.initialized[1].callback({ credential: 'fresh-token' })
  await flush()
  assert.equal(verifies, 2)
  assert.deepEqual(page.verified, [identity])
  page.unmount()
})

test('start failure exposes retry; unmount ignores pending requests and SDK loading', async () => {
  let starts = 0
  const page = mount({ flag: true, fetch: () => {
    if (++starts === 1) return Promise.reject(new Error('Network'))
    return Promise.resolve({ nonce: 'retry-nonce' })
  } })
  await flush()
  assert.match(page.text(), /初始化失败/)
  page.retry()
  await flush()
  assert.equal(page.initialized.length, 1)
  assert.equal(page.initialized[0].nonce, 'retry-nonce')
  assert.equal(page.prompts, 1)
  page.unmount()

  const pending = deferred()
  const disposed = mount({ flag: true, fetch: () => pending.promise })
  disposed.unmount()
  pending.resolve({ nonce: 'too-late' })
  await flush()
  assert.equal(disposed.initialized.length, 0)
  assert.equal(disposed.prompts, 0)
  assert.equal(disposed.verified.length, 0)

  const loading = mount({ flag: true, loadSDK: false })
  await flush()
  // Retain the mock window until the library's delayed load callback settles.
  const testWindow = globalThis.window
  loading.unmount()
  globalThis.window = testWindow
  loading.loadScript()
  await flush()
  delete globalThis.window
  assert.equal(loading.initialized.length, 0)
  assert.equal(loading.prompts, 0)
})
