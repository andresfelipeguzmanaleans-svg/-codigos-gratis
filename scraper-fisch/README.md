# Scraper Fisch

Scraper de datos del juego **Fisch** de Roblox.

## Estructura

```
scraper-fisch/
├── src/
│   ├── sources/        # scripts que scrapean cada fuente
│   ├── parsers/        # funciones para parsear HTML/wikitext
│   └── utils/          # utilidades (rate limiter, retry, etc)
├── data/
│   ├── static/         # datos que cambian poco (peces, mutaciones, cañas)
│   └── dynamic/        # datos que cambian a diario (valores, códigos)
└── package.json
```

## Instalación

```bash
cd scraper-fisch
npm install
```

## Uso

```bash
npm start
```
