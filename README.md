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
| `ODDS_API_KEY` | Chiave gratuita per l'arricchimento con quote di mercato reali | Registrarsi su https://the-odds-api.com/ (piano free, 500 richieste/mese, solo email, nessuna carta richiesta). **Opzionale**: se non impostata (o lasciata al placeholder `CHANGE_ME_THE_ODDS_API_KEY`), il pronostico viene calcolato solo dal modello statistico, senza errori |
| `ODDS_API_BASE_URL` | Base URL di The Odds API | Default `https://api.the-odds-api.com/v4`, di norma non va cambiato |
| `CACHE_TTL_MATCHDAY` / `CACHE_TTL_PREDICTIONS` | TTL cache in secondi | Default 900 (15 minuti) |
| `CACHE_TTL_STANDINGS` | TTL cache classifiche in secondi | Default 3600 (1 ora): la classifica cambia poco frequentemente |
| `CACHE_TTL_ODDS` | TTL cache quote di mercato in secondi | Default 1800 (30 minuti): utile anche per non sprecare le 500 richieste/mese gratuite |
| `HTTP_TIMEOUT_MS` / `HTTP_MAX_RETRIES` | Timeout e retry chiamate provider | Default 8000ms / 2 |
| `CORS_ORIGIN` | Origine consentita per il frontend | Default `http://localhost:4200` |

> **Nota:** se `FOOTBALL_DATA_API_KEY` non è configurata, il backend userà automaticamente
> TheSportsDB come unico provider (fallback), con dati meno dettagliati ma funzionanti.

> ⚠️ **Sicurezza:** `apps/backend/.env` contiene chiavi reali e **non deve mai essere committato**.
> Il file è ora escluso da `.gitignore`; se in passato è stato committato con una chiave reale,
> considerare quella chiave compromessa e **rigenerarla** dal pannello del provider (per
> football-data.org: https://www.football-data.org/client/register, sezione "My Account").

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
step). Motore **deterministico ed interamente spiegabile** ("ensemble avanzato"): ogni numero è
tracciabile nei `debugMetrics`. **Non usa una rete neurale addestrata** — vedi il riquadro
"Perché non è un modello AI/ML addestrato" più sotto per la motivazione.

1. Calcolo forza attacco/difesa di ciascuna squadra, normalizzata sulla media gol di lega.
2. Punteggio di forma recente (ultime 5 partite), pesato dando più importanza ai risultati più
   recenti.
3. Gol attesi (expected goals) per squadra, applicando il vantaggio campo alla squadra di casa.
4. Probabilità 1X2 tramite distribuzione di **Poisson bivariata** sui gol attesi.
5. Aggiustamento delle probabilità con forma recente, scontri diretti (head-to-head) e
   **differenza di posizione in classifica** (`standings`, recuperata da football-data.org o
   TheSportsDB): una squadra molto più in alto in classifica riceve un piccolo bonus aggiuntivo,
   perché riflette la qualità della rosa sull'intera stagione, non solo le ultime 5 partite.
6. **Peso di fiducia nel mercato** (`calculateMarketTrustWeight`, dinamico tra 50% e 85%): non più
   un peso fisso come in precedenza. Aumenta quando il mercato è più sbilanciato verso un singolo
   esito (es. quote 1.20 vs 5.60 → la squadra a 1.20 viene considerata fortemente favorita) e
   quando più bookmaker indipendenti concordano (fino a 15 bookmaker aggregati = fiducia massima).
   Così le quote reali dei bookmaker influenzano il modello molto più fortemente quando il segnale
   di mercato è forte, e meno quando il mercato è vicino all'equilibrio.
7. **Blend con le quote di mercato reali 1X2** (se `ODDS_API_KEY` configurata): le probabilità del
   modello statistico vengono miscelate, con il peso dinamico calcolato allo step 6, con le
   probabilità implicite nelle quote medie di più bookmaker, "de-vigghiate" (rimosso il margine)
   per ottenere probabilità di mercato pure.
