# EB Outlook — moteur trimestriel

Ce moteur calcule l'Investment Outlook d'Economic Bearings et publie `eb-outlook.json`, que le composant Framer **EB Outlook** affiche.
Tout est gratuit : GitHub Actions pour le calcul, GitHub Pages pour l'hébergement, et des données publiques sans clé API (Yahoo Finance, FRED, GDELT).

## Mise en route (une seule fois, environ 10 minutes)

1. Sur GitHub, créez un nouveau dépôt **public** nommé `eb-outlook`. En public, les minutes d'Actions sont illimitées.
2. Envoyez tous les fichiers de ce dossier, y compris le dossier caché `.github/workflows/`.
   Le plus simple : *Add file → Upload files*, puis glissez le contenu du dossier.
3. **Settings → Actions → General → Workflow permissions** : cochez *Read and write permissions*, puis Save.
4. **Settings → Pages** : Source *Deploy from a branch*, branche `main`, dossier `/docs`, puis Save.
5. **Actions → EB Outlook → Run workflow**. Le premier calcul crée l'outlook **Q4 2026**, arrêté à la clôture du 30 septembre 2026. Il prend environ 10 minutes, car GDELT demande une pause entre chaque requête.
6. Votre lien de données est alors :
   `https://VOTRE-NOM.github.io/eb-outlook/eb-outlook.json`
7. Dans Framer : *Assets → Code → New file*, nommez-le `EBOutlook`, collez le contenu de `EBOutlook.tsx`, glissez le composant sur la page et collez le lien dans **Data URL**.

## Le calendrier automatique

| Quand | Ce qui se passe |
|---|---|
| 1er janv., 1er avril, 1er juil., 1er oct. (00:30 UTC) | Nouvel outlook. Les thèmes sont notés et les 5 meilleurs sont **figés** pour le trimestre. Le trimestre précédent est clôturé dans le Track Record. |
| Chaque lundi (12:00 UTC, soit 7 h à New York en hiver) | Mise à jour de la performance des 5 thèmes, du graphique et du régime de marché. Le classement ne change pas. |

En cas de problème, *Actions → EB Outlook → Run workflow* relance le calcul à la main. Cochez **rebuild** pour recalculer entièrement le trimestre en cours.
Si une source de données échoue, le fichier déjà publié n'est pas modifié.

## Ajouter un thème (mode, aérospatial, etc.)

Ouvrez `themes.json`, copiez un bloc et modifiez :

```json
{ "id": "shipping", "name": "Shipping", "category": "Industry", "icon": "truck",
  "proxies": [{ "t": "BOAT", "n": "SonicShares Global Shipping ETF" }] }
```

- **proxies** : les ETF ou actions qui mesurent le thème, avec leur symbole Yahoo Finance (`MC.PA`, `SIE.DE`, `9983.T`…). Les cotations hors dollar sont converties automatiquement.
- Un thème doit avoir au moins **13 mois d'historique** pour être noté.
- **news** (facultatif) : la requête de recherche GDELT, par exemple `"(luxury OR watchmaker)"`. Sans ce champ, elle est construite à partir du nom.
- **icon** : choisir parmi `ai chip lock cloud quantum robot rocket game card atom sun flame gem battery coin drop plug shield bridge bolt car truck house cross dna pill pulse key plane fork watch shirt cart basket leaf bank umbrella building`. Une icône inconnue est remplacée par les initiales.

Le thème est pris en compte au prochain trimestre, ou tout de suite avec *Run workflow* + *rebuild*.

## La méthode EB Outlook

Chaque thème est un panier équipondéré de ses proxies, en dollars. Il reçoit une note de 0 à 100 sur chaque pilier, **par comparaison avec les autres thèmes** :

| Pilier | Poids | Calcul |
|---|---|---|
| Momentum | 30 % | Performance sur 12 mois et sur 6 mois, sans le dernier mois |
| Trend | 20 % | Prix par rapport à la moyenne 200 jours, et pente de cette moyenne |
| Strength | 15 % | Performance sur 3 mois moins celle de l'indice mondial (ACWI) |
| Risk | 15 % | Volatilité annuelle et pire baisse sur 12 mois : plus elles sont faibles, plus la note est haute |
| News | 10 % | Tonalité de la presse mondiale (GDELT) sur 30 jours, et son évolution par rapport aux 60 jours précédents |
| Macro | 10 % | Réaction passée du thème (sur 2 ans, par rapport au monde) aux taux 10 ans, au pétrole, au dollar et aux spreads de crédit, multipliée par l'évolution de ces facteurs sur les 13 dernières semaines |

**Règle de diversification :** si un thème a évolué presque comme un thème mieux classé (corrélation hebdomadaire sur un an supérieure à 0,85), il est écarté du Top 5. Il reste visible dans *All Themes* avec la mention « Moves with … ».

**Niveau de risque affiché :** Low si la volatilité est sous 18 % par an, Medium jusqu'à 28 %, High au-delà.

Les poids se règlent dans `engine.py` (liste `PILLARS`).

## Limites à connaître

- **News :** l'API gratuite de GDELT ne couvre que les 3 derniers mois environ. Pour le premier calcul (Q4 2026, arrêté au 30 septembre), une partie de la période peut manquer. Si moins de la moitié des thèmes ont des données, le pilier News est désactivé pour ce trimestre et les autres poids sont recalculés automatiquement. Le composant affiche alors les vrais poids. À partir de Q1 2027, le calcul se fait le jour même et ce problème disparaît.
- **yfinance** est une bibliothèque non officielle. Si Yahoo modifie son site, il peut suffire de mettre à jour la version dans `requirements.txt`.
- Il s'agit de contenu éducatif, pas de conseil en investissement. Le disclaimer est intégré au composant (*Method & disclaimer*).

## Test hors ligne

```bash
pip install -r requirements.txt
EBO_SYNTHETIC=1 python engine.py   # données aléatoires, sans internet
```

Pensez ensuite à supprimer `state/*.json` et `docs/eb-outlook.json` générés par le test.
