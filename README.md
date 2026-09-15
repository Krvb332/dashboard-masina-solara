# Dashboard Mașină Solară — TUCN Racing Team

Sistem local-first pentru monitorizarea în timp real a telemetriei unei mașini solare din pitlane: serviciu de telemetrie, simulator și dashboard web.

## Arhitectură

```text
mașină / simulator ──MQTT (QoS 1)──> broker Mosquitto ──> serviciu telemetrie ──WebSocket──> dashboard
                   └──HTTP (rezervă)────────────────────>│                    └──SQLite────> istoric sesiuni
```

Serviciul validează mesajele, urmărește integritatea fluxului (mesaje lipsă, duplicate, ordine incorectă), calculează alarmele cu histerezis, înregistrează sesiunile și retransmite starea către browser la un ritm redus, controlat.

Detaliile de proiectare sunt în [`docs/recomandari-arhitectura-dashboard-masina-solara.md`](docs/recomandari-arhitectura-dashboard-masina-solara.md).

Pentru integrarea semnalelor noi:

- [`docs/plan-server-semnale-noi.md`](docs/plan-server-semnale-noi.md) — ce se adaugă în serverul de telemetrie;
- [`docs/plan-teensy-semnale-noi.md`](docs/plan-teensy-semnale-noi.md) — ce trebuie să trimită placa de achiziție.

## Stack

**Frontend:** React 19, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, Zustand, Zod, Apache ECharts, Vitest, Oxlint.

**Backend:** Python 3.13, FastAPI, aiomqtt, aiosqlite, pytest.

## Pornire rapidă

Trei terminale. Fără broker, simulatorul trimite direct prin HTTP — util în dezvoltare.

```bash
cd server && python -m venv .venv && .venv/Scripts/pip install -e ".[dev]"
```

```bash
cd server && .venv/Scripts/python -m uvicorn app.main:app --port 8000
```

```bash
cd server && .venv/Scripts/python simulator/simulate.py --direct --hz 10
```

```bash
npm install && npm run dev
```

Dashboardul este la `http://localhost:5173`, API-ul la `http://localhost:8000` (documentație interactivă la `/docs`).

### Cu broker MQTT

```bash
docker compose -f server/docker-compose.yml up -d
```

```bash
cd server && .venv/Scripts/python simulator/simulate.py --mqtt --broker localhost --hz 10
```

### Injectare de defecte

Simulatorul poate reproduce situațiile care contează, fără mașină:

```bash
python simulator/simulate.py --direct --overheat --drop-link 8 --gps-glitch
```

`--overheat` forțează alarmele termice, `--soc-drain` pornește cu bateria descărcată, `--cell-fault` dezechilibrează celulele, `--gps-glitch` degradează poziția, `--motor-fault` ridică biți în codul de eroare al controllerului, `--drop-link N` taie legătura N secunde la fiecare `--drop-every` secunde.

## Paginile dashboardului

| Pagină         | Rol                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Prezentare** | Starea generală: indicatorii principali, fluxul energetic, harta, starea plăcii de achiziție.                                 |
| **Statistici** | Numai grafice, cifre derivate și ce are pilotul de făcut acum. Panoul de consum arată fiecare formulă folosită la optimizare. |
| **Energie**    | Bateria în detaliu: tensiuni, curent, grila celor 32 de celule, MPPT, consum pe tur.                                          |
| **Traseu**     | Harta desenată local, profilul de elevație și verificarea mapării poziției.                                                   |
| **Piloți**     | Profilurile piloților, stintul în curs și istoricul fiecăruia.                                                                |
| **Sistem**     | Sănătatea fluxului, temperaturi, controllerul Mitsuba, verificarea mapării semnalelor.                                        |
| **Sesiuni**    | Pornirea și oprirea înregistrării, redarea și exportul CSV.                                                                   |

Pilotul de la volan se schimbă din antet, din orice pagină: schimbul taie
contoarele exact în momentul apăsării, iar navigarea către o pagină dedicată ar
întârzia tăietura cu secundele în care mașina chiar merge.

## Configurare

Copiază `.env.example` în `.env.local` pentru frontend. Serviciul citește variabile cu prefixul `TELEMETRY_`:

| Variabilă                  | Implicit            | Rol                                               |
| -------------------------- | ------------------- | ------------------------------------------------- |
| `TELEMETRY_MQTT_HOST`      | _(gol)_             | Broker MQTT. Gol înseamnă ingest MQTT dezactivat. |
| `TELEMETRY_MQTT_TOPIC`     | `solar/+/telemetry` | Topicul abonat.                                   |
| `TELEMETRY_DB_PATH`        | `data/telemetry.db` | Baza de date a sesiunilor.                        |
| `TELEMETRY_WS_RATE_HZ`     | `10`                | Ritmul de emisie către browser.                   |
| `TELEMETRY_OPERATOR_TOKEN` | _(gol)_             | Token cu drept de înregistrare.                   |
| `TELEMETRY_VIEWER_TOKEN`   | _(gol)_             | Token doar-citire.                                |

Dacă niciun token nu este configurat, autentificarea este dezactivată — potrivit pentru dezvoltare, nu pentru o rețea partajată.

## Catalogul de semnale

`server/app/signals.py` este sursa unică de adevăr: etichete, unități, zecimale, praguri de alarmă și timpul după care un semnal devine învechit. Frontendul își construiește cardurile, graficele și tabelele din catalogul expus la `GET /api/v1/signals`.

