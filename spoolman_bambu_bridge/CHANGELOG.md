# Wijzigingen

## 0.10.0
- Originele Bambu-rollen (met RFID-chip): Bambu is leidend. Bambu rekent het verbruik van zijn eigen rollen zelf uit, dus voor die rollen loopt het gewicht van Bambu's Filament Manager naar Spoolman. De bridge koppelt zo'n rol via het serienummer (Spoolman `tag` = Bambu `RFID`) aan Bambu's eigen regel en zet het resterende gewicht in Spoolman (gebruikt = volle rol min Bambu-gewicht). Er gaat niets van die rollen naar Bambu en Bambu's eigen regel wordt nooit verwijderd.
- Een eerder door de bridge gemaakte dubbele handmatige regel (notitie `[spoolman:ID]`) van zo'n rol wordt verwijderd zodra de eigen Bambu-regel is gevonden. Voor rollen met chip maakt de bridge geen handmatige Bambu-regel meer aan.
- Rollen zonder chip (Sunlu e.d.) blijven Spoolman-leidend (Spoolman naar Bambu), ook van het merk Bambu Lab.
- Let op: SpoolmanSync blijft verbruik in Spoolman afboeken; bij elke sync wordt dat voor chip-rollen weer gelijkgetrokken met Bambu. Even na een print kan Spoolman daardoor kort afwijken tot Bambu zijn gewicht bijwerkt.

## 0.9.2
- Fix gewicht bij rol toevoegen: het ingevulde gewicht is wat de rol nu weegt. In Spoolman komt de volle rol (standaard 1000 g, instelbaar) in "Weight", het verschil in "gebruikt" en de lege spoel op 0 g. Eerder kwam het huidige gewicht in "Weight" en stond het verbruik op 0, waardoor percentages niet klopten. De rolscanner heeft daarvoor een veld "Volle rol (g)".
- Bambu krijgt ook het totaalgewicht van de rol (`totalNetWeight`) mee, zodat het percentage in Bambu klopt. Wordt het veld door Bambu genegeerd of geweigerd, dan blijft het resterende gewicht gewoon synchroniseren en wordt het totaal niet elke ronde opnieuw geprobeerd.

## 0.9.1
- Dezelfde netwerkingang luistert ook op poort 8101 (container). Zet die in Home Assistant (Netwerk) op host-poort 3005, nadat SpoolmanSync naar een andere poort is verplaatst, dan openen al geprinte QR-labels met `:3005` meteen de wacht-op-rol-pagina. Poort 8100 blijft werken.

## 0.9.0
- Koppelen aan een tray in de goede volgorde: scan het QR-label, kies de tray en doe daarna pas de rol in de printer. De bridge koppelt de rol in SpoolmanSync pas als de printer de rol 8 seconden onafgebroken in die tray ziet. Een oude rol die er nog in zat telt niet mee (de tray moet eerst leeg zijn geweest). Wachtende koppelingen verlopen na een uur, overleven een herstart en zijn te annuleren in de bridge (onderdeel "Wacht op tray").
- Nieuwe pagina `/scan/spool/<id>` op poort 8100, zonder token (je telefoon heeft er geen). Alleen: een bestaande rol aan een bestaande tray laten koppelen of dat annuleren. Niets aanmaken of verwijderen; 240 verzoeken per minuut per apparaat.
- Nieuwe sensor `sensor.spoolman_tray_koppelingen` met de rollen die op een tray wachten.
- Let op: gebruikt de SpoolmanSync-URL uit de instellingen (die moet dus ingevuld zijn) en het eigen toewijzen van SpoolmanSync.

## 0.8.1
- Een automatisch toegevoegde Bambu-rol wordt door de bridge zelf aan zijn AMS-vak gekoppeld (`extra.active_tray` in Spoolman, met het unique_id uit het entiteitenregister van Home Assistant). SpoolmanSync deed dat alleen op het moment van plaatsen. Alleen als de rol nog niet in een vak staat en het vak vrij is.

