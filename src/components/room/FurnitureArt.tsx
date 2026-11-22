import type { Kind } from '@/lib/room-geometry'

/**
 * Top-down illustration of a furniture item, drawn in its own unrotated
 * local space (0..w, 0..h, cm). The caller rotates it. "Top" of the local
 * space is the item's back (headboard, sofa back, chair back).
 */
export function FurnitureArt({ kind, w, h }: { kind: Kind; w: number; h: number }) {
  const s = { vectorEffect: 'non-scaling-stroke' as const }
  switch (kind) {
    case 'bed': {
      const pillowW = (w - 24) / 2
      return (
        <g>
          <rect width={w} height={h} rx={6} fill="#efe6d8" stroke="#a89479" strokeWidth={1.25} {...s} />
          <rect width={w} height={14} rx={5} fill="#a89479" />
          <rect x={8} y={20} width={pillowW} height={30} rx={8} fill="#fffdf9" stroke="#cdbfa9" {...s} />
          <rect x={16 + pillowW} y={20} width={pillowW} height={30} rx={8} fill="#fffdf9" stroke="#cdbfa9" {...s} />
          <rect x={4} y={h * 0.38} width={w - 8} height={h * 0.62 - 4} rx={5} fill="#b7c6b3" stroke="#8ca288" {...s} />
          <line x1={4} x2={w - 4} y1={h * 0.38 + 18} y2={h * 0.38 + 18} stroke="#8ca288" strokeWidth={1} {...s} />
        </g>
      )
    }
    case 'sofa': {
      const arm = Math.min(18, w * 0.12)
      const back = Math.min(20, h * 0.25)
      const seats = w >= 160 ? 3 : 2
      const seatW = (w - arm * 2) / seats
      return (
        <g>
          <rect width={w} height={h} rx={10} fill="#c98b6f" stroke="#9c614a" strokeWidth={1.25} {...s} />
          <rect x={arm} y={back} width={w - arm * 2} height={h - back - 4} fill="#dba78f" />
          {Array.from({ length: seats }, (_, i) => (
            <rect key={i} x={arm + i * seatW + 2} y={back + 2} width={seatW - 4} height={h - back - 8} rx={5} fill="#e5bba7" stroke="#b77a60" {...s} />
          ))}
        </g>
      )
    }
    case 'desk':
      return (
        <g>
          <rect width={w} height={h} rx={3} fill="#d8b98f" stroke="#9f7d55" strokeWidth={1.25} {...s} />
          <rect x={w * 0.3} y={6} width={w * 0.4} height={6} rx={2} fill="#4d4a45" />
          <rect x={w * 0.32} y={h * 0.45} width={w * 0.36} height={h * 0.28} rx={3} fill="#f3ead9" stroke="#b79a73" {...s} />
          <circle cx={w * 0.82} cy={h * 0.55} r={Math.min(6, h * 0.1)} fill="#8ca288" />
        </g>
      )
    case 'chair':
      return (
        <g>
          <rect x={3} y={10} width={w - 6} height={h - 13} rx={10} fill="#a9bba6" stroke="#6f8a6e" strokeWidth={1.25} {...s} />
          <rect x={1} y={0} width={w - 2} height={12} rx={5} fill="#6f8a6e" />
        </g>
      )
    case 'dresser': {
      const cols = w >= 80 ? 2 : 1
      const cw = (w - 8) / cols
      return (
        <g>
          <rect width={w} height={h} rx={3} fill="#b99b7c" stroke="#7d6248" strokeWidth={1.25} {...s} />
          <rect x={0} y={0} width={w} height={6} rx={2} fill="#7d6248" />
          {Array.from({ length: cols }, (_, i) => (
            <g key={i}>
              <rect x={4 + i * cw + 2} y={10} width={cw - 4} height={h - 14} rx={2} fill="#c9ae91" stroke="#8f7357" {...s} />
              <rect x={4 + i * cw + cw / 2 - 6} y={h - 10} width={12} height={3} rx={1.5} fill="#5d4735" />
            </g>
          ))}
        </g>
      )
    }
    case 'rug':
      return (
        <g opacity={0.9}>
          <rect width={w} height={h} rx={4} fill="#ead7c6" stroke="#c47a5a" strokeWidth={1} {...s} />
          <rect x={10} y={10} width={w - 20} height={h - 20} rx={3} fill="none" stroke="#c47a5a" strokeDasharray="6 5" strokeWidth={1} {...s} />
          <rect x={w * 0.3} y={h * 0.3} width={w * 0.4} height={h * 0.4} rx={h * 0.2} fill="#dfc0a8" />
        </g>
      )
    case 'custom':
      return (
        <g>
          <rect width={w} height={h} rx={4} fill="#e4dfd6" stroke="#8a8073" strokeWidth={1.25} {...s} />
          <rect x={Math.min(5, w / 4)} y={Math.min(5, h / 4)} width={Math.max(0, w - Math.min(10, w / 2))} height={Math.max(0, h - Math.min(10, h / 2))} rx={3} fill="none" stroke="#b3a999" strokeDasharray="4 3" strokeWidth={1} {...s} />
        </g>
      )
  }
}

/** Small swatch for the palette. */
export function FurnitureIcon({ kind, w, h }: { kind: Kind; w: number; h: number }) {
  const pad = 6
  return (
    <svg viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`} className="h-full w-full" aria-hidden>
      <FurnitureArt kind={kind} w={w} h={h} />
    </svg>
  )
}
