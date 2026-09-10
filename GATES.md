# Gates: profiluri de pilot, statistici derivate, GPS extins și planuri de integrare

OWNS: src/\*\*, server/app/signals.py, server/simulator/simulate.py, server/tests/test_simulator.py, scripts/\*\*, docs/plan-\*.md, README.md, package.json, .prettierignore, GATES.md

Scope: dashboardul primește profiluri de pilot (creare manuală, în masă și
automată, schimbare de pilot cu înregistrarea completă a stintului), un motor de
statistici derivate cu formulele recomandate pentru telemetrie de curse, semnale
GPS extinse (altitudine, viteză, curs, calitatea fixului) mapate corect în harta
de traseu și în profilul de elevație, verificarea automată a mapării tuturor
semnalelor, o pagină nouă doar cu grafice, statistici și recomandări pentru
pilot, plus două planuri `.md` de integrare — unul pentru server, unul pentru
Teensy.

Cerințe de mediu: Node pentru toate verificările; G8 are nevoie în plus de un
interpretor Python 3.10 sau mai nou (serviciul de telemetrie cere oricum
Python 3.13), pe care scriptul îl caută singur și îl raportează explicit dacă
lipsește.

- [x] G1: fiecare cheie de semnal folosită în frontend există în catalogul serverului, grupurile sunt sincronizate cu enumerarea Zod, iar celulele respectă tiparul cerut de grila din pagina Energie
  CHECK: node scripts/verify-signal-mapping.mjs
  EXPECT: VERIFICARE MAPARE OK
  EVIDENCE: `Catalog: 104 semnale, 7 grupuri. Interfață: 46 chei distincte, 46 confirmate în catalog. Celule individuale: 32.` — ieșire 0. Control pozitiv: la prima rulare scriptul a respins șase identificatori de verificare din `consistency.ts` luați greșit drept chei de semnal, ceea ce arată că detectează cheile absente din catalog.

- [x] G2: formulele de telemetrie dau rezultatele corecte, verificate independent, și nu inventează niciodată o valoare din date lipsă
  CHECK: node scripts/run-tests-gate.mjs TELEMETRY-MATH-OK 43 src/lib/telemetry-math.test.ts
  EXPECT: TELEMETRY-MATH-OK
  EVIDENCE: `Teste: 43 trecute, 0 picate, 0 sărite, 43 în total.` — ieșire 0. Valorile așteptate sunt derivate independent: aritmetică pe cifre rotunde, forme închise echivalente (`sin(arctan x) = x/√(1+x²)`) și o probă de minim pentru viteza economică.

- [x] G3: fără flux conectat, toate contoarele derivate sunt exact zero și fiecare mărime derivată este „fără valoare"; valorile învechite sau eronate nu intră în agregate
  CHECK: node scripts/run-tests-gate.mjs ANALYTICS-OK 24 src/lib/analytics.test.ts
  EXPECT: ANALYTICS-OK
  EVIDENCE: `Teste: 24 trecute, 0 picate, 0 sărite, 24 în total.` — ieșire 0. Acoperă `stale`, `sensor_error`, `unavailable` cu valoare `null`, pauzele de legătură, contoarele resetate, randamentul raportat la magistrală și distincția între „zero măsurat" și „fără date".

- [x] G4: profilurile de pilot se creează manual, în masă și automat, iar schimbarea pilotului închide stintul precedent cu bilanțul lui complet
  CHECK: node scripts/run-tests-gate.mjs DRIVER-STORE-OK 25 src/stores/driver-store.test.ts
  EXPECT: DRIVER-STORE-OK
  EVIDENCE: `Teste: 25 trecute, 0 picate, 0 sărite, 25 în total.` — ieșire 0. Verifică linia de bază la schimbul de pilot, tăierea stintului la resetarea contoarelor, rebazarea unui stint gol în loc de tăiere, păstrarea bilanțului la o reîncărcare de pagină și faptul că ștergerea unui profil îi închide stintul fără să-i șteargă energia măsurată. Control pozitiv: scoaterea gărzii de „contoare în urmă” face testul de reîncărcare să pice.

