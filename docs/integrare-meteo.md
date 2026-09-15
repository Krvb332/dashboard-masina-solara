# Secțiunea de vreme și condiții meteo

Documentul acesta descrie cum funcționează secțiunea meteo a dashboardului: de
unde vin datele, ce se calculează din ele, unde se configurează și ce trebuie
făcut ca să meargă pe alt circuit sau cu alt furnizor.

---

## 1. De ce trece vremea prin server

Cheia furnizorului **nu ajunge niciodată în browser**.

Orice variabilă `VITE_*` este împachetată în fișierele livrate browserului. O
cheie pusă acolo este publică din clipa în care cineva deschide DevTools, iar o
cheie Google fără restricții poate fi folosită de oricine o găsește — pe factura
echipei. De aceea:

```
mașina → server telemetrie ──► Google Weather API   (cheia stă aici)
                    │
                    └────────► browser  GET /api/v1/weather   (doar rezultatul)
```

Mai sunt două motive, la fel de practice:

- **Cota este partajată.** În pitlane sunt deschise mai multe tablete pe același
  dashboard. Fiecare ar interoga furnizorul separat. Prin server, toate citesc
  aceeași observație din memoria cache, iar numărul de apeluri facturate nu
  crește cu numărul de ecrane.
- **Vremea este singura parte a sistemului care depinde de internet.** Serverul
  stă lângă mașină și trebuie să funcționeze fără el. Secțiunea meteo are deci
  voie să lipsească — dar trebuie să lipsească _vizibil_, nu să întoarcă zerouri.

---

## 2. Configurare

Toate setările stau în `server/.env` (ignorat de git). Model complet în
`server/.env.example`.

```bash
cp server/.env.example server/.env
```

| Variabilă                          | Implicit | Ce face                                                                |
| ---------------------------------- | -------- | ---------------------------------------------------------------------- |
| `TELEMETRY_WEATHER_API_KEY`        | _(gol)_  | Cheia Google Maps Platform. Gol = secțiunea raportează „indisponibil”. |
| `TELEMETRY_WEATHER_DEFAULT_LAT`    | _(gol)_  | Latitudinea circuitului, folosită cât timp GPS-ul nu are fix.          |
| `TELEMETRY_WEATHER_DEFAULT_LON`    | _(gol)_  | Longitudinea circuitului.                                              |
| `TELEMETRY_WEATHER_TTL_S`          | `600`    | Cât timp o observație rămâne bună. Fiecare apel este facturat.         |
| `TELEMETRY_WEATHER_FORECAST_HOURS` | `12`     | Câte ore de prognoză se cer. `0` dezactivează prognoza.                |
| `TELEMETRY_WEATHER_TIMEOUT_S`      | `8`      | Cât așteptăm furnizorul înainte să declarăm căderea.                   |
| `TELEMETRY_WEATHER_LANGUAGE`       | `ro`     | Limba descrierilor („În mare parte însorit”).                          |
| `TELEMETRY_WEATHER_BASE_URL`       | Google   | Adresa furnizorului. Se schimbă doar la înlocuirea lui.                |

### Ce trebuie activat în Google Cloud

1. În proiectul Google Cloud, activează **Weather API** (Maps Platform).
2. Creează o cheie API și **restricționeaz-o**:
   - restricție de aplicație: adresa IP a serverului de telemetrie;
   - restricție de API: numai Weather API.
     O cheie nerestricționată care ajunge pe internet este o factură deschisă.
3. Pune cheia în `server/.env`, niciodată într-un fișier urmărit de git.

> **Dacă o cheie a fost vreodată comisă sau trimisă pe un canal public, revoc-o
> și generează alta.** Ștergerea din fișier nu ajută: istoricul git o păstrează.

### Verificarea că nicio cheie nu a scăpat

```bash
node scripts/verify-no-api-key.mjs
```

Scriptul caută tiparul cheilor Google (`AIza…`) în toate fișierele urmărite de
git și în `dist/` — adică exact în textul livrat browserului. Înainte de a
declara că nu găsește nimic, își demonstrează sensibilitatea pe o cheie de
control pe care o scrie el însuși: un scaner stricat ar raporta „curat” pe orice,
iar „nicio potrivire” n-ar dovedi nimic.

---

## 3. Endpointul

```
GET /api/v1/weather?lat=<opțional>&lon=<opțional>
```

Rol necesar: `viewer` (același ca restul citirilor).

Poziția pentru care se cere vremea, în ordinea încrederii:

1. `lat` / `lon` din query — util în replay, pentru vremea de la locul
   înregistrării;
2. ultimul fix GPS al mașinii, citit de server direct din magistrala de
   telemetrie;
