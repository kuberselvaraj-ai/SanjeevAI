import { useEffect, useState } from 'react'

/**
 * Mission Control boot — a one-shot launch sequence shown the first time the
 * app opens in a session. T-minus telemetry lines, ignition, liftoff, gone.
 * Skipped entirely when the user prefers reduced motion.
 */
const SEQUENCE = [
  { at: 0, text: 'T-03 · SYSTEMS CHECK — ALL NOMINAL' },
  { at: 420, text: 'T-02 · MODELS ON STANDBY' },
  { at: 840, text: 'T-01 · IGNITION' },
  { at: 1260, text: 'LIFTOFF — SANJEEV AI', accent: true },
] as const

const HOLD_AFTER_LAST = 520
const FADE_MS = 450

export function BootSplash() {
  const [show] = useState(() => {
    if (typeof window === 'undefined') return false
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    if (sessionStorage.getItem('sanj_booted')) return false
    sessionStorage.setItem('sanj_booted', '1')
    return true
  })
  const [lines, setLines] = useState<number>(0)
  const [fading, setFading] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!show) return
    const timers = SEQUENCE.map((s, i) => setTimeout(() => setLines(i + 1), s.at))
    const last = SEQUENCE[SEQUENCE.length - 1].at + HOLD_AFTER_LAST
    timers.push(setTimeout(() => setFading(true), last))
    timers.push(setTimeout(() => setGone(true), last + FADE_MS))
    return () => timers.forEach(clearTimeout)
  }, [show])

  if (!show || gone) return null

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#050810] ${
        fading ? 'boot-fade' : ''
      }`}
      aria-hidden
    >
      <div className="flex flex-col items-start gap-2.5">
        {/* radar mark */}
        <div className="relative mb-3 h-10 w-10">
          <div className="absolute inset-0 rounded-full border border-[#1a2540]" />
          <div className="absolute inset-[3px] rounded-full border border-[#1a2540]/60" />
          <div className="radar-sweep absolute inset-0 rounded-full" />
          <div
            className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: '#22d3ee', boxShadow: '0 0 8px #22d3ee' }}
          />
        </div>
        {SEQUENCE.slice(0, lines).map((s) => (
          <div
            key={s.text}
            className={`boot-line font-mono-code text-[12px] tracking-[0.18em] ${
              'accent' in s && s.accent
                ? 'font-semibold text-[#f95e2c]'
                : 'text-[#7d8aa5]'
            }`}
          >
            {s.text}
          </div>
        ))}
      </div>
    </div>
  )
}
