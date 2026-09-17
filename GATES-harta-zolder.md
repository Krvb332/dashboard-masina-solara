# Gates: harta Circuit Zolder ca referință pentru poziția GPS

OWNS: src/lib/track-zolder.ts, src/lib/track-reference.ts, src/lib/track-reference.test.ts, src/lib/map-matching.ts, src/lib/map-matching.test.ts, src/lib/map-matching.continuity.test.ts, src/lib/map-matching.laps.test.ts, src/lib/map-matching.noise.test.ts, src/lib/track-projection.ts, src/lib/track-projection.test.ts, src/test/track-fixtures.ts, src/components/TrackMap.tsx, src/components/TrackPositionPanel.tsx, src/features/track/TrackPage.tsx, server/simulator/track_zolder.py, server/simulator/track_zolder_data.py, server/simulator/simulate.py, server/tests/test_simulator.py, scripts/verify-track-reference.mjs, docs/harta-circuit-zolder.md, package.json

Scope: Circuitul Zolder devine referința geometrică a dashboardului — o linie
mediană georeferențiată (WGS84, cu altitudine reală) pe care fixurile GPS primite
sunt proiectate, astfel încât poziția desenată, distanța, turul și panta să vină
din traseu, nu din zgomotul receptorului.

- [x] G1: Referința este circuitul Zolder real, închis, cu lungimea măsurată în
      limita a 1 % față de cea oficială — recalculată din noduri de verificare,
      nu citită din modul. Numerotarea oficială a virajelor iese T1–T16 în
      ordine, iar originea cade pe linia de start.
  CHECK: node scripts/verify-track-reference.mjs --geometry
  EXPECT: VERIFY-GEOMETRY-OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=20aaa520ea5ff45a76e25e0270ac2878cbf2be53065e8b141d4e7bbec95e7856; output-bytes=325

- [x] G2: Fiecare nod are altitudine reală, fără valori lipsă, iar relieful și
      panta maximă sunt cele măsurate din date, nu presupuse.
  CHECK: node scripts/verify-track-reference.mjs --elevation
  EXPECT: VERIFY-ELEVATION-OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=e74850ca560499cb41516d37ff73f1acf216ab3179da8999cc046b61b4dd1512; output-bytes=147

- [x] G3: Tabelul din dashboard și cel din simulator sunt identice nod cu nod —
      cele două nu pot ajunge pe circuite diferite.
  CHECK: node scripts/verify-track-reference.mjs --sync
  EXPECT: VERIFY-SYNC-OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=57a43500758da80e2d8d524d687d7bf752704e4dfff77afc6b7e364036d7183c; output-bytes=103

- [x] G4: Modulul de referință se comportă corect: buclă închisă fără segment
      nul, cadru metric care păstrează distanțele geodezice WGS84 izotrop
      (cu control pozitiv care arată că o sferă de rază medie *nu* le păstrează),
      poziție și pantă plauzibile pe tot traseul.
  CHECK: node scripts/run-tests-gate.mjs TRACK-REFERENCE-OK 18 src/lib/track-reference.test.ts
  EXPECT: TRACK-REFERENCE-OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=0d560d23b92856102027c6219f195aad4f090d1fa187fa9604e6b5e612bbaf52; output-bytes=73

- [x] G5: Proiecția cade unde trebuie și coridorul decide onest: un fix din
      interiorul coridorului este acceptat (control pozitiv), unul din afara lui
      este raportat ca atare, nu lipit pe asfalt.
  CHECK: node scripts/run-tests-gate.mjs MAP-MATCHING-OK 12 src/lib/map-matching.test.ts
  EXPECT: MAP-MATCHING-OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=c4d62ff311fced74d1b1db5c1ab4d394218612b46b0f2a7faaf8f11b31e224ac; output-bytes=70

- [x] G6: Continuitatea nu introduce eroare — căutarea îngustă dă același
      rezultat ca cea completă — iar separarea minimă a circuitului este
      măsurată, nu presupusă. Ambiguitatea este demonstrată acolo unde chiar
      apare (coridor lărgit), cu control pozitiv care arată că o căutare fără
      memorie greșește în acel caz.
  CHECK: node scripts/run-tests-gate.mjs MAP-MATCHING-CONTINUITY-OK 6 src/lib/map-matching.continuity.test.ts
  EXPECT: MAP-MATCHING-CONTINUITY-OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=d4b46030f0d87eeebb391350ada852d82bf81cfe1ba5cbcace5f1d35eb9dfec1; output-bytes=79

