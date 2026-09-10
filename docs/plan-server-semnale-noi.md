# Plan de modificare a serverului — semnalele noi

Acest document este lista completă de modificări pe care serverul de telemetrie
trebuie să le primească pentru ca dashboardul să afișeze tot ce a fost adăugat:
profiluri de pilot, statistici derivate, GPS cu altitudine, panouri de consum și
verificarea mapării.

Se aplică serverului care alimentează dashboardul în pitlane — `ServerRUTTUCN`
(FastAPI + TimescaleDB + MQTT). Serverul de referință din `server/` a fost deja
adus la zi și poate fi folosit ca implementare model: `server/app/signals.py`
conține catalogul complet, iar `server/simulator/simulate.py` emite toate cele
104 semnale.

> **Ce NU se modifică.** Cele 29 de semnale existente rămân exact cum sunt:
> aceleași etichete, unități, zecimale și praguri. Verificarea automată
> `node scripts/verify-catalog-additive.mjs` refuză orice modificare a lor.
> Toate schimbările de mai jos sunt strict adăugiri.

---

## 1. Rezumat

|                    | Înainte     | După                              |
| ------------------ | ----------- | --------------------------------- |
| Semnale în catalog | 29          | 104                               |
| Grupuri            | 5           | 7 (`chassis` și `board` sunt noi) |
| Contract WebSocket | neschimbat  | neschimbat                        |
| Endpoint-uri       | neschimbate | neschimbate                       |

Nu se schimbă nicio schemă, niciun endpoint și niciun format de mesaj. Se adaugă
doar definiții de semnal și, pe partea de vehicul, valorile corespunzătoare.

---

## 2. Regula cea mai importantă: absența nu se codifică prin zero

Dashboardul distinge patru stări de calitate pentru fiecare semnal: `valid`,
`stale`, `unavailable`, `sensor_error`. Distincția funcționează numai dacă
**un senzor care nu a răspuns lipsește complet din obiectul `signals`**.

```jsonc
// CORECT — senzorul de altitudine nu a răspuns în acest ciclu
{ "signals": { "gps_latitude_deg": 46.771203, "gps_longitude_deg": 23.623611 } }

// GREȘIT — zero este o valoare, nu o absență
{ "signals": { "gps_latitude_deg": 46.771203, "gps_altitude_m": 0 } }
```

Un `0` trimis în locul unei valori lipsă intră în bilanțul energetic, în media
de viteză și în profilul de elevație al sesiunii. Efectul nu se vede pe ecran în
timpul cursei; se vede la finalul ei, într-o statistică greșită pe care nimeni
nu o mai poate corecta. Aceeași regulă se aplică lui `NaN`, `-1`, `9999` și
oricărei alte valori-santinelă.

Corolarul: cu mașina deconectată, dashboardul afișează contoare la zero (nu s-a
acumulat nimic) și `—` pentru orice mărime derivată. Comportamentul acesta
depinde direct de regula de mai sus.

---

## 3. Semnale noi de adăugat în catalog

Structura unui semnal este cea existentă (`key`, `label`, `unit`, `group`,
`decimals`, `min`, `max`, `stale_after_s`, `warn_below`, `crit_below`,
`warn_above`, `crit_above`, `hysteresis`, `overview`, `chartable`, `color`,
`description`). Copiază definițiile din `server/app/signals.py` — sunt scrise
exact în forma finală.

### 3.1 Grupuri noi

```python
SignalGroup = Literal[
    "status", "energy", "thermal", "motor", "gps", "chassis", "board"
]

GROUP_LABELS = {
    ...,
    "chassis": "Șasiu și anvelope",
    "board": "Placă de achiziție",
}
```

Frontendul acceptă deja ambele grupuri (`signalGroupSchema` din
`src/schemas/telemetry.ts`). Un grup trimis de server fără corespondent în Zod
face ca **întregul catalog** să fie respins la validare, deci cele două liste
trebuie să rămână sincronizate. `node scripts/verify-signal-mapping.mjs`
verifică asta.

### 3.2 GPS — 5 semnale (grup `gps`)

| Cheie             | Unitate | Domeniu     | Praguri                                              | Note                                                                     |
| ----------------- | ------- | ----------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `gps_altitude_m`  | m       | −100 … 3000 | —                                                    | Elevație WGS84. Alimentează profilul de elevație și corecția de pantă.   |
| `gps_speed_kph`   | km/h    | 0 … 140     | —                                                    | Viteza GNSS, sursă independentă de senzorul de roată.                    |
| `gps_course_deg`  | °       | 0 … 360     | —                                                    | Curs deasupra solului, 0° = nord. `chartable=False`.                     |
| `gps_fix_quality` | —       | 0 … 5       | `crit_below=1`                                       | 0 fără fix, 1 GPS, 2 DGPS, 4 RTK fix, 5 RTK float.                       |
| `gps_vdop`        | —       | 0 … 20      | `warn_above=3.5`, `crit_above=6.0`, `hysteresis=0.4` | Dispersie verticală; peste 3,5 altitudinea nu susține calculul de pantă. |