- [x] G5: latitudinea, longitudinea și elevația sunt mapate corect — distanțe haversine, pantă, câștig de elevație, respingerea fixurilor invalide — iar semnalele redundante se confirmă reciproc
  CHECK: node scripts/run-tests-gate.mjs GPS-OK 45 src/lib/gps.test.ts src/lib/track-projection.test.ts src/lib/consistency.test.ts
  EXPECT: GPS-OK
  EVIDENCE: `Teste: 45 trecute, 0 picate, 0 sărite, 45 în total.` — ieșire 0. Distanțele sunt verificate pe două căi independente (`R·Δφ` și circumferință/360). Verificările de coerență au control pozitiv: fiecare tip de nepotrivire este demonstrat cu o scalare greșită construită anume.

- [x] G6: recomandările pentru pilot se declanșează pe condițiile reale de consum, poartă cifra din spate și tac complet când nu există date
  CHECK: node scripts/run-tests-gate.mjs COACHING-OK 21 src/lib/coaching.test.ts
  EXPECT: COACHING-OK
  EVIDENCE: `Teste: 21 trecute, 0 picate, 0 sărite, 21 în total.` — ieșire 0. Fiecare regulă are și cazul în care trebuie să tacă, nu doar cel în care trebuie să vorbească.

- [x] G7: pagina nouă de statistici randează panourile de consum, recuperare regenerativă și recomandări, cu cifrele calculate dintr-o sesiune reală
  CHECK: node scripts/run-tests-gate.mjs STATISTICS-PAGE-OK 11 src/features/statistics/StatisticsPage.test.tsx
  EXPECT: STATISTICS-PAGE-OK
  EVIDENCE: `Teste: 11 trecute, 0 picate, 0 sărite, 11 în total.` — ieșire 0. Snapshot-ul este produs alimentând acumulatorul real cu 51 de eșantioane, nu scriind cifrele de mână.

- [x] G8: simulatorul emite toate cele 104 semnale din catalog, în domeniul declarat și coerente între ele, deci lanțul complet este testabil fără mașină
  CHECK: node scripts/verify-simulator-coverage.mjs
  EXPECT: VERIFICARE SIMULATOR OK
  EVIDENCE: `Interpretor: python3.14. Catalog: 104 semnale. Simulator: 104 semnale.` — ieșire 0. Verifică și perechile redundante cu aceleași toleranțe ca panoul din interfață, plus faptul că altitudinea variază cu peste 5 m pe parcurs.

- [x] G9: cele două planuri de integrare acoperă fiecare semnal nou și fiecare subiect obligatoriu
  CHECK: node scripts/verify-plans.mjs
  EXPECT: VERIFICARE PLANURI OK
  EVIDENCE: `Semnale adăugate: 75. Numite explicit în planuri: 48. Acoperite prin tipar de serie: 27. Neacoperite: 0.` — ieșire 0. Control pozitiv: redenumirea lui `tpms_rr_temp_c` în ambele planuri face verificarea să eșueze cu exact acea cheie.

- [x] G10: întregul proiect trece lint, typecheck, verificările de catalog, teste și build
  CHECK: npm run check
  EXPECT: built in
  EVIDENCE: `VERIFICARE MAPARE OK`, `CATALOG ADITIV OK`, `Test Files 20 passed (20)`, `Tests 243 passed (243)`, `✓ built in 915ms` — ieșire 0. `npm run check` include acum și cele două verificări de catalog care rulează pe Node pur. Separat, suita serverului: `51 passed`.

- [x] G11: valorile deja corecte din catalog — etichete, unități, zecimale, praguri, culori ale celor 29 de semnale existente — rămân nemodificate
  CHECK: node scripts/verify-catalog-additive.mjs
  EXPECT: CATALOG ADITIV OK
  EVIDENCE: `Referință: main. Catalog: 29 semnale înainte, 104 acum (+75).` — ieșire 0. Control pozitiv: schimbarea etichetei și a pragului lui `battery_soc_pct` face verificarea să eșueze, numind ambele câmpuri.
