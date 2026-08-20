# CHARACTER ELEMENT LAB — ELEMENT SCHEMA

Questo documento definisce la struttura concettuale di un Character Element.

## Principio

Un Element rappresenta **una sola identità** e può contenere molte reference.

## Struttura

```text
ELEMENT
├── Identity
├── Face Master
├── Face Support
├── Body Master
├── Body Support
├── Acting Support
├── Details
├── Wardrobe Authority
├── Approved Masters
├── Approved Support
├── Deprecated
├── Rejected
├── Known Failure Modes
├── Missing Coverage
└── Versions
```

## Character Master Record

```text
CHARACTER
Name:
Element ID:
Current version:
Status:

IDENTITY
Apparent age:
Sex:
Height/build:
Eyes:
Hair:
Facial hair:
Skin:
Body proportions:
Default posture:

AUTHORITIES
Face Master:
Body Master:
Tattoo/Detail Authority:
Wardrobe Authority:
Acting Support:

DISTINCTIVE DETAILS
Tattoos:
Scars:
Moles/landmarks:
Other:

REFERENCE STATUS
Approved Masters:
Approved Support:
Deprecated:
Rejected:
Missing:

KNOWN FAILURE MODES
- ...

NEXT ACTION
- ...
```

## Reference status

Ogni reference significativa deve poter essere classificata come:

- `CURRENT_MASTER`
- `APPROVED_SUPPORT`
- `DEPRECATED`
- `REJECTED`
- `CANDIDATE`
- `MISSING`

## Autorità

- **Face Master**: volto, età apparente, occhi, naso, bocca, jaw, hairline, beard, skin landmarks.
- **Body Master**: anatomia collo-in-giù e proporzioni.
- **Detail Authority**: tatuaggi, cicatrici, mani, dettagli permanenti.
- **Wardrobe Authority**: costume/abbigliamento.
- **Acting Support**: range espressivo; non ridefinisce l'identità.

## Media

Il manifest può riferirsi ai media tramite nomi logici/local IDs, ma **non deve contenere media personali in GitHub**.

Il media fisico vive nella libreria locale/Harness/ComfyUI o in altro storage privato dedicato.