Toate cinci folosesc `stale_after_s=3.0`, ca semnalele GPS existente.

**De ce contează `gps_altitude_m` și `gps_vdop` împreună:** panta se calculează
din variația de altitudine raportată la distanța parcursă. Cu VDOP mare,
altitudinea are dispersie de câțiva metri, iar panta calculată din ea devine
zgomot. Dashboardul refuză panta când altitudinea nu e credibilă; fără VDOP nu
poate lua decizia asta.

### 3.3 Baterie — 8 semnale de agregat (grup `energy`)

| Cheie                        | Unitate | Domeniu   | Praguri                                                 |
| ---------------------------- | ------- | --------- | ------------------------------------------------------- |
| `battery_capacity_remain_ah` | Ah      | 0 … 200   | —                                                       |
| `battery_capacity_total_ah`  | Ah      | 0 … 200   | — (`chartable=False`)                                   |
| `battery_cycles`             | —       | 0 … 10000 | — (`chartable=False`)                                   |
| `battery_soh_pct`            | %       | 0 … 100   | `warn_below=85`, `crit_below=75`, `hysteresis=2`        |
| `cell_voltage_delta_v`       | V       | 0 … 1.0   | `warn_above=0.25`, `crit_above=0.35`, `hysteresis=0.03` |
| `cell_min_index`             | —       | 0 … 32    | — (`chartable=False`)                                   |
| `cell_max_index`             | —       | 0 … 32    | — (`chartable=False`)                                   |
| `regen_power_w`              | W       | 0 … 8000  | —                                                       |

`cell_min_index` și `cell_max_index` sunt **indici de la 1 la 32**, nu de la 0:
grila de celule din dashboard marchează celula cu acest număr. Un decalaj de
unu marchează vecina, ceea ce trimite pe cineva să măsoare celula greșită.

`regen_power_w` este puterea **pozitivă** care intră înapoi în pachet. Dacă
sursa raportează o putere cu semn, trimite partea pozitivă a negativului ei, nu
valoarea brută. Dashboardul o poate deduce și din `motor_power_w` negativ, dar
semnalul dedicat este mai precis: recuperarea reală diferă de puterea mecanică
prin randamentul invertorului.

### 3.4 Celule individuale — 32 de semnale (grup `energy`)

`cell_01_v` … `cell_32_v`, toate identice ca definiție:

```python
Signal(key="cell_01_v", label="Celula 1", unit="V", group="energy", decimals=3,
       min=2.5, max=4.3, warn_below=3.0, crit_below=2.8, warn_above=4.15,
       crit_above=4.22, hysteresis=0.03, chartable=False),
```

**Numerotarea cu două cifre este obligatorie.** Grila de celule caută tiparul
`/^cell_\d{2}_v$/` și le ordonează alfabetic, ceea ce este și ordinea fizică
doar cu zero în față: `cell_09_v` înaintea lui `cell_10_v`. Cu `cell_9_v`,
celula ar apărea după `cell_31_v` în grilă.

Dacă pachetul are alt număr de celule, adaugă exact atâtea definiții. Grila se
adaptează singură; `verify-signal-mapping.mjs` verifică doar continuitatea
numerotării.

### 3.5 Controller Mitsuba — 12 semnale (grup `motor`)

| Cheie                  | Unitate | Domeniu          | Note                                                    |
| ---------------------- | ------- | ---------------- | ------------------------------------------------------- |
| `motor_current_peak_a` | A       | 0 … 250          | `warn_above=180`, `crit_above=220`, `hysteresis=5`      |
| `motor_pwm_duty_pct`   | %       | 0 … 100          |                                                         |
| `motor_lead_angle_deg` | °       | 0 … 60           |                                                         |
| `regen_vr_pct`         | %       | 0 … 100          | Poziția potențiometrului de regenerare.                 |
| `motor_output_target`  | —       | 0 … 255          | `chartable=False`                                       |
| `drive_action`         | —       | 0 … 3            | Enumerare: 0 oprit, 1 rezervat, 2 înainte, 3 marșarier. |
| `power_mode`           | —       | 0 … 1            | 0 eco, 1 power.                                         |
| `motor_ctrl_mode`      | —       | 0 … 1            | 0 control pe curent, 1 pe PWM.                          |
| `regen_active`         | —       | 0 … 1            |                                                         |
| `motor_overheat_level` | —       | 0 … 3            | `warn_above=0.5`, `crit_above=2.5`                      |
| `digi_sw_position`     | —       | 0 … 9            |                                                         |
| `motor_fault_code`     | —       | fără `min`/`max` | Mască de biți.                                          |

