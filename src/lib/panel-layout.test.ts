import { describe, expect, it } from 'vitest'
import { moveItem, nextSpan, reconcileOrder } from './panel-layout'

describe('moveItem', () => {
  it('lasă panoul pe locul țintei, în ambele sensuri', () => {
    expect(moveItem(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('ignoră id-urile necunoscute', () => {
    const order = ['a', 'b']
    expect(moveItem(order, 'x', 'a')).toBe(order)
  })
})

describe('nextSpan', () => {
  it('trece ciclic prin lățimi', () => {
    expect([2, 3, 4, 6].map((span) => nextSpan(span as 2))).toEqual([
      3, 4, 6, 2,
    ])
  })
})

describe('reconcileOrder', () => {
  it('fără aranjare salvată, rămâne ordinea din cod', () => {
    expect(reconcileOrder([], ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('păstrează ordinea salvată și uită panourile scoase din cod', () => {
    expect(reconcileOrder(['c', 'gone', 'a', 'b'], ['a', 'b', 'c'])).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('nu pierde panourile adăugate după salvare', () => {
    const result = reconcileOrder(['b', 'a'], ['a', 'nou', 'b'])
    expect(result.toSorted()).toEqual(['a', 'b', 'nou'])
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('a'))
  })
})
