# Surveillance complète des vols Asie

Ce robot relance toute la recherche multi-destination une fois par heure. Avec
le secret `OMKAR_API_KEY`, il lit directement les résultats Skyscanner et n'est
associé à aucun vol ni à aucune compagnie en particulier : une nouvelle
combinaison ou une nouvelle compagnie est donc examinée automatiquement.
Sans cette clé, Google Flights reste disponible comme source de secours.

## Critères

- Aller : Paris (tous les aéroports) → Hong Kong, 28 décembre 2026
- Retour : Bangkok (tous les aéroports) → Paris, 14 janvier 2027
- 1 adulte, classe économique
- Prix total inférieur ou égal à 650 €
- Durée moyenne des deux vols inférieure ou égale à 20 h

La source Skyscanner permet de retrouver des prix plus proches du site que
Google Flights. L'API ne fournit toutefois pas l'information de bagage : toute
alerte comporte donc un avertissement et un lien Skyscanner avec le filtre
bagage pour la vérification finale.

Le robot tourne dans GitHub Actions et ne dépend donc pas du Mac. Le webhook
Discord est stocké exclusivement dans le secret GitHub
`DISCORD_WEBHOOK_URL`.

Un bilan Discord est envoyé au plus tôt une fois par heure. Il confirme que la
surveillance s'exécute, nomme explicitement la source et indique le meilleur
prix réellement lu pendant les 60 dernières minutes.

Le dossier `cloudflare/` contient la version recommandée du minuteur. Son cron
Cloudflare est indépendant de GitHub et fonctionne à la minute 5 de chaque
heure, Mac éteint. GitHub Actions reste un secours mais ses horaires gratuits
peuvent être retardés ou omis.

Si Google refuse temporairement une recherche, le workflow recommence depuis
un second runner GitHub, avec une autre session réseau. Le premier échec reste
silencieux ; un avertissement Discord n'est envoyé que si les deux essais
indépendants échouent.

## Lancer localement sans envoyer de message

```bash
npm ci
npx playwright install chromium
npm run check:dry
```
