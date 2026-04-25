# Intent — Huddle

## Vision
Private, selfhosted Discord/Signal-Alternative fuer eine kleine Gruppe von Freunden.
Chat, Voice, Video und Screenshare in einer Web-App mit TTY-Aesthetic.
Kein SaaS fuer Dritte, kein oeffentlicher Zugang — ein privates Werkzeug.

## Was das konkret bedeutet
- Eine Web-App die auf meinem Server laeuft
- Zugang nur ueber Cloudflare Access (nur eingeladene Leute sehen die App ueberhaupt)
- App-eigene Auth (Username/Password) weil sich die Leute teilweise nicht kennen
- Textchat mit persistenter History, Emoji-Reactions, File/Image-Upload
- Voice Calls via LiveKit (Audio + optionale Camera + Screenshare)
- Room-basiert: Group Rooms mit Membership-States (joined/left/not_joined)
- Direct Messages zwischen zwei Usern
- Globale und Room-Screenshares
- TTY-Aesthetic: Monospace, Mint/Sage auf Dunkelblau-Grau, Box-Drawing, Hex-Labels
- Nutzergruppe: ~5-15 Leute, alle persoenlich bekannt, kein Wachstum geplant

## Non-Goals
- Kein oeffentliches Produkt, keine Monetarisierung
- Keine nativen Apps (Mobile/Desktop) — Web-App reicht
- Kein Federation (Matrix/ActivityPub)
- Kein End-to-End-Encryption (Transport-Encryption reicht, private Gruppe)
- Kein Bot-System, keine Integrations-API
- Kein separates Admin-Panel — Admin Console ist in-app (Settings → Admin Tab)

## Done
Huddle laeuft auf meinem Server. Meine Freunde koennen sich
einloggen, in Raeumen chatten, Voice Calls fuehren, ihre Kamera aktivieren
und Screenshares starten. Die App sieht gut aus (TTY-Aesthetic), reagiert
schnell, und die Leute nutzen sie statt Discord.

