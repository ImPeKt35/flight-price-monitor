# Minuteur horaire Cloudflare

Ce Worker exécute une recherche multi-destination Skyscanner à la minute 5 de
chaque heure, même lorsque le Mac est éteint. Il utilise environ 744 appels par
mois, sous le quota gratuit de 1 000 appels/mois du fournisseur Skyscanner.

Deux secrets sont nécessaires :

- `OMKAR_API_KEY` : clé gratuite du service Skyscanner Scraper ;
- `DISCORD_WEBHOOK_URL` : webhook du canal Discord.

Ils doivent être ajoutés avec `wrangler secret put` et ne doivent jamais être
écrits dans Git.
