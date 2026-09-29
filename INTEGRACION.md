# Integración — lider11 / osiris-battlefield

Fork de [simplifaisoul/osiris-battlefield](https://github.com/simplifaisoul/osiris-battlefield) en la cuenta **lider11** (29/09/2026).

## Qué es

App SvelteKit + Vite 8 + Three.js. Visualiza el mercado vivo de `$OSIRIS` / SOL como un campo 3D. Puerto de desarrollo: **5175**.

No es el dashboard OSINT `simplifaisoul/osiris`. No sustituye informes SAE / ALFM / Ecopetrol.

## Ejecutar

```bash
git clone https://github.com/lider11/osiris-battlefield.git
cd osiris-battlefield
cp .env.example .env
npm install --registry https://registry.npmjs.org
npm run dev
```

Abrir http://localhost:5175

Demo pública del origen: https://osiris-battlefield.vercel.app

## Dónde encaja con las actividades actuales

| Capa del paquete | Uso posible de este repo |
|---|---|
| SAFE METRIC | Referencia de inventario / terreno 3D en tiempo real (no copiar token $OSIRIS a un informe SAE). |
| Oil & Gas / predios | Mismo patrón: feed en vivo → unidades en el campo (profundidad = liquidez o área). |
| Jurídico / económico | Solo laboratorio técnico. No radicar ni citar como producto SAE. |

## Arquitectura útil para adaptar

- Vite + plugin `sveltekit()`, `optimizeDeps` automático (`three`, `postprocessing`).
- Cliente WebGL: `src/lib/battle/*` (`ssr = false` en `+page.ts`).
- Proxy de mercado: `src/routes/api/pool/+server.ts` y `api/trades`.
- Mint / pool: `.env` (`OSIRIS_TOKEN_MINT`, `OSIRIS_POOL_ADDRESS`).

## Próximo paso de integración

1. Correr en local.
2. Decidir si el feed cambia (DexScreener → otro API) o si solo se reutiliza el motor 3D.
3. No mezclar NIT / carátulas del paquete Integración Corporativa dentro de este front hasta que haya un alcance escrito.
