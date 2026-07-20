# Dashboard Mașină Solară

Interfață web local-first pentru monitorizarea în timp real a telemetriei unei mașini solare în pitlane.

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

## Verificări

```bash
npm run check
```

Comanda rulează lint, verificarea TypeScript, testele și buildul de producție.

## Configurare

Copiază `.env.example` în `.env.local` și configurează URL-urile backendului când serviciul de telemetrie este disponibil.

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws/telemetry
```

Arhitectura recomandată este documentată în [`docs/recomandari-arhitectura-dashboard-masina-solara.md`](docs/recomandari-arhitectura-dashboard-masina-solara.md).

## Structură

```text
src/
├── app/          # router și provideri globali
├── components/   # componente UI reutilizabile
├── features/     # pagini și funcționalități grupate pe domeniu
├── schemas/      # validarea contractelor de date
├── stores/       # stare client
└── test/         # configurarea testelor
```
