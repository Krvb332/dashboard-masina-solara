import clsx from 'clsx'
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  GripVertical,
  Plus,
  RotateCcw,
} from 'lucide-react'
import {
  Children,
  isValidElement,
  useEffect,
  useState,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  EMPTY_LAYOUT,
  loadLayout,
  moveItem,
  nextSpan,
  reconcileOrder,
  saveLayout,
  type PanelLayout,
  type Span,
} from '../lib/panel-layout'
import { useLayoutEdit } from '../stores/layout-store'

/**
 * Grila de panouri a unei pagini, rearanjabilă de om.
 *
 * Pagina își declară panourile în ordinea implicită, fiecare într-un
 * `PanelSlot`. În „modul aranjare" (butonul din antet) panourile se pot trage,
 * lăți, îngusta și ascunde; rezultatul se ține minte pe pagină.
 */

type SlotProps = PropsWithChildren<{
  /** Stabil între versiuni: este cheia sub care se ține minte aranjarea. */
  id: string
  title: string
  span?: Span
}>

/** Doar declarație: `PanelGrid` îi citește proprietățile și desenează cadrul. */
export function PanelSlot(_props: SlotProps): ReactNode {
  return null
}

const SPAN_CLASS: Record<Span, string> = {
  2: 'xl:col-span-2',
  3: 'xl:col-span-3',
  4: 'xl:col-span-4',
  6: 'xl:col-span-6',
}

const SPAN_LABEL: Record<Span, string> = {
  2: '1/3',
  3: '1/2',
  4: '2/3',
  6: 'Lat',
}

const toolButton =
  'grid size-8 shrink-0 place-items-center rounded-lg text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent'

export function PanelGrid({
  storageKey,
  className,
  children,
}: PropsWithChildren<{ storageKey: string; className?: string }>) {
  const editing = useLayoutEdit((state) => state.editing)
  const [layout, setLayout] = useState(() => loadLayout(storageKey))
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  useEffect(() => {
    useLayoutEdit.setState((state) => ({ grids: state.grids + 1 }))
    return () => useLayoutEdit.setState((state) => ({ grids: state.grids - 1 }))
  }, [])

  const slots = Children.toArray(children).filter(
    (child): child is ReactElement<SlotProps> => isValidElement(child),
  )
  const byId = new Map(slots.map((slot) => [slot.props.id, slot.props]))
  // ponytail: un panou condiționat care lipsește chiar când omul rearanjează
  // își pierde locul salvat și revine ca panou nou. De ținut ordinea completă
  // dacă ajunge să deranjeze.
  const order = reconcileOrder(layout.order, [...byId.keys()])
  const visible = order.filter((id) => !layout.hidden.includes(id))
  const hidden = order.filter((id) => layout.hidden.includes(id))

  const update = (next: PanelLayout) => {
    setLayout(next)
    saveLayout(storageKey, next)
  }
  const move = (fromId: string, toId: string | undefined) => {
    if (toId !== undefined)
      update({ ...layout, order: moveItem(order, fromId, toId) })
  }
  const setHidden = (id: string, hide: boolean) =>
    update({
      ...layout,
      hidden: hide
        ? [...layout.hidden, id]
        : layout.hidden.filter((other) => other !== id),
    })

  return (
    <>
      {editing && (
        <div
          className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-blue-400/40 bg-blue-500/10 px-4 py-2.5 text-sm text-blue-100"
          role="status"
        >
          <span className="mr-auto">
            Trage panourile ca să le muți. Lățimea și ascunderea sunt pe bara
            fiecărui panou.
          </span>
          {hidden.map((id) => (
            <button
              key={id}
              type="button"
              className="flex min-h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-xs hover:bg-white/20"
              onClick={() => setHidden(id, false)}
            >
              <Plus size={14} aria-hidden="true" />
              {byId.get(id)?.title}
            </button>
          ))}
          <button
            type="button"
            className="flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-blue-200 hover:bg-white/10"
            onClick={() => update(EMPTY_LAYOUT)}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Aranjarea implicită
          </button>
        </div>
      )}

      <section className={clsx('mt-4 grid gap-4 xl:grid-cols-6', className)}>
        {visible.map((id, index) => {
          const slot = byId.get(id)
          if (slot === undefined) return null
          const span = layout.spans[id] ?? slot.span ?? 6

          return (
            <div
              key={id}
              draggable={editing}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', id)
                setDragId(id)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              onDragOver={(event) => {
                if (dragId === null) return
                event.preventDefault()
                setOverId(id)
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragId !== null) move(dragId, id)
              }}
              className={clsx(
                // Panoul umple celula, ca rândurile să aibă înălțime egală.
                'flex min-w-0 flex-col [&>article]:flex-1',
                SPAN_CLASS[span],
                editing &&
                  'cursor-grab rounded-2xl outline-2 outline-offset-2 outline-dashed',
                editing &&
                  (overId === id && dragId !== id
                    ? 'outline-blue-400'
                    : 'outline-white/15'),
                dragId === id && 'opacity-40',
              )}
            >
              {editing && (
                <div className="mb-2 flex items-center gap-1 rounded-xl bg-zinc-900 px-2 py-1">
                  <GripVertical
                    size={16}
                    className="shrink-0 text-zinc-500"
                    aria-hidden="true"
                  />
                  <span className="mr-auto truncate text-xs font-medium text-zinc-300">
                    {slot.title}
                  </span>
                  <button
                    type="button"
                    className={toolButton}
                    aria-label={`Mută „${slot.title}" mai devreme`}
                    disabled={index === 0}
                    onClick={() => move(id, visible[index - 1])}
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={toolButton}
                    aria-label={`Mută „${slot.title}" mai târziu`}
                    disabled={index === visible.length - 1}
                    onClick={() => move(id, visible[index + 1])}
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={clsx(
                      toolButton,
                      'hidden w-auto px-2 text-xs xl:grid',
                    )}
                    aria-label={`Schimbă lățimea panoului „${slot.title}"`}
                    onClick={() =>
                      update({
                        ...layout,
                        spans: { ...layout.spans, [id]: nextSpan(span) },
                      })
                    }
                  >
                    {SPAN_LABEL[span]}
                  </button>
                  <button
                    type="button"
                    className={toolButton}
                    aria-label={`Ascunde „${slot.title}"`}
                    onClick={() => setHidden(id, true)}
                  >
                    <EyeOff size={16} aria-hidden="true" />
                  </button>
                </div>
              )}
              {slot.children}
            </div>
          )
        })}
      </section>
    </>
  )
}
