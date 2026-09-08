# Acest server nu mai este folosit

Dashboardul primește acum datele de la serverul de telemetrie din
`ServerRUTTUCN` (FastAPI + TimescaleDB + MQTT), care implementează exact același
contract: `GET /api/v1/signals`, `/health`, `/sessions`, `/history`, `/alarms` și
`WS /ws/telemetry` cu subprotocolul `telemetry.v1`.

Ce diferă față de acest server de referință:

| | `server/` (acesta) | ServerRUTTUCN |
|---|---|---|
| Stocare | SQLite, eșantioanele copiate în sesiuni | TimescaleDB, sesiunile sunt ferestre de timp |
| Ingest | un mesaj plat cu toate semnalele | mesaje separate pe sursă, îmbinate pe server |
| TPMS | inexistent | patru roți, presiune și temperatură |
| Compresie și retenție | fără | automate |
| Refuz pe WebSocket | închide înainte de handshake, clientul vede 1006 | 4401, cu motiv |
| Energie și distanță | trimise de vehicul | calculate prin integrare pe server |

**Nu porni acest server în paralel cu celălalt.** Amândouă ascultă pe portul
8000; ai vedea date vechi sau deloc, fără un mesaj de eroare care să explice de ce.

Codul rămâne aici ca referință pentru contract și poate fi șters oricând: `src/`
al dashboardului nu depinde de el în niciun fel.

Cum se pornește noul server și ce arată dashboardul:
`ServerRUTTUCN/docs/09-dashboard.md`.
