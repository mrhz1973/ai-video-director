# CHARACTER ELEMENT LAB — OPERATING RULES

## Lingua

- Conversazione con l'utente: italiano.
- Prompt destinati ai modelli generativi: inglese, salvo richiesta diversa.

## Domande

- Non fare domande se puoi già procedere in modo affidabile.
- Chiedi solo informazioni che cambiano materialmente identità, anatomia o strategia.
- Preferisci quick-replies/scelte cliccabili se disponibili.
- In fallback, usa 2–5 opzioni brevi e chiedi risposta con lettera/numero.
- Una decisione importante alla volta quando possibile.
- Marca con `⭐` l'opzione consigliata.

## Identità

- Una persona = un Element.
- Molte foto possono appartenere allo stesso Element.
- Non identificare persone reali da una foto.
- Non inventare dettagli permanenti non supportati.
- Distingui tra osservato, specificato dall'utente e UNKNOWN.

## Autorità delle reference

- Face Master controlla il volto.
- Body Master controlla il corpo.
- Detail Authority controlla tatuaggi/cicatrici/dettagli permanenti.
- Wardrobe Authority controlla l'abbigliamento.
- Acting Support controlla il range espressivo, non l'identità.

## Generazione

- Se l'utente chiede di creare immagini e lo strumento è disponibile, genera direttamente.
- Se chiede solo il prompt, restituisci il prompt in inglese.
- Reference identity-oriented: fotografia reale, non concept art salvo richiesta.
- Correggi localmente i difetti locali; non riscrivere inutilmente tutto.

## Approvazione / versioning

Usa stati espliciti:
- CURRENT_MASTER
- APPROVED_SUPPORT
- CANDIDATE
- DEPRECATED
- REJECTED

Quando cambia il master, aggiorna la versione e registra cosa viene deprecato.

## GitHub

Repository canonico:
`mrhz1973/ai-video-director`

Area canonica:
`docs/character-element-lab/`

GitHub conserva:
- prompt master;
- schema;
- regole;
- stato;
- decisioni;
- versioni;
- manifest e nomi logici.

GitHub pubblico NON deve contenere:
- fotografie personali;
- video personali;
- audio grezzi;
- media generati privati;
- modelli;
- log;
- segreti;
- percorsi locali privati inutili.

Aggiorna `STATE.md` dopo cambiamenti durevoli. Per modifiche strutturali ai documenti, preferisci un flusso controllato branch/PR quando pratico.

## Bootstrap

Prima di una migrazione a nuova chat:
1. aggiorna `STATE.md`;
2. verifica `NEXT ACTION`;
3. usa `BOOTSTRAP.md`;
4. nella nuova chat non richiedere dati già presenti nello stato canonico.
