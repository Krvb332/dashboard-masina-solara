/**
 * Numele românești ale stărilor vremii.
 *
 * Furnizorul întoarce și o descriere localizată, dar traducerea lui automată în
 * română este nesigură. Două exemple culese din răspunsuri reale:
 *
 *  - `CLEAR` a venit tradus **„Ștergeți”** — imperativul verbului „a șterge”,
 *    adică sensul de „clear" din informatică, nu cel meteorologic. Afișat ca
 *    stare a vremii, nu înseamnă nimic.
 *  - `MOSTLY_CLEAR` a venit „În mare parte însorit" de la endpointul de
 *    condiții curente și „Cer senin, periodic înnorat" de la cel de prognoză.
 *    Aceeași stare, două nume, în același ecran.
 *
 * De aceea numele îl dăm noi, pornind de la `type`, care este un enum stabil.
 * Descrierea furnizorului rămâne rezervă, pentru un tip pe care nu îl cunoaștem
 * încă — mai bine o traducere stângace decât un gol.
 */

const LABELS: Record<string, string> = {
  CLEAR: 'Senin',
  MOSTLY_CLEAR: 'În mare parte senin',
  PARTLY_CLOUDY: 'Parțial înnorat',
  MOSTLY_CLOUDY: 'În mare parte înnorat',
  CLOUDY: 'Înnorat',

  WINDY: 'Vânt',
  WIND_AND_RAIN: 'Vânt și ploaie',

  LIGHT_RAIN_SHOWERS: 'Averse slabe',
  CHANCE_OF_SHOWERS: 'Posibile averse',
  SCATTERED_SHOWERS: 'Averse izolate',
  RAIN_SHOWERS: 'Averse',
  HEAVY_RAIN_SHOWERS: 'Averse puternice',
  LIGHT_TO_MODERATE_RAIN: 'Ploaie slabă spre moderată',
  MODERATE_TO_HEAVY_RAIN: 'Ploaie moderată spre puternică',
  RAIN: 'Ploaie',
  LIGHT_RAIN: 'Ploaie slabă',
  HEAVY_RAIN: 'Ploaie puternică',
  RAIN_PERIODICALLY_HEAVY: 'Ploaie, pe alocuri puternică',

  LIGHT_SNOW_SHOWERS: 'Ninsori slabe',
  CHANCE_OF_SNOW_SHOWERS: 'Posibile ninsori',
  SCATTERED_SNOW_SHOWERS: 'Ninsori izolate',
  SNOW_SHOWERS: 'Ninsori',
  HEAVY_SNOW_SHOWERS: 'Ninsori puternice',
  LIGHT_TO_MODERATE_SNOW: 'Ninsoare slabă spre moderată',
  MODERATE_TO_HEAVY_SNOW: 'Ninsoare moderată spre puternică',
  SNOW: 'Ninsoare',
  LIGHT_SNOW: 'Ninsoare slabă',
  HEAVY_SNOW: 'Ninsoare puternică',
  SNOWSTORM: 'Viscol',
  SNOW_PERIODICALLY_HEAVY: 'Ninsoare, pe alocuri puternică',
  HEAVY_SNOW_STORM: 'Viscol puternic',
  BLOWING_SNOW: 'Ninsoare spulberată',
  RAIN_AND_SNOW: 'Lapoviță',

  HAIL: 'Grindină',
  HAIL_SHOWERS: 'Averse de grindină',

  THUNDERSTORM: 'Furtună cu descărcări electrice',
  THUNDERSHOWER: 'Aversă cu descărcări electrice',
  LIGHT_THUNDERSTORM_RAIN: 'Ploaie slabă cu descărcări electrice',
  SCATTERED_THUNDERSTORMS: 'Furtuni izolate',
  HEAVY_THUNDERSTORM: 'Furtună puternică',
}

/**
 * Numele stării vremii, pentru afișare.
 *
 * `null` doar când nu avem nici tip cunoscut, nici descriere — adică nu știm
 * nimic. Interfața afișează atunci „—", nu o stare presupusă.
 */
export function conditionLabel(
  type: string | null | undefined,
  description: string | null | undefined,
): string | null {
  if (typeof type === 'string') {
    const label = LABELS[type]
    if (label !== undefined) return label
  }

  const fallback = description?.trim()
  return fallback ? fallback : null
}
