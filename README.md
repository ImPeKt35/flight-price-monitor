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

Le robot actif tourne dans un Worker Cloudflare et ne dépend donc pas du Mac.
Les clés Skyscanner et Discord sont enregistrées comme secrets chiffrés dans
Cloudflare et ne figurent pas dans le dépôt.

Un bilan Discord est envoyé au plus tôt une fois par heure. Il confirme que la
surveillance s'exécute, nomme explicitement la source et indique le meilleur
prix réellement lu pendant les 60 dernières minutes.

Le dossier `cloudflare/` contient le minuteur actif. Son cron fonctionne à la
minute 5 de chaque heure, Mac éteint. Le workflow GitHub reste disponible pour
un lancement manuel, mais sa planification a été désactivée afin d'éviter les
doubles messages et les anciens prix Google.

Si la source Skyscanner refuse temporairement une recherche, Cloudflare envoie
un avertissement puis réessaie automatiquement à l'heure suivante.

## Lancer localement sans envoyer de message

```bash
npm ci
npx playwright install chromium
npm run check:dry
```
