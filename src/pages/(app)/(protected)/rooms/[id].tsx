import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getUserColor, useAuthProfileReady, useMutations, usePresenceRoom, useQuery } from 'deepspace'
import {
  AlertTriangle, ArrowLeft, Download, FlipHorizontal2, Grid3x3, Link2, Maximize, Minus, Plus, Redo2, RotateCcw, RotateCw, Trash2, Undo2, WifiOff,
} from 'lucide-react'
import { Button, Input, Label, Popover, PopoverContent, PopoverTrigger, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { FurnitureArt, FurnitureIcon } from '@/components/room/FurnitureArt'
import {
  bounds, CUSTOM_DEFAULT, findIssues, footprintSize, formatM, MAX_LABEL, nextRot, normRot, parseItemSize, parseRoomDims, placeCenter, PRESETS,
  GRID_CM, MAX_ROOM_CM, MIN_ITEM_CM, cleanLabel, clampAlong, isOpening, openingCenter, openingDepth, snapToWall,
  type Item, type ItemSpec, type Rot,
} from '@/lib/room-geometry'
import { useRoomCanvas } from '@/lib/use-room-canvas'
import { svgToJpeg } from '@/lib/export-image'
import type { Room } from '@/schemas/rooms-schema'
import { visitIdFor, type RoomVisit } from '@/schemas/room-visits-schema'

type Pt = { x: number; y: number }
/** `along` set = an opening being dragged along the walls. */
type DragState = { id: string; x: number; y: number; rot: Rot; along?: number }
type PeerState = { cursor?: Pt | null; drag?: DragState | null; selected?: string | null }

const PAD = 70 // cm of margin around the room inside the SVG

export default function RoomEditorPage() {
  const { id = '' } = useParams()
  const { records, status, error } = useQuery<Room>('rooms')
  const room = records.find((r) => r.recordId === id)

  if (status === 'loading') return <CenteredNote>Loading room…</CenteredNote>
  if (status === 'error') return <CenteredNote tone="error">Couldn't load this room: {error}</CenteredNote>
  if (!room) {
    return (
      <CenteredNote>
        <span data-testid="room-not-found">This room doesn't exist or was deleted.</span>{' '}
        <Link to="/rooms" className="text-primary underline underline-offset-4">Back to rooms</Link>
      </CenteredNote>
    )
  }
  // key: a different room id remounts the editor so no state leaks between rooms.
  return <Editor key={id} roomId={id} room={room.data} createdBy={room.createdBy} />
}

function Editor({ roomId, room, createdBy }: { roomId: string; room: Room; createdBy: string }) {
  const toast = useToast()
  const { userId } = useAuthProfileReady()
  const { items, connected, canWrite, add, move, rotate, resize, rename, place, setFlip, remove, undo, redo } = useRoomCanvas(roomId)
  const { peers, updateState, connected: presenceConnected } = usePresenceRoom(`room:${roomId}`)
  const roomMut = useMutations<Room>('rooms')
  const visitMut = useMutations<RoomVisit>('roomVisits')
  const editable = connected && canWrite

  const [selected, setSelected] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [snapOn, setSnapOn] = useState(true)
  const [zoom, setZoom] = useState(1)

  const W = Math.min(Math.max(room.widthCm, 100), 3000)
  const L = Math.min(Math.max(room.lengthCm, 100), 3000)
  const dims = useMemo(() => ({ widthCm: W, lengthCm: L }), [W, L])

  // Record that this user opened the room, so it shows on their dashboard. Each visitor
  // writes only their own row, so simultaneous first visits can't overwrite each other.
  const joined = useRef(false)
  useEffect(() => {
    if (joined.current || !visitMut.ready || !userId || userId === createdBy) return
    joined.current = true
    visitMut.put(visitIdFor(roomId, userId), { roomId }).catch(() => { joined.current = false })
  }, [visitMut, userId, createdBy, roomId])

  // One live position per item: local drag > a peer's in-flight drag > canvas.
  const uniquePeers = useMemo(() => {
    const m = new Map<string, (typeof peers)[number]>()
    for (const p of peers) if (p.userId !== userId) m.set(p.userId, p)
    return [...m.values()]
  }, [peers, userId])

  const liveItems = useMemo(() => {
    const peerDrags = new Map<string, DragState>()
    for (const p of uniquePeers) {
      const d = (p.state as PeerState).drag
      if (d && typeof d.x === 'number') peerDrags.set(d.id, d)
    }
    return items.map((it) => {
      if (drag?.id === it.id) return { ...it, x: drag.x, y: drag.y, rot: drag.rot }
      const pd = peerDrags.get(it.id)
      if (pd) return { ...it, x: pd.x, y: pd.y, rot: normRot(pd.rot) }
      // Openings sit on their wall wherever the room's walls are now.
      return isOpening(it.kind) ? { ...it, ...openingCenter(it, dims) } : it
    })
  }, [items, drag, uniquePeers, dims])

  const issues = useMemo(() => findIssues(liveItems, dims), [liveItems, dims])
  const sel = liveItems.find((i) => i.id === selected) ?? null

  useEffect(() => { updateState({ selected }) }, [selected, updateState, presenceConnected])

  // --- actions ------------------------------------------------------------
  const addItem = useCallback(
    (spec: ItemSpec) => {
      if (!editable) return
      if (isOpening(spec.kind)) {
        const wall = { rot: 0 as Rot, along: clampAlong({ ...spec, rot: 0 }, W / 2, dims) } // top wall, centered
        const c = openingCenter({ ...spec, ...wall }, dims)
        return setSelected(add(spec, c.x, c.y, wall))
      }
      const c = placeCenter({ ...spec, rot: 0 }, W / 2, L / 2, dims, snapOn)
      setSelected(add(spec, c.x, c.y))
    },
    [editable, add, W, L, dims, snapOn],
  )

  const rotateSel = useCallback(
    (dir: 1 | -1) => {
      if (!editable || !sel || isOpening(sel.kind)) return // an opening's wall is its rotation
      rotate(sel.id, nextRot(sel.rot, dir))
    },
    [editable, sel, rotate],
  )

  // By id, not "the selection": a draft committed on unmount lands after the selection moved on.
  const resizeItem = useCallback(
    (id: string, width: number, height: number) => {
      const it = liveItems.find((i) => i.id === id)
      if (it && isOpening(it.kind)) height = openingDepth(it.kind, width)
      if (!editable || !it || (width === it.width && height === it.height)) return
      if (isOpening(it.kind)) return resize(id, width, height, it.x, it.y) // x/y derived from the wall
      // Keep the center, then pull it back inside the walls if the new size pokes out.
      const c = placeCenter({ width, height, rot: it.rot }, it.x, it.y, dims, false)
      resize(id, width, height, c.x, c.y)
    },
    [editable, liveItems, dims, resize],
  )

  const renameItem = useCallback(
    (id: string, name: string) => {
      const it = liveItems.find((i) => i.id === id)
      const label = cleanLabel(name)
      if (!editable || !it || it.kind !== 'custom' || !label || label === it.label) return
      rename(id, label)
    },
    [editable, liveItems, rename],
  )

  const flipSel = useCallback(() => {
    if (editable && sel?.kind === 'door') setFlip(sel.id, !sel.flip)
  }, [editable, sel, setFlip])

  const deleteSel = useCallback(() => {
    if (!editable || !sel) return
    remove(sel.id)
    setSelected(null)
  }, [editable, sel, remove])

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (!editable || !sel) return
      if (isOpening(sel.kind)) {
        // Slide along the wall: left/right on top/bottom walls, up/down on side walls.
        const cur = clampAlong(sel, sel.along ?? 0, dims)
        const along = clampAlong(sel, cur + (sel.rot % 180 === 0 ? dx : dy), dims)
        if (along !== cur) place(sel.id, sel.rot, along)
        return
      }
      const c = placeCenter(sel, sel.x + dx, sel.y + dy, dims, false)
      if (c.x !== sel.x || c.y !== sel.y) move(sel.id, c.x, c.y)
    },
    [editable, sel, dims, move, place],
  )

  // --- keyboard -----------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (editable) (e.shiftKey ? redo : undo)() }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); if (editable) redo() }
      else if (e.key === 'r' || e.key === 'R') rotateSel(e.shiftKey ? -1 : 1)
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); deleteSel() } }
      else if (e.key === 'Escape') setSelected(null)
      else if (e.key.startsWith('Arrow') && sel) {
        e.preventDefault()
        const step = e.shiftKey ? 50 : 10
        nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable, undo, redo, rotateSel, deleteSel, nudge, sel])

  // --- share --------------------------------------------------------------
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Link copied', 'Anyone signed in with this link can edit this room.')
    } catch {
      toast.info('Copy this link', window.location.href)
    }
  }

  // --- export -------------------------------------------------------------
  const [exporting, setExporting] = useState(false)
  async function exportJpeg() {
    const svg = document.querySelector<SVGSVGElement>('svg[aria-label="Room floor plan"]')
    if (!svg) return
    setExporting(true)
    try {
      const background = getComputedStyle(svg.closest('[data-testid="room-surface"]')!).backgroundColor
      const slug = room.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room'
      await svgToJpeg(svg, `${slug}-floor-plan.jpg`, { background })
    } catch (e) {
      toast.error('Could not export', e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="room-editor" data-can-write={String(editable)}>
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/70 px-3 py-2 backdrop-blur sm:px-4">
        <Link to="/rooms" aria-label="Back to rooms" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="mr-auto min-w-0">
          <h1 className="truncate font-display text-xl leading-tight text-foreground" data-testid="room-title">{room.name}</h1>
          <p className="text-xs text-muted-foreground">{formatM(W)} × {formatM(L)} · {liveItems.length} item{liveItems.length === 1 ? '' : 's'}</p>
        </div>
        <PeerAvatars peers={uniquePeers} />
        <ConnectionBadge connected={connected} canWrite={canWrite} />
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Undo" title="Undo (⌘Z)" disabled={!editable} onClick={undo}><Undo2 /></Button>
          <Button size="icon" variant="ghost" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!editable} onClick={redo}><Redo2 /></Button>
        </div>
        <Button size="sm" variant="ghost" onClick={exportJpeg} loading={exporting} data-testid="export-button" title="Download the floor plan as a JPEG"><Download /> Export</Button>
        <Button size="sm" variant="outline" onClick={copyLink} data-testid="share-button"><Link2 /> Share</Button>
      </div>

      {!connected && (
        <div role="status" className="flex items-center gap-2 bg-warning/15 px-4 py-1.5 text-xs text-foreground">
          <WifiOff className="size-3.5" /> Connecting to the room… editing is paused until the connection is back.
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[208px_1fr_288px]">
        {/* Palette */}
        <aside aria-label="Furniture" className="border-b border-border bg-card/50 lg:border-b-0 lg:border-r">
          <p className="hidden px-4 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:block">Furniture</p>
          <div className="flex gap-2 overflow-x-auto p-3 lg:grid lg:grid-cols-2 lg:overflow-visible">
            {PRESETS.filter((p) => !isOpening(p.kind)).map((p) => (
              <button
                key={p.kind}
                data-testid={`add-${p.kind}`}
                disabled={!editable}
                onClick={() => addItem(p)}
                title={`Add ${p.label} (${p.hint})`}
                className="group flex w-20 shrink-0 flex-col items-center gap-1 rounded-xl border border-border bg-card p-2 text-xs text-foreground transition hover:border-primary/60 hover:shadow-[0_6px_20px_-6px_rgba(70,55,35,0.18)] disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
              >
                <span className="flex h-12 w-full items-center justify-center"><span className="h-full w-12"><FurnitureIcon kind={p.kind} w={p.width} h={p.height} /></span></span>
                <span className="font-medium">{p.label}</span>
              </button>
            ))}
            <CustomFurnitureButton disabled={!editable} onAdd={addItem} />
          </div>
          <p className="hidden px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:block">Doors &amp; windows</p>
          <div className="flex gap-2 overflow-x-auto p-3 lg:grid lg:grid-cols-2 lg:overflow-visible">
            {PRESETS.filter((p) => isOpening(p.kind)).map((p) => (
              <button
                key={p.kind}
                data-testid={`add-${p.kind}`}
                disabled={!editable}
                onClick={() => addItem(p)}
                title={`Add ${p.label} (${p.hint}) — drag it along the walls`}
                className="group flex w-20 shrink-0 flex-col items-center gap-1 rounded-xl border border-border bg-card p-2 text-xs text-foreground transition hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
              >
                <span className="flex h-12 w-full items-center justify-center"><span className="h-full w-12"><FurnitureIcon kind={p.kind} w={p.width} h={p.height} /></span></span>
                <span className="font-medium">{p.label}</span>
              </button>
            ))}
          </div>
          <p className="hidden px-4 pb-4 text-[11px] leading-relaxed text-muted-foreground lg:block">
            Click to add at the room's center, then drag into place. <kbd>R</kbd> rotates, arrows nudge, <kbd>Del</kbd> removes.
          </p>
        </aside>

        {/* Canvas */}
        <RoomSurface
          W={W} L={L} items={liveItems} issues={issues} selected={selected} editable={editable}
          snapOn={snapOn} zoom={zoom} peers={uniquePeers} dims={dims}
          onSelect={setSelected}
          onDrag={(d) => { setDrag(d); updateState({ drag: d }) }}
          onDrop={(d, moved) => {
            setDrag(null)
            updateState({ drag: null })
            if (moved) {
              if (d.along !== undefined) place(d.id, d.rot, d.along)
              else move(d.id, d.x, d.y)
            }
          }}
          onCursor={(c) => updateState({ cursor: c })}
          toolbar={
            <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-xl border border-border bg-card/90 p-1 shadow-[0_1px_2px_rgba(70,55,35,0.05)] backdrop-blur">
              <Button size="icon" variant="ghost" className="size-8" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}><Minus /></Button>
              <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <Button size="icon" variant="ghost" className="size-8" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}><Plus /></Button>
              <Button size="icon" variant="ghost" className="size-8" aria-label="Fit room" onClick={() => setZoom(1)}><Maximize /></Button>
              <span className="mx-1 h-5 w-px bg-border" />
              <Button size="sm" variant={snapOn ? 'secondary' : 'ghost'} className="h-8" aria-pressed={snapOn} onClick={() => setSnapOn((s) => !s)}>
                <Grid3x3 /> Snap
              </Button>
            </div>
          }
        />

        {/* Properties */}
        <aside aria-label="Properties" className="overflow-y-auto border-t border-border bg-card/50 p-4 lg:border-l lg:border-t-0">
          {sel ? (
            <ItemPanel item={sel} issues={issues} items={liveItems} editable={editable} onRotate={rotateSel} onFlip={flipSel} onResize={resizeItem} onRename={renameItem} onDelete={deleteSel} onSelect={setSelected} />
          ) : (
            <RoomPanel roomId={roomId} room={room} editable={roomMut.ready} issues={issues} items={liveItems} onSelect={setSelected} />
          )}
        </aside>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function RoomSurface(props: {
  W: number; L: number; items: Item[]; issues: ReturnType<typeof findIssues>; selected: string | null
  editable: boolean; snapOn: boolean; zoom: number; dims: { widthCm: number; lengthCm: number }
  peers: { userId: string; userName: string; state: Record<string, unknown> }[]
  onSelect: (id: string | null) => void
  onDrag: (d: DragState) => void
  onDrop: (d: DragState, moved: boolean) => void
  onCursor: (c: Pt | null) => void
  toolbar: React.ReactNode
}) {
  const { W, L, items, issues, selected, editable, snapOn, zoom, dims, peers, onSelect, onDrag, onDrop, onCursor } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })
  const dragRef = useRef<{ item: Item; dx: number; dy: number; last: DragState; moved: boolean } | null>(null)
  const cursorFrame = useRef<number | null>(null)
  const pendingCursor = useRef<Pt | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const vbW = W + PAD * 2
  const vbH = L + PAD * 2
  const fit = Math.max(0.05, Math.min((box.w - 24) / vbW, (box.h - 24) / vbH))
  const pxPerCm = fit * zoom

  /** Screen → room cm, via the SVG's own transform: correct at any size/zoom/scroll. */
  const toRoom = (e: { clientX: number; clientY: number }): Pt | null => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }

  function sendCursor(c: Pt | null) {
    pendingCursor.current = c
    if (cursorFrame.current !== null) return
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = null
      onCursor(pendingCursor.current)
    })
  }

  function onItemDown(e: RPointerEvent, it: Item) {
    e.stopPropagation()
    onSelect(it.id)
    if (!editable || e.button !== 0) return
    const p = toRoom(e)
    if (!p) return
    svgRef.current?.setPointerCapture(e.pointerId)
    dragRef.current = { item: it, dx: p.x - it.x, dy: p.y - it.y, last: { id: it.id, x: it.x, y: it.y, rot: it.rot }, moved: false }
  }

  function onMove(e: RPointerEvent) {
    const p = toRoom(e)
    if (!p) return
    sendCursor({ x: Math.round(p.x), y: Math.round(p.y) })
    const d = dragRef.current
    if (!d) return
    if (isOpening(d.item.kind)) {
      // Follow the pointer to the nearest wall; the item turns to face it.
      const w = snapToWall(d.item, p.x, p.y, dims, snapOn)
      const c = openingCenter({ ...d.item, ...w }, dims)
      if (c.x === d.last.x && c.y === d.last.y && w.rot === d.last.rot) return
      d.moved = w.rot !== d.item.rot || w.along !== clampAlong(d.item, d.item.along ?? 0, dims)
      d.last = { id: d.item.id, x: c.x, y: c.y, rot: w.rot, along: w.along }
      onDrag(d.last)
      return
    }
    const c = placeCenter(d.item, p.x - d.dx, p.y - d.dy, dims, snapOn)
    if (c.x === d.last.x && c.y === d.last.y) return
    d.moved = c.x !== d.item.x || c.y !== d.item.y
    d.last = { id: d.item.id, x: c.x, y: c.y, rot: d.item.rot }
    onDrag(d.last)
  }

  function onUp() {
    const d = dragRef.current
    dragRef.current = null
    if (d) onDrop(d.last, d.moved)
  }

  const fontCm = Math.max(9, Math.min(16, 11 / Math.max(pxPerCm, 0.4)))

  return (
    <div ref={wrapRef} className="relative min-h-[55vh] flex-1 overflow-auto bg-[var(--color-canvas)] lg:min-h-0" data-testid="room-surface">
      <div className="flex min-h-full min-w-full items-center justify-center p-3" style={{ width: vbW * pxPerCm + 24, height: vbH * pxPerCm + 24 }}>
        <svg
          ref={svgRef}
          role="application"
          aria-label="Room floor plan"
          viewBox={`${-PAD} ${-PAD} ${vbW} ${vbH}`}
          width={vbW * pxPerCm}
          height={vbH * pxPerCm}
          className="select-none"
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => { if (!dragRef.current) sendCursor(null) }}
          onPointerDown={() => onSelect(null)}
        >
          <defs>
            <pattern id="grid10" width={10} height={10} patternUnits="userSpaceOnUse">
              <path d="M10 0H0V10" fill="none" stroke="var(--color-grid)" strokeWidth={0.4} />
            </pattern>
            <pattern id="grid50" width={50} height={50} patternUnits="userSpaceOnUse">
              <rect width={50} height={50} fill="url(#grid10)" />
              <path d="M50 0H0V50" fill="none" stroke="var(--color-grid-strong)" strokeWidth={0.8} />
            </pattern>
            <pattern id="warn" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={8} height={8} fill="rgba(196,122,90,0.12)" />
              <line x1={0} y1={0} x2={0} y2={8} stroke="rgba(178,84,52,0.55)" strokeWidth={2.5} />
            </pattern>
          </defs>

          {/* Floor + walls */}
          <rect x={-6} y={-6} width={W + 12} height={L + 12} rx={2} fill="var(--color-wall)" />
          <rect width={W} height={L} fill="var(--color-floor)" />
          <rect width={W} height={L} fill="url(#grid50)" />

          {/* Dimensions */}
          <DimLabel x1={0} y1={-30} x2={W} y2={-30} label={formatM(W)} fontCm={fontCm} />
          <DimLabel x1={-30} y1={0} x2={-30} y2={L} label={formatM(L)} fontCm={fontCm} vertical />

          {/* Furniture */}
          {items.map((it) => {
            const { w: fw, h: fh } = footprintSize(it)
            const b = bounds(it)
            const issue = issues.get(it.id)
            const isSel = it.id === selected
            const peerSel = peers.find((p) => (p.state as PeerState).selected === it.id)
            return (
              <g
                key={it.id}
                data-testid="furniture"
                data-kind={it.kind}
                data-x={it.x}
                data-y={it.y}
                data-rot={it.rot}
                data-width={it.width}
                data-height={it.height}
                data-flip={it.flip || undefined}
                data-along={isOpening(it.kind) ? it.along : undefined}
                data-selected={isSel || undefined}
                data-warning={issue ? 'true' : undefined}
                onPointerDown={(e) => onItemDown(e, it)}
                style={{ cursor: editable ? 'grab' : 'pointer', touchAction: 'none' }}
              >
                <g transform={`translate(${it.x} ${it.y}) rotate(${it.rot}) translate(${-it.width / 2} ${-it.height / 2})`}>
                  <FurnitureArt kind={it.kind} w={it.width} h={it.height} flip={it.flip} />
                </g>
                {issue && <rect data-export="skip" x={b.left} y={b.top} width={fw} height={fh} fill="url(#warn)" stroke="#b25434" strokeWidth={1.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" rx={3} />}
                {peerSel && !isSel && (
                  <rect data-export="skip" x={b.left - 3} y={b.top - 3} width={fw + 6} height={fh + 6} rx={5} fill="none" stroke={getUserColor(peerSel.userId)} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                )}
                {isSel && (
                  <rect data-export="skip" x={b.left - 4} y={b.top - 4} width={fw + 8} height={fh + 8} rx={6} fill="none" stroke="var(--color-accent-strong)" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                )}
                {!isOpening(it.kind) && <text
                  x={it.x} y={it.y} textAnchor="middle" dominantBaseline="central"
                  fontSize={Math.min(fontCm, fw / Math.max(4, it.label.length * 0.62), fh / 2.2)}
                  className="pointer-events-none fill-[var(--color-foreground)] font-medium"
                  style={{ paintOrder: 'stroke', stroke: 'rgba(255,253,249,0.85)', strokeWidth: fontCm / 4 }}
                >
                  {it.label}
                </text>}
              </g>
            )
          })}

          {/* Peer cursors */}
          {peers.map((p) => {
            const c = (p.state as PeerState).cursor
            if (!c || typeof c.x !== 'number') return null
            const color = getUserColor(p.userId)
            const s = 1 / pxPerCm
            return (
              <g key={p.userId} transform={`translate(${c.x} ${c.y}) scale(${s})`} className="pointer-events-none" data-testid="peer-cursor" data-export="skip">
                <path d="M0 0 L0 16 L4.5 12 L8 19 L10.5 18 L7 11 L13 11 Z" fill={color} stroke="#fff" strokeWidth={1.2} />
                <g transform="translate(14 14)">
                  <rect height={18} width={p.userName.length * 6.5 + 12} rx={9} fill={color} />
                  <text x={6} y={12.5} fontSize={11} fill="#fff" fontWeight={600}>{p.userName}</text>
                </g>
              </g>
            )
          })}
        </svg>
      </div>
      {props.toolbar}
    </div>
  )
}

