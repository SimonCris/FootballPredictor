# Football Predictor

Monorepo con **frontend Angular 17 + Angular Material** e **backend Node.js/TypeScript (Express)**
per selezionare un campionato di calcio, recuperare le partite della prossima giornata da servizi
online gratuiti (con fallback tra provider) e generare pronostici statistici (1X2, Over/Under,
confidenza, quota stimata) per ogni partita.

## Indice
- [Struttura del monorepo](#struttura-del-monorepo)
- [Requisiti](#requisiti)
- [Setup rapido](#setup-rapido)
- [Variabili d'ambiente](#variabili-dambiente)
- [Esecuzione in sviluppo](#esecuzione-in-sviluppo)
- [Build di produzione](#build-di-produzione)
- [Test](#test)
- [API REST del backend](#api-rest-del-backend)
- [Algoritmo di pronostico](#algoritmo-di-pronostico)
- [Provider dati esterni e fallback](#provider-dati-esterni-e-fallback)
- [Note legali](#note-legali)

## Struttura del monorepo

```
/FootballPredictor
  package.json              # root, npm workspaces + script comuni
  .env.example               # variabili d'ambiente di riferimento (root)
  /apps
    /backend                 # Express + TypeScript
      src/
        config/               # env loader, mappatura campionati
        types/                # interfacce di dominio (League, Match, Prediction, ...)
        providers/            # football-data.org, TheSportsDB
        services/             # cache, provider-manager (fallback), prediction engine, ...
        controllers/          # handler delle rotte REST
        routes/               # definizione rotte /api/*
        utils/                # logger, retry HTTP, normalizzazione dati
      tests/                  # test Jest (motore pronostici, fallback provider)
    /frontend                 # Angular 17 standalone + Angular Material + ngx-charts
      src/app/
        core/                 # modelli condivisi e ApiService (HttpClient verso il backend)
        features/home/                # select campionato + tabella partite
        features/match-detail/        # dialog dettaglio partita e pronostico
        features/top-predictions/     # aggregazione top pronostici + grafico
```

## Requisiti
- **Node.js 20.11.1** (o compatibile, vedi `engines` in ogni `package.json`)
- npm 10+

## Setup rapido

```powershell
# 1. Clonare il repository e posizionarsi nella root
cd FootballPredictor

# 2. Installare tutte le dipendenze (root + workspaces backend/frontend)
npm install

# 3. Copiare i file .env di esempio e valorizzare le chiavi
Copy-Item apps\backend\.env.example apps\backend\.env
# Aprire apps\backend\.env e impostare FOOTBALL_DATA_API_KEY (vedi sotto)
```

## Variabili d'ambiente

Copiare `apps/backend/.env.example` in `apps/backend/.env` e valorizzare:

| Variabile | Descrizione | Come ottenerla |
|---|---|---|
| `FOOTBALL_DATA_API_KEY` | Chiave gratuita per il provider primario | Registrarsi su https://www.football-data.org/client/register (piano free, 10 richieste/minuto) |
| `THESPORTSDB_API_KEY` | Chiave provider di fallback | `3` è la chiave pubblica di test, nessuna registrazione richiesta |
| `CACHE_TTL_MATCHDAY` / `CACHE_TTL_PREDICTIONS` | TTL cache in secondi | Default 900 (15 minuti) |
| `HTTP_TIMEOUT_MS` / `HTTP_MAX_RETRIES` | Timeout e retry chiamate provider | Default 8000ms / 2 |
| `CORS_ORIGIN` | Origine consentita per il frontend | Default `http://localhost:4200` |

> **Nota:** se `FOOTBALL_DATA_API_KEY` non è configurata, il backend userà automaticamente
> TheSportsDB come unico provider (fallback), con dati meno dettagliati ma funzionanti.

## Esecuzione in sviluppo

Dalla root del monorepo, avvia backend e frontend in parallelo:

```powershell
npm run dev
```

Questo esegue con `concurrently`:
- backend su `http://localhost:3000` (`ts-node-dev`, hot reload)
- frontend su `http://localhost:4200` (`ng serve`)

Per avviarli singolarmente:

```powershell
npm run start:dev --workspace=apps/backend   # solo backend
npm run start --workspace=apps/frontend      # solo frontend
```

## Build di produzione

```powershell
npm run build            # build backend + frontend
npm run build:backend    # solo backend -> apps/backend/dist
npm run build:frontend   # solo frontend -> apps/frontend/dist/frontend
```

## Test

```powershell
npm run test              # test backend (Jest)
npm run test:backend      # idem, esplicito
npm run test:frontend     # test frontend (Karma/Jasmine, --watch=false)
npm run lint              # lint backend + frontend
```

I test del backend coprono in particolare:
- `tests/prediction.service.spec.ts`: proprietà statistiche del motore pronostici (probabilità che
  sommano a 100, esito coerente con la forza delle squadre, Over/Under, confidenza 0-100, quota > 1).
- `tests/provider-manager.spec.ts`: meccanismo di fallback tra provider dati esterni.

## API REST del backend

Tutte le rotte sono montate sotto `/api`. Esempi con `curl`:

```bash
# Lista campionati supportati
curl http://localhost:3000/api/leagues

# Partite della prossima giornata di Serie A
curl "http://localhost:3000/api/matchday?league=SA"

# Pronostico dettagliato per una partita (usare un id restituito da /matchday)
curl "http://localhost:3000/api/match/football-data:12345/predictions"

# Top 3 pronostici aggregati tra i top 5 campionati
curl "http://localhost:3000/api/top-predictions?n=3"
```

Codici campionato supportati (vedi `apps/backend/src/config/leagues.ts`): `SA` (Serie A), `PL`
(Premier League), `PD` (LaLiga), `FL1` (Ligue 1), `BL1` (Bundesliga), `DED` (Eredivisie), `PPL`
(Primeira Liga).

## Algoritmo di pronostico

Implementato in `apps/backend/src/services/prediction.service.ts` (vedi commenti inline per ogni
step):

1. Calcolo forza attacco/difesa di ciascuna squadra, normalizzata sulla media gol di lega.
2. Punteggio di forma recente (ultime 5 partite), pesato dando più importanza ai risultati più
   recenti.
3. Gol attesi (expected goals) per squadra, applicando il vantaggio campo alla squadra di casa.
4. Probabilità 1X2 tramite distribuzione di **Poisson bivariata** sui gol attesi.
5. Aggiustamento delle probabilità con forma recente e scontri diretti (head-to-head).
6. Suggerimento **Over/Under 2.5** dai gol attesi totali.
7. **Confidenza** (0-100) calcolata dallo scarto tra la probabilità più alta e la seconda.
8. **Quota stimata** = quota equa (100/probabilità) ridotta da un margine bookmaker (~7%).

In ambiente di sviluppo (`NODE_ENV !== production`) ogni pronostico include anche
`debugMetrics` con i valori intermedi del calcolo, visibili nel dialog di dettaglio partita del
frontend.

La **quota combinata** (pagina Top Pronostici) è il prodotto delle quote stimate dei pronostici
selezionati, arrotondato a 3 decimali.

## Provider dati esterni e fallback

- **football-data.org** (primario): richiede una API key gratuita, copre i principali campionati
  europei. Rate limit ~10 richieste/minuto sul piano free.
- **TheSportsDB** (fallback): chiave pubblica di test `3`, nessuna registrazione richiesta,
  copertura meno dettagliata ma sempre disponibile.

> **Nota su TheSportsDB (fallback):** l'endpoint `eventsnextleague.php` con la chiave gratuita
> restituisce in modo affidabile solo il prossimo singolo evento per molti campionati. Per
> ottenere l'intero turno, il provider usa quell'evento solo per scoprire round/stagione e poi
> interroga `eventsround.php`. **Verificato empiricamente**: con la chiave pubblica di test `3`,
> TUTTI gli endpoint a lista di TheSportsDB (`eventsround.php`, `eventsseason.php`,
> `search_all_seasons.php`, ecc.) restituiscono al massimo **5 risultati**, indipendentemente dal
> numero reale di elementi disponibili — è un limite imposto lato server sulla chiave condivisa
> gratuita, non un bug del nostro codice, e non è aggirabile con retry, paginazione o chiamate
> incrociate (`eventsround.php` ed `eventsseason.php` restituiscono esattamente gli stessi 5
> eventi). Quando questo limite scatta, l'API `/api/matchday` include un campo `warning` nella
> risposta e il frontend mostra uno snackbar che invita a configurare `FOOTBALL_DATA_API_KEY`.
> Il provider primario (football-data.org, con API key gratuita configurata) non ha questa
> limitazione e restituisce sempre il turno completo: **per vedere sempre tutte le partite di
> ogni giornata è fortemente consigliato registrarsi gratuitamente su
> https://www.football-data.org/client/register e impostare la chiave in `apps/backend/.env`.**

Per mitigare i rate limit del piano free di TheSportsDB (HTTP 429, Cloudflare "Error 1015"),
il provider serializza le chiamate con un ritardo minimo tra una richiesta e l'altra
(`apps/backend/src/utils/request-queue.ts`) e rispetta l'header `Retry-After` quando presente
(`apps/backend/src/utils/http-retry.ts`). Anche football-data.org usa la stessa coda per
restare sotto il limite di ~10 richieste/minuto del piano free.

Il `ProviderManager` (`apps/backend/src/services/provider-manager.ts`) prova il provider primario
e, in caso di errore (rete, rate limit, chiave mancante, timeout dopo i retry), passa
automaticamente al fallback. Le risposte vengono messe in cache in memoria (`node-cache`) con TTL
configurabile per ridurre il numero di chiamate esterne.

## Note legali

Questo progetto usa esclusivamente le API pubbliche/gratuite di football-data.org e TheSportsDB nei
limiti dei rispettivi piani free. Per un uso in produzione o con volumi di traffico elevati:
- registrare chiavi API proprie e rispettare i rate limit e i termini di servizio di ciascun
  provider;
- preferire sempre le API ufficiali documentate invece dello scraping di pagine web;
- verificare periodicamente eventuali cambi ai termini d'uso dei provider gratuiti.
