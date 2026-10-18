# DCA optimisé

Petite application web, consultable sur téléphone, qui indique **le montant à investir ce mois-ci**.
Ce montant dépend du *drawdown* (DD) du **MSCI ACWI IMI** (code 664204), niveau Price, en USD : l'écart entre la clôture de
la veille du jour d'investissement et la plus haute clôture journalière jamais atteinte.

- Site statique sur GitHub Pages, sans serveur, sans base de données, sans compte.
- Une GitHub Action ajoute chaque jour de bourse la dernière clôture et publie `data/state.json`.
- Chaque personne a un lien avec son budget, son prénom et son jour : `?b=800&n=Paul&j=25`.

**Règle de calcul**
- `DD = clôture(J−1) / max(toutes les clôtures journalières jusqu'à J−1 inclus) − 1`.
- J−1 est le dernier jour de bourse **strictement avant** le jour d'investissement J (25 par défaut).
- Avant le jour J, l'app affiche une **estimation** (« si tu investissais aujourd'hui »). À partir du jour J,
  le montant du mois est **figé**.
- Montant = montant du palier × budget / 1 200, arrondi aux 10 CHF les plus proches.
- Seules les clôtures comptent, jamais les plus hauts ou plus bas intraday.

---

## Structure

```
config.json                  indice, paliers, jour par défaut (le SEUL fichier à modifier)
index.html, app.js           écran principal
lien.html, lien.js           générateur de lien + QR code
style.css, sw.js, manifest.webmanifest, icons/   présentation, PWA
lib/model.js                 règles métier (DD, paliers, jour J, mise à l'échelle), partagées site/job/tests
lib/parse.js, lib/format.js  lecture des CSV, affichage suisse (1'500 CHF)
lib/prefs.js                 budget/prénom/jour (lien ou mémoire du navigateur)
scripts/update-data.mjs      job de mise à jour
scripts/sources.mjs          source en ligne (Yahoo Finance, 5 derniers jours)
scripts/xlsx.mjs             lecture de l'export .xlsx de msci.com (sans dépendance)
scripts/import-history.mjs   création de l'historique depuis l'export msci.com
scripts/serve.mjs            serveur local de test (npm run serve)
data/state.json              état publié (série journalière complète, lue par la page)
data/history/acwiimi.csv     clôtures journalières de référence depuis le 01/01/1997 (date,close)
data/manual/                 plan B : export msci.com (.xlsx) déposé à la main
data/historique/             fichiers bruts ayant servi aux tests d'acceptation
tests/                       tests d'acceptation (npm test)
vendor/qrcode.js             qrcode-generator 1.4.4 (MIT, Kazuhiko Arase)
```

---

## 1. Changer les paliers ou l'indice

Tout se règle dans `config.json` :

- **Paliers** : la liste `tiers` de l'indice. Un palier s'applique si `DD > above`. Le dernier
  (`above: null`) couvre tout le reste. Une borne exacte tombe dans le palier suivant : −5,00 % → 940.
- **Budget de référence** : `nominalBudget` (1 200). **Arrondi** : `roundTo` (10). **Jour par défaut** : `defaultInvestDay` (25).
- **Encadré « Capacité à prévoir »** : bloc `capacity`.
- **Indice** : `activeIndex`. Indice actif : `acwiimi` (MSCI ACWI IMI Price USD, code MSCI 664204, ticker Yahoo `^664204-USD-STRD`).

L'historique msci.com commence le 01/01/1997 : le pic est calculé sur tout cet historique, sans pic injecté
(`priorPeak: null`). Ce paramètre ne sert que si un futur indice a un historique plus court.

**Passer à un autre indice :**
1. Recalibre les paliers avec le script de calibration (livré en fin de projet).
2. Télécharge sur msci.com l'export journalier *Full history, Daily, **Price**, USD* (.xlsx).
3. Ajoute un bloc dans `indices` de `config.json` (code MSCI, ticker Yahoo `^<code>-USD-STRD`, fichiers), puis mets-le dans `activeIndex`.
4. Lance `node scripts/import-history.mjs "export.xlsx"`, puis pousse le tout.

Les valeurs attendues des tests (`tests/model.test.mjs`) portent sur les paliers actuels. Ajuste-les si tu
modifies ces paliers.

## 2. Générer un lien pour quelqu'un

Ouvre `…/lien.html`, ou le lien « Créer un lien personnalisé » en bas de la page. Saisis le prénom, le
budget moyen et le jour d'investissement. Tu obtiens le lien, les boutons « Copier » et « Partager », et un QR code.

Le lien est mémorisé sur le téléphone de la personne : l'icône ajoutée à l'écran d'accueil garde ses
réglages. Sans lien, la page utilise 1 200 CHF et le 25, modifiables dans « Mon budget et mon jour
d'investissement ».

## 3. Relancer la mise à jour à la main

GitHub → onglet **Actions** → **Données et site** → **Run workflow**.
En local : `npm run update`, puis commit et push de `data/`.

