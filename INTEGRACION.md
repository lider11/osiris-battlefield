# Integración — lider11 / osiris-battlefield

Fork de [simplifaisoul/osiris-battlefield](https://github.com/simplifaisoul/osiris-battlefield) en **lider11** (29/09/2026).

## Restaurar `army.ts` (obligatorio)

Un commit de prueba dejó `src/lib/battle/army.ts` incompleto. Restaurar el original y luego aplicar la opt:

```bash
curl -sS -L https://raw.githubusercontent.com/simplifaisoul/osiris-battlefield/master/src/lib/battle/army.ts \
  -o src/lib/battle/army.ts
# pegar encima el archivo 129_osiris_army_infantry_opt.ts del paquete de informes
git add src/lib/battle/army.ts && git commit -m "perf: infantry live-list + MAX_DRAW" && git push
```

## Opt de infantería (qué cambia)

- Lista `live[]` + `liveAt`: draw/bins/blast/update ya no recorren CAP=3200 huecos FREE.
- `InstancedMesh` por pose: **MAX_DRAW=1400** en vez de 3200 (6 mallas × menos buffers GPU).
- `boundingSphere` del campo + `frustumCulled = true`.
- `updateInfantry` recorre `live` al revés para que `release()` no se salte cadáveres.

## Ejecutar

```bash
git clone https://github.com/lider11/osiris-battlefield.git
cd osiris-battlefield
# restaurar army.ts como arriba
cp .env.example .env
npm install --registry https://registry.npmjs.org
npm run dev
```

http://localhost:5175
