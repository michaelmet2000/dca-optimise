# Plan B : CSV manuel

Si la source en ligne (Yahoo Finance) ne répond plus ou donne des valeurs refusées, dépose ici un fichier
nommé d'après l'indice actif : `msciworld.csv`.

Formats acceptés :

- l'export investing.com tel quel (*MSCI World → Historical Data → Daily → Download*) :
  `"Date","Price","Open","High","Low","Vol.","Change %"`, dates MM/JJ/AAAA, milliers « , » ;
- ou un fichier simple :

```
date,close
2026-10-19,4921.35
```

Seules les clôtures **journalières** comptent (colonnes Date et Price). Les dates de week-end sont ignorées.
Le job prend le CSV manuel en priorité pour les jours qui manquent dans `data/history/`. Il ne réécrit
jamais les jours déjà présents. Tu peux supprimer le fichier une fois la source en ligne revenue.