`motor_fault_code` **nu are `min` și `max` declarate**, intenționat: verificarea
de „valoare imposibilă fizic" compară cu domeniul declarat, iar o mască de biți
cu bitul 29 activ are valoarea 536.870.912. Cu un domeniu declarat, serverul ar
marca-o ca `sensor_error` exact atunci când raportează o defecțiune reală.

Semnificația biților este în `src/lib/mitsuba-faults.ts` și trebuie să rămână
identică cu `MITSUBA_ERROR_BITS` din firmware.

Enumerările (`drive_action`, `power_mode`, `motor_ctrl_mode`, `regen_active`,
`motor_overheat_level`, `digi_sw_position`) au `chartable=False`: o linie care
sare între 2 și 3 nu spune nimic, iar dashboardul le afișează ca insigne cu text.

### 3.6 Senzori de temperatură — 5 semnale (grup `thermal`)

| Cheie               | Domeniu   | Praguri                                          |
| ------------------- | --------- | ------------------------------------------------ |
| `temp_ambient_c`    | −20 … 60  | —                                                |
| `temp_cockpit_c`    | −10 … 80  | `warn_above=45`, `crit_above=55`, `hysteresis=2` |
| `temp_pack_front_c` | −10 … 80  | `warn_above=50`, `crit_above=60`, `hysteresis=3` |
| `temp_pack_rear_c`  | −10 … 80  | `warn_above=50`, `crit_above=60`, `hysteresis=3` |
| `temp_mppt_c`       | −10 … 100 | `warn_above=70`, `crit_above=85`, `hysteresis=3` |

`temp_ambient_c` este referința pentru toate creșterile de temperatură. Fără ea,
„motor la 78 °C" nu se poate interpreta: e mult într-o zi de 12 °C și normal
într-una de 38 °C.

### 3.7 Anvelope — 8 semnale (grup `chassis`)

`tpms_fl_*`, `tpms_fr_*`, `tpms_rl_*`, `tpms_rr_*` (față-stânga, față-dreapta,
spate-stânga, spate-dreapta):

- `tpms_fl_pressure_bar`, `tpms_fr_pressure_bar`, `tpms_rl_pressure_bar`,
  `tpms_rr_pressure_bar` — bar, 0 … 6, `warn_below=1.6`, `crit_below=1.3`,
  `warn_above=4.2`, `crit_above=4.6`, `hysteresis=0.05`;
- `tpms_fl_temp_c`, `tpms_fr_temp_c`, `tpms_rl_temp_c`, `tpms_rr_temp_c` — °C,
  −10 … 120, `warn_above=70`, `crit_above=85`, `hysteresis=3`.

Pe o mașină cu trei roți, elimină definițiile roții inexistente. Sursa „TPMS"
din dashboard raportează câte roți răspund din câte sunt declarate, deci o
definiție rămasă pentru o roată care nu există ar arăta permanent „3/4".

### 3.8 Placa de achiziție — 5 semnale (grup `board`)

| Cheie                | Unitate | Domeniu    | Praguri                                          |
| -------------------- | ------- | ---------- | ------------------------------------------------ |
| `teensy_temp_c`      | °C      | 0 … 100    | `warn_above=65`, `crit_above=80`, `hysteresis=3` |
| `teensy_loop_hz`     | Hz      | 0 … 2000   | `warn_below=80`, `crit_below=40`, `hysteresis=5` |
| `teensy_can_errors`  | —       | 0 … 100000 | —                                                |
| `teensy_free_ram_kb` | kB      | 0 … 1024   | `warn_below=32`, `crit_below=12`, `hysteresis=2` |
| `teensy_uptime_s`    | s       | ≥ 0        | — (`chartable=False`)                            |

Grupul separat nu este cosmetic: temperatura plăcii nu este o temperatură a
mașinii. Amestecate în lista termică, cele două ar fi citite ca aceeași
categorie, iar o placă fierbinte într-o cutie închisă ar arăta ca o problemă de
răcire a bateriei.

`teensy_uptime_s` care revine la zero este cel mai clar semn de repornire a
plăcii — mai clar decât golul din date, care poate fi și o cădere de rețea.

---

## 4. Reguli de calcul pe server

Dacă serverul calculează el însuși mărimi (cazul `ServerRUTTUCN`, care
integrează energia și distanța în loc să le primească), aceste reguli trebuie
respectate:

