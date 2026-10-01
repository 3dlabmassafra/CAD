# CAD — Foto → disegno tecnico quotato → modello 3D

**3D Lab Massafra** · da una fotografia a una tavola tecnica in millimetri, con misure
proporzionate e verificate. Da lì: DXF per Onshape, STL per la stampa 3D, brief per Ragnar.

App statica, senza server: tutto il calcolo avviene nel browser, le foto non vengono caricate
da nessuna parte.

## Le tre pagine

| Pagina | Cosa fa |
|---|---|
| **`index.html`** | Home: come funziona e perché le misure sono affidabili |
| **`genera.html`** | Il flusso guidato in 3 passi: foto → misure verificate → tavola tecnica |
| **`cad.html`** | CAD 2D completo (Schizzo) per rifinire a mano, con export DXF/STL/SVG/PNG |

## Il flusso guidato (`genera.html`)

1. **La foto** — carichi l'immagine (o usi quella di esempio) e, se le conosci, scrivi le misure:
   *"porta interna anta 800x2100, spessore 40, maniglia a 1019, backset 45"*.
   Le misure che dichiari diventano il riferimento di scala e vincono su ogni stima.
2. **Le misure** — l'analisi deterministica mostra cosa ha trovato, con le evidenze numeriche
   e i controlli superati (o falliti: te lo dice, non tira a indovinare).
3. **Il disegno tecnico** — tavola quotata A4/A3 in scala, con cartiglio, note di lavorazione
   e dettaglio ingrandito della ferramenta. Da qui esporti i file.

## Cosa esce

| File | A cosa serve |
|---|---|
| **DXF R2000** (mm) | Onshape: *Inserisci → Importa*; Ragnar e gli altri CAD 3D |
| **STL** | Estrusione dei profili chiusi con lo spessore impostato |
| **SVG / PNG** | Tavola tecnica in scala (1:1 sul foglio, 300 o 600 dpi) |
| **brief.json** | Parametri reali in mm: è il contesto numerico da dare a Ragnar |

## Perché queste misure sono proporzionate

- **Linee sub-pixel.** Ogni spigolo è ricavato dal profilo di gradiente *mediano* della colonna
  (o riga) e rifinito con un fit parabolico: la posizione è stimata al decimo di pixel e la
  venatura del legno, la punteggiatura del JPEG o un watermark non la spostano.
- **Contorno agganciato alle linee, non alle soglie.** Il bordo esterno è la linea persistente
  più esterna, con esclusione di aloni e cornici della foto. La crescita di regione dal centro
  conferma o integra il risultato: quando i due metodi concordano, la misura è doppiamente verificata.
- **Simmetria misurata e regolarizzata.** Le coppie di linee speculari vengono cercate e
  allineate su un asse comune: l'anta non può risultare più larga a sinistra che a destra.
- **Ferramenta dal riquadro reale.** Rosetta, bocchetta e maniglia sono misurate sull'ingombro
  effettivo dell'elemento metallico, non sul baricentro dei pixel chiari.
- **Controlli espliciti.** Scala coerente su X e Y, bordi stabili, ferramenta coerente, misure
  plausibili (intervalli di officina). I controlli falliti sono mostrati in rosso con il numero
  che li ha fatti fallire.
- **Chiusura garantita.** Il disegno è costruito dal sistema di misure: *anta + battute +
  coprifilo = ingombro*, sempre. Le quote della tavola sono misurate sulla geometria finale.

## Il modello parametrico "porta a battente"

17 parametri, tutti modificabili dal pannello: anta, battute, coprifilo, asse maniglia,
backset, rosetta, bocchetta, lunghezza maniglia, numero di cerniere, lato serratura, spessore.
Cambi un valore e il disegno si rigenera in modo coerente.

## Sviluppo locale

```bash
python3 -m http.server 8080 --bind 0.0.0.0
# poi apri http://localhost:8080
```

## Struttura del codice

| File | Ruolo |
|---|---|
| `precision.js` | Analisi deterministica della foto: contorno, linee sub-pixel, simmetria, ferramenta, cerchi, QA |
| `models.js` | Modelli parametrici (porta, pannello): stima dalla foto, validazione, costruzione CAD |
| `sheet.js` | Tavola tecnica SVG in millimetri: quote, cartiglio, note, dettaglio |
| `studio.js` | Il wizard: caricamento, analisi, pannello misure, esportazioni |
| `studio.css` | Interfaccia della nuova app |
| `app.js` · `export.js` · `trace.js` · `styles.css` | Il CAD 2D (Schizzo) e i suoi export DXF/STL/SVG |
| `esempi/` | Tavola (SVG + PNG), DXF e brief generati dalla foto della porta |

## Nota sui file già presenti

`porta.jpg` è la foto di prova usata dal flusso guidato. `porta-interna.schizzo` e i DXF di
esempio restano come materiale del CAD 2D.

---

### Test

La pipeline principale e il CAD rapido hanno test automatici in Node, senza dipendenze browser:

```bash
node --test tests/*.test.js
```

### Limiti di misura

Una singola vista non contiene informazioni sufficienti per ricostruire la profondità o correggere una prospettiva sconosciuta. Le quote dichiarate dall’utente sono vincoli; i dettagli dedotti dalla foto restano stime da verificare prima di fabbricare. L’immagine viene elaborata localmente nel browser.

Il workflow GitHub Pages pubblica il sito quando viene aggiornato `main` o il branch Arena della sessione, se Pages è già abilitato nel repository (Settings → Pages → Source: GitHub Actions).
