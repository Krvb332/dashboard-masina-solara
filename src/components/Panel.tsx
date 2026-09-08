import clsx from 'clsx'
import type { PropsWithChildren, ReactNode } from 'react'

/** Containerul vizual comun al secțiunilor. Evită repetarea claselor de card. */
export function Panel({
  title,
  subtitle,
  action,
  className,
  bodyClassName,
  children,
}: PropsWithChildren<{
  title: string
  subtitle?: string
  action?: ReactNode
  className?: string
  bodyClassName?: string
}>) {
  return (
    <article
      className={clsx(
        // `min-w-0`: elementele de grid nu coboară implicit sub lățimea
        // conținutului, iar tabelele și textele lungi ar sparge layoutul pe ecrane mici.
        'min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/10 backdrop-blur-sm',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-white">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      {/*
        `relative` face din corpul panoului blocul de referință pentru
        descendenții poziționați absolut (de exemplu textele `sr-only` dintr-un
        tabel lat). Fără el, aceștia scapă din containerul cu scroll orizontal
        și întind pagina în lateral pe ecrane mici.
      */}
      <div className={clsx('relative mt-4', bodyClassName)}>{children}</div>
    </article>
  )
}
