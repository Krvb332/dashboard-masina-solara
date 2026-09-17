# Circuitul Zolder ca referință a poziției

Dashboardul nu mai desenează urma GPS: desenează circuitul și proiectează
mașina pe el. Documentul explică de unde vine geometria, ce se schimbă în
calcule și cât s-a câștigat, cu cifrele măsurate.

## Problema

Un receptor GNSS bun raportează poziția cu câțiva metri de dispersie. Pe un
grafic de viteză, câțiva metri nu se văd. Pe o hartă de circuit se văd imediat:
urma iese în iarbă, taie interiorul virajelor, iar mașina oprită în box desenează
un ghem. Mai grav, tot ce se deduce din poziție moștenește zgomotul — și nu
simetric, ci mereu în aceeași direcție.

Cel mai scump caz este distanța. Calculată prin însumarea pașilor dintre fixuri
consecutive, fiecare pas primește și zgomotul celor două capete, iar un modul nu
scade niciodată. La 10 Hz și 22 m/s mașina avansează 2,2 m între eșantioane, deci
un receptor cu 4 m dispersie produce pași dominați de zgomot pur. Măsurat pe două
ture sintetice: **26 821 m raportați pentru 8 018 m parcurși, adică +234 %**.
Consumul pe kilometru se împarte la numărul acela.

Informația care lipsește nu este în date. Este pe hartă: mașina nu poate fi
oriunde, ci pe asfalt.

## Geometria: de unde vine

Sursa nu este schița de pe Wikipedia. O schiță este un desen fără sistem de
coordonate; ca să fie comparată cu un fix GNSS ar trebui georeferențiată de mână,
prin alinierea pe câteva repere — o operație cu eroare de zeci de metri, pe care
nimic din ce urmează nu ar mai putea-o corecta.

Geometria vine din **OpenStreetMap**, unde circuitul este cartografiat nod cu nod
în WGS84, exact sistemul în care raportează receptorul:

| Ce | De unde | Detalii |
| --- | --- | --- |
| Linia mediană | Overpass API, `way(around:2000,50.9894,5.2564)["highway"="raceway"]` | 22 de căi înlănțuite în ordinea de mers dată de `oneway=yes`, 215 noduri |
| Altitudinea | OpenTopodata, setul `eudem25m` | Copernicus EU-DEM, rezoluție 25 m, fără valori lipsă |
| Numele și numerele virajelor | etichetele `name` și `ref` din OSM | T1–T16, numerotarea oficială a circuitului |

Pit lane-ul (way 179267542), Safety Car Lane (444633117) și racordul 288284741
sunt excluse deliberat: nu fac parte din tur.

**Licențe.** Geometria OpenStreetMap este ODbL (© contribuitorii OpenStreetMap);
EU-DEM este produs Copernicus, redistribuibil cu menționarea sursei.

### Cum știm că este corectă

Trei confirmări independente, niciuna dedusă din celelalte:

1. **Bucla se închide exact.** Ultimul nod al ultimei căi *este* primul nod al
   primei căi — abatere 0 m, nu „aproape".
2. **Lungimea.** Măsurată din noduri: **4 008,7 m**. Publicată: **4 011 m**.
   Abatere **0,06 %**. O geometrie desenată aproximativ ar arăta bine pe ecran și
   ar rata tocmai cifra aceasta.
3. **Numerotarea virajelor iese în ordine.** Pornind de la originea aleasă
   independent, sectoarele se citesc T1, T2, … T16 fără nicio excepție. Dacă
   originea sau înlănțuirea ar fi fost greșite, secvența s-ar fi rupt.

### Originea distanței

Nodul 0 este ieșirea din ultimul viraj (T16 Jacky Ickx), la începutul liniei
drepte principale. Este **cel mai apropiat nod din tot circuitul** de
coordonatele publicate ale acestuia (50°59′23″N, 5°15′24″E) — la 39,9 m. Acolo se
închide turul, deci numărătoarea dashboardului cade unde o așteaptă și
cronometrarea de pe circuit.

## Ce face proiecția

Fiecare fix este proiectat pe punctul cel mai apropiat de pe linia mediană, iar
mai departe se lucrează cu *poziția pe traseu* (`s`, metri de la linia de start),
nu cu perechea de coordonate.

Trei decizii merită reținute.

**Coridorul, nu lipirea forțată.** Un fix aflat la peste 25 m de linia mediană
este raportat ca fiind în afara traseului, nu mutat pe el. Mașina în padoc, pe
drumul de acces sau cu receptorul defect chiar *nu este* pe circuit, iar o hartă
care o desenează oricum pe asfalt ascunde exact ce trebuie văzut. Cei 25 m sunt
jumătatea de asfalt (~6 m) plus bugetul de eroare al unui receptor cu HDOP prost.

**Continuitatea.** Căutarea pornește din vecinătatea poziției precedente și abia
dacă nu găsește nimic plauzibil acolo se uită pe tot circuitul. Măsurat, Zolder
nu are porțiuni depărtate pe traseu care să treacă la mai puțin de ~70 m una de
alta, deci **la coridorul implicit nu există pereche ambiguă** — continuitatea
este aici o marjă și o economie de căutare, nu o corecție. Devine o corecție
adevărată dacă receptorul e slab și coridorul trebuie lărgit; testul care o
demonstrează construiește explicit acel caz, la un coridor declarat.

**Abaterea laterală rămâne raportată.** Este exact componenta pe care proiecția o
înlătură din poziția desenată. Ascunsă, ar face o hartă alimentată de un receptor
defect să arate la fel de curat ca una corectă. Afișată, spune cât s-a corectat —
și recuperează traiectoria reală a pilotului, care taie virajele.

