import { describe, expect, it } from 'vitest'
import { canvasIdFor, findIssues, footprintSize, nextRot, normRot, parseRoomDims, placeCenter, type Item } from './room-geometry'

const room = { widthCm: 400, lengthCm: 300 }
const item = (o: Partial<Item>): Item => ({ id: 'a', kind: 'desk', x: 100, y: 100, width: 120, height: 60, rot: 0, ...o })

describe('room geometry', () => {
  it('rotation swaps the footprint and cycles 0→90→180→270→0', () => {
    expect(footprintSize(item({ rot: 90 }))).toEqual({ w: 60, h: 120 })
    expect(nextRot(270)).toBe(0)
    expect(nextRot(0, -1)).toBe(270)
    expect(normRot('junk')).toBe(0)
    expect(normRot(450)).toBe(90)
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

  it('gives every room its own canvas', () => {
    expect(canvasIdFor('r1')).not.toBe(canvasIdFor('r2'))
  })
})
