# Dashboard Mașină Solară · TUCN Racing Team

Interfață web local-first pentru monitorizarea în timp real a telemetriei mașinii solare în pitlane.

## Stack

- React 19, TypeScript și Vite
- Tailwind CSS
- React Router
- TanStack Query și Zustand
- Zod pentru validarea mesajelor
- Apache ECharts pentru grafice
- Vitest și Testing Library
- Oxlint și Prettier

## Pornire locală

```bash
npm install
npm run dev
```

Aplicația este disponibilă implicit la `http://localhost:5173`.

**Fără niciun server configurat, aplicația pornește pe simulatorul integrat**, deci poate fi dezvoltată și demonstrată fără mașină și fără backend.

## Verificări

```bash
npm run check
```

Comanda rulează lint, verificarea TypeScript, testele și buildul de producție.

## Configurare

Copiază `.env.example` în `.env.local`.

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws/telemetry
VITE_TELEMETRY_SOURCE=auto
```

`VITE_TELEMETRY_SOURCE` acceptă:

| Valoare | Comportament |
| --- | --- |
| `auto` (implicit) | WebSocket dacă `VITE_WS_URL` este setat, altfel simulator |
| `websocket` | Se conectează la `VITE_WS_URL` |
| `simulator` | Date generate local |

Sursa poate fi comutată și din interfață, din colțul barei laterale, fără repornire.

## Contractul de date

Serverul trimite prin WebSocket mesajul descris în documentul de arhitectură:

```json
{
  "schema_version": 1,
  "vehicle_id": "tucn-solar-01",
  "session_id": "race-2026-07-21",
  "timestamp": "2026-07-21T12:34:56.123Z",
  "sequence": 18452,
  "signals": { "battery_soc_pct": 76.2 }
}
```

Sunt acceptate și variantele:

- semnal cu calitate explicită: `{"value": 76.2, "quality": "valid"}`, unde `quality` este `valid`, `stale`, `unavailable` sau `error`;
- mesaj cu plic: `{"type": "telemetry", "frame": {…}}`;
- alarme calculate pe server: `{"type": "alarms", "alarms": [{"id": "…", "severity": "critical", "title": "…"}]}`.

Mesajele care nu trec de validarea Zod sunt numărate și afișate în pagina **Sistem**, nu aruncate în tăcere.

## Decizii de implementare

- **`0` nu înseamnă „fără date".** Valorile lipsă sunt `null` și se afișează ca `—`. Vechimea ultimului mesaj este vizibilă permanent, iar indicatorul de conexiune trece pe „date învechite" chiar dacă socketul este deschis.
- **Recepția și afișarea sunt separate.** Cadrele sunt înregistrate în istoric la rata plină, dar publicate în React cel mult de `uiRefreshHz` ori pe secundă (implicit 10 Hz), conform deciziei #4 din documentul de arhitectură.
- **Istoricul stă în afara stării React** (`lib/history-buffer.ts`), într-un buffer mutabil pe coloane. Componentele se abonează la `historyVersion`.
- **Alarmele sunt evaluate local, dar cele de la server au prioritate** (`lib/alarms.ts`). Pragurile locale sunt o soluție temporară până când backendul le calculează și le înregistrează în istoricul sesiunii.
- **Registrul de semnale** (`config/signals.ts`) este sursa unică de adevăr: etichetă, unitate, precizie, grupă și praguri. Un semnal nou se adaugă într-un singur loc.
- **Circuitul simulat** (`lib/track.ts`) este definit prin puncte de reper, interpolate cu o spline Catmull-Rom închisă și reeșantionate la pas constant de 3 m. Din curbura fiecărui punct rezultă o limită de viteză (`v = √(a_lateral / κ)`), peste care se aplică treceri înainte și înapoi pe buclă pentru a respecta accelerația și frânarea — altfel mașina ar intra în viraj cu viteza de pe dreaptă. Rezultă un circuit de ~3,1 km, parcurs în ~174 s, cu viteze între 25 și 90 km/h. Poziția GPS nu mai este un cerc, ci consecința distanței parcurse.
- **Harta traseului este SVG, nu ECharts.** O reprezentare cartografică trebuie să păstreze proporțiile: `preserveAspectRatio` garantează că un viraj rotund rămâne rotund indiferent de forma panoului, ceea ce axele cartesiene scalate independent nu asigurau. Harta se redesenează de 2 ori pe secundă, nu la fiecare cadru, și subeșantionează traseul peste 900 de puncte.
- **Importurile ECharts trebuie făcute din `echarts-for-react/esm/core`.** Varianta `lib/` este CommonJS și, prin interop-ul din browser, ajunge ca obiect de modul — React cade cu „Element type is invalid". Testele din jsdom nu prind asta, pentru că Node rezolvă corect `exports.default`, deci restricția este impusă de o regulă `no-restricted-imports` în `.oxlintrc.json`.

## Structură

```text
src/
├── app/          # router, provideri globali și layout
├── components/   # componente UI reutilizabile
├── config/       # variabile de mediu și registrul de semnale
├── features/     # câte o pagină per domeniu
├── hooks/        # conectarea la telemetrie și derivarea datelor
├── lib/          # surse de date, istoric, alarme, formatare
├── schemas/      # validarea contractelor de date
├── stores/       # stare client
└── test/         # configurarea testelor
```

Arhitectura recomandată pentru întregul sistem este documentată în [`docs/recomandari-arhitectura-dashboard-masina-solara.md`](docs/recomandari-arhitectura-dashboard-masina-solara.md).
