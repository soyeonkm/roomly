import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthProfileReady, useMutations, useQuery } from 'deepspace'
import { Plus, Ruler, Trash2, Users } from 'lucide-react'
import { Button, Input, Label, useToast } from '@/components/ui'
import { formatM, parseRoomDims } from '@/lib/room-geometry'
import type { Room } from '@/schemas/rooms-schema'

export default function RoomsDashboard() {
  const { userId } = useAuthProfileReady()
  const navigate = useNavigate()
  const toast = useToast()
  // ponytail: loads every room then filters client-side — rooms are link-shared,
  // not private, so this leaks nothing new. Add a server-side `where` when lists grow.
  const { records, status, error } = useQuery<Room>('rooms', { orderBy: 'createdAt', orderDir: 'desc' })
  const { ready, createConfirmed, removeConfirmed } = useMutations<Room>('rooms')

  const [name, setName] = useState('')
  const [widthM, setWidthM] = useState('3.5')
  const [lengthM, setLengthM] = useState('4.2')
  const [formError, setFormError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const mine = records.filter((r) => r.createdBy === userId)
  const shared = records.filter((r) => r.createdBy !== userId && r.data.collaborators?.includes(userId ?? ''))

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setFormError('Give your room a name.')
    const dims = parseRoomDims(widthM, lengthM)
    if (typeof dims === 'string') return setFormError(dims)
    setFormError(null)
    setCreating(true)
    try {
      const id = await createConfirmed({ name: trimmed.slice(0, 80), ...dims, collaborators: [] })
      navigate(`/rooms/${id}`)
    } catch (err) {
      toast.error('Could not create room', err instanceof Error ? err.message : String(err))
      setCreating(false)
    }
  }

  async function onDelete(id: string, roomName: string) {
    if (!confirm(`Delete “${roomName}”? This removes it from everyone's dashboard.`)) return
    try {
      await removeConfirmed(id)
      toast.success('Room deleted')
    } catch (err) {
      toast.error('Could not delete room', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8">
      <header className="mb-10">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Your spaces</p>
        <h1 className="mt-2 font-display text-4xl text-foreground sm:text-5xl">Plan a room together</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Sketch a floor plan, drop in furniture, and share the link with your roommate — you'll both
          see every change as it happens.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
        <form
          onSubmit={onCreate}
          data-testid="create-room-form"
          className="h-fit rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(70,55,35,0.05)]"
        >
          <h2 className="text-lg font-semibold text-foreground">New room</h2>
          <p className="mt-1 text-sm text-muted-foreground">Inside wall-to-wall measurements.</p>
          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="room-name">Name</Label>
              <Input id="room-name" placeholder="Shared bedroom" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="room-width">Width (m)</Label>
                <Input id="room-width" type="number" inputMode="decimal" step="0.1" min="1" max="30" value={widthM} onChange={(e) => setWidthM(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="room-length">Length (m)</Label>
                <Input id="room-length" type="number" inputMode="decimal" step="0.1" min="1" max="30" value={lengthM} onChange={(e) => setLengthM(e.target.value)} />
              </div>
            </div>
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
            <Button type="submit" className="w-full" disabled={!ready} loading={creating}>
              <Plus /> Create room
            </Button>
          </div>
        </form>

        <section aria-label="Rooms" className="space-y-8">
          {status === 'loading' && <RoomGridSkeleton />}
          {status === 'error' && <p className="text-destructive">Couldn't load rooms: {error}</p>}
          {status === 'ready' && (
            <>
              <RoomGroup title="Created by you" rooms={mine} onDelete={onDelete} canDelete empty="No rooms yet — create your first one." />
              {shared.length > 0 && <RoomGroup title="Shared with you" rooms={shared} empty="" />}
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Sharing is link-based: anyone signed in to Roomly who has a room's link can view and edit it.
            Rooms are not private.
          </p>
        </section>
      </div>
    </div>
  )
}

type RoomRec = { recordId: string; data: Room; createdAt: string }

function RoomGroup({ title, rooms, empty, canDelete, onDelete }: {
  title: string
  rooms: RoomRec[]
  empty: string
  canDelete?: boolean
  onDelete?: (id: string, name: string) => void
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {rooms.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rooms.map((r) => (
            <li key={r.recordId} className="group relative">
              <Link
                to={`/rooms/${r.recordId}`}
                data-testid="room-card"
                className="block rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(70,55,35,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_20px_-6px_rgba(70,55,35,0.18)]"
              >
                <RoomThumb w={r.data.widthCm} l={r.data.lengthCm} />
                <div className="mt-3 truncate font-medium text-foreground">{r.data.name}</div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Ruler className="size-3.5" />{formatM(r.data.widthCm)} × {formatM(r.data.lengthCm)}</span>
                  {(r.data.collaborators?.length ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{(r.data.collaborators?.length ?? 0) + 1}</span>
                  )}
                </div>
              </Link>
              {canDelete && onDelete && (
                <button
                  aria-label={`Delete ${r.data.name}`}
                  onClick={() => onDelete(r.recordId, r.data.name)}
                  className="absolute right-3 top-3 rounded-lg bg-card/90 p-1.5 text-muted-foreground opacity-0 shadow-sm transition hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RoomThumb({ w, l }: { w: number; l: number }) {
  const pad = Math.max(w, l) * 0.08
  return (
    <div className="flex h-32 items-center justify-center rounded-xl bg-muted/60">
      <svg viewBox={`${-pad} ${-pad} ${w + pad * 2} ${l + pad * 2}`} className="h-full w-full p-2" aria-hidden>
        <defs>
          <pattern id={`g-${w}-${l}`} width={50} height={50} patternUnits="userSpaceOnUse">
            <path d="M50 0H0V50" fill="none" stroke="var(--color-grid)" strokeWidth={2} />
          </pattern>
        </defs>
        <rect width={w} height={l} fill="var(--color-floor)" />
        <rect width={w} height={l} fill={`url(#g-${w}-${l})`} />
        <rect width={w} height={l} fill="none" stroke="var(--color-wall)" strokeWidth={Math.max(w, l) * 0.02} />
      </svg>
    </div>
  )
}

function RoomGridSkeleton() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
      ))}
    </ul>
  )
}
