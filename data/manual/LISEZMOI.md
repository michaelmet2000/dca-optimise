# Plan B : fichier déposé à la main

Si la source en ligne (Yahoo Finance) ne répond plus, si elle donne des valeurs refusées, ou si le job n'a pas
tourné pendant plus de 4 jours de bourse (Yahoo ne garde que 5 jours), dépose ici l'export de msci.com :

1. Sur msci.com, ouvre la page de l'indice **MSCI ACWI IMI** (code 664204) → *Performance*.
2. Choisis *Full history*, *Daily*, **Price** (pas Net, pas Gross), *USD*, puis télécharge.
3. Renomme le fichier `acwiimi.xlsx` et place-le dans ce dossier (`data/manual/acwiimi.xlsx`).
4. Pousse-le sur GitHub, puis relance le workflow (*Actions → Données et site → Run workflow*).

Le job vérifie la ligne « Index Level » : un fichier **Net** ou **Gross** est refusé. Seuls les jours
manquants de l'historique sont ajoutés ; les jours déjà présents ne sont jamais réécrits.

Un CSV simple est aussi accepté sous le nom `acwiimi.csv` :

```
date,close
2026-10-19,2821.35
```

Tu peux supprimer le fichier une fois la source en ligne revenue.
