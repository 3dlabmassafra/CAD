# Schizzo — CAD 2D per Onshape

**3D Lab Massafra** · foto + testo → schizzo in millimetri → DXF / STL.

App statica, senza server. Apri [l’anteprima GitHub Pages](https://3dlabmassafra.github.io/CAD/) oppure `index.html` in un browser.

## Cosa fa

- CAD 2D di precisione (linee, polilinee, cerchi, raccordi, offset, quote, snap)
- **Foto → CAD**: carica una foto o uno schizzo, descrivi il pezzo (`Porta interna 800×2100, spessore 40, maniglia a 1050`), genera profili chiusi
- Anteprima 3D estrusa, raffinamento a parole
- Export **DXF R2000** (Onshape: *Inserisci → Importa* → Estrudi) e **STL**

## File

| File | Ruolo |
|---|---|
| `index.html` | UI |
| `app.js` | CAD |
| `export.js` | DXF / SVG / STL |
| `trace.js` | Foto → schizzo |
| `styles.css` | Tema |
| `porta.jpg` | Sottofondo esempio porta |
| `porta-interna.dxf` | DXF della porta 800×2100 |

## Onshape

1. Esporta **DXF Onshape** (unità mm)
2. Nel Part Studio: *Inserisci → Importa*
3. Schizzo sul piano → **Estrudi**

I profili chiusi (rettangolo, cerchio, polilinea chiusa) diventano solidi. I fori restano cerchi esatti.

## Sviluppo locale

```bash
python3 -m http.server 8080 --bind 0.0.0.0
```

Poi apri `http://localhost:8080`.