3. coordonatele configurate ale circuitului.

Dacă nu există niciuna, răspunsul o spune pe față. Un receptor fără fix
raportează `0, 0` — golful Guineei; poziția aceea este respinsă explicit, pentru
că vremea din Atlantic afișată ca vremea circuitului ar fi mai rea decât nimic.

### Cele trei stări ale răspunsului

| `status`      | Ce înseamnă                                              | Ce afișează interfața                                         |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| `ok`          | Observație proaspătă, mai nouă decât TTL-ul.             | Cifrele, cu ora măsurării.                                    |
| `stale`       | Furnizorul nu răspunde, dar avem ultima observație bună. | Aceleași cifre, pe fundal de avertizare, **cu vechimea lor**. |
| `unavailable` | Nici cheie, nici observație anterioară, nici poziție.    | „—” peste tot, plus motivul.                                  |

Endpointul răspunde **200 în toate trei cazurile**. Interfața trebuie să poată
afișa „indisponibil” ca stare normală, nu ca eroare de rețea.

### Formă (prescurtat)

```jsonc
{
  "status": "ok",
  "provider": "google-weather",
  "location": { "latitude": 46.7712, "longitude": 23.6236, "source": "gps" },
  "fetched_at": "2026-09-15T14:22:38Z",
  "age_s": 12.4,
  "reason": null,
  "current": {
    "observed_at": "2026-09-15T14:22:38Z",
    "time_zone": "Europe/Bucharest",
    "condition": { "type": "MOSTLY_CLEAR", "description": "În mare parte însorit", "icon_uri": "…" },
    "values": {
      "temperature_c": 23.9, "feels_like_c": 24.6, "dew_point_c": 8.2,
      "relative_humidity_pct": 36, "pressure_hpa": 1020, "cloud_cover_pct": 28,
      "uv_index": 0, "visibility_km": 16,
      "wind_speed_kph": 5, "wind_gust_kph": 12, "wind_from_deg": 357, "wind_cardinal": "NORTH",
      "precipitation_probability_pct": 0, "precipitation_mm": 0,
      "thunderstorm_probability_pct": 0, "is_daytime": true
    },
    "history": { "max_temperature_c": 24.3, "min_temperature_c": 9.2, … }
  },
  "forecast": [ { "start_time": "…", "condition": {…}, "values": {…} } ]
}
```

**Fiecare mărime poate fi `null`.** Nu există valoare implicită numerică
nicăieri în contract — nici pe server (`server/app/schemas.py`), nici în Zod
(`src/schemas/weather.ts`). Furnizorul nu raportează totul peste tot și la orice
oră: UV-ul lipsește noaptea, rafala lipsește pe vânt calm. Un `0` strecurat în
locul unei absențe ar intra nevăzut în densitatea aerului și în tot ce se
calculează din ea.

---

## 4. Ce se calculează din datele meteo

Formulele stau în `src/lib/weather-math.ts` (cod pur, fără React și fără rețea),
iar legarea lor de starea mașinii în `src/lib/weather-impact.ts`.

### Aer și aerodinamică

| Mărime                 | Formulă                                               | La ce folosește                                                                                                                           |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Presiune de saturație  | `e_s = 6,112·exp(17,62·T/(243,12+T))`                 | Intrare pentru umiditate și punct de rouă.                                                                                                |
| Punct de rouă          | inversa Magnus                                        | Riscul de ceață și condens pe parbriz.                                                                                                    |
| Presiune la altitudine | `p = p_mare·(1 − 0,0065·h/(T+0,0065·h+273,15))^5,257` | Furnizorii dau presiunea redusă la nivelul mării; densitatea cere presiunea reală. La 400 m diferența e ~45 hPa, peste 4 % din densitate. |
| **Densitatea aerului** | `ρ = p_uscat/(R_d·T) + e/(R_v·T)`                     | Intră direct în rezistența aerodinamică. Aerul umed este mai _ușor_ decât cel uscat.                                                      |
| Vânt frontal / lateral | `v·cos(direcție − cap)` / `v·sin(direcție − cap)`     | Direcția meteorologică este cea _din care_ bate vântul.                                                                                   |
| Viteza aerului         | `v_sol + v_frontal`                                   | Ce „vede” caroseria. La 60 km/h cu 15 km/h vânt frontal, aerodinamic mașina merge cu 75.                                                  |
| Putere aerodinamică    | `½·ρ·CdA·v_aer²·v_sol`                                | Forța depinde de viteza aerului, puterea de cea față de sol.                                                                              |
| **Costul vântului**    | `P_aero(cu vânt) − P_aero(aer liniștit)`              | Cifra care se transmite pe radio.                                                                                                         |
| Viteză economică       | `∛(P_aux/(ρ·CdA))`                                    | Recalculată cu densitatea reală, nu cu cea standard.                                                                                      |

