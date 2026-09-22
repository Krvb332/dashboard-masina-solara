# Configurație Reboost pentru cele două SEC-B175-7A

Propunere de setări pentru tool-ul Reboost, derivată din manualul Open-SEC
V1.13 (Rev. 6) și din datele reale ale mașinii de pe 18-19.09.2026.
Valorile marcate „de validat” nu au unități sau valori implicite publicate în
manual; se pornește de la valoarea din fabrică și se ajustează pe banc.

## 1. Datele de intrare, măsurate

| Mărime | Valoare | Sursă |
|---|---|---|
| Pachet | 32 celule Li-ion în serie, 22 Ah învățat de BMS | BMS ANT, catalogul serverului |
| Celulă: tăiere / nominal / plină | 2,50 / 3,70 / 4,20 V | catalog server |
| Praguri echipă pe celulă (18.09.2026) | 4,25 V avertizare, 4,30 V critic | catalog server |
| Pachet: min / max | 80,0 / 134,4 V | derivat |
| Dezechilibru celule văzut acum | 0,135 V (3,746 … 3,881 V) | pagina Energie |
| Tensiune pachet la 75-77 % SOC, sub sarcină | 123,3 … 124,5 V | BMS |
| Panou pe unitatea 32: tensiune în gol observată | 117 … 126 V | istoric MPPT |
| Panou pe unitatea 32: tensiune la vârf de putere | ~107 V la 456 W | istoric MPPT, 18.09 11:00 UTC |
| Panou pe unitatea 32: curent la vârf | ~4,3 A | 456 W / 107 V |
| Radiator, maxim văzut | 41 °C | istoric MPPT |
| Unitatea 33 | niciun cadru real recepționat vreodată | istoric MPPT |

Limitele hardware din datasheet-ul SEC-B175-7A Rev. 6:

| Parametru | Min | Max |
|---|---|---|
| Tensiune de ieșire (baterie) | 30 V | 175 V (absolut 200 V) |
| Tensiune de intrare (panou) | 6 V | **0,97 × V_ieșire** |
| Curent de intrare | 0 | 7 A |
| Temperatură radiator | 0 °C | 80 °C |
| Viteză CAN | 125 kbit/s | 1000 kbit/s |
| Capacitate pe ieșire | | 440 µF |

Panourile sunt legate pe partea de intrare (VL, low side), bateria pe partea
de ieșire (VH, high side): convertorul doar ridică tensiunea. Regula
„intrare ≤ 0,97 × ieșire” este cea care contează pentru mașina asta:

| Tensiune pachet | Intrare maximă admisă | Ce înseamnă pentru un panou cu Vmp ≈ 107 V |
|---|---|---|
| 134,4 V (plin) | 130,4 V | tot domeniul panoului e utilizabil |
| 123,5 V (acum, 76 %) | 119,8 V | punctul de putere maximă e accesibil; tensiunea în gol (până la 126 V) nu |
| 118,4 V (3,7 V/celulă) | 114,8 V | accesibil, cu 7 V rezervă |
| 110 V (3,44 V/celulă) | 106,7 V | punctul de putere maximă nu mai poate fi ținut; convertorul aduce mai puțin |
| 96 V (avertizare) | 93 V | panoul lucrează mult sub Vmp |

Șirul de pe unitatea 32 are tensiunea în gol (117-126 V) peste limita de
intrare cât timp pachetul e sub ~130 V. Nu este periculos (dioda internă de
bypass conduce), dar înseamnă că setpointul de tensiune de intrare nu are voie
să urce spre tensiunea în gol, iar sub ~110 V pe pachet aportul solar scade
indiferent de configurație. Dacă șirul se poate reconfigura, cu 8-10 % mai
puține celule în serie ar aduce Vmp la ~95-98 V și ar acoperi tot domeniul
pachetului.

Din datasheet, la cablare: borna negativă de panou (VL−) a fiecărei unități
nu are voie să fie legată la nimic altceva, nici la VL− a celeilalte unități.

## 2. Setările propuse

Ambele unități se configurează identic, cu excepția ID-ului și a întârzierii de
pornire.

### Identitate și pornire

