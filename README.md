# Dashboard Mașină Solară — TUCN Racing Team

Sistem local-first pentru monitorizarea în timp real a telemetriei unei mașini solare din pitlane: serviciu de telemetrie, simulator și dashboard web.

## Arhitectură

```text
mașină / simulator ──MQTT (QoS 1)──> broker Mosquitto ──> serviciu telemetrie ──WebSocket──> dashboard
                   └──HTTP (rezervă)────────────────────>│                    └──SQLite────> istoric sesiuni
```

Serviciul validează mesajele, urmărește integritatea fluxului (mesaje lipsă, duplicate, ordine incorectă), calculează alarmele cu histerezis, înregistrează sesiunile și retransmite starea către browser la un ritm redus, controlat.

Detaliile de proiectare sunt în [`docs/recomandari-arhitectura-dashboard-masina-solara.md`](docs/recomandari-arhitectura-dashboard-masina-solara.md).

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

`--overheat` forțează alarmele termice, `--soc-drain` pornește cu bateria descărcată, `--cell-fault` dezechilibrează celulele, `--gps-glitch` degradează poziția, `--drop-link N` taie legătura N secunde la fiecare `--drop-every` secunde.

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

## Verificări

```bash
npm run check
```

```bash
cd server && .venv/Scripts/python -m pytest
```

## Structură

```text
src/                  # dashboard
├── app/              # router și provideri
├── components/       # componente UI (carduri, grafice, hartă, alarme)
├── features/         # paginile: prezentare, energie, traseu, sistem, sesiuni
├── hooks/            # fluxul live și accesul la semnale
├── lib/              # client WebSocket, buffer de serii, replay, formatare
├── schemas/          # validarea contractelor de date
└── stores/           # stare client

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

**Stocarea este SQLite, în spatele unei interfețe.** La 10 Hz, o cursă de opt ore înseamnă ~290.000 de rânduri, dimensiune la care SQLite se comportă bine fără servicii suplimentare în pitlane. Trecerea la TimescaleDB înseamnă o singură clasă nouă care implementează `TelemetryStorage`.