8. **Over/Under 2.5**: probabilità calcolata dalla stessa griglia di Poisson bivariata (non solo
   dal confronto "gol attesi >= 2.5"), poi corretta con il mercato reale **`totals`** (Over/Under)
   di The Odds API se disponibile, con lo stesso principio di blend dinamico dello step 6-7 (ma
   applicato al mercato binario Over/Under).
9. **BTTS (Both Teams To Score)**: derivato matematicamente dal modello di Poisson —
   `P(Sì) = 1 - e^(-λcasa) - e^(-λtrasferta) + e^(-λcasa-λtrasferta)`. Nessun mercato "btts" è
   fetchabile gratuitamente da The Odds API (la richiesta viene rifiutata con `INVALID_MARKET`),
   quindi non c'è blend di mercato per questo esito.
10. **Doppia chance** (1X, X2, 12): derivata sommando le probabilità 1X2 finali corrispondenti
    (es. 1X = P(1) + P(X)). Anche questo mercato non è fetchabile gratuitamente, ma la derivazione
    aritmetica dalle probabilità 1X2 finali è esatta.
11. **Confidenza** (0-100, `calculateConfidence`) calcolata dallo scarto tra la probabilità più alta
    e la seconda; se le quote di mercato sono disponibili e concordano con l'esito suggerito dal
    modello, la confidenza riceve un bonus (8-20 punti, scalato dal peso di fiducia nel mercato
    dello step 6), altrimenti un malus della stessa entità.
12. **Quota stimata** (`calculateFairOdds`): se disponibile, è la quota reale media di mercato (The
    Odds API) per l'esito consigliato; altrimenti la quota "equa" calcolata dal modello
    (100/probabilità, ridotta dal margine bookmaker ~7%).

In ambiente di sviluppo (`NODE_ENV !== production`) ogni pronostico include anche
`debugMetrics` con i valori intermedi del calcolo (incluso `standingsFactor`, `marketBlendWeight`,
`marketSkew`, le probabilità del modello prima del blend con il mercato e la probabilità
Over/Under del solo modello prima del blend con il mercato `totals`), visibili nel dialog di
dettaglio partita del frontend.

La **quota combinata** (pagina Top Pronostici) è il prodotto delle quote stimate dei pronostici
selezionati, arrotondato a 3 decimali.

### Perché non è un modello AI/ML addestrato

Il progetto **non persiste uno storico dei risultati reali** delle partite passate (nessun
database). Addestrare una rete neurale (es. TensorFlow.js/Brain.js) richiede un dataset etichettato
di esempi reali con cui apprendere; senza questi dati, un "modello AI" produrrebbe pesi casuali
mascherati da intelligenza artificiale — una scelta deliberatamente evitata. Al suo posto, questo
motore è un **ensemble statistico deterministico e trasparente** che integra più segnali reali
(Poisson, forma, H2H, classifica, mercati bookmaker multipli) con pesi espliciti e spiegabili. Se
in futuro si vorrà costruire un vero modello addestrato, servirebbe prima un servizio che
persista i risultati finali delle partite (status `FINISHED`) insieme alle feature calcolate al
momento del pronostico, per costruire un dataset di addestramento reale.

## Provider dati esterni e fallback

- **football-data.org** (primario): richiede una API key gratuita, copre i principali campionati
  europei. Rate limit ~10 richieste/minuto sul piano free. Fornisce anche l'endpoint
  `/competitions/{code}/standings` usato per la classifica.
- **TheSportsDB** (fallback): chiave pubblica di test `3`, nessuna registrazione richiesta,
  copertura meno dettagliata ma sempre disponibile. Fornisce la classifica tramite
  `lookuptable.php`.
