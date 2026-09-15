# Plan de modificare a firmware-ului Teensy — semnalele noi

Ce trebuie să trimită placa de achiziție ca dashboardul să afișeze tot: GPS cu
altitudine, celulele individuale, starea controllerului Mitsuba, anvelopele,
temperaturile de pe mașină și diagnosticul plăcii însăși.

Perechea acestui document este `docs/plan-server-semnale-noi.md`, care descrie
partea de server. Ordinea de lucru este firmware întâi: serverul nu poate
transmite mai departe ce nu primește.

---

## 1. Regula care contează mai mult decât oricare cheie

**Un senzor care nu a răspuns nu are voie să apară în mesaj.**

```cpp
// CORECT
if (gps.hasAltitude()) {
    payload["gps_altitude_m"] = gps.altitudeMeters();
}

// GREȘIT — toate trei
payload["gps_altitude_m"] = gps.hasAltitude() ? gps.altitudeMeters() : 0.0;
payload["gps_altitude_m"] = gps.hasAltitude() ? gps.altitudeMeters() : -1.0;
payload["gps_altitude_m"] = gps.hasAltitude() ? gps.altitudeMeters() : NAN;
```

Serverul deduce starea fiecărui semnal din prezența lui în mesaje și din
vechimea ultimei valori. O valoare-santinelă îl face să raporteze `valid`, iar
dashboardul integrează mai departe: zero-ul intră în bilanțul energetic, `-1`
intră în media de temperatură, `NaN` contaminează tot ce atinge.

Consecința practică: **cu mașina deconectată, dashboardul arată contoare la zero
și `—` peste tot.** Comportamentul acesta se sprijină în întregime pe regula de
mai sus.

Corolar pentru cadrele CAN: dacă un cadru nu a mai sosit de câteva perioade, nu
retrimite ultima valoare citită. Un cadru care lipsește este o informație; ultima
valoare repetată este o minciună cu marcaj de timp proaspăt.

---

## 2. GPS — 5 semnale noi

Sursa este receptorul GNSS, prin NMEA. Nu este nevoie de niciun senzor nou:
mesajele conțin deja tot, dar câmpurile nu erau citite.

| Cheie             | Unitate | Sursă NMEA      | Câmp                                |
| ----------------- | ------- | --------------- | ----------------------------------- |
| `gps_altitude_m`  | m       | `GGA`           | 9 (altitudine deasupra geoidului)   |
| `gps_speed_kph`   | km/h    | `RMC` sau `VTG` | `RMC` 7 (noduri) sau `VTG` 7 (km/h) |
| `gps_course_deg`  | °       | `RMC` sau `VTG` | `RMC` 8 / `VTG` 1                   |
| `gps_fix_quality` | —       | `GGA`           | 6                                   |
| `gps_vdop`        | —       | `GSA`           | 17                                  |

### 2.1 Capcana coordonatelor: `ddmm.mmmm`, nu grade zecimale

NMEA raportează latitudinea ca `4746.2718` — adică 47° și 46,2718 minute — nu ca
47,462718°. Trimisă direct, poziția cade la câteva sute de kilometri de traseu,
iar harta desenează totuși o buclă cu formă plauzibilă. Este cea mai frecventă
greșeală de integrare GNSS și cea mai greu de observat.

```cpp
// Conversie corectă din ddmm.mmmm în grade zecimale.
double nmeaToDegrees(double ddmm, char hemisphere) {
    const int degrees = static_cast<int>(ddmm / 100.0);
    const double minutes = ddmm - degrees * 100.0;
    double result = degrees + minutes / 60.0;
    if (hemisphere == 'S' || hemisphere == 'W') result = -result;
    return result;
}
```

Longitudinea are trei cifre pentru grade (`dddmm.mmmm`), dar formula este
aceeași: împărțirea la 100 separă corect ambele cazuri.

**Cum verifici că ai făcut-o bine:** dashboardul, pagina **Traseu →
Verificarea mapării poziției**, compară viteza calculată din două fixuri
consecutive cu viteza raportată de senzorul de roată. Dacă cele două diferă cu
peste 25 %, panoul o spune explicit și numește ambele cauze posibile.

### 2.2 Altitudinea

Câmpul 9 din `GGA` este altitudinea deasupra geoidului, în metri (câmpul 10 este
litera `M`). Câmpul 11 este separarea geoid–elipsoid; **nu o aduna** — o dată
adunată, altitudinea sare cu ~35 m în România, iar profilul de elevație arată o
treaptă care nu există.

