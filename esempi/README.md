# Esempi generati

File prodotti dalla pipeline a partire da `porta.jpg` (foto della porta, 640×1377 px),
con queste misure dichiarate: anta 800×2100, spessore 40, maniglia a 1019, backset 45.

| File | Descrizione |
|---|---|
| `porta-tavola.svg` | Tavola tecnica A3 in scala 1:10 con quote, dettaglio ferramenta 1:5, cartiglio e note |
| `porta.dxf` | DXF R2000 in millimetri (contorni + ferramenta + quote) per Onshape |
| `porta-brief.json` | Brief con i parametri reali per Ragnar |

Misure ricavate dalla foto (stima automatica, poi dichiarate dove indicate):

| Voce | Valore | Fonte |
|---|---|---|
| Anta | 800 × 2100 mm | dichiarata (usata come riferimento di scala) |
| Coprifilo | 72 / 72 / 70,5 mm | stimata dalle linee sub-pixel |
| Battuta | 43 / 43 / 55 mm | stimata |
| Asse maniglia | 1019 mm da terra | dichiarata |
| Backset (bordo anta → asse maniglia) | 45 mm | dichiarata |
| Rosetta quadra | 50 × 50 mm | stimata dal riquadro reale della ferramenta |
| Bocchetta chiave sotto l'asse | 89,5 mm | stimata |
| Lunghezza maniglia dal centro | 113 mm | stimata |
| Scala | 1,665 mm/px (scarto X/Y 0,8%) | calcolata |
