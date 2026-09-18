import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { describeRecordingError } from './recording'

describe('describeRecordingError', () => {
  it('spune că lipsește tokenul la 401', () => {
    expect(describeRecordingError(new ApiError('Token lipsă', 401))).toMatch(
      /VITE_API_TOKEN/,
    )
  })

  it('spune că trebuie rol de operator la 403', () => {
    expect(
      describeRecordingError(new ApiError('Necesită operator', 403)),
    ).toMatch(/operator/)
  })

  it('spune că nu există înregistrare activă la 409', () => {
    expect(describeRecordingError(new ApiError('Nu există', 409))).toMatch(
      /nicio înregistrare activă/,
    )
  })

  it('arată codul și detaliul pentru alte răspunsuri', () => {
    expect(
      describeRecordingError(new ApiError('Baza de date e blocată.', 500)),
    ).toBe('Serviciul a răspuns 500: Baza de date e blocată.')
  })

  it('tratează căderea rețelei separat de răspunsurile serverului', () => {
    expect(describeRecordingError(new TypeError('Failed to fetch'))).toMatch(
      /nu răspunde/,
    )
  })

  it('nu aruncă pentru valori care nu sunt erori', () => {
    expect(describeRecordingError('ceva')).toMatch(/necunoscut/)
  })
})