Trimite altitudinea numai când `gps_fix_quality ≥ 1`. Fără fix, receptorul o
raportează oricum, dar valoarea este ultima cunoscută sau zero.

### 2.3 Fixul și dispersia

`gps_fix_quality` este câmpul 6 din `GGA`, exact ca atare: `0` fără fix, `1` GPS,
`2` DGPS, `4` RTK fix, `5` RTK float. Nu-l converti în boolean — dashboardul
distinge un fix RTK de unul obișnuit.

`gps_vdop` vine din `GSA`, câmpul 17 (`PDOP`, `HDOP`, `VDOP` — al treilea).
Fără el, dashboardul nu poate decide dacă altitudinea susține un calcul de pantă,
iar panta calculată din altitudine zgomotoasă este zgomot amplificat.

### 2.4 Frecvență

Receptorul rulează de obicei la 1 Hz, uneori la 5 sau 10 Hz. Semnalele GPS au
`stale_after_s = 3.0` în catalog, deci 1 Hz este suficient. Nu retrimite aceeași
poziție între fixuri ca să „umpli" ritmul: eșantioanele duplicate ar face harta
să pară că mașina stă, apoi sare.

---

## 3. Baterie — 40 de semnale noi

Sursa este BMS-ul ANT, pe CAN. Cadrele există deja; se citesc câmpuri
suplimentare din ele.

### 3.1 Celulele individuale — `cell_01_v` … `cell_32_v`

| Aspect     | Cerință                                                     |
| ---------- | ----------------------------------------------------------- |
| Unitate    | volți                                                       |
| Rezoluție  | 3 zecimale (1 mV)                                           |
| Numerotare | **două cifre, cu zero în față**: `cell_01_v`, nu `cell_1_v` |
| Ordine     | de la 1, în ordinea fizică din pachet                       |
| Frecvență  | 1–2 Hz este suficient                                       |

Numerotarea cu zero în față nu este o preferință de stil: grila de celule din
dashboard le ordonează alfabetic, iar `cell_9_v` s-ar așeza după `cell_31_v`.

```cpp
char key[12];
for (uint8_t index = 0; index < CELL_COUNT; ++index) {
    if (!bms.hasCell(index)) continue;   // celula nu a raportat: se omite
    snprintf(key, sizeof(key), "cell_%02u_v", index + 1);
    payload[key] = bms.cellVoltage(index);
}
```

Dacă pachetul are alt număr de celule, trimite exact atâtea. Serverul trebuie să
aibă tot atâtea definiții — vezi planul de server.

### 3.2 Extremele și indicii

| Cheie                  | Cerință                 |
| ---------------------- | ----------------------- |
| `cell_voltage_delta_v` | `max − min`, în volți   |
| `cell_min_index`       | **de la 1**, nu de la 0 |
| `cell_max_index`       | **de la 1**, nu de la 0 |

Dacă BMS-ul raportează indici de la 0, adaugă unu înainte de trimitere. Un
decalaj de unu marchează în dashboard celula vecină, iar cineva ajunge să
măsoare cu multimetrul celula greșită.

Cele trei valori trebuie să fie **coerente cu celulele individuale**: dacă
`cell_voltage_min_v` nu este chiar minimul din `cell_01_v` … `cell_32_v`,
verificarea de coerență din dashboard o semnalează. Când BMS-ul le raportează în
cadre separate, preferă recalcularea lor din celule, în firmware — o singură
sursă de adevăr, o singură posibilitate de greșeală.

### 3.3 Capacitate și sănătate

| Cheie                        | Unitate | Sursă                           |
| ---------------------------- | ------- | ------------------------------- |
| `battery_capacity_remain_ah` | Ah      | BMS                             |
| `battery_capacity_total_ah`  | Ah      | Capacitatea învățată de BMS     |
| `battery_cycles`             | —       | Contorul de cicluri al BMS-ului |
| `battery_soh_pct`            | %       | Numai dacă BMS-ul o cunoaște    |

BMS-urile ANT raportează capacitatea **învățată**, nu pe cea de proiect. Starea
de sănătate reală este `capacitate_învățată / capacitate_de_proiect`, iar
capacitatea de proiect nu este în BMS: este în fișa celulelor. Dacă firmware-ul
o cunoaște, calculează `battery_soh_pct` acolo; dacă nu, **nu trimite semnalul**
și dashboardul va afișa `—`, ceea ce este adevărat.

Frecvență: 0,2–1 Hz. Sunt valori care se schimbă în minute, nu în milisecunde.

### 3.4 `regen_power_w`