- [x] G7: Turul și distanța se deduc din poziția pe linia mediană: o mașină
      oprită pe linia de start nu generează tururi, distanța crește monoton și nu
      se acumulează cât timp mașina este în afara circuitului.
  CHECK: node scripts/run-tests-gate.mjs MAP-MATCHING-LAPS-OK 8 src/lib/map-matching.laps.test.ts
  EXPECT: MAP-MATCHING-LAPS-OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=7e3397efb4aadb3b4b707c457185889f6a8b977c68aa3be395d2420ba5a5e731; output-bytes=73

- [x] G8: Reducerea zgomotului este măsurată față de o poziție adevărată
      cunoscută, cu așteptările puse de teorie: îmbunătățirea poziției în plan
      este ~1,65× și independentă de σ, abaterea perpendiculară ajunge exact
      zero, iar eroarea de distanță scade de la sute de procente la sub unu.
  CHECK: node scripts/run-tests-gate.mjs MAP-MATCHING-NOISE-OK 4 src/lib/map-matching.noise.test.ts
  EXPECT: MAP-MATCHING-NOISE-OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=0799e2fd509967692f93aacd4019ec58cdc304c58c66541410795f66fce1d0f0; output-bytes=74

- [x] G9: Harta desenează circuitul într-un cadru fix, legat de geometrie: scara
      nu depinde de datele primite, iar o mașină oprită nu mai schimbă zoomul
      (cu control pozitiv pe proiecția auto-scalată, care se strânge).
  CHECK: node scripts/run-tests-gate.mjs TRACK-PROJECTION-OK 17 src/lib/track-projection.test.ts
  EXPECT: TRACK-PROJECTION-OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=1910f339ac0d87d87ccaaee4243587c69514c4c187b2e4956df3526f77d35a92; output-bytes=74

- [x] G10: Simulatorul emite coordonate care cad efectiv pe circuit, iar
      odometrul lui coincide cu poziția pe traseu — verificat rulând chiar
      simulatorul, nu o rescriere a modelului.
  CHECK: node scripts/verify-track-reference.mjs --simulator
  EXPECT: VERIFY-SIMULATOR-OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=9c2313f5fe882a0fdf2d51d9c205912aafa6b23f8ba0fa565540b50020f14413; output-bytes=237

- [x] G11: Testele serverului trec cu simulatorul mutat pe geometria reală.
  CHECK: .venv/bin/python -m pytest tests/ -q && echo SERVER-TESTS-OK
  EXPECT: SERVER-TESTS-OK
  CWD: server
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN/server; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=f7b3ffec0810e89d3e0d5ae9897716dfd802d09f63c7205823f16934c67370dc; output-bytes=1159

- [x] G12: Proiectul trece verificarea completă existentă — lint, typecheck,
      verificările de catalog, semnale și traseu, toată suita de teste și
      build-ul.
  CHECK: npm run check
  EXPECT: built in
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=b31ac2a57b1d/29 entries; EXPECT=matched; output-sha256=ac5efec9769ab55406aade565534e0f20f78408f2aeca02df2393779923d0efb; output-bytes=4662

- [x] G13: Pagina „Traseu" chiar desenează Zolder în browser, alimentată de
      serverul și simulatorul reale, cu poziția proiectată pe circuit și panoul
      de abatere populat. Verificare vizuală, cu măsurători pe canvas ca dovadă
      durabilă.
  EVIDENCE: 2026-09-17, Chrome intern, http://localhost:5173/traseu, alimentat de
      serverul de telemetrie (uvicorn :8000) și de simulator (--direct), la
      10,0 Hz. Canvas 686x420 CSS / 1372x840 buffer, atribut data-track="Circuit
      Zolder". Măsurat pe pixelii desenați: 20 988 pixeli pictați, dintre care
      12 015 în culoarea asfaltului (conturul circuitului), 408 albi (linia de
      start/sosire) și 1 146 verzi (marcajul mașinii). Forma desenată este
      recognoscibil Zolder — linia dreaptă principală, bucla Kanaalbocht în
      stânga-jos, secțiunea Bolderberg/Terlamen în dreapta-sus — iar bara de
      scară arată 500 m. Panoul „Poziția pe circuit" a raportat, pe date vii:
      sector „T4 · Lucien Bianchi", poziție pe tur 1 447 m (36 %), abatere de la
      mijloc 0,0 m, 712 din 712 fixuri pe circuit, altitudine traseu 37,3 m față
      de 38,2 m raportați de GPS, panta 1,9 %. Antetul a afișat „Linia mediană
      măsoară 4.009 m, față de cei 4.011 m publicați — o abatere de 0,06 %".
      Abaterea laterală de 0,0 m este așteptată: simulatorul emite exact pe linia
      mediană, deci acest gate confirmă randarea și legăturile, nu reducerea de
      zgomot — aceea este măsurată de G8, pe fixuri cu zgomot cunoscut.
