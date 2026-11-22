/**
 * Landing page — STATIC (no providers, prerendered). Keep it renderable
 * without a browser: no window/document during render.
 */
import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { FurnitureArt } from '../components/room/FurnitureArt'
import { seo } from '../seo'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="mx-auto flex min-h-screen max-w-6xl flex-col px-6">
        <header className="flex items-center justify-between py-6">
          <span className="font-display text-2xl text-foreground">Roomly</span>
          <Link to="/rooms" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
        </header>
        <main className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-2">
          <div>
            <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-primary">Room planning, together</p>
            <h1 className="font-display text-5xl leading-[1.05] text-foreground sm:text-6xl">
              Arrange the room before you lift a thing.
            </h1>
            <p className="mt-6 max-w-md text-lg text-muted-foreground">
              Measure your room, drop in a bed, desk, or sofa, and drag pieces into place. Share the link and
              your roommate edits the same plan with you — live.
            </p>
            <Link
              to="/rooms"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Start planning
            </Link>
          </div>
          <svg viewBox="-30 -30 460 380" className="w-full drop-shadow-sm" aria-label="Example floor plan with a bed, desk, rug and sofa">
            <rect x={-6} y={-6} width={412} height={332} rx={2} fill="var(--color-wall)" />
            <rect width={400} height={320} fill="var(--color-floor)" />
            <g transform="translate(20 20)"><FurnitureArt kind="bed" w={160} h={200} /></g>
            <g transform="translate(170 160)"><FurnitureArt kind="rug" w={200} h={140} /></g>
            <g transform="translate(220 200)"><FurnitureArt kind="sofa" w={140} h={80} /></g>
            <g transform="translate(260 10)"><FurnitureArt kind="desk" w={120} h={60} /></g>
            <g transform="translate(345 105) rotate(180) translate(-25 -25)"><FurnitureArt kind="chair" w={50} h={50} /></g>
            <g transform="translate(20 250)"><FurnitureArt kind="dresser" w={100} h={50} /></g>
          </svg>
        </main>
        <footer className="py-6 text-xs text-muted-foreground">Rooms are shared by link with signed-in users — not private.</footer>
      </div>
    </>
  )
}