- **The Odds API** (arricchimento opzionale, non fa parte del fallback partite/classifica):
  https://the-odds-api.com/ — piano free **gratuito**, 500 richieste/mese, richiede solo una
  registrazione via email (nessuna carta di credito). Fornisce le quote reali aggregate da molti
  bookmaker per **tre mercati calcistici** (`h2h` 1X2, `totals` Over/Under, `spreads` handicap
  asiatico — tutti e tre confermati disponibili gratuitamente per il calcio), usate come segnale
  aggiuntivo per il motore pronostici (vedi sopra). Se un bookmaker non offre un determinato
  mercato per una partita, quel mercato viene semplicemente omesso senza errori. **Nota**: i
  mercati `btts` e `double_chance` NON sono richiedibili da The Odds API (l'API risponde con
  `INVALID_MARKET`): vengono invece calcolati matematicamente dal motore pronostici (vedi sopra).
  **Nota su Betfair Exchange**: non esiste un'API pubblica gratuita di Betfair (richiede
  application key + account finanziato approvato), quindi non è integrata in questo progetto. Se
  `ODDS_API_KEY` non è configurata, l'intero arricchimento viene semplicemente saltato (nessun
  errore): il calcolo funziona comunque con solo il modello statistico. Le squadre vengono abbinate
  tra provider diversi per nome normalizzato (`normalizeTeamName` in
  `apps/backend/src/utils/normalize.ts`), poiché The Odds API non condivide gli stessi id squadra
  di football-data.org/TheSportsDB.

> **Nota su TheSportsDB (fallback):** l'endpoint `eventsnextleague.php` con la chiave gratuita
> restituisce in modo affidabile solo il prossimo singolo evento per molti campionati. Per
> ottenere l'intero turno, il provider usa quell'evento solo per scoprire round/stagione e poi
> interroga `eventsround.php`. **Verificato empiricamente**: con la chiave pubblica di test `3`,
> TUTTI gli endpoint a lista di TheSportsDB (`eventsround.php`, `eventsseason.php`,
> `search_all_seasons.php`, `lookuptable.php`, ecc.) restituiscono al massimo **5 risultati**,
> indipendentemente dal numero reale di elementi disponibili — è un limite imposto lato server
> sulla chiave condivisa gratuita, non un bug del nostro codice, e non è aggirabile con retry,
> paginazione o chiamate incrociate. Quando questo limite scatta sulle partite, l'API
> `/api/matchday` include un campo `warning` nella risposta e il frontend mostra uno snackbar che
> invita a configurare `FOOTBALL_DATA_API_KEY`. Il provider primario (football-data.org, con API
> key gratuita configurata) non ha questa limitazione e restituisce sempre il turno/la classifica
> completi: **per vedere sempre tutte le partite di ogni giornata è fortemente consigliato
> registrarsi gratuitamente su https://www.football-data.org/client/register e impostare la
> chiave in `apps/backend/.env`.**

Per mitigare i rate limit del piano free di TheSportsDB (HTTP 429, Cloudflare "Error 1015"),
il provider serializza le chiamate con un ritardo minimo tra una richiesta e l'altra
(`apps/backend/src/utils/request-queue.ts`) e rispetta l'header `Retry-After` quando presente
(`apps/backend/src/utils/http-retry.ts`). Anche football-data.org e The Odds API usano la stessa
coda per restare sotto i rispettivi limiti dei piani free.

Il `ProviderManager` (`apps/backend/src/services/provider-manager.ts`) prova il provider primario
e, in caso di errore (rete, rate limit, chiave mancante, timeout dopo i retry), passa
automaticamente al fallback per partite, forma squadre, scontri diretti e classifica. Le risposte
vengono messe in cache in memoria (`node-cache`) con TTL configurabile per ridurre il numero di
chiamate esterne (`CACHE_TTL_MATCHDAY`, `CACHE_TTL_PREDICTIONS`, `CACHE_TTL_STANDINGS`,
`CACHE_TTL_ODDS`).

## Note legali

Questo progetto usa esclusivamente le API pubbliche/gratuite di football-data.org e TheSportsDB nei
limiti dei rispettivi piani free. Per un uso in produzione o con volumi di traffico elevati:
- registrare chiavi API proprie e rispettare i rate limit e i termini di servizio di ciascun
  provider;
- preferire sempre le API ufficiali documentate invece dello scraping di pagine web;
- verificare periodicamente eventuali cambi ai termini d'uso dei provider gratuiti.
