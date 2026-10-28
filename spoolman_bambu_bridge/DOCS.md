# Spoolman Bambu Bridge

Leest de rollenvoorraad uit Spoolman en zet de resterende grammen in Bambu's eigen Filament Manager.
De bridge boekt **geen** printverbruik af; dat doet SpoolmanSync. Hij leest geen printer-G-code en bedient de printer niet.

## Installeren
1. Kopieer de map `spoolman_bambu_bridge` naar `/addons/spoolman_bambu_bridge` op de Home Assistant-host (Samba- of SSH-add-on).
2. Instellingen → Add-ons → Add-on store → ⋮ → Opnieuw laden. Onder *Lokale add-ons* verschijnt de bridge; installeer en start hem.
3. Open "Bambu Bridge" in de zijbalk.
4. Vul de Spoolman-URL in. De Spoolman-Ingress-add-on heeft geen eigen externe poort; gebruik `http://2c829f0e-spoolman-ingress:7912` (getest, werkt vanuit de bridge). Lukt dat niet, installeer dan de niet-Ingress-variant van Spoolman of open de poort.
5. Log in bij Bambu (met verificatiecode indien gevraagd). Het wachtwoord wordt niet opgeslagen, alleen het token.
6. "Rollen laden", koppel één rol, klik "Nu synchroniseren". Zet pas daarna automatisch synchroniseren aan.

## Werking
- Spoolman is leidend. Per ronde: doelgewicht = Spoolman-resterend, afgerond op hele grammen; alleen schrijven als Bambu afwijkt.
- Rollen met onbekend gewicht of een gearchiveerde bronrol worden zichtbaar gepauzeerd (nooit 0 g). Verwijder je een rol in Spoolman, dan verwijdert de bridge ook de gekoppelde Bambu-rol en vervalt de koppeling (alleen rollen die de bridge zelf koppelde; niet terug te draaien). Is de hele Spoolman-lijst leeg, dan wordt er niets ontkoppeld maar gepauzeerd.
- Handmatig ontkoppelen verwijdert geen rol. Een ronde draait nooit dubbel; mislukte updates gaan de volgende ronde opnieuw met de nieuwste stand.
- Een aangemaakte Bambu-rol krijgt `[spoolman:ID]` in de notitie. Na een onzekere netwerkreactie wordt daarop gezocht in plaats van opnieuw aan te maken.

- Optioneel (instelling): een nieuwe Spoolman-rol met bekend gewicht wordt automatisch in Bambu aangemaakt en gekoppeld. Bestaat dezelfde rol al los in Bambu, dan ontstaat er een tweede; koppel die dan handmatig vóór je de rol in Spoolman toevoegt.

## Back-up en herstel
- Gegevens staan in `/data/state.json` en zitten in de normale Home Assistant-back-up van de add-on.
- Update: vervang de map, laad de store opnieuw, werk de add-on bij; `/data` blijft behouden.
- Herstel: back-up terugzetten, add-on starten. Controleer na een nieuwe Spoolman-database of -account de koppelingen vóór je automatisch synchroniseren aanzet (ontbrekende rollen worden gepauzeerd).

## Sensoren in Home Assistant
Elke ronde publiceert de bridge: `sensor.spoolman_rol_<id>` (resterende grammen met merk, materiaal, kleur, tray, sync-status), `sensor.spoolman_voorraad` (totaal, aantal lage rollen, lijst `rollen`) en `sensor.spoolman_bridge_status` (ok / pauze / fout / niet_ingelogd). Het zijn alleen-lezen sensoren zonder registratie; na een herstart van Home Assistant verschijnen ze bij de volgende ronde weer (maximaal één interval). Bij een Spoolman-storing worden alleen de status bijgewerkt en geen rolsensoren verwijderd.

## Printgeschiedenis
Vul in de bridge de SpoolmanSync-URL (bijv. `http://172.30.32.1:3005`) en de printer-prefix (bijv. `x2d_20p9bj620700578`) in. De bridge leest dan elke ronde de afboekingen van SpoolmanSync. De grammen zijn wat SpoolmanSync afboekt (gepland gewicht x voortgang): een schatting, geen meting. Naam, status en voortgang van een print worden vastgelegd op het moment dat de afboeking wordt gezien; bij afboekingen die al ouder zijn dan 30 minuten blijft de naam leeg ("Onbekende print").

