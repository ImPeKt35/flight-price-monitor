# Surveillance complète des vols Asie

Ce robot relance toute la recherche multi-destination Google Flights toutes les
15 minutes. Il n'est associé à aucun vol ni à aucune compagnie en particulier :
une nouvelle combinaison ou une nouvelle compagnie est donc examinée
automatiquement.

## Critères

- Aller : Paris (tous les aéroports) → Hong Kong, 28 décembre 2026
- Retour : Bangkok (tous les aéroports) → Paris, 14 janvier 2027
- 1 adulte, classe économique
- Prix total inférieur ou égal à 650 €
- Durée moyenne des deux vols inférieure ou égale à 20 h

Google Flights sert à détecter l'ensemble du marché et les nouvelles
compagnies. Sur une recherche multi-destination, il ne permet pas de certifier
automatiquement le bagage en soute. Toute alerte comporte donc un avertissement
et deux liens directs vers Skyscanner (filtre bagage déjà appliqué) et KAYAK
pour la vérification finale. Cela privilégie le fait de ne pas manquer une
nouvelle offre à moins de 650 €.

Le robot tourne dans GitHub Actions et ne dépend donc pas du Mac. Le webhook
Discord est stocké exclusivement dans le secret GitHub
`DISCORD_WEBHOOK_URL`.

Un bilan Discord est envoyé au plus tôt une fois par heure. Il confirme que la
surveillance s'exécute et indique le meilleur prix réellement lu pendant les
60 dernières minutes, ainsi que le nombre de contrôles réussis. GitHub peut
retarder une exécution planifiée ; dans ce cas, le bilan part au prochain
passage disponible.

## Lancer localement sans envoyer de message

```bash
npm ci
npx playwright install chromium
npm run check:dry
```
