import { useState, type ClipboardEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { Markdown } from 'tiptap-markdown'
import {
  Bold,
  Code2,
  Eye,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pencil,
  Quote,
  Sigma,
  Underline as UnderlineIcon
} from 'lucide-react'
import { AssetImage } from '@renderer/lib/assetImage'
import { renderMarkdown } from '@renderer/lib/markdown'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'

interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
}

function markdownOf(editor: NonNullable<ReturnType<typeof useEditor>>): string {
  return (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
}

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const showToast = useWorkspaceStore((state) => state.showToast)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
      Underline,
      Placeholder.configure({ placeholder: '记录推导、例题、概念边界或自己的话……' }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      AssetImage.configure({ allowBase64: true }),
      Markdown.configure({ html: false, tightLists: true, transformPastedText: true })
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'rich-editor__content',
        spellcheck: 'false'
      }
    },
    onUpdate: ({ editor: current }) => onChange(markdownOf(current))
  })

  if (!editor) return null

  const insertImage = async () => {
    const result = await window.zhitu.assets.pick()
    if (!result.ok) {
      showToast(result.error.message, 'error')
      return
    }
    if (result.value) editor.chain().focus().setImage({ src: result.value, alt: '学习图片' }).run()
  }

  const insertFormula = (display: boolean) => {
    const expression = window.prompt(display ? '输入块级 LaTeX 公式' : '输入行内 LaTeX 公式')
    if (!expression) return
    editor.chain().focus().insertContent(display ? `$$\n${expression}\n$$` : `$${expression}$`).run()
  }

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    const href = window.prompt('输入链接地址', previous ?? 'https://')
    if (href === null) return
    if (!href.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const file = [...(event.clipboardData.files ?? [])].find((item) => item.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    void (async () => {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
      const result = await window.zhitu.assets.importBytes(bytes, file.name || 'pasted.png')
      if (!result.ok) {
        showToast(result.error.message, 'error')
        return
      }
      editor.chain().focus().setImage({ src: result.value, alt: file.name || '粘贴的图片' }).run()
    })()
  }

  return (
    <div className="rich-editor">
      <div className="rich-editor__bar">
        <div className="rich-editor__tools" role="toolbar" aria-label="Markdown 格式">
          <button type="button" className={editor.isActive('bold') ? 'is-active' : ''} onClick={() => editor.chain().focus().toggleBold().run()} title="粗体"><Bold size={15} /></button>
          <button type="button" className={editor.isActive('italic') ? 'is-active' : ''} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体"><Italic size={15} /></button>
          <button type="button" className={editor.isActive('underline') ? 'is-active' : ''} onClick={() => editor.chain().focus().toggleUnderline().run()} title="下划线"><UnderlineIcon size={15} /></button>
          <button type="button" className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="二级标题"><Heading2 size={15} /></button>
          <button type="button" className={editor.isActive('bulletList') ? 'is-active' : ''} onClick={() => editor.chain().focus().toggleBulletList().run()} title="无序列表"><List size={15} /></button>
          <button type="button" className={editor.isActive('orderedList') ? 'is-active' : ''} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="有序列表"><ListOrdered size={15} /></button>
          <button type="button" className={editor.isActive('blockquote') ? 'is-active' : ''} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用"><Quote size={15} /></button>
          <button type="button" className={editor.isActive('codeBlock') ? 'is-active' : ''} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="代码块"><Code2 size={15} /></button>
          <button type="button" className={editor.isActive('link') ? 'is-active' : ''} onClick={setLink} title="链接"><Link2 size={15} /></button>
          <button type="button" onClick={() => insertFormula(false)} title="行内公式"><Sigma size={15} /></button>
          <button type="button" onClick={() => insertFormula(true)} title="块级公式"><Sigma size={15} /><sub>块</sub></button>
          <button type="button" onClick={() => void insertImage()} title="插入图片"><ImagePlus size={15} /></button>
        </div>
        <div className="rich-editor__mode">
          <button type="button" className={mode === 'edit' ? 'is-active' : ''} onClick={() => setMode('edit')}><Pencil size={14} />编辑</button>
          <button type="button" className={mode === 'preview' ? 'is-active' : ''} onClick={() => setMode('preview')}><Eye size={14} />预览</button>
        </div>
      </div>
      {mode === 'edit' ? (
        <div onPaste={handlePaste}>
          <EditorContent editor={editor} />
        </div>
      ) : (
        <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
      )}
    </div>
  )
}
