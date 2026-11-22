import type { CollectionSchema } from 'deepspace/schema'

/**
 * Room metadata. Furniture does NOT live here — it lives in the room's
 * CanvasRoom (canvas id `room:<recordId>`, see src/lib/room-geometry.ts).
 *
 * Sharing model (MVP): authenticated-link editing. Any signed-in member who
 * has a room's URL can read and edit it; rooms are NOT private. Only the
 * creator can delete. Who has opened a room lives in `roomVisits` (one row
 * per user, see room-visits-schema.ts). `collaborators` is legacy: no longer
 * written, still read so rooms visited before roomVisits existed keep showing.
 */
export const roomsSchema: CollectionSchema = {
  name: 'rooms',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true, maxLength: 80 },
    { name: 'widthCm', storage: 'number', interpretation: 'plain', required: true },
    { name: 'lengthCm', storage: 'number', interpretation: 'plain', required: true },
    { name: 'collaborators', storage: 'text', interpretation: { kind: 'json' } },
  ],
  permissions: {
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: true, update: true, delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export type Room = {
  name: string
  widthCm: number
  lengthCm: number
  collaborators?: string[]
}