**Adăugarea unui senzor nou înseamnă o linie în `signals.py` și zero modificări în React.**

Catalogul conține 104 semnale, în șapte grupuri: stare generală, energie și
baterie, temperaturi, motor, poziție, șasiu și anvelope, placă de achiziție.
`npm run verify:signals` confirmă că interfața și catalogul spun același lucru.

## Verificări

```bash
npm run check
```

Rulează lint, typecheck, verificarea mapării semnalelor, verificarea că modificările
de catalog sunt aditive, testele și build-ul.

```bash
npm run verify
```

Rulează toate cele patru verificări structurale, inclusiv acoperirea simulatorului
(care cere un interpretor Python ≥ 3.10, la fel ca serviciul de telemetrie):

| Verificare         | Ce garantează                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify:signals`   | Fiecare cheie folosită în interfață există în catalog; grupurile sunt sincronizate cu enumerarea Zod; celulele respectă tiparul cerut de grilă. |
| `verify:catalog`   | Modificările aduse catalogului sunt **aditive**: etichetele, unitățile, zecimalele și pragurile semnalelor existente nu s-au schimbat.          |
| `verify:simulator` | Simulatorul emite toate semnalele din catalog, în domeniul declarat și coerente între ele.                                                      |
| `verify:plans`     | Planurile de integrare acoperă fiecare semnal nou.                                                                                              |

```bash
cd server && .venv/Scripts/python -m pytest
```

## Structură

```text
src/                  # dashboard
├── app/              # router și provideri
├── components/       # componente UI (carduri, grafice, hartă, alarme, piloți)
├── features/         # paginile: prezentare, statistici, energie, traseu,
│                     #   piloți, sistem, sesiuni
├── hooks/            # fluxul live, motorul de statistici, accesul la semnale
├── lib/              # WebSocket, buffere de serii, formule, GPS, replay
├── schemas/          # validarea contractelor de date
└── stores/           # stare client (telemetrie, statistici, piloți, erori)

scripts/              # verificări care rulează pe Node pur

server/               # serviciul de telemetrie
├── app/
│   ├── api/          # WebSocket și REST
│   ├── core/         # magistrală, calitate, alarme, sesiuni
│   ├── ingest/       # MQTT și HTTP
│   ├── storage/      # SQLite (interfață pregătită pentru TimescaleDB)
│   └── signals.py    # catalogul de semnale
├── simulator/        # simulator de telemetrie
└── tests/
```

## Decizii de proiectare

**`0` nu este același lucru cu „fără date".** Fiecare semnal are o stare de calitate (`valid`, `stale`, `unavailable`, `sensor_error`) calculată pe server. Interfața afișează `—` pentru orice nu este proaspăt, niciodată `0` sau ultima valoare cunoscută.

**Alarmele se calculează pe server, cu histerezis.** Pragul de activare diferă de cel de stingere, deci o valoare care oscilează în jurul limitei nu produce zeci de alarme. Când alarma critică a unui semnal este activă, avertizarea aceluiași semnal este ascunsă. Tranzițiile se salvează în istoricul sesiunii.

**Interfața se randează pe două benzi.** Eșantioanele intră imediat într-un buffer circular din afara React, pe care graficele îl citesc într-o buclă `requestAnimationFrame`. Textul se actualizează la ~5 Hz. La 10 Hz și 30 de semnale, trecerea fiecărui eșantion prin state React ar re-randa inutil întreaga pagină.

**Replay-ul folosește aceeași cale de date ca fluxul live.** Componentele nu știu dacă rulează pe date live sau pe o înregistrare, deci nu există o a doua cale de cod care să se strice separat.

**Harta nu folosește tile-uri externe.** Traseul este desenat din coordonatele GPS, auto-scalat. Funcționează fără internet, coerent cu principiul local-first.

**Statisticile derivate se calculează numai din valori proaspete.** Consumul
specific, autonomia, bilanțul energetic și recomandările pentru pilot se sprijină
exclusiv pe semnale marcate `valid`. O valoare `stale` integrată mai departe ar
„consuma" energie cu mașina oprită, iar greșeala nu s-ar vedea pe ecran, ci în
statisticile trase la finalul cursei. Consecința vizibilă: fără nimic conectat,
contoarele sunt exact `0` — nu s-a acumulat nimic — iar mărimile derivate rămân
„—", fiindcă „0 Wh/km" ar fi o afirmație falsă, nu o lipsă de informație.

**Stintul unui pilot este o diferență de contoare, nu un al doilea acumulator.**
La schimbul de la volan se reține linia de bază, iar ce se afișează este
diferența față de ea. Nu există două numărători care s-ar putea desincroniza.

**Semnalele redundante se confruntă între ele.** Mașina trimite și puterea, și
tensiunea, și curentul; și suma MPPT, și totalul solar. Un factor de scalare
greșit trece de orice verificare de domeniu, dar nu trece de comparația cu
perechea lui. Pagina „Sistem" arată cele șase perechi și numește cauza probabilă
a fiecărei nepotriviri.

**Stocarea este SQLite, în spatele unei interfețe.** La 10 Hz, o cursă de opt ore înseamnă ~290.000 de rânduri, dimensiune la care SQLite se comportă bine fără servicii suplimentare în pitlane. Trecerea la TimescaleDB înseamnă o singură clasă nouă care implementează `TelemetryStorage`.