### Soare și panouri

| Mărime                       | Model                                         | Note                                                                                                                               |
| ---------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Poziția soarelui             | NOAA Solar Calculator                         | Declinație, unghi orar, ecuația timpului, azimut.                                                                                  |
| Iradianță pe cer senin       | Haurwitz: `1098·cos(z)·exp(−0,059/cos(z))`    | Un singur parametru — înălțimea soarelui. Nu cere turbiditate, pe care oricum nu o avem.                                           |
| Atenuare prin nori           | Kasten & Czeplak: `1 − 0,75·nebulozitate^3,4` | Neliniar, și asta e partea utilă: 30 % nori iau ~3 %, cer acoperit lasă 25 %.                                                      |
| Temperatura celulei          | NOCT: `T_aer + (NOCT−20)/800·GHI`             | La 800 W/m² și 20 °C aer, formula întoarce chiar NOCT.                                                                             |
| Pierdere termică PV          | `−0,35 %/°C` peste 25 °C                      | Celule la 60 °C livrează cu ~12 % sub etichetă.                                                                                    |
| **Aria efectivă de captare** | `P_solar / GHI`                               | Suprafață × randament, dedusă din măsurători. Nu presupune nimic. O scădere bruscă la soare neschimbat = șir căzut sau MPPT oprit. |
| Randament array              | `P_solar / (GHI · suprafață)`                 | Apare **doar** după ce suprafața array-ului este completată în interfață.                                                          |

> **De ce randamentul array-ului nu are valoare implicită.** Un procent calculat
> pe o suprafață presupusă ar fi o părere afișată ca măsurătoare. Cât timp
> câmpul din interfață este gol, cifra rămâne „—”, iar aria efectivă — care nu
> presupune nimic — ține locul.

### Cum sunt verificate formulele

Fiecare formulă are o referință fizică independentă de implementare, iar testele
o folosesc pe aceea (`src/lib/weather-math.test.ts`, 48 de verificări):

- densitatea aerului uscat la 15 °C și 1013,25 hPa = **1,225 kg/m³**, prin
  definiția atmosferei standard internaționale;
- presiunea la 1000 m și 8,5 °C = **898,8 hPa**, tot din atmosfera standard;
- punctul de rouă la 20 °C și 50 % = **9,3 °C**, din tabelul psihrometric;
- la amiaza solară, înălțimea soarelui = **90° − |latitudine − declinație|**, o
  identitate geometrică;
- la solstiții, declinația = **±23,44°**, înclinarea axei terestre;
- puterea aerodinamică pe aer liniștit coincide cu `aeroDragW` din
  `telemetry-math.ts` — o implementare separată, scrisă independent;
- la 800 W/m² și 20 °C aer, temperatura celulei = **NOCT**, prin definiția NOCT.

---

## 5. Ce vede echipa în interfață

| Loc              | Ce arată                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `/vreme`         | Pagina completă: recomandări, măsurători brute, mărimi derivate cu formula sub fiecare cifră, prognoză orară. |
| `/` (Prezentare) | Rezumat: temperatură, vânt frontal, nebulozitate, iradianță, densitate, plus cea mai gravă observație.        |

Recomandările pentru pilot (`src/lib/weather-advice.ts`) respectă aceleași reguli
ca restul sfaturilor din dashboard:

- **fără date, fără sfaturi** — un raport `unavailable` produce listă goală;
- **fiecare sfat poartă cifra din spate** — „vânt de față 18 km/h, te costă
  210 W”, nu „e vânt”;
- **cel mult un sfat pe cauză**.

Ce declanșează un sfat: furtună, ceață și condens, vizibilitate redusă, ploaie,
stres termic pentru pilot, vânt lateral, rafale, vânt de față sau din spate, cer
acoperit, soare jos pe cer, panouri calde, aer rar, UV ridicat.

Strategia de viteză pe vânt este cea clasică din cursele solare: **încetinește
puțin pe vânt de față, accelerează pe vânt din spate.** Puterea aerodinamică
depinde de pătratul vitezei aerului, dar energia pe kilometru depinde de cât timp
stai în acel aer.

---

## 6. Ce se schimbă la un alt circuit

Un singur lucru: coordonatele implicite din `server/.env`.

```bash
TELEMETRY_WEATHER_DEFAULT_LAT=<latitudinea circuitului>
TELEMETRY_WEATHER_DEFAULT_LON=<longitudinea circuitului>
```

Cât timp GPS-ul mașinii are fix, coordonatele lui au oricum prioritate, iar
câmpul `location.source` din răspuns spune care a fost folosită.