function DimLabel({ x1, y1, x2, y2, label, fontCm, vertical }: { x1: number; y1: number; x2: number; y2: number; label: string; fontCm: number; vertical?: boolean }) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const t = 6
  return (
    <g className="pointer-events-none" stroke="var(--color-muted-foreground)" strokeWidth={1} vectorEffect="non-scaling-stroke">
      <line x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />
      {vertical ? (
        <><line x1={x1 - t} x2={x1 + t} y1={y1} y2={y1} vectorEffect="non-scaling-stroke" /><line x1={x1 - t} x2={x1 + t} y1={y2} y2={y2} vectorEffect="non-scaling-stroke" /></>
      ) : (
        <><line x1={x1} x2={x1} y1={y1 - t} y2={y1 + t} vectorEffect="non-scaling-stroke" /><line x1={x2} x2={x2} y1={y1 - t} y2={y1 + t} vectorEffect="non-scaling-stroke" /></>
      )}
      <text
        x={mx} y={my} textAnchor="middle" dominantBaseline="central" fontSize={fontCm} stroke="var(--color-canvas)" strokeWidth={fontCm / 2.5}
        transform={vertical ? `rotate(-90 ${mx} ${my})` : undefined}
        style={{ paintOrder: 'stroke' }} className="fill-[var(--color-muted-foreground)]"
      >
        {label}
      </text>
    </g>
  )
}

