# Decisions — Huddle

Architekturentscheidungen mit Begruendung. Verhindert dass in Session 5 etwas vorgeschlagen wird was in Session 2 bewusst verworfen wurde.

Format: `ID — Titel — Status (accepted/superseded/rejected) — Datum`

---

D-001 — LiveKit Signaling durch cloudflared tunneln — accepted — 2026-03-17

LiveKit Signaling (WSS, Port 7880) geht als zweite Route durch den cloudflared Tunnel
(your-livekit-domain.com). TLS wird von Cloudflare terminiert. Nur UDP Media (7882) und TURN
Fallback (443/TCP) sind direkt auf der Firewall offen.

Alternativen verworfen:
- Caddy Reverse Proxy: Mehr Infrastruktur, Port 443 Conflict mit TURN, neue Angriffsfläche.
- LiveKit Cloud: Widerspricht selfhosted-Intent, externe Abhängigkeit.
- LiveKit Signaling direkt exposed: Kein TLS, Browser blockiert ws:// von HTTPS-Seite.

**Nachtrag 2026-03-25:** Production-Port ist 7890, nicht 7880 (7880 may be occupied on some hosts). Siehe CLAUDE.md §LiveKit Konfiguration.

---

D-002 — TURN auf Port 443/TCP als Fallback — superseded — 2026-03-17

LiveKit TURN auf Port 443 TCP fuer User hinter restriktiven Firewalls (Hotels, Firmen)
die UDP blockieren. Port 443 wird sonst nicht gebraucht (App geht durch cloudflared).

**Superseded 2026-03-25:** Port 443 anderweitig belegt. TURN ist deaktiviert. ICE TCP Fallback laeuft auf Port 7881/TCP als Alternative. Siehe CLAUDE.md §Split-Routing.

---

D-003 — Kein self-service Password Reset, Admin-Reset statt Email-Flow — accepted — 2026-03-17

Kein Forgot-Password Link, kein Email-basierter Reset. Admin setzt Passwort via Admin
Console zurueck (generiert Temp-Passwort, User muss beim naechsten Login aendern).

Begruendung: 5-15 Leute, alle kennen sich. Email-Infrastruktur (Mailcow SMTP) ist
Overhead der keinen proportionalen Nutzen bringt. Admin ist immer erreichbar.

Supersedes: Frueherer Spec-Entwurf in 15-auth.md 15.10 (vollstaendiger Email-Reset-Flow).

---

D-004 — Camera-Join mit Friction, Screenshare-Join ohne — accepted — 2026-03-17

Camera ON waehrend nicht im Call: One-Click-Bestätigung ("Join call to enable camera").
Screenshare ON waehrend nicht im Call: Sofortiger Auto-Join ohne Prompt.

Begruendung: Kamera + Mikrofon = Privacy-Risiko (User zeigt sich/sein Zimmer ungewollt).
Screenshare = bewusste Aktion, User waehlt explizit was geteilt wird. Die Asymmetrie
ist gewollt und muss dokumentiert bleiben damit kein Agent sie "fixt".

---

D-005 — Screenshare Window: Single JOIN statt zwei Optionen — accepted — 2026-03-17

Frueher: "Join chatroom" und "Join call" als zwei Optionen. Beide waren identisch
spezifiziert (oeffnen Room + joinen Call). Jetzt: Ein `[ JOIN ]` Button.

Begruendung: Kein sinnvoller Unterschied zwischen den Optionen. Chat gehoert zum Room,
nicht zum Call. Room-View oeffnen + Call joinen ist immer das Richtige.

---

D-006 — Uploads als Bind Mount statt Docker Named Volume — accepted — 2026-03-17

./data/uploads auf dem Host, gemounted als /data/uploads im Container.
pgdata bleibt Named Volume (PostgreSQL-Daten direkt anfassen ist riskant).

Begruendung: Admin-Komfort. Direkter Dateizugriff (ls, du, rsync, Backup-Scripts) ohne
Docker-Wissen. Fuer ein Single-Server-Setup ohne CI/CD ist Portabilitaet irrelevant.