## Pc-app: rol toevoegen met foto
De bridge heeft een tweede poort (8100) voor de pc-app in de map `rolscanner/` (zie `rolscanner/README.md`). Die poort accepteert alleen "rol toevoegen" en de lijst met merken, en alleen met een token dat je in de bridge-interface aanmaakt (onderdeel Pc-app). Het token wordt eenmalig getoond en alleen als hash bewaard; een nieuw token maakt het oude ongeldig. Na 5 foute pogingen wordt het adres een minuut geblokkeerd. Poort 8100 is bereikbaar voor je hele thuisnetwerk; het token is de enige beveiliging.

## Bambu-profiel ("Type")
Bij het aanmaken van een rol in Bambu zoekt de bridge het profiel (het "Type" in Handy en Studio) op merk, materiaal en de productnaam in de Spoolman-naam, bijvoorbeeld SUNLU "PLA C220". Eerst kijkt hij naar de profielen van je bestaande rollen in Bambu (die kent jouw account, ook profielen die niet in de openbare lijst staan, zoals C210 en C220), daarna naar Bambu's openbare bibliotheek. Alleen een eenduidige match wordt gebruikt; anders blijft het type leeg (zichtbaar in de activiteit) en kies je het zelf in Handy of Studio. Bestaande rollen worden niet aangepast. De temperaturen komen uit het profiel; Bambu kent ze niet per rol.

## Vaste typen en locaties (rolscanner)
De bridge bewaart de typen die de rolscanner in het menu toont: label, merk, materiaal, productnaam, standaard nozzletemperatuur en het Bambu-profiel (`id`, `vendor`, `name`). Standaard staan erin: SUNLU PLA C190 (`P71db9ac`), C210 (`Paed3d28`), C220 (`P9877e1f`) en PETG Basic (`P05a4964`); de nozzletemperaturen 190, 210 en 220 horen bij de eerste drie, bij PETG Basic en voor bed is niets ingevuld. De ID's komen uit je eigen Bambu-account (`GET /api/bambu/slicer-probe`, onder "private"). Typen en locaties pas je aan via `POST /api/settings` met `rolTypes` of `locations`. De locatie komt alleen in Spoolman (veld "Locatie") en niet in Bambu.

## Wie is leidend?
- **Rollen zonder chip** (Sunlu e.d.): Spoolman is leidend. Het resterende gewicht en de volle rol gaan van Spoolman naar Bambu.
- **Originele Bambu-rollen met chip**: Bambu is leidend, omdat Bambu het verbruik zelf uitrekent. De bridge koppelt de rol via het serienummer (Spoolman `tag` = Bambu `RFID`) aan Bambu's eigen regel en zet het gewicht van Bambu in Spoolman. Er gaat niets naar Bambu en Bambu's eigen regel wordt nooit verwijderd. Een dubbele handmatige regel van de bridge zelf wordt opgeruimd.
- SpoolmanSync boekt verbruik nog steeds in Spoolman af (printgeschiedenis, gram per print). Voor chip-rollen trekt de volgende sync het gewicht weer gelijk met Bambu.

## Rol aan een tray koppelen (QR-label)
Het QR-label van een rol wijst naar `http://<adres>:3005/scan/spool/<id>` (poort 8100 geeft dezelfde pagina). Voor poort 3005 is SpoolmanSync verplaatst naar poort 3015 (zijn eigen instelling `port`) en staat in het Netwerk-tabblad van de bridge `8101/tcp` op 3005. Scan je het, kies dan de tray en doe daarna de rol in de printer. De bridge leest elke 5 seconden de status van die tray in Home Assistant en koppelt de rol via SpoolmanSync pas als de printer de rol 8 seconden onafgebroken ziet. Een rol zonder chip toont de AMS als "?"; dat telt als geladen. Zat er bij het kiezen al een rol in de tray, dan wacht de bridge tot de tray leeg is geweest (of een andere rolchip zichtbaar is). Een uur lang geen rol: de wachtende koppeling vervalt. Wachtende koppelingen staan in het onderdeel "Wacht op tray" en in `sensor.spoolman_tray_koppelingen`.
Voorwaarden: de SpoolmanSync-URL is ingevuld, de bridge heeft Home Assistant-toegang (`homeassistant_api`), en de tray-sensoren staan in Home Assistant. De pagina heeft geen inlog (zoals SpoolmanSync zelf); gebruik poort 8100 alleen op je eigen netwerk.