Puterea instantanee care intră înapoi în pachet, **întotdeauna pozitivă**:

```cpp
const float packPowerW = packVoltageV * packCurrentA;   // negativ la regenerare
payload["regen_power_w"] = packPowerW < 0.0f ? -packPowerW : 0.0f;
```

Dashboardul poate deduce recuperarea și din `motor_power_w` negativ, dar cifra
măsurată la pachet este cea reală: între motor și baterie se pierde randamentul
invertorului, iar diferența contează într-un bilanț pe opt ore.

---

## 4. Controller Mitsuba — 12 semnale noi

Sursa este CAN-ul controllerului, cadrele 0, 1 și 2. Adresele și pozițiile
câmpurilor sunt în `docs/adrese_mitsuba_bms.md` din depozitul de firmware;
cadrul de erori este `0x08A50225`.

### 4.1 Măsurători

| Cheie                  | Unitate | Note                                    |
| ---------------------- | ------- | --------------------------------------- |
| `motor_current_peak_a` | A       | Curentul de vârf raportat de controller |
| `motor_pwm_duty_pct`   | %       | 0 … 100                                 |
| `motor_lead_angle_deg` | °       | Unghiul de avans                        |
| `regen_vr_pct`         | %       | Poziția potențiometrului de regenerare  |
| `motor_output_target`  | —       | 0 … 255, ținta de ieșire                |

Aplică factorii de scalare din tabelul de adrese **în firmware**, nu în server și
nici în dashboard. Un factor aplicat în două locuri se aplică de două ori, iar
unul aplicat în niciunul nu se aplică deloc; firmware-ul este singurul loc care
cunoaște formatul brut.

### 4.2 Enumerări

| Cheie                  | Valori                                      |
| ---------------------- | ------------------------------------------- |
| `drive_action`         | 0 oprit, 1 rezervat, 2 înainte, 3 marșarier |
| `power_mode`           | 0 eco, 1 power                              |
| `motor_ctrl_mode`      | 0 control pe curent, 1 control pe PWM       |
| `regen_active`         | 0 inactiv, 1 activ                          |
| `motor_overheat_level` | 0 normal … 3 critic                         |
| `digi_sw_position`     | poziția comutatorului digital               |

Trimite valoarea numerică brută, nu text. Dashboardul le traduce; o valoare din
afara enumerării este afișată ca atare, cu marcaj, fiindcă înseamnă că
protocolul s-a schimbat — o informație pe care conversia în text din firmware ar
ascunde-o.

### 4.3 `motor_fault_code`

Masca de biți din cadrul 2, ca număr întreg fără semn, pe 32 de biți.

```cpp
payload["motor_fault_code"] = static_cast<double>(faultBits);
```

**Nu o descompune în firmware** și nu trimite biții separat. Dashboardul o
descompune (`src/lib/mitsuba-faults.ts`), iar cele două liste de biți trebuie să
rămână identice cu `MITSUBA_ERROR_BITS` din firmware. Verificatorul
`scripts/unlazy/verify-fault-bits.mjs` din depozitul de firmware compară automat
cele trei liste; rulează-l după orice modificare a tabelului.

Când nu există nicio eroare, trimite `0`. Aici zero **este** o valoare: „niciun
bit activ" este o afirmație despre controller, nu o absență de date. Dacă însă
cadrul 2 nu a sosit deloc, omite cheia.

---

## 5. Senzori de temperatură — 5 semnale noi

| Cheie               | Amplasare                                                       | Frecvență |
| ------------------- | --------------------------------------------------------------- | --------- |
| `temp_ambient_c`    | Aer exterior, ferit de soare direct și de fluxul de la radiator | 0,5 Hz    |
| `temp_cockpit_c`    | Habitaclu, la nivelul pilotului                                 | 0,5 Hz    |
| `temp_pack_front_c` | Pachet, jumătatea din față                                      | 1 Hz      |
| `temp_pack_rear_c`  | Pachet, jumătatea din spate                                     | 1 Hz      |
| `temp_mppt_c`       | Radiatorul controlerelor MPPT                                   | 0,5 Hz    |

`temp_ambient_c` este referința pentru orice creștere de temperatură. Un senzor
montat în bătaia soarelui sau lângă evacuarea aerului cald face inutile toate
comparațiile care se sprijină pe el.

Senzorii digitali (DS18B20 și similari) raportează `85.0 °C` ca valoare de
inițializare, înainte de prima conversie reușită. Filtreaz-o explicit: 85 °C este
în domeniul declarat, deci serverul o va accepta ca validă și va declanșa alarma
de supraîncălzire a pachetului la fiecare repornire a plăcii.

