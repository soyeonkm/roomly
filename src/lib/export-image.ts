/**
 * Save an on-screen SVG as a JPEG.
 *
 * An SVG drawn as an <img> can't see the page's CSS (theme variables,
 * Tailwind classes), so computed paint/text styles are copied onto a clone
 * first. Elements marked data-export="skip" (selection, cursors) are dropped.
 */

const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight', 'paint-order', 'visibility']

export async function svgToJpeg(svg: SVGSVGElement, fileName: string, { pxPerUnit = 2, maxPx = 4000, background = '#ffffff' } = {}) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const src = [svg, ...svg.querySelectorAll('*')]
  const dst = [clone, ...clone.querySelectorAll('*')]
  src.forEach((el, i) => {
    const cs = getComputedStyle(el)
    ;(dst[i] as SVGElement).setAttribute('style', STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'))
  })
  clone.querySelectorAll('[data-export="skip"]').forEach((el) => el.remove())

  const { width: vw, height: vh } = svg.viewBox.baseVal
  const scale = Math.min(pxPerUnit, maxPx / Math.max(vw, vh))
  const w = Math.round(vw * scale)
  const h = Math.round(vh * scale)
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = background // JPEG has no transparency
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
    if (!blob) throw new Error('Could not encode the image')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  } finally {
    URL.revokeObjectURL(url)
  }
}
