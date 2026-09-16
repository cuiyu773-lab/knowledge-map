import Image from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'

export const AssetImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const source = String(HTMLAttributes.src ?? '')
    const displaySource =
      source && !/^(?:data:|https?:|blob:|zhitu-asset:)/i.test(source)
        ? `zhitu-asset://workspace/${source.replace(/^\.\//, '').replace(/^\/+/, '')}`
        : source
    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        src: displaySource,
        loading: 'lazy'
      })
    ]
  }
})
