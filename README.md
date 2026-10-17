# DCA optimisé

Petite application web, consultable sur téléphone, qui indique **le montant à investir ce mois-ci**.
Ce montant dépend du *drawdown* (DD) du **MSCI World**, niveau Price, en USD : l'écart entre la clôture de
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
config.json                  indice, pic antérieur, paliers, jour par défaut (le SEUL fichier à modifier)
index.html, app.js           écran principal
lien.html, lien.js           générateur de lien + QR code
style.css, sw.js, manifest.webmanifest, icons/   présentation, PWA
lib/model.js                 règles métier (DD, paliers, jour J, mise à l'échelle), partagées site/job/tests
lib/parse.js, lib/format.js  lecture des CSV, affichage suisse (1'500 CHF)
lib/prefs.js                 budget/prénom/jour (lien ou mémoire du navigateur)
scripts/update-data.mjs      job de mise à jour
scripts/sources.mjs          source en ligne (Yahoo Finance)
scripts/import-history.mjs   création de l'historique depuis un CSV investing.com
scripts/serve.mjs            serveur local de test (npm run serve)
data/state.json              état publié (série journalière complète, lue par la page)
data/history/msciworld.csv   clôtures journalières de référence (date,close)
data/manual/                 plan B : CSV déposé à la main
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
- **Indice** : `activeIndex`. Le seul indice actif en V1 est `msciworld` (MSCI World Price USD, code MSCI 990100).

**Pic antérieur (`priorPeak`)** : l'historique commence le 09/07/2012. La plus haute clôture antérieure
(1 682,351441 le 31/10/2007, vérifiée sur msci.com) est donc injectée dans le calcul du pic.

**Passer à un autre indice (par exemple MSCI ACWI, code 892400) :**
1. Recalibre les paliers avec le script de calibration (livré en fin de projet).
2. Télécharge l'historique journalier **Price** (pas Net ni Gross) depuis investing.com.
3. Dans `config.json`, mets `activeIndex: "acwi"`, les nouveaux paliers et, si l'historique commence tard,
   le `priorPeak`.
4. Lance `node scripts/import-history.mjs <fichier.csv>`, puis pousse le tout.

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

**Plan B**
1. Télécharge le CSV journalier sur investing.com (*MSCI World → Historical Data → Daily → Download*).
2. Dépose-le tel quel sous `data/manual/msciworld.csv` (voir `data/manual/LISEZMOI.md`).
3. Pousse-le, puis relance le workflow.

**Garde-fous du job**
- Il compare la source aux jours déjà enregistrés et refuse tout écart de plus de 0,5 %.
- Il refuse une variation de plus de 15 % en un jour, et un trou de plus de 7 jours.
- Il ignore les week-ends et ne réécrit jamais l'historique.

**Les sources et leurs limites**

| Source | Rôle | Limites |
|---|---|---|
| investing.com, fichier « MSCI World Historical Data » | Historique de référence depuis le 09/07/2012 | Téléchargement manuel. Contient quelques lignes datées d'un dimanche, qui ne sont pas des clôtures MSCI : elles sont écartées, sans effet sur les tests. |
| Yahoo Finance, ticker `^990100-USD-STRD` | Nouveaux jours | API **non officielle**, sans clé : elle peut changer ou bloquer sans préavis. Valeurs arrondies au dixième, égales à msci.com à ~0,001 % près (vérifié en octobre 2026). L'historique ancien de Yahoo est faux par endroits, d'où son usage limité aux nouveaux jours. |
| msci.com | **Non utilisé par le job** | Les conditions d'utilisation (révisées le 15/07/2026) interdisent l'extraction automatisée (API comprises) et la redistribution. Le site répond aussi par un reCAPTCHA. Utilisable seulement à la main, pour vérifier une valeur. |

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

1. **Méthode journalière** sur le fichier investing, jour 25, de 08/2012 à 10/2026, pic injecté 1 682,351441 :
   171 mois, **965,0 CHF**, 57,9 / 15,8 / 21,6 / 4,7 / 0,0 %. Plus haute clôture : 5 034,04 le 13/08/2026.
2. **Mensuel M−1**, MSCI World de 02/1997 à 09/2026 : ≈ 1 366 CHF. Le test est sauté tant que
   `data/historique/MSCI_World_Price_mensuel_1997-2026.csv` n'est pas déposé. Vérifié à part sur les
   données msci.com : 1 366,15 CHF, fréquences identiques.
3. **S&P 500**, de 02/1970 à 12/2024 : 1 207,94 CHF. Le seul écart avec la référence (≈ 1 207) vient de
   11/1979, à exactement −10,00 %, classé dans le palier 1 500 selon la règle exacte.
4. **Bornes, mise à l'échelle, jour J** (31 février, week-end, J = 1), estimation ou montant figé, fraîcheur des données.
5. **Lecture des formats** français, suisse et anglais (investing.com), et **affichage** suisse.

Le palier est choisi sur le DD exact. Le DD affiché est **tronqué** à 2 décimales : −9,996 % s'affiche
« −9,99 % » et reste dans le palier > −10 %.

---

*Information à titre indicatif, pas un conseil en investissement personnalisé. Les performances passées
ne préjugent pas des performances futures.*
