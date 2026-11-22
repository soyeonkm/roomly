/**
 * Roomly's single coordinate model.
 *
 * Everything is in centimetres in ROOM space: origin at the room's top-left
 * corner, +x to the right (room width), +y downward (room length).
 *
 * A canvas shape stores one furniture item:
 *   x, y          — the item's CENTER (so a 90° rotation never moves it)
 *   width, height — the item's unrotated size
 *   props.kind    — preset id or 'custom', props.rot — 0 | 90 | 180 | 270
 *   props.label   — custom items only: the user's name for it
 *
 * Doors and windows ("openings") live on a wall instead: props.rot is the
 * wall (0 top, 90 right, 180 bottom, 270 left — the item's back faces it) and
 * props.along is the center's distance along that wall (from its left / top
 * end). Their x/y is derived from the room (openingCenter), so they stay on
 * the wall when the room is resized, and any move — even to another wall —
 * is ONE canvas update, so one undo step. A door's footprint is its swing.
 *
 * The screen never appears here: the editor renders an SVG whose viewBox is
 * in cm and converts pointer events with getScreenCTM(), so any screen size
 * or zoom maps to the same room coordinates.
 */

export type Rot = 0 | 90 | 180 | 270
export type PresetKind = 'bed' | 'desk' | 'sofa' | 'chair' | 'dresser' | 'rug' | 'door' | 'window'
export type Kind = PresetKind | 'custom'

export type Item = {
  id: string
  kind: Kind
  label: string
  x: number
  y: number
  width: number
  height: number
  rot: Rot
  /** Openings only (see top). */
  along?: number
  /** Doors only: hinge on the other side. */
  flip?: boolean
}

export const WINDOW_DEPTH = 15

export type Preset = { kind: PresetKind; label: string; width: number; height: number; hint: string }

export const PRESETS: Preset[] = [
  { kind: 'bed', label: 'Bed', width: 160, height: 200, hint: 'Queen · 160 × 200' },
  { kind: 'sofa', label: 'Sofa', width: 200, height: 90, hint: '3-seat · 200 × 90' },
  { kind: 'desk', label: 'Desk', width: 120, height: 60, hint: '120 × 60' },
  { kind: 'chair', label: 'Chair', width: 50, height: 50, hint: '50 × 50' },
  { kind: 'dresser', label: 'Dresser', width: 100, height: 50, hint: '100 × 50' },
  { kind: 'rug', label: 'Rug', width: 200, height: 140, hint: '200 × 140' },
  { kind: 'door', label: 'Door', width: 80, height: 80, hint: '80 wide · swing shown' },
  { kind: 'window', label: 'Window', width: 100, height: WINDOW_DEPTH, hint: '100 wide' },
]

export const PRESET_BY_KIND = Object.fromEntries(PRESETS.map((p) => [p.kind, p])) as Record<PresetKind, Preset>

export const CUSTOM_DEFAULT = { width: 120, height: 60 }
export const MAX_LABEL = 40

/** What a new item is made from: a preset, or a custom piece with its own name and size. */
export type ItemSpec = { kind: Kind; width: number; height: number; label?: string }

export const GRID_CM = 10
export const MIN_ROOM_CM = 100
export const MAX_ROOM_CM = 3000
export const MIN_ITEM_CM = 10

/** Furniture size from panel input (cm): rounded, 10 cm … 30 m, or null when not a number. */
export function parseItemSize(v: string): number | null {
  const n = Math.round(Number(v))
  if (!v.trim() || !Number.isFinite(n)) return null
  return Math.min(Math.max(n, MIN_ITEM_CM), MAX_ROOM_CM)
}

/** Stable, room-specific canvas id. Separate rooms never share furniture. */
export const canvasIdFor = (roomId: string) => `room:${roomId}`

export const isKind = (v: unknown): v is Kind => v === 'custom' || (typeof v === 'string' && Object.hasOwn(PRESET_BY_KIND, v)) // not `in`: '__proto__' would match

/** Custom furniture name: trimmed, single-spaced, capped at MAX_LABEL; '' when blank. */
export const cleanLabel = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL).trim() : '')

/** Display name: a custom item's own label (fallback "Custom"), else the preset's. */
export const labelFor = (kind: Kind, label?: unknown) =>
  kind === 'custom' ? cleanLabel(label) || 'Custom' : PRESET_BY_KIND[kind].label

export const normRot = (v: unknown): Rot => {
  const n = ((Math.round(Number(v) / 90) * 90) % 360 + 360) % 360
  return (Number.isFinite(n) ? n : 0) as Rot
}

export const nextRot = (r: Rot, dir: 1 | -1 = 1): Rot => normRot(r + dir * 90)

/** On-floor size after rotation. */
export function footprintSize(i: Pick<Item, 'width' | 'height' | 'rot'>) {
  return i.rot % 180 === 0 ? { w: i.width, h: i.height } : { w: i.height, h: i.width }
}

export function bounds(i: Item) {
  const { w, h } = footprintSize(i)
  return { left: i.x - w / 2, top: i.y - h / 2, right: i.x + w / 2, bottom: i.y + h / 2 }
}

