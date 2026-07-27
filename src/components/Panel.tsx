import clsx from 'clsx'
import type { PropsWithChildren, ReactNode } from 'react'

type PanelProps = PropsWithChildren<{
  title: string
  subtitle?: string
  /** Element afișat în dreapta antetului: badge, acțiune, iconiță. */
  aside?: ReactNode
  className?: string
}>

/** Containerul vizual folosit de toate secțiunile dashboardului. */
export function Panel({
  title,
  subtitle,
  aside,
  className,
  children,
}: PanelProps) {
  return (
    <article
      className={clsx(
        'rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 backdrop-blur-sm',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-white">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </article>
  )
}
