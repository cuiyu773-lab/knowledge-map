import type { ZhituApi } from './index'

declare global {
  interface Window {
    zhitu: ZhituApi
  }
}

export {}