---

D-007 — DirectConversation Lazy Creation — superseded — 2026-03-17

DM-Entity wird erst bei erster Message erstellt, nicht beim Klick auf den User.
UI zeigt DM-View sofort, Backend erstellt Entity als Teil des ersten Message-Send.

Begruendung: Verhindert leere DM-Entities wenn User nur kurz die Conversation oeffnen.
Trade-off: Typing Indicators funktionieren erst nach der ersten Message (kein scopeId
vorher). Akzeptabel — bei der allerersten Nachricht fehlt der Typing-Indicator, danach
alles normal.

**Superseded 2026-03-25:** DirectConversation wird jetzt eager erstellt beim Oeffnen der DM-View (`GET /api/direct/:otherUserId`). Grund: Call- und Screenshare-Controls brauchen eine existierende Entity sofort, nicht erst nach der ersten Message. Spec 10-domain.md und 99-acceptance.md §99.20 dokumentieren das aktuelle Verhalten.

---

D-008 — Curated Emoji Set statt Full Unicode Picker — accepted — 2026-03-17

21 handpicked Emojis statt vollem Unicode-Picker. Flat Grid, kein Tabs, keine Suche.

Begruendung: Passt zur TTY-Aesthetic (minimalistisch, opinionated). 5-15 Leute brauchen
keine 3000 Emojis. Gaming-relevante + Core-Reactions reichen. Kann spaeter erweitert
werden wenn die Gruppe mehr will.

---

D-009 — End Call for All fuer jeden joined User — superseded — 2026-03-17

Jeder User der in einem Room `joined` ist, kann den Call fuer alle beenden (mit
Bestaetigungs-Dialog). Nicht Admin-exklusiv.

Begruendung: Trust-basierte Gruppe, 5-15 Leute. Missbrauch ist kein Thema. Loest das
"Ghost Call"-Problem (Call bleibt offen weil jemand den Tab geschlossen hat) ohne
Admin-Intervention. Admin hat zusaetzlich Force-End ohne Scope-Restriction.

**Superseded 2026-03-25:** "End Call for All" Button wurde entfernt. Force-End ist jetzt admin-only via Admin Console (80-admin.md §80.6). Grund: In der Praxis reichte der Ghost-Call-Cleanup via `empty_timeout: 60` in der LiveKit-Config. Der Button war UX-Noise. Commit 43fcb5b.

---

D-010 — Welcome Screen als Terminal MOTD — accepted — 2026-03-17

Hauptbereich wenn kein Room/DM aktiv: Terminal-MOTD-Format mit System Status (wer online,
aktive Calls), Gaming-Quote aus MotdPool, zufaelliger Tip.

Begruendung: Passt zur TTY-Aesthetic und Gaming-Thematik. Funktional nuetzlich (System-
Ueberblick auf einen Blick). MotdPool mit User-Submissions baut Gruppenkultur.

---

D-011 — Admin Console in-app statt separater Service — accepted — 2026-03-17

Admin-Features als Page innerhalb der SPA, geschuetzt durch is_admin Flag. Kein separater
Port, kein separater Service.

Begruendung: Simplicity. Bleibt im bestehenden Auth-System. Fuer 5-15 User braucht man
keine Enterprise-Admin-Infrastruktur. Scope: Password Reset, User De/Reactivation,
Room Deletion/Rename, Force-End Call, System Status.

---

D-012 — Login Attempt Limiting statt generellem Rate Limiting — accepted — 2026-03-17

5 Fehlversuche pro Username → 5 Min Lockout. Kein generelles API Rate Limiting.

Begruendung: Cloudflare Access filtert unautorisierte Zugriffe vorher. Innerhalb der
Gruppe ist Trust-basiert. Auth-Brute-Force ist der einzige realistische Angriffsvektor
der Schutz braucht. In-Memory Lockout State (reset bei Server-Restart) reicht.

---

