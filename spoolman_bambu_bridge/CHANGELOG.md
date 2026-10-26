# Wijzigingen

## 0.2.1
- Statuscontrole van de Spoolman-verbinding (`GET /api/spoolman`) in de interface.

## 0.2.0
- Herbouwd als zelfstandige Node.js-app (geen npm-afhankelijkheden); de lokale 0.1.0-broncode was niet beschikbaar.
- Synchronisatie Spoolman → Bambu Filament Manager (resterend gewicht, hele grammen).
- Handmatige koppeling, suggesties (nooit automatisch), aanmaken van Bambu-rol met herkenningsmarkering `[spoolman:ID]`.
- Pauzeren bij ontbrekende/gearchiveerde rol of onbekend gewicht.
- G-code-analyse (`/api/estimate`): voorstel voor verbruik, boekt nooit zelf af.
- Automatische synchronisatie staat standaard uit.
