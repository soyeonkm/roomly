import type { CollectionSchema } from 'deepspace/schema'

/**
 * "This user has opened this room" — one row per (room, user), so a room
 * shows up on that user's dashboard under "Shared with you".
 *
 * Replaces read-modify-writing a JSON `collaborators` list on the room,
 * where two first visits at the same moment could overwrite each other.
 * Here each visitor only ever writes their own row: recordId is
 * `${roomId}:${userId}` (a repeat visit is an idempotent put), and the
 * visitor is the server-set `createdBy`, never a client-supplied field.
 * Not an access-control list: rooms stay link-shared.
 */
export const roomVisitsSchema: CollectionSchema = {
  name: 'roomVisits',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true, maxLength: 64 },
  ],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false }, // signed-out sockets are `viewer`
    member: { read: true, create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export type RoomVisit = { roomId: string }

export const visitIdFor = (roomId: string, userId: string) => `${roomId}:${userId}`
