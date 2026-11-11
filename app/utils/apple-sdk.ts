interface AppleResponse {
  authorization: { code: string, state: string, id_token: string }
}
interface AppleSDK {
  auth: {
    init: (options: { clientId: string, scope: string, redirectURI: string, state: string, nonce: string, usePopup: boolean }) => void
    signIn: () => Promise<AppleResponse>
  }
}
declare global { interface Window { AppleID?: AppleSDK } }

let pending: Promise<AppleSDK> | undefined

export function loadAppleSDK(): Promise<AppleSDK> {
  if (window.AppleID) return Promise.resolve(window.AppleID)
  if (pending) return pending
  pending = new Promise<AppleSDK>((resolve, reject) => {
    const script = document.createElement('script')
    const fail = () => {
      clearTimeout(timeout)
      script.remove()
      pending = undefined
      reject(new Error('Apple SDK 加载失败，请检查网络后重试。'))
    }
    const timeout = setTimeout(fail, 15000)
    script.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'
    script.async = true
    script.onload = () => {
      clearTimeout(timeout)
      if (window.AppleID) resolve(window.AppleID)
      else fail()
    }
    script.onerror = fail
    document.head.appendChild(script)
  })
  return pending
}
