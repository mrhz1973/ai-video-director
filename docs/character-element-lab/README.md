# Character Element Lab

Sistema dedicato alla costruzione e manutenzione di **Character Elements** riutilizzabili per AI image/video generation.

## Scopo

Trasformare fotografie e/o descrizioni in un asset di identità versionato, con gerarchia chiara tra Face Master, Body Master, Acting Support, Details e altre reference.

## File

- `MASTER_PROMPT_IT.md` — istruzioni complete della chat dedicata.
- `OPERATING_RULES.md` — regole operative compatte.
- `ELEMENT_SCHEMA.md` — struttura standard di un Character Element.
- `STATE.md` — stato canonico vivo del lavoro corrente.
- `BOOTSTRAP.md` — procedura per riprendere il lavoro in una nuova chat.

## Modalità di ingresso

Il Lab può partire da:

1. molte fotografie della stessa persona;
2. una singola fotografia;
3. fotografie + descrizione;
4. sola descrizione per un personaggio originale.

## Principio operativo

- Se può lavorare, lavora subito.
- Se manca una decisione materiale, propone una scelta multipla breve.
- Conversazione in italiano.
- Prompt generativi in inglese.
- Un Element può contenere molte reference.
- GitHub conserva stato e metadata, non media personali.

## Bootstrap

In una nuova chat usare il messaggio breve presente in `BOOTSTRAP.md` e leggere i documenti canonici prima di continuare.