## Ce s-a câștigat, măsurat

Pe ture sintetice, unde poziția adevărată este aleasă întâi și zgomotul adăugat
peste ea (`src/test/track-fixtures.ts`), deci eroarea este cunoscută exact:

| Mărime | Brut | Proiectat |
| --- | --- | --- |
| Eroare mediană de poziție (σ = 3 m) | 3,49 m | 2,12 m |
| Abatere perpendiculară pe traseu (σ = 5 m) | 3,40 m mediană, 19,7 m maxim | **0 m** |
| Distanță pe 2 ture (σ = 4 m; adevăr 8 018 m) | 26 821 m (**+234,5 %**) | 8 021 m (**0,04 %**) |

Factorul de 1,65 pe poziția în plan **nu este reglabil**: zgomotul izotrop are
modulul distribuit Rayleigh (mediana 1,177 σ), iar componenta rămasă după
proiecție este seminormală (mediana 0,674 σ). Raportul lor, ~1,75, nu depinde de
σ — și într-adevăr nu depinde: măsurat la σ = 2, 3, 5 și 8 m iese 1,65 de fiecare
dată. O implementare care ar raporta mult mai mult ar fi suspectă, nu mai bună.

Câștigul adevărat sunt celelalte două rânduri: abaterea perpendiculară dispare
complet — urma nu mai iese de pe asfalt — iar distanța încetează să fie umflată.

### Odometrul: o capcană găsită de măsurătoare

Prima versiune aduna modulul pașilor pe *traseu* în loc de cel al pașilor în
plan. Rezultatul a fost +5,8 % în loc de +234 % — mai bine, dar aceeași eroare,
doar mutată pe altă axă. Corect este **maximul avansului net**: suma diferențelor
dintre poziții consecutive se telescopează, deci zgomotul intermediar se anulează
în întregime și rămâne doar cel al capetelor. De acolo vin cei 0,04 %.

Tot măsurătoarea a prins și numărătoarea de tururi: o mașină oprită pe linia de
start oscilează în jurul lui zero, iar avansul ei net ajunge la câțiva centimetri
*negativi*. Rotunjit în jos, `−0,06 m` pe un circuit de patru kilometri dădea
turul **−1**. Se trunchiază, nu se rotunjește.

## Unde se vede în interfață

Pagina **Traseu**:

- **Harta** desenează circuitul din referință, într-un cadru fix legat de
  geometria lui. Nu se mai auto-scalează după date: același loc de pe asfalt cade
  mereu în același pixel, iar o mașină oprită nu mai schimbă scara. Sub urma
  proiectată rămâne desenată, estompat, urma brută — distanța dintre ele este cât
  corectează maparea.
- **Poziția pe circuit** arată sectorul (cu numărul oficial de viraj), metrul
  turului, abaterea de la mijloc acum și mediană, turul, distanța pe traseu,
  altitudinea de referință față de cea raportată de GPS și panta traseului.

## Simulatorul

Simulatorul emite chiar pe această geometrie — altfel funcția ar fi fost moartă
la prima rulare, cu fiecare fix la 1 400 km de circuit. Mașina înaintează pe
lungime de arc (`s += viteză · dt`, fără nicio corecție), iar viteza în viraj este
limitată de raza de curbură reală, citită cu 70 m în avans. Profilul de viteză
rezultat — 29…108 km/h, lent în șicane, rapid pe linia dreaptă — nu este scris de
mână nicăieri: iese din geometrie.

Datele stau în două tabele generate în aceeași rulare, `src/lib/track-zolder.ts`
și `server/simulator/track_zolder_data.py`, iar `--sync` le compară nod cu nod.

## Verificări

```bash
npm run verify:track
```

rulează geometria, altitudinea și sincronizarea celor două tabele. Face parte din
`npm run check`.

```bash
npm run verify:track:sim
```

pornește simulatorul și confirmă că fixurile emise cad pe circuit (cel mai
depărtat la 0,06 m) și că odometrul coincide cu poziția pe traseu la milimetru.
Separat, pentru că are nevoie de mediul virtual Python al serverului.

Scriptul de verificare **nu importă** modulele pe care le verifică: citește
tabelele textual și recalculează geometria cu implementare proprie. Altfel ar
confirma doar că modulele sunt consecvente cu ele însele.

Comportamentul este acoperit de cinci suite:

| Fișier | Ce demonstrează |
| --- | --- |
| `src/lib/track-reference.test.ts` | geometria, altitudinea, cadrul metric față de geodezice WGS84 |
| `src/lib/map-matching.test.ts` | proiecția și coridorul, cu control pozitiv |
| `src/lib/map-matching.continuity.test.ts` | separarea măsurată a circuitului și ambiguitatea la coridor lărgit |
| `src/lib/map-matching.laps.test.ts` | turele și distanța, inclusiv mașina oprită pe linie |
| `src/lib/map-matching.noise.test.ts` | cifrele din tabelul de mai sus |

## Cum se schimbă circuitul

Datele sunt vendate, nu descărcate la build: dashboardul trebuie să funcționeze
fără internet. Pentru alt circuit se reface tabelul din aceeași sursă (Overpass +
un model de teren), se păstrează formatul, se alege originea la linia de start și
se rulează `npm run verify:track`. Pragurile din `MATCHING` — coridor, fereastră
de căutare — sunt exprimate în metri și nu depind de circuit.
