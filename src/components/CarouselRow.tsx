import { useRef, useState, useEffect, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from './Icons'

interface Props {
  title: string
  linkTo?: string
  children: ReactNode
}

export function CarouselRow({ title, linkTo, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  function update() {
    const el = ref.current
    if (!el) return
    setCanLeft(el.scrollLeft > 8)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8)
  }

  useEffect(() => {
    update()
    const el = ref.current
    if (!el) return
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [children])

  function scrollBy(dir: 1 | -1) {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.82, behavior: 'smooth' })
  }

  return (
    <section className="row">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {linkTo && (
          <a href={linkTo} className="section-link">
            Ver mais →
          </a>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        {canLeft && (
          <button className="row-arrow row-arrow--left" onClick={() => scrollBy(-1)} aria-label="Anterior">
            <ChevronLeft size={22} />
          </button>
        )}
        <div className="row-scroll" ref={ref}>
          {children}
        </div>
        {canRight && (
          <button className="row-arrow row-arrow--right" onClick={() => scrollBy(1)} aria-label="Próximo">
            <ChevronRight size={22} />
          </button>
        )}
      </div>
    </section>
  )
}