```cpp
const float reading = sensor.readCelsius();
const bool plausible = sensor.crcOk() && reading > -50.0f && reading < 120.0f
                       && !(reading > 84.9f && reading < 85.1f && !sensor.hasConverted());
if (plausible) payload["temp_pack_front_c"] = reading;
```

---

## 6. Anvelope — 8 semnale noi

Senzori TPMS, câte doi pe roată (presiune și temperatură).

| Roată         | Presiune               | Temperatură      |
| ------------- | ---------------------- | ---------------- |
| Față stânga   | `tpms_fl_pressure_bar` | `tpms_fl_temp_c` |
| Față dreapta  | `tpms_fr_pressure_bar` | `tpms_fr_temp_c` |
| Spate stânga  | `tpms_rl_pressure_bar` | `tpms_rl_temp_c` |
| Spate dreapta | `tpms_rr_pressure_bar` | `tpms_rr_temp_c` |

Unitatea este **barul**, nu PSI și nu kPa. Dacă senzorul raportează altfel,
convertește în firmware: `bar = psi / 14.5038`, `bar = kPa / 100`.

Senzorii TPMS raportează la câteva secunde și adorm între raportări. Nu
retrimite ultima valoare între ele — semnalele au `stale_after_s` implicit de
2 secunde, deci dashboardul le va marca `stale`, ceea ce este exact adevărul:
valoarea este reală, dar veche.

Dacă mașina are trei roți, trimite doar cele trei perechi existente și șterge
definițiile celei de-a patra din catalogul serverului.

---

## 7. Diagnosticul plăcii — 5 semnale noi

Cele mai ieftine cinci semnale de implementat și cele care economisesc cel mai
mult timp la depanare: când cifrele de pe dashboard arată ciudat, prima
întrebare este dacă placa mai citește.

| Cheie                | Sursă                              | Frecvență |
| -------------------- | ---------------------------------- | --------- |
| `teensy_temp_c`      | `tempmonGetTemp()` pe Teensy 4.x   | 0,5 Hz    |
| `teensy_loop_hz`     | Cicluri complete pe secundă        | 1 Hz      |
| `teensy_can_errors`  | Contor cumulativ de cadre respinse | 1 Hz      |
| `teensy_free_ram_kb` | Memorie liberă între heap și stivă | 0,5 Hz    |
| `teensy_uptime_s`    | `millis() / 1000`                  | 1 Hz      |

```cpp
// Ritmul buclei: numărăm cicluri într-o fereastră de o secundă.
static uint32_t loops = 0;
static uint32_t windowStart = 0;
static float loopHz = 0.0f;

++loops;
const uint32_t now = millis();
if (now - windowStart >= 1000) {
    loopHz = loops * 1000.0f / (now - windowStart);
    loops = 0;
    windowStart = now;
}
```

`teensy_can_errors` trebuie să fie **cumulativ și monoton crescător**.
Dashboardul calculează diferențele; un contor care se resetează periodic ar
raporta zero erori la fiecare fereastră.

`teensy_uptime_s` care revine la zero este cel mai clar semn de repornire a
plăcii — mai clar decât golul din date, care poate fi și o cădere de rețea.

---

## 8. Structura mesajului și bugetul de bandă

Formatul rămâne neschimbat:

```json
{
  "schema_version": 1,
  "vehicle_id": "solar-car-01",
  "session_id": "race-2026-07-21",
  "timestamp": "2026-07-21T12:34:56.123Z",
  "sequence": 18452,
  "signals": { "...": 0 }
}
```

### 8.1 Ce se schimbă la dimensiune

104 de semnale în JSON înseamnă ~2,2 kB pe mesaj. La 10 Hz sunt ~22 kB/s, prea
mult pentru o legătură radio modestă. Trei măsuri, în ordinea eficienței:

1. **Trimite fiecare semnal la ritmul lui.** Viteza și puterea au nevoie de
   10 Hz; celulele, capacitatea, TPMS-ul și diagnosticul plăcii nu. Un mesaj la
   10 Hz cu semnalele rapide și unul la 1 Hz cu restul reduce banda de vreo
   patru ori. Serverul îmbină automat: fiecare semnal are propriul moment de
   sosire.
2. **Rotunjește la zecimalele din catalog.** `cell_01_v` are 3 zecimale;
   `3.6421997` ocupă de două ori mai mult decât `3.642` și nu adaugă nimic.