1. **Integrează numai peste eșantioane valide.** O pauză de legătură nu
   înseamnă putere constantă în tot intervalul. Peste ~3 secunde fără date,
   intervalul se sare, nu se interpolează.
2. **Folosește regula trapezului**, nu dreptunghiul. La intervale neregulate —
   și ele devin neregulate exact când se pierd mesaje — dreptunghiul acumulează
   eroare într-o singură direcție, deci sistematică pe toată cursa.
3. **Contoarele nu scad niciodată.** Când sursa repornește și contorul o ia de
   la zero, reia numărătoarea de la noua valoare; nu scădea diferența.
4. **Nu amesteca sursele.** Dacă distanța vine ca semnal, nu adăuga peste ea
   integrarea vitezei. Cele două se însumează în dublă numărătoare.

Dashboardul aplică exact aceleași reguli local (`src/lib/analytics.ts`); când
serverul le respectă și el, cele două cifre coincid, iar orice divergență devine
un simptom util în loc de zgomot.

---

## 5. Alarme compuse care merită adăugate

Regulile compuse existente (`link_lost`, `cell_imbalance`, `energy_deficit`)
rămân. Odată cu semnalele noi devin posibile:

| Cheie                | Severitate | Condiție                                              | Mesaj                              |
| -------------------- | ---------- | ----------------------------------------------------- | ---------------------------------- |
| `tire_pressure_drop` | `warning`  | O presiune scade cu peste 0,3 bar în 10 minute        | „Presiune în scădere pe roata X."  |
| `gps_no_fix`         | `warning`  | `gps_fix_quality < 1` mai mult de 10 s                | „Receptorul GNSS a pierdut fixul." |
| `board_reset`        | `info`     | `teensy_uptime_s` scade                               | „Placa de achiziție a repornit."   |
| `cell_dead`          | `critical` | O celulă sub 2,8 V în timp ce restul sunt peste 3,2 V | „Celula X a cedat."                |

Toate patru cer histerezis, ca regulile existente. Sunt opționale: dashboardul
funcționează fără ele, dar fiecare acoperă o situație pe care altfel o vede
cineva prin comparație vizuală, târziu.

---

## 6. Ordinea de aplicare

1. Adaugă cele două grupuri în `SignalGroup` și în `GROUP_LABELS`.
2. Adaugă cele 75 de definiții de semnal, în ordinea din
   `server/app/signals.py`.
3. Repornește serviciul și verifică `GET /api/v1/signals`: trebuie să întoarcă
   104 semnale și 7 grupuri.
4. Extinde simulatorul, dacă serverul are unul, ca să emită toate semnalele —
   altfel dezvoltarea se face pe un catalog pe jumătate gol.
5. Rulează verificările din depozitul dashboardului:

```bash
node scripts/verify-signal-mapping.mjs
```

```bash
node scripts/verify-catalog-additive.mjs
```

```bash
node scripts/verify-simulator-coverage.mjs
```

6. Deschide dashboardul, pagina **Sistem → Verificarea mapării semnalelor**.
   Toate perechile redundante trebuie să apară „coerent". O nepotrivire acolo
   înseamnă un factor de scalare greșit, iar panoul spune care.

---

## 7. Verificarea finală, în ordinea în care se face

| Pas                  | Unde                                  | Ce trebuie să vezi                                  |
| -------------------- | ------------------------------------- | --------------------------------------------------- |
| Catalogul se încarcă | Sistem → Calitatea semnalelor         | 104 rânduri                                         |
| Sursele răspund      | Sistem → Verificarea mapării          | Toate insignele verzi                               |
| Coerența scalărilor  | Sistem → Verificarea mapării          | 6 verificări „coerent", 0 nepotriviri               |
| Poziția              | Traseu → Verificarea mapării poziției | „Poziția și viteza se confirmă reciproc"            |
| Elevația             | Traseu → Profil de elevație           | Curbă, nu linie dreaptă                             |
| Celulele             | Energie → Tensiunea pe celulă         | 32 de bare, minima și maxima marcate                |
| Statisticile         | Statistici                            | Consum specific și autonomie calculate              |
| Fără mașină          | oprește fluxul                        | Contoare `0`, mărimi derivate `—`, fără recomandări |

Ultimul rând este cel care se uită cel mai ușor și cel care contează cel mai
mult: cu mașina deconectată, dashboardul nu are voie să afișeze cifre derivate
din date vechi.

---

## 8. Documente înrudite

- `docs/plan-teensy-semnale-noi.md` — ce trebuie să trimită placa de achiziție.
- `docs/recomandari-arhitectura-dashboard-masina-solara.md` — decizii de
  arhitectură.
- `server/app/signals.py` — catalogul complet, în forma finală.
- `server/simulator/simulate.py` — simulator care emite toate cele 104 semnale.