| Setare | Unitatea A | Unitatea B | De ce |
|---|---|---|---|
| Device ID în tool | 0 | 1 | ID-ul de pe fir = 32 + valoarea; cadrele ajung pe 0x200/0x201 și 0x210/0x211. Două unități pe același ID cad în același slot pe Teensy și valorile sar între ele. |
| Encoder fizic | 0 | 1 | trebuie să coincidă cu ID-ul din tool |
| Default off | dezactivat | dezactivat | Unitatea 32 raportează acum `Enabled = 0` (Disabled) și livrează 0 W. Convertorul trebuie să pornească singur la alimentare, fără comandă CAN. |
| Startup delay | 0,5 s | 1,5 s | Eșalonează încărcarea celor 440 µF ai fiecărei unități, ca cele două să nu tragă vârf de curent în același moment. |

### Limite electrice

| Setare | Valoare | De ce |
|---|---|---|
| Output voltage limit (tensiunea maximă pe baterie) | 131,0 V | ≈ 4,09 V/celulă medie. Cu dezechilibrul actual de 0,135 V, celula cea mai sus ajunge la ~4,20 V când media e ~4,10 V. Sub pragul echipei de 4,25 V, ca BMS-ul să nu fie nevoit să deschidă MOSFET-ul de încărcare în mers. Se poate ridica la 133,0 V după ce balansarea aduce dezechilibrul sub 0,05 V. |
| Output current limit (curent maxim spre baterie) | 5,0 A pe unitate | Vârful real văzut este 3,65 A (456 W la 125 V). 5 A lasă loc pentru soare mai puternic și limitează o unitate la ~650 W. Cele două împreună dau 10 A, adică 0,45 C pe 22 Ah. De confirmat că limita de curent de încărcare din BMS este ≥ 10 A. |
| Input current limit (curent maxim din panou) | 7,0 A | Limita hardware. Șirul dă ~4,3 A la vârf; algoritmul nu poate cere mai mult decât dă panoul. |
| Maximum input voltage | 112 V | Datasheet: intrarea nu poate depăși 0,97 × ieșire. 112 V = 0,97 × 115,5 V, deci limita rămâne valabilă până la ~3,6 V/celulă. Este peste Vmp observat (~107 V), deci nu taie din putere. Limitează și capetele sweep-ului. |
| Temperature limit start | 70 °C | La fel ca pragul de avertizare din dashboard. |
| Temperature limit end | 80 °C | Temperatura specificată a radiatorului. La 80 °C curentul de intrare ajunge la zero. Maximul văzut pe mașină este 41 °C. |
| Output current fault detection | activat | Opțiunea de dezactivare (V1.13) există pentru bancuri de test, nu pentru mașină. |
| Output current gain limit | valoarea din fabrică | de validat |

### Algoritmul MPPT

| Setare | Valoare | De ce |
|---|---|---|
| Meter filter coefficient | fabrică, apoi 0,8 … 0,9 dacă tracking-ul oscilează | 0 = fără filtru, 1 = răspuns infinit de lent. Pe mașină nivelul de zgomot este mic (±30 mA). de validat |
| P&O step size | fabrică | pasul minim în tensiune; de validat |
| P&O step time | fabrică | de validat |
| P&O step gain | fabrică | 0 = pas fix; un gain mic accelerează urcarea după o umbră. de validat |
| Jump power threshold | fabrică | de validat |
| Jump rate | 0 | Saltul aleator caută un alt maxim global; pe un șir fără umbrire parțială structurală pierde putere de fiecare dată. Se pornește doar dacă o parte a panoului este umbrită permanent (de exemplu de un element de caroserie). |

### Sweep IV

| Setare | Valoare | De ce |
|---|---|---|
| Periodic sweep | dezactivat în cursă | În timpul sweep-ului convertorul nu urmărește punctul de maxim și pierde putere. Se folosește manual, din tool, pentru caracterizarea panourilor. |
| Sweep start | 40 V | Sub jumătatea tensiunii în gol, ca să prindă genunchiul curbei. |
| Sweep end | 112 V | Nu poate trece de „maximum input voltage” și nici de 0,97 × tensiunea pachetului din acel moment. Un sweep pornit cu pachetul sub 115 V se oprește mai devreme, ceea ce e în regulă. |
| Sweep size | 64 puncte | Suficient pentru forma curbei, sub limita de 128. |
| Publish sweep on CAN bus | dezactivat | Cadrele de sweep (packet 2) sunt numărate de Teensy ca pachete rezervate și încarcă CAN3 degeaba. Se activează doar la caracterizare, cu tool-ul conectat. |

### Magistrala CAN

| Element | Valoare | De ce |
|---|---|---|
| Bit rate | 500 kbit/s | Este ce așteaptă firmware-ul Teensy pe CAN3 (`MPPT_CAN_BAUD`). |
| Format ID | standard (11 biți) | Manualul spune că mesajele trimise sunt pe ID standard. |
| Terminare | 120 Ω la capătul lanțului | Schema de instalare din manual arată terminarea la ultima unitate. Teensy-ul e la celălalt capăt. |

