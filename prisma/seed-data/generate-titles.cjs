// Title pool generator — curated, high quality
// Short, punchy, no filler. Gaming + nerd culture for ~40yo gamers.
// Run: node prisma/seed-data/generate-titles.cjs 2>/dev/null > prisma/seed-data/titles.json

const titles = [
  // ── Soulslike / FromSoft ───────────────────────────────
  "You Died", "Git Gud", "Praise the Sun", "Sunbro",
  "Bonfire Lit", "Estus Flask Half Full",
  "Elden Lord", "Tarnished", "Ashen One",
  "Lord of Cinder", "Chosen Undead",
  "Let Me Solo Her", "Parry God",
  "First Try (Lie)", "Skill Issue",
  "I-Frames Expert", "Unga Bunga",
  "No Hit Run (Attempt 847)", "Rolling Simulator",

  // ── Elder Scrolls / Fallout ────────────────────────────
  "Dovahkiin", "Dragonborn", "Fus Ro Dah",
  "Arrow to the Knee", "Vault Dweller",
  "Courier Six", "Tunnel Snake Rules",
  "War Never Changes", "Patrolling the Mojave",
  "Another Settlement Needs Your Help",
  "Synth Detector", "Preston Garvey's Nemesis",
  "Do You Get to the Cloud District",

  // ── Metal Gear ─────────────────────────────────────────
  "Snake? SNAKE!", "Kept You Waiting, Huh?",
  "Metal Gear?!", "Psycho Mantis?", "A Hind D?",
  "Cardboard Box Expert", "Big Boss", "Diamond Dog",

  // ── Witcher ────────────────────────────────────────────
  "White Wolf", "Butcher of Blaviken", "Gwent Master",
  "Wind's Howling", "Damn, You're Ugly",
  "Place of Power, Gotta Be",

  // ── Doom / Quake / Arena Shooters ──────────────────────
  "Rip and Tear", "Doom Slayer", "BFG Division",
  "Railgun Specialist", "Rocket Jump Expert",
  "M-M-M-Monster Kill", "Godlike",
  "Headshot", "Camping is a Strategy",
  "360 No Scope", "1v5 Clutch", "Ace",

  // ── Half-Life ──────────────────────────────────────────
  "The One Free Man", "Crowbar Enthusiast",
  "Rise and Shine, Mr. Freeman",
  "Unforeseen Consequences",

  // ── GTA ────────────────────────────────────────────────
  "Wasted", "Busted", "Five Star Fugitive",
  "Ah Shit, Here We Go Again",

  // ── Nintendo / Retro Console ───────────────────────────
  "It's-a Me", "Princess Is Elsewhere",
  "Hero of Time", "Hey! Listen!",
  "Navi's Worst Nightmare",
  "It's Dangerous to Go Alone",
  "Do a Barrel Roll", "A Winner Is You",
  "Konami Code Master", "Up Up Down Down",
  "Blow on the Cartridge", "Player 2 Has Entered",
  "Insert Coin to Continue", "Select Your Fighter",
  "Game Over, Man", "Continue? 9... 8... 7...",
  "Gotta Catch 'Em All", "Shiny Hunter",
  "Nuzlocke Survivor", "Missingno Finder",
  "Tom Nook's Debtor", "Turnip Stonks",

  // ── Blizzard / WoW / Diablo ────────────────────────────
  "50 DKP Minus", "More Dots", "Many Whelps",
  "Handle It", "Leeroy Jenkins",
  "At Least I Have Chicken",
  "Did Someone Say Thunderfury",
  "Barrens Chat Veteran", "LFG Since 2005",
  "Hogger Slayer", "Mankrik's Wife Finder",
  "For the Horde", "For the Alliance",
  "Lok'tar Ogar", "MRGLGLGL",
  "Stay a While and Listen",
  "Cow Level Denier", "Fresh Meat",
  "Not Even Death Can Save You",
  "Ashes of Al'ar (3. Try)", "Hand of Rag",
  "Corrupted Ashbringer Traeumer",
  "Big Love Rocket (Never)",
  "Swift Zulian Tiger",

  // ── StarCraft / RTS ────────────────────────────────────
  "Zerg Rush Survivor", "Additional Pylons Required",
  "Spawn More Overlords", "GG No Re",
  "Carrier Has Arrived", "Nuclear Launch Detected",
  "Wololo", "Kirov Reporting",
  "Harvester Under Attack", "Silos Needed",
  "Insufficient Funds", "Construction Complete",
  "One More Turn Syndrom", "Gandhi Nuke Survivor",

  // ── Counter-Strike ─────────────────────────────────────
  "Rush B", "Bomb Has Been Planted",
  "Counter-Terrorist Win", "Fire in the Hole",
  "AWP Only", "Wallbang Artist",

  // ── Classic PC / Point & Click ─────────────────────────
  "Guybrush Threepwood",
  "You Fight Like a Dairy Farmer",
  "Monkey Island Veteran",
  "Day of the Tentacle Traveler",
  "Sam & Max Freelance Police",
  "Space Quest Janitor", "King's Quest Royalty",
  "Maniac Mansion Alumnus", "Full Throttle Rider",
  "Lucasarts Adventurer", "Sierra Survivor",
  "Loom Weaver",

  // ── DOS / Retro PC ─────────────────────────────────────
  "Autoexec.bat Editor", "Config.sys Optimierer",
  "DOS 6.22 Survivor", "Norton Commander User",
  "Turbo Pascal Absolvent", "QBasic Gorillas Champion",
  "FORMAT C: Survivor", "Defrag Veteran",
  "SkiFree Yeti Opfer", "Minesweeper Experte",
  "Solitaire Weltmeister",
  "Pinball Space Cadet Highscore",
  "Hover! Champion",
  "Commander Keen Fan", "Jazz Jackrabbit Speedrunner",
  "Duke Nukem Hail to the King",
  "Come Get Some",

  // ── Classic Sim / Strategy ─────────────────────────────
  "SimCity Mayor", "Theme Hospital Director",
  "Roller Coaster Tycoon Mogul",
  "Dungeon Keeper Overlord",
  "Lemmings Savior", "Worms Armageddon Veteran",
  "Sims Pool Architect", "Removed the Ladder",
  "Civilization Addict",

  // ── LAN Party Era ──────────────────────────────────────
  "LAN Party Veteran", "Bring Your Own CRT",
  "20kg Monitor Schlepper",
  "Netzwerkkabel Mitbringer",
  "IPX/SPX Protocol Expert",

  // ── Internet Nostalgia ─────────────────────────────────
  "56k Modem Veteran", "GeoCities Webmaster",
  "Winamp Skin Designer",
  "It Really Whips the Llama's Ass",
  "ICQ Uh-Oh", "MSN Nudge Spammer",
  "Away Message Poet", "A/S/L?",
  "Napster Pirate (Retired)",
  "mIRC Script Kiddie",
  "RealPlayer Buffering...",
  "Netscape Navigator", "AltaVista Searcher",
  "AOL CD Sammler",

  // ── Memes & Internet Culture ───────────────────────────
  "All Your Base Are Belong to Us",
  "The Cake Is a Lie", "Would You Kindly",
  "This Is Fine", "Stonks", "Not Stonks",
  "It's Over 9000", "One Does Not Simply",
  "Press F to Pay Respects", "F",
  "X to Doubt", "Always Has Been",
  "Perfectly Balanced",
  "Task Failed Successfully",
  "Panik. Kalm. Panik.",
  "Confused Screaming",
  "Challenge Accepted",
  "Hide the Pain Harold",
  "Surprised Pikachu",
  "Understandable, Have a Nice Day",

  // ── Movie / TV / Pop Culture ───────────────────────────
  "I'll Be Back", "Hasta La Vista, Baby",
  "There Is No Spoon", "Red Pill Taker",
  "Hello There", "General Kenobi",
  "This Is the Way", "I Have the High Ground",
  "Unlimited Power",
  "So Anyway, I Started Blasting",
  "I See Dead Pixels",
  "My Precious (Legendary Drop)",
  "You Shall Not Pass (Firewall)",
  "Nobody Expects the Spanish Inquisition",

  // ── Music References ───────────────────────────────────
  "Stairway to Respawn",
  "Bohemian Ragequitter",
  "Smells Like Team Spirit",
  "Rage Against the Latency",
  "Another One Bites the Dust",

  // ── Tech / Dev Humor ───────────────────────────────────
  "Stack Overflow Copyist", "rm -rf / Survivor",
  "sudo make me a sandwich",
  "localhost:3000 Stammgast",
  "404 Not Found", "418 I'm a Teapot",
  "200 OK Somehow", "500 Internal Error",
  "Merge Conflict Generator", "Git Blame Target",
  "Force Pusher", "TODO Comment Author",
  "FIXME Ignorer", "Legacy Code Archaeologist",
  "Spaghetti Code Chef", "Rubber Duck Debugger",
  "Console.log Connoisseur", "Vim Exiter",
  "Dark Mode Fundamentalist",
  "Light Mode Psychopath",
  "CSS Centering Expert",
  "node_modules Black Hole",
  "Docker Container Collector",
  "Jira Warrior", "Scrum but Actually",

  // ── German Gaming Humor ────────────────────────────────
  "Professioneller Noob", "Qualifizierter Feeder",
  "Zertifizierter Kartoffelaim",
  "Ehren-AFK", "Ehrenamtlicher Ragequitter",
  "Pensionierter Pro-Gamer",
  "Sachbearbeiter fuer Endgegner",
  "Dezernent fuer Alt-F4",
  "Seine Erlauchtheit",
  "Oberste Heeresklickung",
  "Dr. rer. nat. der Niederlage",
  "Master of Disaster", "PhD in Procrastination",
  "Veni Vidi Rage-Quitti",
  "Memento Respawnare",
  "Descartes des Dashens",
  "Schopenhauer des Scheiterns",
  "Diogenes des Debuggens",
  "Graf von Pixelburg", "Baron von Lag",

  // ── Self-Aware / Meta ──────────────────────────────────
  "Title Not Found", "Title Loading...",
  "[object Object]", "null", "undefined",
  "Title (Early Access)", "Title (Beta)",
  "Placeholder Title", "TODO: Add Title",
  "Title.exe Has Stopped",

  // ── Multiplayer Callouts ───────────────────────────────
  "1v1 Me Bro", "GG", "GG EZ", "GLHF", "GGWP",
  "EZ Clap", "Get Rekt", "Outplayed",
  "Calculated", "What a Save",
  "Wow! Wow! Wow!", "Chat Disabled",
  "No Problem", "Nice Shot",
  "Close One", "Unlucky",
  "Diff", "Skill Diff", "Jungle Diff",
  "Go Next", "FF 15", "Winnable",
  "Cope", "Seethe", "Mald", "Ratio",
  "Wombo Combo", "Happy Feet",
  "That Ain't Falco",
  "No Items, Fox Only, Final Destination",

  // ── Ranks & Awards ─────────────────────────────────────
  "Hardstuck Bronze", "Hardstuck Gold",
  "Elo Hell Bewohner", "Diamond Wannabe",
  "Platin IV Endstation", "Iron IV mit Stolz",
  "Unranked and Proud", "Ranked Anxiety",
  "Global Elite (At Heart)",
  "Participation Trophy Collector",
  "Employee of the Month (Self-Awarded)",
  "Voted Most Average",
  "Consistently Inconsistent",
  "Exceptionally Average", "Epically Meh",
  "Legendarily Forgettable",

  // ── Gaming Behavior ────────────────────────────────────
  "Hoarder of Consumables", "Potion Saver",
  "Never Used the Master Ball",
  "Quick Save Addict", "F5 F9 F5 F9",
  "Wiki Tab Open", "Every Corner Checker",
  "Barrel Looter", "Invisible Wall Finder",
  "Photo Mode Addict", "Screenshot Spammer",
  "4h im Character Creator",
  "Ignored the Main Quest",
  "Killed the Merchant", "Sold the Quest Item",
  "One Save File Only", "Save Scummer",
  "Cutscene Skipper", "Read All the Lore",
  "Talked to Every NPC",

  // ── Industry / Meta Gaming ─────────────────────────────
  "It Just Works", "16 Times the Detail",
  "Todd Howard Told Me",
  "Cyberpunk Launch Day Survivor",
  "No Man's Sky Redemption Arc",
  "Half-Life 3 Wartender",
  "Star Citizen Backer",
  "Day 1 Patch Akzeptierer",
  "Loot Box Oeffner (Bereut)",
  "Battle Pass Grinder", "F2P Whale",
  "DLC Complainer then Buyer",
  "Preorder Never Again (Wieder)",
  "That's XCOM, Baby",
  "95% Hit Chance: Miss",
  "EA: It's in the Game",

  // ── Halo / Titanfall ───────────────────────────────────
  "I Need a Weapon", "Finish the Fight",
  "Wake Me When You Need Me",
  "Were It So Easy",
  "Protocol 3: Protect the Pilot",
  "BT-7274", "Trust Me",

  // ── CoD / Military Shooters ────────────────────────────
  "Bravo Six, Going Dark",
  "The Numbers, Mason",
  "Ramirez! Do Everything!",
  "Mission Failed, Next Time",
  "Objective: Survive",

  // ── Twitch / Streaming ─────────────────────────────────
  "PogChamp", "Kappa", "MonkaS", "KEKW",
  "Sadge", "Pepega", "OMEGALUL",
  "Copium Inhaler", "Hopium Dealer",
  "Jebaited", "5Head",

  // ── Tabletop / D&D ─────────────────────────────────────
  "Natuerliche 20", "Kritischer Fehlschlag",
  "Chaotic Neutral IRL", "Roll for Initiative",
  "Rules Lawyer", "Min-Maxer",

  // ── Short & Punchy ─────────────────────────────────────
  "Noob", "Leet", "1337", "w00t",
  "Pew Pew", "Oof", "Bruh", "Yeet",
  "Respawn", "Ragequit", "Camper",
  "Tryhard", "Tryhard Casual", "Lurker",
  "Tank Main", "Healer Main", "DPS Main",
  "Solo Queue Masochist", "One Trick Pony",
  "Flex Player", "Off-Meta Missionar",
  "Respawning in 3... 2... 1...",

  // ── Hardware / Tech ────────────────────────────────────
  "RGB Makes It Faster",
  "Blue Screen Veteran", "Kernel Panic Veteran",
  "4K at 15 FPS", "720p and Proud",
  "Integrated Graphics Warrior",
  "Linux BTW", "I Use Arch BTW",
  "Windows Update Opfer",
  "USB: Immer Falsch Rum",
  "WiFi Whisperer", "Password Resetter",
  "Browser Tab Hoarder",
  "Definitely Not a Bot",

  // ── Voice Chat ─────────────────────────────────────────
  "Open Mic Fan", "Push-to-Talk Forgetter",
  "Keyboard ASMR Artist", "Mic Quality: Potato",
  "Webcam: Off Always",
  "Accidentally Left Mic On",

  // ── Legendary / Drops ──────────────────────────────────
  "Legendary Drop at 3 AM", "Epic Mount Owner",
  "Ninja Looter", "Need Before Greed",

  // ── App Self-Reference ─────────────────────────────────
  "Huddle Stammgast", "Lurker Extraordinaire",
  "Unread Dot Collector", "Emoji Reactor",
];

// Deduplicate and filter to max 40 chars
const unique = [...new Set(titles)].filter(t => t.length <= 40);
const output = unique.map(t => ({ title: t }));

console.log(JSON.stringify(output, null, 2));
console.error(`Total titles: ${output.length}`);