Le job tourne du lundi au samedi à 06:30 et 12:30 UTC. Seuls les jours **terminés** sont ajoutés, jamais
la séance en cours.

## 4. Si la source de données casse

**Ce que tu verras**
- Le workflow devient rouge et GitHub t'envoie un e-mail.
- Si la dernière clôture a plus d'un jour ouvré de retard, la page affiche un bandeau rouge, par exemple
  « Données au 16/10/2026 — mise à jour en retard », et le montant est grisé.
- Si la clôture de la veille de ton jour d'investissement manque encore, un bandeau orange indique
  « montant provisoire ».

**Plan B** : dépose l'export msci.com (.xlsx, *Daily, Price, USD*) sous `data/manual/acwiimi.xlsx`, pousse-le,
puis relance le workflow. La marche à suivre est dans `data/manual/LISEZMOI.md`. Le job refuse un fichier
dont « Index Level » n'est pas « Price ».

**Garde-fous du job**
- Il compare Yahoo aux jours déjà enregistrés et refuse tout écart de plus de 0,5 %.
- Il vérifie la clôture déduite des barres horaires contre la clôture publiée par Yahoo.
- Il refuse une variation de plus de 15 % en un jour, et un trou de plus de 7 jours.
- Il ignore les week-ends et ne réécrit jamais l'historique.

**Les sources et leurs limites**

| Source | Rôle | Limites |
|---|---|---|
| msci.com, export *Full history, Daily, Price, USD* | Historique de référence depuis le 01/01/1997, et plan B | Téléchargement **manuel** uniquement. |
| Yahoo Finance, `^664204-USD-STRD` | Nouveaux jours | API **non officielle**, sans clé, qui peut changer sans préavis. **Pas d'historique** : seulement les 5 derniers jours, en barres horaires. La clôture du jour est la dernière barre avant 22:30 UTC, contrôlée contre la clôture publiée par Yahoo. Si le job ne tourne pas pendant plus de 4 jours de bourse, il faut le plan B. Valeur du 16/10/2026 : 2 813,72, identique à msci.com. |
| API msci.com | **Non utilisée par le job** | Les conditions d'utilisation (révisées le 15/07/2026) interdisent l'extraction automatisée (bots, agents d'IA, API comprises) et la redistribution. Le site répond aussi par un reCAPTCHA. |

⚠️ **Licence.** Les niveaux de l'indice appartiennent à MSCI, et `data/state.json` les publie pour que
chaque téléphone calcule son montant. C'est toléré pour un usage privé entre proches, mais ce n'est pas une
licence. La page est en « noindex » et n'a pas vocation à être diffusée largement.

## 5. Sauvegarder et restaurer son suivi

*Phase 2 (onglet « Mon suivi »), pas encore livrée.* Les données de suivi resteront dans le navigateur du
téléphone, avec un export/import JSON pour la sauvegarde et le changement d'appareil.

---

## Mise en ligne

Le dépôt est `michaelmet2000/dca-optimise`, publié par GitHub Pages
(*Settings → Pages → Source : GitHub Actions*). Pour tester en local : `npm run serve`, puis http://localhost:8080.

## Tests (`npm test`, Node 20 ou plus, sans dépendance)

1. **Méthode journalière**, ACWI IMI, jour 25, de 02/1997 à 10/2026 (357 mois) : **1 543,7 CHF**,
   38,9 / 14,0 / 20,2 / 12,6 / 14,3 %, plus les 5 points de contrôle (10/2008, 03/2009, 04/2020, 10/2022, 10/2026)
   et les repères 2 813,72 (16/10/2026), 2 903,74 (14/08/2026) et 1 060,07 (31/10/2007). Vérifie aussi les
   chiffres de l'encadré « Capacité à prévoir ».
2. **Mensuel M−1**, ACWI IMI, de 02/1997 à 09/2026 (356 mois) : **1 472,5 CHF**.
3. **S&P 500 mensuel M−1**, de 03/1970 à 12/2024 : 1 286,02 CHF (et 1 270,46 jusqu'à 01/2026). La référence
   du cahier des charges (1 284,4 et 1 268,9) classe 11/1979, à exactement −10,00 %, dans le palier 940, à cause
   d'un arrondi en virgule flottante. La règle exacte, validée, le met dans le palier 2 000. Le test vérifie
   que c'est la seule différence.
4. **Bornes, mise à l'échelle** (B = 600 et DD = −12 % → 1 000 CHF), **jour J** (31 février, week-end, J = 1),
   estimation ou montant figé, fraîcheur des données.
5. **Lecture des formats** français, suisse et anglais, de l'export .xlsx de msci.com (refus de Net et Gross),
   et **affichage** suisse.

Le palier est choisi sur le DD exact. Le DD affiché est **tronqué** à 2 décimales : −9,996 % s'affiche
« −9,99 % » et reste dans le palier > −10 %.

---

*Information à titre indicatif, pas un conseil en investissement personnalisé. Les performances passées
ne préjugent pas des performances futures.*