## 2b. Setările în numele câmpurilor din Reboost

Captura tool-ului pentru unitatea cu „General ID 33” (19.09.2026) și ce se
schimbă. Câmpurile nelistate rămân pe valorile din captură.

| Câmp Reboost | În captură | De pus | De ce |
|---|---|---|---|
| Baudrate | 250 kHz | **500 kHz** | Teensy-ul rulează CAN3 la 500 kbit/s (`MPPT_CAN_BAUD`), iar unitatea 32 e la 500. La 250 kHz unitatea 33 nu e decodată de nimeni și strică și cadrele celeilalte. Aceasta e cauza pentru care 33 nu a apărut niciodată în dashboard. |
| Sample Point | 75 % | 75 % | compatibil cu FlexCAN |
| General ID | 33 | 33 (cealaltă unitate: 32) | ID-ul de pe fir = General ID + encoder; encoderul trebuie să fie pe 0 pe ambele, altfel se ajunge la 34 sau la coliziune. |
| Output Voltage Limit Soft | 134,00 V | **131,00 V** | 134 V = 4,19 V/celulă medie; cu dezechilibrul de 0,135 V celula maximă ar trece de 4,30 V (pragul critic). |
| Input Voltage Limit soft | 112,00 V | 112,00 V | corect, vezi regula 0,97 × ieșire |
| Output Current Limit Soft | 6,50 A | 6,50 A dacă BMS-ul acceptă ≥ 13 A la încărcare, altfel 5,00 A | vârful real este ~3,7 A pe unitate |
| Input Current Limit Soft | 7,00 A | 7,00 A | limita hardware |
| Temperature Limit Start / End | 70 / 80 °C | 70 / 80 °C | corect |
| meter filter | 0,93 | 0,93 | valoare din fabrică, de păstrat |
| P&O Stepsize / Timestep / Gain | 250 mV / 5 ms / 1,0 | neschimbate | fabrică; se ajustează doar dacă tracking-ul oscilează |
| Jump Power Threshold / Jump rate | 30 W / 0 | 30 W / 0 | saltul aleator rămâne oprit |
| High-side switch enable current | −0,50 A | −0,50 A | fabrică |
| Minimum Current | −0,30 A | −0,30 A | fabrică |
| Output Enable | False | **True** | Este exact `Enabled = 0` din pachetul de stare CAN: electronica de putere e oprită și unitatea livrează 0 W. |
| Turn on at startup | True | True | corect; asigură pornirea la alimentare |
| Startup Delay | 0 ms | 1500 ms (unitatea 32: 500 ms) | eșalonează încărcarea celor 440 µF |

Aceleași valori pe unitatea 32, cu General ID 32 și Startup Delay 500 ms.
De verificat pe 32 în special Baudrate (trebuie să fie tot 500 kHz) și
Output Enable, pentru că și ea raportează `Enabled = 0` pe CAN.

## 3. Cum se verifică după aplicare

1. Pe pagina Energie din dashboard, „MPPT 1” și „MPPT 2” trebuie să arate
   amândouă valori, nu „Semnal nerecepționat”. Panoul Sistem trebuie să
   arate „MPPT solar 28/28” în plin soare.
2. „Diagnostic convertoare”: `mode` = `const-input-voltage` (0) pe ambele
   unități cât timp bateria nu e plină; `enabled` = 1; `fault` = `ok`.
3. „Putere solară” trebuie să fie apropiată de diferența dintre puterea
   motorului și puterea din pachet (acum ~240 W în medie, cu motorul
   raportând curentul în pași de 1 A).
4. Când pachetul urcă spre 131 V, `mode` trebuie să treacă pe
   `const-output-voltage` (3), iar celula maximă să rămână sub 4,25 V.
5. Verificarea de consistență „Putere solară față de suma MPPT” din pagina
   Sistem trece de la „fără date” la „ok”.

## 4. Ce rămâne de confirmat pe mașină

- Limita de curent de încărcare configurată în BMS-ul ANT (trebuie ≥ 10 A).
- Tensiunea în gol a șirului de pe unitatea B, care nu a fost niciodată
  văzută pe CAN; dacă are alt număr de celule, „maximum input voltage” și
  capetele sweep-ului se ajustează pentru ea separat.
- Cablajul CAN al unității B până la CAN3 și poziția rezistenței de 120 Ω.