## 0.8.0
- Originele Bambu-rollen met RFID worden automatisch in Spoolman gezet. Elke minuut leest de bridge de AMS-vakken uit Home Assistant (sensoren met `tray_uuid` en `tag_uid`); staat het RFID-nummer nog niet in `extra.tag` van een rol, dan maakt de bridge de rol aan (leverancier Bambu Lab, filament uit naam, materiaal en kleur van het vak, gewicht en verbruikt gewicht uit `tray_weight` en `remain`). SpoolmanSync herkent de rol daarna aan het RFID-nummer. Rollen zonder chip (Sunlu e.d.) worden genegeerd, gearchiveerde rollen tellen mee als bestaand. Instelling `rfidAutoAdd` (standaard aan); het extra veld `tag` wordt zo nodig in Spoolman aangemaakt.

## 0.7.0
- Vaste rol-typen voor de rolscanner (SUNLU PLA C190, C210, C220 en PETG Basic), elk vast gekoppeld aan jouw eigen Bambu-profiel (`filament_id` uit je account). Een rol die met een type wordt toegevoegd, krijgt in Bambu precies dat profiel. Typen en locaties zijn instelbaar (`rolTypes`, `locations` in de instellingen).
- Locatie (bijv. Vincent of Ine) wordt bij het toevoegen in Spoolman op de rol gezet (veld "Locatie") en niet naar Bambu gestuurd.
- Verkenning van je eigen filamentprofielen: `GET /api/bambu/slicer-probe` (alleen lezen).

## 0.6.1
- Zie 0.6.0; profielen van bestaande rollen gaan voor, de terugval op één profiel per merk is verwijderd, en een niet bereikbare bibliotheek laat de profielen van bestaande rollen intact.

## 0.6.0
- Nieuwe Bambu-rollen krijgen het bijpassende profiel (het "Type" in Handy en Studio, `filamentId`), gezocht op merk, materiaal en productnaam. Bron: eerst de profielen van je bestaande rollen in Bambu (daar staan ook profielen die niet in de openbare bibliotheek zitten, zoals SUNLU PLA C210/C220), daarna Bambu's openbare bibliotheek (vraagt een Bambu-inlog). Geen eenduidige match: het type blijft leeg en dat staat in de activiteit; er wordt nooit gegokt. `GET /api/bambu/profiles` toont de bibliotheek.
- Rolscanner: knoppen voor nozzletemperatuur 190, 210 en 220.

## 0.5.0
- Rol snel toevoegen vanaf de pc-app (map `rolscanner/`): extra poort 8100 met token, alleen `POST /api/quick-add` en `GET /api/quick-add/catalog`. Zoekt of maakt leverancier en filament in Spoolman (met nozzle- en bedtemperatuur) en maakt de rol aan. Token aanmaken in de bridge-interface; alleen de hash wordt bewaard.
- Fix: het invoerveld voor de SpoolmanSync-URL had dezelfde id als de knop "Nu synchroniseren" (0.4.0), waardoor die knop niet werkte.

## 0.4.0
- Printgeschiedenis: leest de afboekingen (`spool_usage`) uit SpoolmanSync, groepeert afboekingen binnen 15 minuten tot één print en publiceert `sensor.printgeschiedenis` (laatste 15 prints met gram per rol). Printnaam, status en voortgang komen uit de officiële Bambu-integratie en worden alleen bij verse afboekingen vastgelegd. Instellingen: SpoolmanSync-URL en printer-prefix.

## 0.3.0
- Publiceert de voorraad als sensoren in Home Assistant: `sensor.spoolman_rol_<id>`, `sensor.spoolman_voorraad` (totaal en lijst met rollen) en `sensor.spoolman_bridge_status`. Vereist `homeassistant_api`. Instelling: grens voor lage voorraad (standaard 100 g).

## 0.2.6
- Aangemaakte Bambu-rol: geen dubbel materiaal in de naam ("PLA PLA ...") en kleur als `#RRGGBBFF`.

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
