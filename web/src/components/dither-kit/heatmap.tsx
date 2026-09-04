// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "./lib"
import { rgb, type DitherColor, seedOfColor } from "./palette"
import {
  BAYER4,
  clamp01,
  type PixelBloom,
  pixelBloomStyle,
  pixelPrefersReducedMotion,
} from "./pixel"

// One day = one 4×4 Bayer tile of backing px, upscaled `image-rendering:
// pixelated` — the same trick as the avatar, stretched across a calendar.
const DAY = 4
const ROWS = 7

export type HeatmapDay = { date: string; events: number }

export type DitherHeatmapProps = {
  /** Sparse day counts (`{ date: "2026-08-30", events: 4 }`); missing days are empty. */
  days: HeatmapDay[]
  /** Columns of days — the rightmost column always contains today. */
  weeks?: number
  /** Palette colour the cells dither with. */
  color?: DitherColor
  /** Glow on the lit cells. */
  bloom?: PixelBloom
  /** Play the Bayer-ordered materialize entrance. */
  animate?: boolean
  /** Called with a day's facts on hover; clears with null when the pointer leaves. */
  onHover?: (day: { date: string; events: number } | null) => void
  className?: string
}

/** Activity → dither density. Four lit tiers over an unlit floor. */
function levelOf(events: number): number {
  if (events <= 0) return 0
  if (events === 1) return 0.35
  if (events === 2) return 0.55
  if (events <= 4) return 0.78
  return 1
}

/**
 * Dither heatmap — a GitHub-style contribution calendar painted with the
 * ordered-dither texture: every lit day is a Bayer tile of the one fill
 * colour, density carrying the intensity, so it reads on light and dark.
 */
export function DitherHeatmap({
  days,
  weeks = 26,
  color = "green",
  bloom = "off",
  animate = true,
  onHover,
  className,
}: DitherHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bloomRef = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; w: number; date: string; events: number } | null>(null)
  const [replay, setReplay] = useState(0)

  // (col, row) → calendar date; the grid is anchored so today sits in the
  // last column at its own weekday row and future cells stay blank. The
  // calendar walks in UTC so keys always match the server's day buckets,
  // whatever timezone the browser is in.
  const { dateAt, keyOf } = useMemo(() => {
    const now = new Date()
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const keyOf = (d: Date) => d.toISOString().slice(0, 10)
    const dateAt = (col: number, row: number) => {
      const offset = (weeks - 1 - col) * 7 + (todayUtc.getUTCDay() - row)
      return new Date(todayUtc.getTime() - offset * 86400000)
    }
    return { dateAt, keyOf }
  }, [weeks])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of days) map.set(d.date, d.events)
    return map
  }, [days])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const w = weeks * DAY
    const h = ROWS * DAY
    canvas.width = w
    canvas.height = h
    const bloomCtx = bloomRef.current?.getContext("2d") ?? null
    if (bloomRef.current) {
      bloomRef.current.width = w
      bloomRef.current.height = h
    }
    const fill = seedOfColor(color).fill
    const now = new Date()
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

    const draw = (progress: number) => {
      ctx.clearRect(0, 0, w, h)
      for (let c = 0; c < weeks; c++) {
        for (let r = 0; r < ROWS; r++) {
          const date = dateAt(c, r)
          if (date > today) continue
          const level = levelOf(counts.get(keyOf(date)) ?? 0)
          // Cells materialize in Bayer order — same matrix as the texture.
          const start = BAYER4[r % 4][c % 4] * 0.7
          const gate = clamp01((progress - start) / 0.3)
          if (gate <= 0) continue
          const base = level === 0 ? 0.06 : 0.3 + 0.7 * level
          for (let py = 0; py < DAY; py++) {
            for (let px = 0; px < DAY; px++) {
              const gx = c * DAY + px
              const gy = r * DAY + py
              // Empty days keep a flat faint tile; lit days dither by density.
              // The off tier stays close to on (vs the avatar's 0.35) — calendar
              // squares are small, and hard checker noise reads as static.
              const lit = level === 0 || level > BAYER4[gy & 3][gx & 3]
              const alpha = (lit ? base : base * 0.72) * gate
              ctx.fillStyle = rgb(fill, 1, alpha)
              ctx.fillRect(gx, gy, 1, 1)
            }
          }
        }
      }
      if (bloomCtx && bloomRef.current) {
        bloomCtx.clearRect(0, 0, w, h)
        bloomCtx.drawImage(canvas, 0, 0)
      }
    }

    if (!animate || pixelPrefersReducedMotion()) {
      draw(1)
      return undefined
    }
    let raf = 0
    const startTime = performance.now()
    const tick = (now: number) => {
      const t = clamp01((now - startTime) / 700)
      draw(1 - (1 - t) ** 3)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [counts, weeks, color, animate, dateAt, replay])

  const bloomStyle = pixelBloomStyle(bloom)

  const hover = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * weeks)
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS)
    if (col < 0 || col >= weeks || row < 0 || row >= ROWS) return setTip(null)
    const date = dateAt(col, row)
    const now = new Date()
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    if (date > today) return setTip(null)
    const events = counts.get(keyOf(date)) ?? 0
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, date: keyOf(date), events })
    onHover?.({ date: keyOf(date), events })
  }

  // Month labels over the columns whose first row flips the month.
  const monthLabels = useMemo(() => {
    const out: { col: number; label: string }[] = []
    let last = -1
    for (let c = 0; c < weeks; c++) {
      const m = dateAt(c, 0).getUTCMonth()
      if (m !== last) {
        out.push({ col: c, label: dateAt(c, 0).toLocaleDateString("en", { month: "short", timeZone: "UTC" }) })
        last = m
      }
    }
    return out
  }, [dateAt, weeks])

  const dayPx = 100 / weeks // % width per day column

  return (
    <div className={cn("relative select-none", className)}>
      <div className="relative h-4 mb-1 set-mono text-[9px] text-set-dim" aria-hidden>
        {monthLabels.map((m) => (
          <span key={m.col} className="absolute top-0" style={{ left: `${m.col * dayPx}%` }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className="relative" style={{ aspectRatio: `${weeks} / ${ROWS}` }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full rounded-[3px]"
          style={{ imageRendering: "pixelated", width: "100%", height: "100%" }}
          onMouseMove={hover}
          onMouseLeave={() => {
            setTip(null)
            onHover?.(null)
          }}
        />
        {bloomStyle && (
          <canvas
            ref={bloomRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ ...bloomStyle, width: "100%", height: "100%" }}
          />
        )}
        {tip && (
          <div
            className="pointer-events-none absolute z-10 set-card px-2 py-1 text-[10px] whitespace-nowrap shadow-lg"
            style={{
              top: tip.y - 30,
              left: tip.x + 10,
              transform: tip.x > tip.w * 0.7 ? "translateX(-110%)" : undefined,
            }}
          >
            <span className="text-set-text">{tip.events > 0 ? `${tip.events} event${tip.events > 1 ? "s" : ""}` : "No activity"}</span>
            <span className="text-set-dim ml-1.5">
              {new Date(`${tip.date}T12:00:00`).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