function ItemPanel({ item, issues, items, editable, onRotate, onFlip, onResize, onRename, onDelete, onSelect }: {
  item: Item; issues: ReturnType<typeof findIssues>; items: Item[]; editable: boolean
  onRotate: (dir: 1 | -1) => void; onFlip: () => void; onResize: (id: string, width: number, height: number) => void
  onRename: (id: string, name: string) => void
  onDelete: () => void; onSelect: (id: string) => void
}) {
  const { w, h } = footprintSize(item)
  const b = bounds(item)
  const issue = issues.get(item.id)
  return (
    <div className="space-y-5" data-testid="item-panel">
      <div className="flex items-center gap-3">
        <div className="size-14 rounded-xl border border-border bg-card p-1.5"><FurnitureIcon kind={item.kind} w={item.width} h={item.height} /></div>
        <div>
          <h2 className="break-words font-display text-xl text-foreground" data-testid="item-label">{item.label}</h2>
          <p className="text-xs text-muted-foreground" data-testid="item-footprint">{w} × {h} cm</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Stat label="From left" value={`${Math.round(b.left)} cm`} />
        <Stat label="From top" value={`${Math.round(b.top)} cm`} />
        {isOpening(item.kind)
          ? <Stat label="Wall" value={WALL_NAMES[item.rot]} testId="item-wall" />
          : <Stat label="Rotation" value={`${item.rot}°`} testId="item-rotation" />}
      </dl>
      {item.kind === 'custom' && <NameField key={`name-${item.id}`} item={item} editable={editable} onRename={onRename} />}
      <SizeFields key={`size-${item.id}`} item={item} editable={editable} onResize={onResize} widthOnly={isOpening(item.kind)} />
      {item.kind === 'door' ? (
        <Button variant="outline" className="w-full" disabled={!editable} onClick={onFlip} data-testid="flip-door"><FlipHorizontal2 /> Flip swing</Button>
      ) : !isOpening(item.kind) && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!editable} onClick={() => onRotate(-1)} aria-label="Rotate left"><RotateCcw /> 90°</Button>
          <Button variant="outline" disabled={!editable} onClick={() => onRotate(1)} aria-label="Rotate right" data-testid="rotate-right"><RotateCw /> 90°</Button>
        </div>
      )}
      {isOpening(item.kind) && <p className="text-xs text-muted-foreground">Drag along the walls to move it; arrow keys slide it.</p>}
      <Warnings issue={issue} items={items} onSelect={onSelect} />
      <Button variant="ghost" className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={!editable} onClick={onDelete} data-testid="delete-item">
        <Trash2 /> Remove {nameIn(item)}
      </Button>
    </div>
  )
}