export const snap = (v: number, step = GRID_CM) => Math.round(v / step) * step

export const isOpening = (k: Kind) => k === 'door' || k === 'window'

/** Openings' depth follows their width: a door's swing is as deep as the door is wide. */
export const openingDepth = (k: Kind, width: number) => (k === 'door' ? width : WINDOW_DEPTH)

const wallLength = (rot: Rot, room: { widthCm: number; lengthCm: number }) => (rot % 180 === 0 ? room.widthCm : room.lengthCm)

/** Clamp an opening's `along` so it stays on its wall (centered if wider than the wall). */
export function clampAlong(i: { width: number; rot: Rot }, along: number, room: { widthCm: number; lengthCm: number }) {
  const len = wallLength(i.rot, room)
  return i.width >= len ? len / 2 : Math.min(Math.max(along, i.width / 2), len - i.width / 2)
}

/** Room-space center of an opening sitting on its wall. */
export function openingCenter(i: { width: number; height: number; rot: Rot; along?: number }, room: { widthCm: number; lengthCm: number }) {
  const a = clampAlong(i, i.along ?? 0, room)
  const d = i.height / 2
  switch (i.rot) {
    case 0: return { x: a, y: d }
    case 90: return { x: room.widthCm - d, y: a }
    case 180: return { x: a, y: room.lengthCm - d }
    default: return { x: d, y: a }
  }
}

/** Nearest wall to (x, y) and the position along it, edge snapped to the grid when `snapOn`. */
export function snapToWall(i: { width: number }, x: number, y: number, room: { widthCm: number; lengthCm: number }, snapOn: boolean) {
  const d: [Rot, number][] = [[0, y], [90, room.widthCm - x], [180, room.lengthCm - y], [270, x]]
  const rot = d.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0]
  let along = rot % 180 === 0 ? x : y
  if (snapOn) along = snap(along - i.width / 2) + i.width / 2
  return { rot, along: clampAlong({ width: i.width, rot }, along, room) }
}

/**
 * Where an item's center ends up when dropped at `x, y`: footprint's top-left
 * edge snapped to the grid (when `snapOn`), then clamped inside the room when
 * the item fits.
 */
export function placeCenter(
  i: Pick<Item, 'width' | 'height' | 'rot'>,
  x: number,
  y: number,
  room: { widthCm: number; lengthCm: number },
  snapOn: boolean,
) {
  const { w, h } = footprintSize(i)
  let left = x - w / 2
  let top = y - h / 2
  if (snapOn) {
    left = snap(left)
    top = snap(top)
  }
  if (w <= room.widthCm) left = Math.min(Math.max(left, 0), room.widthCm - w)
  if (h <= room.lengthCm) top = Math.min(Math.max(top, 0), room.lengthCm - h)
  return { x: left + w / 2, y: top + h / 2 }
}

/** Strict overlap (touching edges is fine). */
export function overlaps(a: Item, b: Item) {
  const A = bounds(a)
  const B = bounds(b)
  const EPS = 0.01
  return A.left < B.right - EPS && B.left < A.right - EPS && A.top < B.bottom - EPS && B.top < A.bottom - EPS
}

const flat = (k: Kind) => k === 'rug' || k === 'window'

export type Issue = { outOfBounds: boolean; overlapsWith: string[] }

/**
 * Per-item warnings. Rugs sit under furniture and windows sit in the wall,
 * so neither counts as overlapping. A door's footprint is its swing, so
 * furniture in it overlaps the door. ponytail: O(n²) pairwise scan — fine for a room's worth of
 * furniture; use a sweep line if rooms ever hold hundreds of items.
 */
export function findIssues(items: Item[], room: { widthCm: number; lengthCm: number }) {
  const issues = new Map<string, Issue>()
  for (const it of items) {
    const b = bounds(it)
    const outOfBounds = b.left < -0.01 || b.top < -0.01 || b.right > room.widthCm + 0.01 || b.bottom > room.lengthCm + 0.01
    const overlapsWith = flat(it.kind) ? [] : items.filter((o) => o.id !== it.id && !flat(o.kind) && overlaps(it, o)).map((o) => o.id)
    if (outOfBounds || overlapsWith.length) issues.set(it.id, { outOfBounds, overlapsWith })
  }
  return issues
}

/** Validate dashboard / settings input in metres; returns cm or an error. */
export function parseRoomDims(widthM: string, lengthM: string): { widthCm: number; lengthCm: number } | string {
  const w = Math.round(Number(widthM) * 100)
  const l = Math.round(Number(lengthM) * 100)
  const ok = (v: number) => Number.isFinite(v) && v >= MIN_ROOM_CM && v <= MAX_ROOM_CM
  if (!ok(w) || !ok(l)) return `Width and length must be between ${MIN_ROOM_CM / 100} m and ${MAX_ROOM_CM / 100} m.`
  return { widthCm: w, lengthCm: l }
}

export const formatM = (cm: number) => `${(cm / 100).toFixed(cm % 100 === 0 ? 0 : cm % 10 === 0 ? 1 : 2)} m`
