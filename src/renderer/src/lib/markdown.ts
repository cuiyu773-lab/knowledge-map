import DOMPurify from 'dompurify'
import katex from 'katex'
import { marked } from 'marked'

function protectMath(markdown: string): { markdown: string; expressions: Array<{ token: string; value: string; display: boolean }> } {
  const expressions: Array<{ token: string; value: string; display: boolean }> = []
  let index = 0
  const add = (value: string, display: boolean) => {
    const token = `ZTOKENMATH${index}Z`
    expressions.push({ token, value, display })
    index += 1
    return token
  }
  const withBlock = markdown.replace(/\$\$([\s\S]+?)\$\$/g, (_match, value: string) => add(value.trim(), true))
  return {
    markdown: withBlock.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_match, value: string) => add(value.trim(), false)),
    expressions
  }
}

export function renderMarkdown(markdown: string): string {
  const protectedValue = protectMath(markdown)
  const rawHtml = marked.parse(protectedValue.markdown, { gfm: true, breaks: true }) as string
  let html = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel']
  })
  for (const expression of protectedValue.expressions) {
    let rendered: string
    try {
      rendered = katex.renderToString(expression.value, {
        displayMode: expression.display,
        throwOnError: false,
        strict: 'ignore',
        output: 'htmlAndMathml'
      })
    } catch {
      rendered = `<span class="math-error" title="公式格式无效">${expression.display ? '$$' : '$'}${escapeHtml(expression.value)}${expression.display ? '$$' : '$'}</span>`
    }
    html = html.replaceAll(expression.token, rendered)
  }
  const wrapper = document.createElement('div')
  wrapper.innerHTML = html
  wrapper.querySelectorAll('img').forEach((image) => {
    const source = image.getAttribute('src') ?? ''
    if (source && !/^(?:data:|https?:|blob:|zhitu-asset:)/i.test(source)) {
      image.setAttribute('src', `zhitu-asset://workspace/${source.replace(/^\.\//, '').replace(/^\/+/, '')}`)
    }
    image.setAttribute('loading', 'lazy')
  })
  wrapper.querySelectorAll('a').forEach((link) => {
    const href = link.getAttribute('href') ?? ''
    if (/^(?:https?:|mailto:)/i.test(href)) {
      link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noreferrer')
    } else if (!href.startsWith('#')) {
      link.removeAttribute('href')
    }
  })
  return wrapper.innerHTML
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }
    return entities[character] ?? character
  })
}

export function summarizeMarkdown(markdown: string, length = 90): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`$-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > length ? `${plain.slice(0, length)}…` : plain
}
