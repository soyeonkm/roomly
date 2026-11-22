import { describe, expect, it } from 'vitest'
import { bounds, canvasIdFor, clampAlong, openingCenter, openingDepth, snapToWall, cleanLabel, CUSTOM_DEFAULT, isKind, labelFor, findIssues, footprintSize, nextRot, normRot, parseItemSize, parseRoomDims, placeCenter, type Item } from './room-geometry'

const room = { widthCm: 400, lengthCm: 300 }
const item = (o: Partial<Item>): Item => ({ id: 'a', kind: 'desk', label: 'Desk', x: 100, y: 100, width: 120, height: 60, rot: 0, ...o })

describe('room geometry', () => {
  it('rotation swaps the footprint and cycles 0→90→180→270→0', () => {
    expect(footprintSize(item({ rot: 90 }))).toEqual({ w: 60, h: 120 })
    expect(nextRot(270)).toBe(0)
    expect(nextRot(0, -1)).toBe(270)
    expect(normRot('junk')).toBe(0)
    expect(normRot(450)).toBe(90)
  })

  it('parses furniture size input: rounds, clamps to 10 cm … 30 m, rejects junk', () => {
    expect(parseItemSize('142.6')).toBe(143)
    expect(parseItemSize('3')).toBe(10)
    expect(parseItemSize('99999')).toBe(3000)
    expect(parseItemSize('')).toBeNull()
    expect(parseItemSize('abc')).toBeNull()
  })

  it('resizing keeps the center and pulls an item back inside the walls', () => {
    // Desk against the right wall (right edge at 400) grows from 120 to 200 wide.
    expect(placeCenter({ width: 200, height: 60, rot: 0 }, 340, 100, room, false)).toEqual({ x: 300, y: 100 })
    // Rotated, width runs along y: a 260-long item near the bottom wall is pulled up.
    expect(placeCenter({ width: 260, height: 60, rot: 90 }, 100, 250, room, false)).toEqual({ x: 100, y: 170 })
    // Room-sized item ends exactly at the walls; a size that already fits doesn't move.
    expect(placeCenter({ width: 400, height: 300, rot: 0 }, 50, 50, room, false)).toEqual({ x: 200, y: 150 })
    expect(placeCenter({ width: 120, height: 60, rot: 0 }, 200, 150, room, false)).toEqual({ x: 200, y: 150 })
  })

  it('custom sizes drive footprint, bounds and overlap checks', () => {
    const big = item({ id: 'big', width: 300, height: 40, rot: 90, x: 200, y: 150 })
    expect(footprintSize(big)).toEqual({ w: 40, h: 300 })
    expect(bounds(big)).toEqual({ left: 180, top: 0, right: 220, bottom: 300 })
    const other = item({ id: 'o', width: 50, height: 50, x: 250, y: 150 })
    expect(findIssues([big, other], room).has('o')).toBe(false) // 220 < 225: clear
    const wider = { ...big, width: 300, height: 120 } // footprint now 120 wide: 140…260
    expect(findIssues([wider, other], room).get('o')?.overlapsWith).toEqual(['big'])
  })

  it('snaps footprint edges to the grid and clamps inside the room', () => {
    expect(placeCenter(item({}), 103, 97, room, true)).toEqual({ x: 100, y: 100 })
    expect(placeCenter(item({}), -50, 1000, room, true)).toEqual({ x: 60, y: 270 })
    expect(placeCenter(item({ rot: 90 }), 399, 0, room, false)).toEqual({ x: 370, y: 60 })
  })

  it('flags overlaps (ignoring rugs and touching edges) and out-of-bounds', () => {
    const issues = findIssues(
      [
        item({ id: 'a', x: 60, y: 30 }),
        item({ id: 'b', x: 120, y: 30 }), // overlaps a by 60
        item({ id: 'c', x: 240, y: 30 }), // touches b's edge only
        item({ id: 'rug', kind: 'rug', x: 100, y: 100, width: 200, height: 140 }),
        item({ id: 'out', x: 390, y: 280 }),
      ],
      room,
    )
    expect(issues.get('a')?.overlapsWith).toEqual(['b'])
    expect(issues.has('c')).toBe(false)
    expect(issues.has('rug')).toBe(false)
    expect(issues.get('out')?.outOfBounds).toBe(true)
  })

  it('validates room dimensions in metres', () => {
    expect(parseRoomDims('3.5', '4')).toEqual({ widthCm: 350, lengthCm: 400 })
    expect(typeof parseRoomDims('0.5', '4')).toBe('string')
    expect(typeof parseRoomDims('abc', '4')).toBe('string')
  })

  it('custom furniture: valid kind, cleaned label, 120 × 60 default', () => {
    expect(isKind('custom')).toBe(true)
    expect(isKind('piano')).toBe(false)
    expect(CUSTOM_DEFAULT).toEqual({ width: 120, height: 60 })
    expect(cleanLabel('  Book   shelf \n')).toBe('Book shelf')
    expect(cleanLabel('x'.repeat(60))).toHaveLength(40)
    expect(cleanLabel(42)).toBe('')
    expect(labelFor('custom', 'Piano')).toBe('Piano')
    expect(labelFor('custom', '   ')).toBe('Custom') // blank or tampered props still render
    expect(labelFor('bed', 'ignored')).toBe('Bed')
  })

  it('openings sit on their wall: center derived from wall + along, clamped to the wall', () => {
    const door = { width: 80, height: 80, along: 100 }
    expect(openingCenter({ ...door, rot: 0 }, room)).toEqual({ x: 100, y: 40 })
    expect(openingCenter({ ...door, rot: 90 }, room)).toEqual({ x: 360, y: 100 })
    expect(openingCenter({ ...door, rot: 180 }, room)).toEqual({ x: 100, y: 260 })
    expect(openingCenter({ ...door, rot: 270 }, room)).toEqual({ x: 40, y: 100 })
    // Past the end of the wall (e.g. the room shrank): pulled back so it fits.
    expect(openingCenter({ ...door, rot: 90, along: 999 }, room)).toEqual({ x: 360, y: 260 })
    expect(clampAlong({ width: 500, rot: 0 }, 10, room)).toBe(200) // wider than the wall: centered
    // A door's footprint is its swing; windows are a fixed shallow strip.
    expect(openingDepth('door', 90)).toBe(90)
    expect(openingDepth('window', 200)).toBe(15)
  })

  it('dragging an opening snaps it to the nearest wall', () => {
    expect(snapToWall({ width: 80 }, 200, 20, room, false)).toEqual({ rot: 0, along: 200 })
    expect(snapToWall({ width: 80 }, 390, 150, room, false)).toEqual({ rot: 90, along: 150 })
    expect(snapToWall({ width: 80 }, 123, 290, room, true)).toEqual({ rot: 180, along: 120 }) // edge 80 → grid
    expect(snapToWall({ width: 80 }, 5, 10, room, false)).toEqual({ rot: 270, along: 40 }) // corner: clamped onto wall
  })

  it('a door blocks furniture in its swing; windows never overlap', () => {
    const door = item({ id: 'door', kind: 'door', x: 100, y: 40, width: 80, height: 80 })
    const win = item({ id: 'win', kind: 'window', x: 100, y: 7.5, width: 100, height: 15 })
    const chair = item({ id: 'chair', kind: 'chair', x: 100, y: 30, width: 50, height: 50 })
    const issues = findIssues([door, win, chair], room)
    expect(issues.get('chair')?.overlapsWith).toEqual(['door'])
    expect(issues.get('door')?.overlapsWith).toEqual(['chair'])
    expect(issues.has('win')).toBe(false)
  })

  it('gives every room its own canvas', () => {
    expect(canvasIdFor('r1')).not.toBe(canvasIdFor('r2'))
  })
})