Suprafața array-ului se completează direct în interfață, pe pagina `/vreme`, și
se păstrează local în browser.

---

## 7. Ce se schimbă la un alt furnizor meteo

Toată cunoașterea despre Google stă în `server/app/core/weather.py`, în două
locuri:

- funcțiile `parse_current` / `parse_forecast` / `parse_measurements` —
  traducerea răspunsului în contractul nostru;
- clasa `GoogleWeatherProvider` — adresele și parametrii cererii.

Un furnizor nou înseamnă o clasă cu aceleași două metode (`current`, `forecast`)
și un set nou de funcții de normalizare. Restul — memoria cache, degradarea,
endpointul, tot frontendul — nu se atinge, pentru că lucrează pe contract, nu pe
răspunsul brut.

**Unitățile sunt citite din răspuns, nu presupuse.** Cerem explicit sistem
metric, dar fiecare mărime își poartă unitatea și este convertită după ea. Dacă
furnizorul ar schimba vreodată implicitul, primim o valoare corectă, nu grade
Fahrenheit intrate tăcut în formula densității aerului. O unitate necunoscută
face valoarea `null` — mai bine fără cifră decât cu una greșită.

---

## 8. Senzori de pe mașină care ar îmbunătăți secțiunea

Secțiunea funcționează integral cu semnalele care există deja
(`gps_latitude_deg`, `gps_longitude_deg`, `gps_altitude_m`, `vehicle_speed_kph`,
`solar_power_w`). Nimic nu trebuie adăugat în firmware pentru ca ea să meargă.

Dacă echipa vrea totuși să o facă mai precisă, în ordinea raportului
beneficiu/efort:

1. **Piranometru pe array** (`solar_irradiance_wm2`) — înlocuiește iradianța
   _estimată_ cu una _măsurată_. Toate cifrele solare devin măsurători, iar
   „aria efectivă” devine un randament real al array-ului.
2. **Termometru pe celule** (`array_temp_c`) — înlocuiește modelul NOCT, care
   este o estimare dintre cele mai grosiere din tot lanțul.
3. **Tub Pitot sau anemometru pe mașină** (`airspeed_kph`) — dă viteza reală a
   aerului, în locul compunerii dintre viteza la sol și vântul raportat pentru o
   zonă de câțiva kilometri.
4. **Direcția de mers de la o busolă** (`heading_deg`) — acum este dedusă din
   ultimele două fixuri GPS și există doar cât timp mașina se deplasează cel
   puțin 10 m. Oprită, componenta de vânt frontal rămâne „—”.

Pentru adăugarea oricăruia dintre ele, procedura este cea din
[`plan-teensy-semnale-noi.md`](plan-teensy-semnale-noi.md) și
[`plan-server-semnale-noi.md`](plan-server-semnale-noi.md): un semnal nou se
declară o singură dată, în `server/app/signals.py`, iar frontendul îl preia din
catalog fără modificări.

---

## 9. Fișiere

| Fișier                                  | Rol                                                    |
| --------------------------------------- | ------------------------------------------------------ |
| `server/app/core/weather.py`            | Client, normalizare, memorie cache, degradare.         |
| `server/app/api/weather.py`             | Endpointul `GET /api/v1/weather`.                      |
| `server/app/schemas.py`                 | Contractul (Pydantic).                                 |
| `server/app/config.py`                  | Setările `TELEMETRY_WEATHER_*`.                        |
| `server/tests/test_weather.py`          | 18 verificări: normalizare, degradare, cache.          |
| `src/schemas/weather.ts`                | Contractul (Zod), oglinda celui de pe server.          |
| `src/lib/weather-math.ts`               | Formulele meteorologice. Cod pur.                      |
| `src/lib/weather-impact.ts`             | Legarea formulelor de starea mașinii.                  |
| `src/lib/weather-advice.ts`             | Traducerea condițiilor în instrucțiuni pentru pilot.   |
| `src/hooks/useWeather.ts`               | Interogarea serverului, poziția, direcția de mers.     |
| `src/stores/weather-store.ts`           | Raportul curent și suprafața array-ului.               |
| `src/components/WeatherPanel.tsx`       | Măsurători brute + rezumatul de pe prima pagină.       |
| `src/components/WeatherImpactPanel.tsx` | Cifrele derivate, cu formula sub fiecare.              |
| `src/components/WeatherForecast.tsx`    | Prognoza orară cu iradianța estimată.                  |
| `src/features/weather/WeatherPage.tsx`  | Pagina `/vreme`.                                       |
| `scripts/verify-no-api-key.mjs`         | Verifică faptul că nicio cheie nu a scăpat în depozit. |