const WALL_NAMES: Record<Rot, string> = { 0: 'Top', 90: 'Right', 180: 'Bottom', 270: 'Left' }

/** Item name mid-sentence: presets lowercased ("Remove bed"), custom names as typed. */
const nameIn = (i: Item) => (i.kind === 'custom' ? i.label : i.label.toLowerCase())

/** Palette tile that opens a small form: name + size (default 120 × 60), then adds it at the room's center. */
function CustomFurnitureButton({ disabled, onAdd }: { disabled: boolean; onAdd: (spec: ItemSpec) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [w, setW] = useState(String(CUSTOM_DEFAULT.width))
  const [h, setH] = useState(String(CUSTOM_DEFAULT.height))
  const label = cleanLabel(name)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!label) return
    onAdd({
      kind: 'custom', label,
      width: parseItemSize(w) ?? CUSTOM_DEFAULT.width,
      height: parseItemSize(h) ?? CUSTOM_DEFAULT.height,
    })
    setOpen(false)
    setName('')
    setW(String(CUSTOM_DEFAULT.width))
    setH(String(CUSTOM_DEFAULT.height))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="add-custom"
        disabled={disabled}
        title="Add custom furniture"
        className="group flex w-20 shrink-0 flex-col items-center gap-1 rounded-xl border border-dashed border-border bg-card p-2 text-xs text-foreground transition hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
      >
        <span className="flex h-12 w-full items-center justify-center text-muted-foreground"><Plus className="size-6" /></span>
        <span className="font-medium">Custom</span>
      </PopoverTrigger>
      <PopoverContent side="right" className="w-64 p-4">
        {/* noValidate: min/step are spinner hints; parseItemSize clamps instead of the browser blocking e.g. 85 cm. */}
        <form onSubmit={submit} noValidate className="space-y-3" data-testid="custom-form">
          <div className="space-y-1.5">
            <Label htmlFor="cf-name">Name</Label>
            <Input id="cf-name" autoFocus required maxLength={MAX_LABEL} placeholder="e.g. Bookshelf" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="cf-w">Width (cm)</Label>
              <Input id="cf-w" type="number" inputMode="numeric" min={MIN_ITEM_CM} max={MAX_ROOM_CM} step={GRID_CM} value={w} onChange={(e) => setW(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-d">Depth (cm)</Label>
              <Input id="cf-d" type="number" inputMode="numeric" min={MIN_ITEM_CM} max={MAX_ROOM_CM} step={GRID_CM} value={h} onChange={(e) => setH(e.target.value)} />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={!label}>Add to room</Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

/** Run the latest `fn` on unmount (ref set in an effect, so cleanup sees the last committed render). */
function useFlushOnUnmount(fn: () => void) {
  const latest = useRef(fn)
  useEffect(() => { latest.current = fn })
  useEffect(() => () => latest.current(), [])
}

/** Rename a custom item. Same commit rules as SizeFields: Enter, blur, or unmount; blank reverts. */
function NameField({ item, editable, onRename }: { item: Item; editable: boolean; onRename: (id: string, name: string) => void }) {
  const [name, setName] = useState(item.label)
  useEffect(() => { setName(item.label) }, [item.label])
  useFlushOnUnmount(() => onRename(item.id, name))
  return (
    <div className="space-y-1.5">
      <Label htmlFor="item-name">Name</Label>
      <Input
        id="item-name" data-testid="item-name" maxLength={MAX_LABEL} value={name} disabled={!editable}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { onRename(item.id, name); setName(cleanLabel(name) || item.label) }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
    </div>
  )
}

/**
 * Unrotated width × depth in cm. Commits on blur / Enter so typing doesn't spam the undo stack,
 * and on unmount: clicking another item or the floor swaps the panel before the input's blur fires.
 * Keyed by item id, so switching items is an unmount.
 */
function SizeFields({ item, editable, onResize, widthOnly }: {
  item: Item; editable: boolean; onResize: (id: string, width: number, height: number) => void
  /** Openings: depth follows width (door swing) or is fixed (window). */
  widthOnly?: boolean
}) {
  const [w, setW] = useState(String(item.width))
  const [h, setH] = useState(String(item.height))
  // Follow remote edits and undo/redo.
  useEffect(() => { setW(String(item.width)); setH(String(item.height)) }, [item.width, item.height])

  const size = () => [parseItemSize(w) ?? item.width, parseItemSize(h) ?? item.height] as const
  function commit() {
    const [nw, nh] = size()
    setW(String(nw))
    setH(String(nh))
    onResize(item.id, nw, nh)
  }
  useFlushOnUnmount(() => onResize(item.id, ...size()))
  const field = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id} data-testid={id} type="number" inputMode="numeric" min={MIN_ITEM_CM} max={MAX_ROOM_CM} step={GRID_CM}
        value={value} disabled={!editable}
        onChange={(e) => set(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-2">
      {field('item-width', 'Width (cm)', w, setW)}
      {!widthOnly && field('item-depth', 'Depth (cm)', h, setH)}
    </div>
  )
}

function Warnings({ issue, items, onSelect }: { issue?: { outOfBounds: boolean; overlapsWith: string[] }; items: Item[]; onSelect: (id: string) => void }) {
  if (!issue) return null
  return (
    <div role="status" className="space-y-1 rounded-xl border border-[#e3b8a4] bg-[#f8e9e1] p-3 text-sm text-[#7a3a22]">
      {issue.outOfBounds && <p className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> Extends past the walls.</p>}
      {issue.overlapsWith.length > 0 && (
        <p className="flex flex-wrap gap-x-1 gap-y-0.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Overlaps
          {issue.overlapsWith.map((id, i) => {
            const o = items.find((x) => x.id === id)
            return o ? <button key={id} className="underline underline-offset-2" onClick={() => onSelect(id)}>{nameIn(o)}{i < issue.overlapsWith.length - 1 ? ',' : ''}</button> : null
          })}
        </p>
      )}
    </div>
  )
}

function RoomPanel({ roomId, room, editable, issues, items, onSelect }: {
  roomId: string; room: Room; editable: boolean; issues: ReturnType<typeof findIssues>; items: Item[]; onSelect: (id: string) => void
}) {
  const toast = useToast()
  const { putConfirmed } = useMutations<Room>('rooms')
  const [name, setName] = useState(room.name)
  const [w, setW] = useState(String(room.widthCm / 100))
  const [l, setL] = useState(String(room.lengthCm / 100))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Follow remote edits to the room record.
  useEffect(() => { setName(room.name); setW(String(room.widthCm / 100)); setL(String(room.lengthCm / 100)) }, [room.name, room.widthCm, room.lengthCm])

  const dirty = name.trim() !== room.name || w !== String(room.widthCm / 100) || l !== String(room.lengthCm / 100)

  async function save() {
    const dims = parseRoomDims(w, l)
    if (!name.trim()) return setErr('Name is required.')
    if (typeof dims === 'string') return setErr(dims)
    setErr(null)
    setSaving(true)
    try {
      await putConfirmed(roomId, { name: name.trim().slice(0, 80), ...dims })
      toast.success('Room updated')
    } catch (e) {
      toast.error('Could not update room', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const flagged = items.filter((i) => issues.has(i.id))

  return (
    <div className="space-y-6" data-testid="room-panel">
      <div>
        <h2 className="font-display text-xl text-foreground">Room</h2>
        <p className="text-xs text-muted-foreground">Select a piece of furniture to edit it.</p>
      </div>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="rp-name">Name</Label>
          <Input id="rp-name" value={name} maxLength={80} disabled={!editable} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="rp-w">Width (m)</Label>
            <Input id="rp-w" type="number" step="0.1" min="1" max="30" value={w} disabled={!editable} onChange={(e) => setW(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-l">Length (m)</Label>
            <Input id="rp-l" type="number" step="0.1" min="1" max="30" value={l} disabled={!editable} onChange={(e) => setL(e.target.value)} />
          </div>
        </div>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <Button className="w-full" disabled={!editable || !dirty} loading={saving} onClick={save}>Save room</Button>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Layout check</h3>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Empty room. Add furniture from the palette.</p>
        ) : flagged.length === 0 ? (
          <p className="text-sm text-primary" data-testid="layout-ok">Everything fits — no overlaps.</p>
        ) : (
          <ul className="space-y-1.5" data-testid="layout-warnings">
            {flagged.map((i) => {
              const iss = issues.get(i.id)!
              return (
                <li key={i.id}>
                  <button onClick={() => onSelect(i.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[#7a3a22] hover:bg-[#f8e9e1]">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>{i.label}: {[
                      iss.outOfBounds && 'past the walls',
                      iss.overlapsWith.length > 0 && (i.kind !== 'door' && iss.overlapsWith.some((id) => items.find((o) => o.id === id)?.kind === 'door') ? 'blocks a door' : 'overlapping'),
                    ].filter(Boolean).join(', ')}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p className="rounded-xl bg-muted/70 p-3 text-xs leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">Link sharing.</strong> Anyone signed in to Roomly with this
        room's link can view and edit it. Rooms are not private.
      </p>
    </div>
  )
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg bg-muted/70 px-2.5 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums text-foreground" data-testid={testId}>{value}</dd>
    </div>
  )
}

function PeerAvatars({ peers }: { peers: { userId: string; userName: string }[] }) {
  if (peers.length === 0) return null
  return (
    <div className="flex -space-x-2" data-testid="peer-avatars" aria-label={`${peers.length} other ${peers.length === 1 ? 'person' : 'people'} here`}>
      {peers.slice(0, 4).map((p) => (
        <span
          key={p.userId}
          title={p.userName}
          className="flex size-8 items-center justify-center rounded-full border-2 border-card text-xs font-semibold text-white"
          style={{ background: getUserColor(p.userId) }}
        >
          {(p.userName?.[0] ?? '?').toUpperCase()}
        </span>
      ))}
    </div>
  )
}

function ConnectionBadge({ connected, canWrite }: { connected: boolean; canWrite: boolean }) {
  const [label, tone] = !connected ? ['Connecting', 'bg-warning'] : canWrite ? ['Live', 'bg-primary'] : ['View only', 'bg-muted-foreground']
  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex" data-testid="connection-status">
      <span className={cn('size-2 rounded-full', tone, connected && canWrite && 'animate-pulse')} />
      {label}
    </span>
  )
}

function CenteredNote({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return <div className={cn('flex h-full items-center justify-center p-8 text-center text-sm', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{children}</div>
}
