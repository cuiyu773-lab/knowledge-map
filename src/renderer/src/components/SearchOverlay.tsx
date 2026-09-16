import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FileText, Search, X } from 'lucide-react'
import type { SearchHit } from '@shared/types'
import { useWorkspaceStore } from '@renderer/stores/workspaceStore'
import { useMapStore } from '@renderer/stores/mapStore'

function createSnippet(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const index = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (index < 0) return normalized.slice(0, 110)
  const start = Math.max(0, index - 42)
  return `${start > 0 ? '…' : ''}${normalized.slice(start, start + 120)}${start + 120 < normalized.length ? '…' : ''}`
}

export function SearchOverlay() {
  const open = useWorkspaceStore((state) => state.searchOpen)
  const setOpen = useWorkspaceStore((state) => state.setSearchOpen)
  const descriptor = useWorkspaceStore((state) => state.descriptor)
  const selectMap = useWorkspaceStore((state) => state.selectMap)
  const currentDocument = useMapStore((state) => state.document)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits([])
    }
  }, [open])

  useEffect(() => {
    const keyword = query.trim().toLocaleLowerCase()
    if (!open || !descriptor || !keyword) {
      setHits([])
      return
    }
    let canceled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      const next: SearchHit[] = []
      const inspect = (mapId: string, mapTitle: string, document: NonNullable<typeof currentDocument>) => {
        for (const node of Object.values(document.nodes)) {
          const haystack = `${node.title}\n${node.summary}\n${node.detailMarkdown}`.toLocaleLowerCase()
          if (!haystack.includes(keyword)) continue
          next.push({
            mapId,
            mapTitle,
            nodeId: node.id,
            nodeTitle: node.title,
            snippet: createSnippet(`${node.summary} ${node.detailMarkdown}`.trim(), keyword)
          })
          if (next.length >= 60) return
        }
      }
      for (const map of descriptor.maps) {
        if (next.length >= 60) break
        if (currentDocument?.id === map.id) {
          inspect(map.id, map.title, currentDocument)
          continue
        }
        const result = await window.zhitu.maps.read(map.id)
        if (result.ok) inspect(map.id, map.title, result.value.document)
      }
      if (!canceled) {
        setHits(next)
        setSearching(false)
      }
    }, 180)
    return () => {
      canceled = true
      clearTimeout(timer)
    }
  }, [query, open, descriptor, currentDocument])

  const grouped = useMemo(() => {
    const groups = new Map<string, SearchHit[]>()
    hits.forEach((hit) => groups.set(hit.mapId, [...(groups.get(hit.mapId) ?? []), hit]))
    return [...groups.entries()]
  }, [hits])

  const jump = async (hit: SearchHit) => {
    await selectMap(hit.mapId)
    useMapStore.getState().selectNode(hit.nodeId)
    setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay dialog-overlay--search" />
        <Dialog.Content className="search-dialog" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">搜索工作区</Dialog.Title>
          <div className="search-input-wrap">
            <Search size={19} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、摘要和笔记内容"
              aria-label="搜索工作区"
            />
            <Dialog.Close className="icon-button" aria-label="关闭搜索"><X size={17} /></Dialog.Close>
          </div>
          <div className="search-results">
            {!query.trim() ? (
              <p className="search-hint">输入关键词，可搜索当前工作区的全部导图。</p>
            ) : searching ? (
              <p className="search-hint">正在搜索…</p>
            ) : grouped.length ? (
              grouped.map(([mapId, mapHits]) => (
                <section className="search-group" key={mapId}>
                  <h2><FileText size={14} />{mapHits[0]?.mapTitle}</h2>
                  {mapHits.map((hit) => (
                    <button key={`${hit.mapId}-${hit.nodeId}`} type="button" onClick={() => void jump(hit)}>
                      <strong>{hit.nodeTitle}</strong>
                      <small>{hit.snippet || '该节点只有标题'}</small>
                    </button>
                  ))}
                </section>
              ))
            ) : (
              <p className="search-hint">没有找到匹配内容。</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