3. **Trece pe binar** (MessagePack sau Protobuf) doar dacă primele două nu
   ajung. Serverul convertește în JSON pentru browser.

### 8.2 Numerotarea și ceasul

- `sequence` crește cu 1 la fiecare mesaj **trimis**, inclusiv peste
  întreruperi. Serverul deduce mesajele pierdute din golurile din serie; o
  numerotare care sare la reconectare ar raporta o pierdere care nu a existat,
  iar una care se resetează ar ascunde una reală.
- `timestamp` vine de la GNSS când există fix, altfel din ceasul plăcii.
  Serverul calculează decalajul și îl afișează în pagina Sistem.

### 8.3 Reluarea după căderea legăturii

Documentul de arhitectură cere ca placa să tamponeze local și să retransmită
după reconectare. Endpoint-ul `POST /api/v1/telemetry` acceptă și un **tablou**
de mesaje, exact pentru asta. Ordinea în tablou trebuie să fie cronologică, iar
`sequence` să rămână cel original — nu renumerota la retransmisie.

---

## 9. Ordinea de implementare

Etapele sunt independente și fiecare aduce ceva vizibil în dashboard. Ordinea de
mai jos maximizează ce se poate verifica devreme.

| Etapă | Semnale                                   | Se vede în                                       |
| ----- | ----------------------------------------- | ------------------------------------------------ |
| 1     | GPS: altitudine, viteză, curs, fix, VDOP  | Traseu: profil de elevație, verificarea mapării  |
| 2     | Diagnosticul plăcii (5 semnale)           | Prezentare: panoul Teensy                        |
| 3     | Celulele individuale + extreme + indici   | Energie: grila de celule                         |
| 4     | Controller Mitsuba (12 semnale)           | Sistem: starea de condus, erorile controllerului |
| 5     | Capacitate, cicluri, SOH, `regen_power_w` | Energie, Statistici                              |
| 6     | Temperaturi (5 semnale)                   | Sistem: temperaturi                              |
| 7     | TPMS (8 semnale)                          | Sistem: șasiu și anvelope                        |

Etapa 1 prima pentru că este singura care nu cere hardware nou și pentru că
verifică imediat cea mai probabilă greșeală de integrare (scalarea
coordonatelor).

---

## 10. Cum verifici fiecare etapă

1. **Fără mașină, cu simulatorul.** Simulatorul din
   `server/simulator/simulate.py` emite toate cele 104 semnale și poate injecta
   defecte:

```bash
python simulator/simulate.py --direct --gps-glitch --motor-fault
```

2. **Cu mașina, pe standuri.** Deschide dashboardul și verifică în ordinea asta:

| Pas                                 | Unde                                    | Ce trebuie să vezi                                       |
| ----------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| Semnalele sosesc                    | Sistem → Calitatea semnalelor           | Fiecare semnal nou este `valid`, nu `indisponibil`       |
| Scalările sunt corecte              | Sistem → Verificarea mapării semnalelor | 6 verificări „coerent", 0 nepotriviri                    |
| Coordonatele sunt în grade zecimale | Traseu → Verificarea mapării poziției   | „Poziția și viteza se confirmă reciproc"                 |
| Altitudinea variază                 | Traseu → Profil de elevație             | Curbă, nu linie dreaptă                                  |
| Celulele sunt în ordine             | Energie → Tensiunea pe celulă           | 32 de bare, minima și maxima marcate pe celulele corecte |
| Codul de eroare se descompune       | Sistem → Erori controller               | Nume de defecte, nu un număr                             |
| Un senzor deconectat                | scoate un conector                      | Semnalul devine `indisponibil`, **nu** `0`               |

Ultimul pas este cel mai important și cel care se sare cel mai des. Deconectează
fizic un senzor și verifică faptul că valoarea lui **dispare** din dashboard, nu
că devine zero. Dacă devine zero, firmware-ul trimite o valoare-santinelă
undeva, iar toate statisticile calculate la finalul cursei sunt greșite cu exact
atât cât nu se vede.

---

## 11. Documente înrudite

- `docs/plan-server-semnale-noi.md` — partea de server.
- `src/lib/mitsuba-faults.ts` — tabelul de biți de eroare, care trebuie să rămână
  identic cu `MITSUBA_ERROR_BITS` din firmware.
- `src/lib/sensor-sources.ts` — cum sunt grupate semnalele pe surse fizice în
  dashboard; prefixele cheilor (`gps_`, `tpms_`, `temp_`, `mppt`, `teensy_`)
  determină gruparea.
- `server/app/signals.py` — catalogul complet, cu unități, domenii și praguri.
