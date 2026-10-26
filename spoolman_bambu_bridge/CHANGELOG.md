# Wijzigingen

## 0.2.5
- Instelling: nieuwe Spoolman-rollen automatisch in Bambu aanmaken (standaard uit; max. 5 per ronde, rollen zonder of met 0 g worden overgeslagen).

## 0.2.4
- Een verwijderde Spoolman-rol verwijdert ook de gekoppelde Bambu-rol (alleen rollen die de bridge zelf had gekoppeld). Mislukt dat, dan blijft de koppeling staan en volgt een nieuwe poging. Bij een lege Spoolman-lijst gebeurt niets.

## 0.2.3
- Een verwijderde Spoolman-rol heft de koppeling automatisch op (Bambu-rol blijft staan). Bij een lege Spoolman-lijst wordt alleen gepauzeerd. Gearchiveerde rollen blijven pauzeren.

## 0.2.2
- Ingress-adres zonder dubbele slash (`ingress_entry` verwijderd) en paneel in de zijbalk.

## 0.2.1
- Statuscontrole van de Spoolman-verbinding (`GET /api/spoolman`) in de interface.

## 0.2.0
- Herbouwd als zelfstandige Node.js-app (geen npm-afhankelijkheden); de lokale 0.1.0-broncode was niet beschikbaar.
- Synchronisatie Spoolman → Bambu Filament Manager (resterend gewicht, hele grammen).
- Handmatige koppeling, suggesties (nooit automatisch), aanmaken van Bambu-rol met herkenningsmarkering `[spoolman:ID]`.
- Pauzeren bij ontbrekende/gearchiveerde rol of onbekend gewicht.
- G-code-analyse (`/api/estimate`): voorstel voor verbruik, boekt nooit zelf af.
- Automatische synchronisatie staat standaard uit.
