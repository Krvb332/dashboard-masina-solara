# Gates: secțiune vreme și condiții meteo

OWNS: server/app/core/weather.py, server/app/api/weather.py, server/app/config.py, server/app/schemas.py, server/app/main.py, server/pyproject.toml, server/tests/test_weather.py, src/schemas/weather.ts, src/schemas/weather.test.ts, src/lib/weather-math.ts, src/lib/weather-math.test.ts, src/lib/weather-impact.ts, src/lib/weather-advice.ts, src/lib/weather-advice.test.ts, src/lib/api.ts, src/stores/weather-store.ts, src/hooks/useWeather.ts, src/components/WeatherPanel.tsx, src/components/WeatherImpactPanel.tsx, src/components/WeatherForecast.tsx, src/lib/weather-conditions.ts, src/lib/weather-conditions.test.ts, src/features/weather/WeatherPage.tsx, src/features/weather/WeatherPage.test.tsx, src/app/router.tsx, src/components/AppShell.tsx, scripts/verify-no-api-key.mjs, docs/integrare-meteo.md, .env.example

Scope: O secțiune completă de vreme și condiții meteo pentru dashboard — proxy pe server către Google Weather API cu cheia ținută exclusiv pe server, contracte validate capăt-la-capăt, formule meteorologice derivate utile mașinii solare, pagină dedicată, recomandări pentru pilot și degradare curată („—", niciodată zero inventat) când nu există conexiune.

- [x] G1: Răspunsul real Google Weather este normalizat câmp cu câmp în contractul serverului (temperatură, umiditate, punct de rouă, vânt, rafală, direcție, nori, UV, presiune, vizibilitate, precipitații, zi/noapte).
  CHECK: .venv/bin/python -m pytest tests/test_weather.py -q -k normalize && echo GATE_G1_OK
  EXPECT: GATE_G1_OK
  CWD: server
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN/server; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=98d5e2d4d10802a3d4ed820afd1360fe2706fb63555050ec0ec6a39c4d5ded93; output-bytes=1063

- [x] G2: Fără cheie configurată sau cu furnizorul căzut, endpointul răspunde 200 cu `status` non-`ok` și fără nicio valoare numerică inventată (toate câmpurile rămân `null`).
  CHECK: .venv/bin/python -m pytest tests/test_weather.py -q -k degrade && echo GATE_G2_OK
  EXPECT: GATE_G2_OK
  CWD: server
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN/server; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=9a7a71af04978cd35c2997f78bc0dab269911c3f5b49ed55e34e002316a10bd4; output-bytes=1063

- [x] G3: Memoria cache respectă TTL-ul (un al doilea apel în fereastră nu atinge furnizorul) și, când furnizorul cade, servește ultima observație bună etichetată cu vechimea ei.
  CHECK: .venv/bin/python -m pytest tests/test_weather.py -q -k cache && echo GATE_G3_OK
  EXPECT: GATE_G3_OK
  CWD: server
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN/server; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=439c38bd408ac944b0383b255f4a4f48e8762f59c4b2c218e4c58d50a0c3d17a; output-bytes=1063

- [x] G4: Formulele meteo derivate (densitatea aerului, punct de rouă, componenta de vânt pe direcția de mers, poziția solară, iradianța pe cer senin, atenuarea de nori, temperatura celulei fotovoltaice, derating termic) se potrivesc cu valori de referință calculate independent de implementare.
  CHECK: npx vitest run src/lib/weather-math.test.ts && echo GATE_G4_OK
  EXPECT: GATE_G4_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=5567008af378aac89ae7cf2ffe729c556697fb5678bbb46a8172eb7244049bf8; output-bytes=260

- [x] G5: Recomandările meteo pentru pilot sunt vide fără date și produc exact sfaturile așteptate pentru intrări cunoscute (vânt de față, nori în creștere, risc de ploaie, stres termic).
  CHECK: npx vitest run src/lib/weather-advice.test.ts && echo GATE_G5_OK
  EXPECT: GATE_G5_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=b74df6c4791482c515079d24bbdd138bb15400c802dcb24d621faa14c740a586; output-bytes=260

- [x] G6: Pagina „Vreme" este rutată la /vreme, apare în navigația principală, iar fără date afișează „—" în locul fiecărei cifre, nu `0`.
  CHECK: npx vitest run src/features/weather/WeatherPage.test.tsx && echo GATE_G6_OK
  EXPECT: GATE_G6_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=171162b5e04a4c5498cde9543bd040aefac75919fa5a3649683862e1005a980b; output-bytes=446

- [x] G7: Cheia API nu apare în niciun fișier urmărit de git și nici în bundle-ul frontend construit; scanerul își demonstrează sensibilitatea pe un control pozitiv înainte de a raporta absența.
  CHECK: node scripts/verify-no-api-key.mjs && echo GATE_G7_OK
  EXPECT: GATE_G7_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=46d438294e02808c73b38c1e8325ddfb4800ddb3716a7069e32e599e9cda4e86; output-bytes=231

- [x] G8: Verificarea completă a proiectului frontend (lint, typecheck, toate testele, build) trece cu modificările integrate.
  CHECK: npm run check && echo GATE_G8_OK
  EXPECT: GATE_G8_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=53a877250cde7c7057dd88ae1c32f3a860c1e154961d38e8d8f292b5d9be6521; output-bytes=3485

- [x] G9: Suita Python completă a serverului trece, deci secțiunea nouă nu rupe ingestul, alarmele, sesiunile sau API-ul existent.
  CHECK: .venv/bin/python -m pytest -q && echo GATE_G9_OK
  EXPECT: GATE_G9_OK
  CWD: server
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN/server; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=a8ba79069401e71e37209f2804fef64701f1201f65aee89f872acd2985db063e; output-bytes=1049

- [x] G10: Un apel real, prin serverul pornit local, către Google Weather API întoarce date meteo reale pentru coordonatele circuitului.
  EVIDENCE: uvicorn pornit local pe 127.0.0.1:8123 cu `server/.env`, 15.09.2026 17:52. `GET /api/v1/weather` fără parametri → HTTP 200, status="ok", location.source="configurat" (46.7712, 23.6236), condition="În mare parte însorit" (MOSTLY_CLEAR), 19 din 20 mărimi completate (lipsește doar wet_bulb_c, pe care `currentConditions` nu îl raportează), 12 ore de prognoză. Al doilea apel la 27 s → același `fetched_at`, age_s=26,8: servit din memoria cache, fără apel nou la furnizor. `GET /api/v1/weather?lat=44.4268&lon=26.1025` → location.source="gps", alte valori (22,8 °C, „Parțial însorit"), deci coordonatele chiar ajung la furnizor. Răspunsul live captat și validat cu schema Zod a frontendului în `src/schemas/weather.test.ts` (5 verificări, trec). Serverul a fost oprit după verificare; `server/data/` restaurat la starea din git.
