# Gates: audit de performanță și corectitudine a datelor

OWNS: src/test/synthetic.ts, src/hooks/useAnalyticsEngine.audit.test.tsx, src/hooks/useSignal.render.test.tsx, src/schemas/telemetry.test.ts, src/lib/stream-coalescing.audit.test.ts, src/lib/gps-buffer.test.ts, src/lib/analytics.audit.test.ts, src/lib/gps.audit.test.ts, src/stores/telemetry-store.test.ts, src/hooks/useWeather.render.test.tsx, src/lib/ring-buffer.bench.ts, src/lib/track-pipeline.bench.ts, src/lib/analytics.bench.ts, src/schemas/telemetry.bench.ts, server/tests/test_audit_date.py, server/tests/test_perf.py, server/pyproject.toml, package.json, scripts/verify-audit-report.mjs, docs/audit-performanta.md, GATES-audit-performanta.md

Scope: Un audit executabil al dashboardului și al serverului: teste de corectitudine care expun erorile de citire/calcul găsite, benchmark-uri care măsoară punctele fierbinți la ritmul real de telemetrie, și un raport cu fiecare ipoteză confirmată sau infirmată pe cifre măsurate, fără modificări în codul de producție.

- [x] G0: ledgerul de față formulează rezultate care pot pica
  CHECK: node /Users/razesusebastian-constantin/.claude/skills/unlazy/scripts/gate-lint.mjs GATES-audit-performanta.md
  EXPECT: LINT OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8

- [x] G1: testele de corectitudine frontend (decimare GPS, urcare cumulată, contor intermitent, integrare pe ceas real, resetare tur, viteză din fixuri, contract null, re-randări, coalescing) rulează pe codul curent, iar fiecare test marcat ca defect confirmat chiar pică pe implementarea actuală
  CHECK: npx vitest run src/lib/gps-buffer.test.ts src/lib/analytics.audit.test.ts src/lib/gps.audit.test.ts src/stores/telemetry-store.test.ts src/hooks/useAnalyticsEngine.audit.test.tsx src/hooks/useWeather.render.test.tsx src/hooks/useSignal.render.test.tsx src/schemas/telemetry.test.ts src/lib/stream-coalescing.audit.test.ts && echo GATE_G1_OK
  EXPECT: GATE_G1_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=8204007b1ff8f83848c6da243f145db05fbc6c687dba544e3e03e33b08ec5230; output-bytes=647

- [x] G2: testele de corectitudine backend (precizia exportului CSV, NaN în semnale față de contractul Zod, ordinea ts față de server_ts) rulează pe codul curent, iar fiecare test marcat ca defect confirmat chiar pică pe implementarea actuală
  CHECK: .venv/bin/python -m pytest tests/test_audit_date.py -q -rxX && echo GATE_G2_OK
  EXPECT: GATE_G2_OK
  CWD: server
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN/server; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=2b80c1716593cd086d68c94ad5c86ea4303eaf4e36f516f8045d6bb035e08500; output-bytes=974

- [x] G3: benchmark-urile frontend (ring buffer, lanțul hărții GPS, parsarea Zod, acumulatorul de statistici pe opt ore) rulează până la capăt și tipăresc cifrele măsurate
  CHECK: npx vitest bench --run src/lib/ring-buffer.bench.ts src/lib/track-pipeline.bench.ts src/lib/analytics.bench.ts src/schemas/telemetry.bench.ts && echo GATE_G3_OK
  EXPECT: GATE_G3_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=675e0cbb54201de77f6c03e49c5c05a6f669a0a90bf54355f56b051fb2ca8339; output-bytes=5859

- [x] G4: testele de performanță backend (ingest la 100 Hz, construirea și serializarea cadrului WS, evaluarea alarmelor, scrierea și citirea SQLite pe o sesiune de opt ore, exportul CSV, backfill din buffer) rulează până la capăt și tipăresc cifrele măsurate
  CHECK: .venv/bin/python -m pytest tests/test_perf.py -q -m perf -s && echo GATE_G4_OK
  EXPECT: GATE_G4_OK
  CWD: server
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN/server; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=cc6f0557012479a3297fb4e9c8250e401416e8a18f51791ea8ffd5669d0baf24; output-bytes=815

- [x] G5: verificarea completă a proiectului (lint, typecheck, toate testele, build) și suita Python completă rămân verzi cu testele de audit adăugate
  CHECK: npm run check && (cd server && .venv/bin/python -m pytest -q) && echo GATE_G5_OK
  EXPECT: GATE_G5_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=5fd65d8c7d2af6fe74aae32492eb284ac3ce30722624147d039c99d4994a7b0e; output-bytes=5013

- [x] G6: raportul docs/audit-performanta.md conține fiecare ipoteză (B1, B2, P1–P5, D1–D8, S1–S4) cu un verdict explicit și, pentru cele măsurate, cel puțin o cifră cu unitate
  CHECK: node scripts/verify-audit-report.mjs
  EXPECT: AUDIT_REPORT_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/razesusebastian-constantin/Desktop/interfataMasinaTUCN; path=72baba5c8539/27 entries; EXPECT=matched; output-sha256=12fde056fe73ceab661bee9a3bb8bb233762cf100c8280eb1cd14485073f4ddd; output-bytes=140
