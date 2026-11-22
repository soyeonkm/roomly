import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas, type CanvasShapeClient } from 'deepspace'
import { canvasIdFor, cleanLabel, isKind, isOpening, labelFor, MAX_ROOM_CM, MIN_ITEM_CM, normRot, type Item, type ItemSpec, type Rot } from './room-geometry'

/**
 * useCanvas, adapted to Roomly's furniture model.
 *
 * The SDK's CanvasRoom broadcasts `add`/`delete`/undo/redo to everyone, but
 * `move`, `resize` and `update` only to OTHER peers. So the local peer keeps an
 * optimistic overlay of its own un-echoed writes. Each overlay field
 * remembers the server value it was written over (`base`); as soon as the
 * server's value for that field differs from `base` (a peer edited it, or a
 * full snapshot arrived after reconnect/undo), the server wins. The canvas
 * room stays the only source of truth.
 */

type Fields = { x?: number; y?: number; rot?: Rot; width?: number; height?: number; label?: string; along?: number; flip?: boolean }
type Pending = Record<string, { fields: Fields; base: Required<Fields> }>

// Shapes come straight from any member's socket (CanvasRoom doesn't validate them), so coerce every field.
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const size = (v: unknown) => Math.min(Math.max(num(v), MIN_ITEM_CM), MAX_ROOM_CM)
const serverFields = (s: CanvasShapeClient): Required<Fields> => ({
  x: num(s.x), y: num(s.y), rot: normRot(s.props?.rot), width: size(s.width), height: size(s.height), label: cleanLabel(s.props?.label),
  along: num(s.props?.along), flip: s.props?.flip === true,
})

function toItem(s: CanvasShapeClient, p?: Pending[string]): Item | null {
  const kind = s.props?.kind
  if (!isKind(kind)) return null
  const server = serverFields(s)
  const live = { ...server }
  if (p) {
    for (const k of Object.keys(p.fields) as (keyof Fields)[]) {
      // Only apply our write while the server still holds the value we overwrote.
      if (server[k] === p.base[k]) (live as Record<string, unknown>)[k] = p.fields[k]
    }
  }
  return { id: s.id, kind, ...live, label: labelFor(kind, live.label) }
}

export function useRoomCanvas(roomId: string) {
  const canvas = useCanvas(canvasIdFor(roomId))
  const { shapes, moveShape, resizeShape, updateShape, addShape, deleteShape, undo, redo } = canvas
  const [pending, setPending] = useState<Pending>({})
  const awaitingSnapshot = useRef(false)
  const prevShapes = useRef(shapes)

  // Drop overlay entries the server has caught up with or superseded.
  useEffect(() => {
    const prev = prevShapes.current
    prevShapes.current = shapes
    if (awaitingSnapshot.current && shapes !== prev) {
      awaitingSnapshot.current = false
      // Undo/redo of a move answers with a full snapshot (every object new);
      // that snapshot is authoritative even where it restores the old value.
      const prevRefs = new Set(prev)
      if (shapes.every((s) => !prevRefs.has(s))) {
        setPending({})
        return
      }
    }
    setPending((cur) => {
      let changed = false
      const next: Pending = {}
      const byId = new Map(shapes.map((s) => [s.id, s]))
      for (const [id, p] of Object.entries(cur)) {
        const s = byId.get(id)
        if (!s) { changed = true; continue }
        const server = serverFields(s)
        const keep = (Object.keys(p.fields) as (keyof Fields)[]).some(
          (k) => server[k] === p.base[k] && server[k] !== p.fields[k],
        )
        if (keep) next[id] = p
        else changed = true
      }
      return changed ? next : cur
    })
  }, [shapes])

  const items = useMemo(() => {
    const list = shapes.map((s) => toItem(s, pending[s.id])).filter((i): i is Item => i !== null)
    // Rugs, doors and windows under furniture (so furniture in a door's swing stays clickable), then creation order.
    const under = (i: Item) => Number(i.kind === 'rug' || isOpening(i.kind))
    return list.sort((a, b) => under(b) - under(a))
  }, [shapes, pending])

  const remember = useCallback(
    (id: string, fields: Fields) => {
      const s = shapes.find((sh) => sh.id === id)
      if (!s) return
      setPending((cur) => {
        const prev = cur[id]
        return { ...cur, [id]: { fields: { ...prev?.fields, ...fields }, base: prev?.base ?? serverFields(s) } }
      })
    },
    [shapes],
  )

  const add = useCallback(
    ({ kind, width, height, label }: ItemSpec, x: number, y: number, wall?: { rot: Rot; along: number }): string => {
      // CanvasRoom honours a client-supplied id, so the caller can select it right away.
      const id = crypto.randomUUID()
      const props = kind === 'custom' ? { kind, rot: 0, label: cleanLabel(label) } : { kind, rot: 0, ...wall }
      addShape({ id, type: 'furniture', x, y, width, height, props })
      return id
    },
    [addShape],
  )

  const move = useCallback(
    (id: string, x: number, y: number) => {
      remember(id, { x, y })
      moveShape(id, x, y)
    },
    [remember, moveShape],
  )

  /** Rotation is stored in props (CanvasRoom has no rotate message); x/y is the center, so it stays put. */
  const rotate = useCallback(
    (id: string, rot: Rot) => {
      remember(id, { rot })
      updateShape(id, { rot })
    },
    [remember, updateShape],
  )

  /** New unrotated size; x/y is the new center (callers clamp it back inside the room). */
  const resize = useCallback(
    (id: string, width: number, height: number, x: number, y: number) => {
      remember(id, { width, height, x, y })
      resizeShape(id, width, height, x, y)
    },
    [remember, resizeShape],
  )

  /** Custom items only; the name lives in props, like rotation. */
  const rename = useCallback(
    (id: string, label: string) => {
      remember(id, { label })
      updateShape(id, { label })
    },
    [remember, updateShape],
  )

  /** Openings: wall + position along it in ONE update, so a cross-wall move is one undo step. */
  const place = useCallback(
    (id: string, rot: Rot, along: number) => {
      remember(id, { rot, along })
      updateShape(id, { rot, along })
    },
    [remember, updateShape],
  )

  const setFlip = useCallback(
    (id: string, flip: boolean) => {
      remember(id, { flip })
      updateShape(id, { flip })
    },
    [remember, updateShape],
  )

  const undoOne = useCallback(() => { awaitingSnapshot.current = true; undo() }, [undo])
  const redoOne = useCallback(() => { awaitingSnapshot.current = true; redo() }, [redo])

  return {
    items,
    connected: canvas.connected,
    canWrite: canvas.canWrite,
    add,
    move,
    rotate,
    resize,
    rename,
    place,
    setFlip,
    remove: deleteShape,
    undo: undoOne,
    redo: redoOne,
  }
}