D-013 — Prisma polymorphes Message-Scope-Pattern — accepted — 2026-03-17

Messages haben scopeType (room|direct) + scopeId. Optionale FK-Relations zu Room und
DirectConversation. Wenn Prisma die dualen optionalen FKs nicht sauber abbildet:
Application-Layer Enforcement statt DB-FK.

Begruendung: Ein Message-Model statt zwei (RoomMessage + DirectMessage) vereinfacht
Queries, Pagination, WS-Events. Der Trade-off (schwächere DB-Constraints) ist fuer
5-15 User akzeptabel. Der Performance-Index (scopeType + scopeId + createdAt) ist
das Entscheidende.

---

D-014 — Lightbox fuer Bild-Vorschau — accepted — 2026-03-17

Klick auf Inline-Bild oeffnet Lightbox: Full-Size-Bild, Dark Backdrop, Close via
Backdrop/Escape/X, Prev/Next-Navigation durch Bilder in der Conversation.

---

D-015 — Message Pagination 50 initial, cursor-basiert — accepted — 2026-03-17

Letzte 50 Messages beim Oeffnen eines Rooms/DMs. Aeltere on-scroll-up nachladen.
Cursor = created_at Timestamp des aeltesten geladenen Messages.

Begruendung: 50 ist genug fuer den sofortigen Kontext, wenig genug fuer schnelle
Ladezeiten. Cursor-basiert statt Offset-basiert weil sich die Liste aendert
(neue Messages kommen rein).

---

D-016 — Butterchurn als Visualization Engine — accepted — 2026-03-24

WebGL 2.0 Milkdrop-Implementation fuer das Visualizer-Gimmick-Feature.
Keine Custom-Vizzes (YAGNI), kein projectM/WASM.

Begruendung: Butterchurn ist die einzige produktionsreife Web-Implementation
von Milkdrop. 1.8k Stars, MIT, stabile API, von Webamp genutzt. 4 API-Calls
decken den gesamten Use Case ab. Custom WebGL wuerde Wochen brauchen fuer
visuell schlechtere Ergebnisse.

---

D-017 — Output Device Monitor Source fuer Audio-Capture — accepted — 2026-03-24

Primaer: getUserMedia mit der Monitor/Loopback-Source des in Huddle's Audio
Settings konfigurierten Wiedergabegeraets. Kein Auswahl-Dialog.

Mechanik: enumerateDevices() → Output-Device-Label matchen → "Monitor of {label}"
in audioinput-Devices finden → getUserMedia({ audio: { deviceId: monitorId } }).
Funktioniert nativ auf Linux (PipeWire/PulseAudio), Windows (Stereo Mix),
und in allen Browsern inkl. Firefox.

Fallback: Monitor nicht gefunden → No Audio State mit [TAB AUDIO] Button
(getDisplayMedia, braucht User-Gesture) und [MIC] Button (getUserMedia).

User-Override des Council-Ergebnisses: Council hatte getDisplayMedia als
primaeren Pfad beschlossen. User hat explizit korrigiert: Monitor-Source
des konfigurierten Wiedergabegeraets ist primaer. Muss auf Linux + Firefox
funktionieren ohne Extra-Picker.

Begruendung: Laeuft auf Linux + Firefox (Requirement). Nutzt die bereits
konfigurierte Geraetewahl aus den Audio Settings (kein Extra-Picker).
Latenzfrei weil digitaler Tap des Ausgabestreams.

---

D-018 — Kuratierte Presets (30-50) statt Full Library — accepted — 2026-03-24

30-50 handkuratierte Milkdrop-Presets, lazy-loaded als ein Chunk.
Keine Pack-Management-UI, kein progressives Nachladen.

Begruendung: Unkuratierte 200+ Presets wuerden den Wow-Faktor regelmaessig
zerstoeren (viele Presets sind mittelmassig). Kuration sichert: jedes Preset
ist visuell beeindruckend. Ein lazy Chunk statt Eager-Loading schuetzt den
Bundle-Size der Haupt-App (aktuell 884KB).
