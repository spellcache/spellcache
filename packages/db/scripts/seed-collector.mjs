// Compte de démonstration « collectionneur » pour le développement local :
// collection volumineuse, binders, listes, dossiers et decks dans tous les
// états du cycle de vie. Uniquement des cartes réelles — chaque nom est
// résolu dans le catalogue local (miroir Scryfall), jamais inventé ; un nom
// introuvable est signalé et ignoré.
//
// Idempotent : supprime le compte et sa collection avant de les recréer.
// Usage : pnpm --filter @spellcache/db seed:collector
import pg from 'pg'

const EMAIL = 'collector@example.test'
const USERNAME = 'collector'
const DISPLAY_NAME = 'Alex'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

// RNG déterministe : deux exécutions produisent la même collection.
let seed = 0x5eed
function rand() {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const between = (min, max) => min + Math.floor(rand() * (max - min + 1))
function shuffle(arr) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ---------------------------------------------------------------------------
// Contenu
// ---------------------------------------------------------------------------

// Pools « ouverts » en draft/boosters : le gros de la collection racine.
const DRAFT_SETS = ['woe', 'lci', 'mkm', 'otj', 'blb', 'dsk', 'fdn', 'dft', 'one', 'mom', 'dmu', 'bro', 'neo', 'snc', 'mh2', 'mh3']
const OLD_SETS = ['ice', 'mir', 'vis', 'wth', 'tmp', 'sth', 'exo', 'usg', 'ulg', 'uds', 'mmq', 'nem', 'pcy', 'inv', 'pls', 'ody']

const COMMANDER_STAPLES = {
  'Sol Ring': 3, 'Arcane Signet': 4, 'Command Tower': 5, 'Swords to Plowshares': 2,
  'Path to Exile': 3, Counterspell: 4, 'Demonic Tutor': 1, 'Rhystic Study': 1,
  'Smothering Tithe': 1, Cultivate: 4, "Kodama's Reach": 3, 'Beast Within': 3,
  'Chaos Warp': 2, 'Lightning Greaves': 2, 'Swiftfoot Boots': 3, 'Eternal Witness': 2,
  'Mind Stone': 3, 'Fellwar Stone': 2, 'Thought Vessel': 1, 'Reliquary Tower': 2,
  'Blasphemous Act': 2, 'Cyclonic Rift': 1, 'Anguished Unmaking': 1, 'Generous Gift': 2,
  'Heroic Intervention': 2, "Teferi's Protection": 1, 'Esper Sentinel': 1,
  'Talisman of Dominance': 2, 'Talisman of Creativity': 1, 'Dimir Signet': 2,
  'Rampant Growth': 3, "Nature's Lore": 2, 'Farseek': 2, 'Exotic Orchard': 2,
  'Path of Ancestry': 2, 'Rogue\'s Passage': 2, 'Bojuka Bog': 1, 'Myriad Landscape': 2,
  'Evolving Wilds': 4, 'Terramorphic Expanse': 3, 'Skullclamp': 1, 'Feed the Swarm': 2,
  'Austere Command': 1, 'Toxic Deluge': 1, 'Damnation': 1, 'Wrath of God': 1,
}

const DUAL_LANDS = {
  'Overgrown Tomb': 1, 'Steam Vents': 2, 'Sacred Foundry': 2, 'Godless Shrine': 1,
  'Blood Crypt': 2, 'Breeding Pool': 1, 'Hallowed Fountain': 1, 'Stomping Ground': 1,
  'Temple Garden': 1, 'Watery Grave': 1, 'Scalding Tarn': 1, 'Polluted Delta': 1,
  'Verdant Catacombs': 1, 'Misty Rainforest': 1, 'Arid Mesa': 2, 'Marsh Flats': 1,
  'Windswept Heath': 1, 'Flooded Strand': 1, 'Bloodstained Mire': 2, 'Wooded Foothills': 2,
  'Inspiring Vantage': 4, 'Spirebluff Canal': 4, 'Botanical Sanctum': 2,
  'Concealed Courtyard': 2, 'Blooming Marsh': 2, 'Darkslick Shores': 1,
  'Copperline Gorge': 2, 'Seachrome Coast': 1, 'Razorverge Thicket': 1,
  'Fabled Passage': 2, 'Prismatic Vista': 1, 'Sulfurous Springs': 4, 'Haunted Ridge': 4,
}

const WISHLIST = [
  "Gaea's Cradle", 'Mana Crypt', 'The One Ring', 'Jeweled Lotus', 'Cavern of Souls',
  'Ragavan, Nimble Pilferer', 'Force of Will', 'Wrenn and Six', 'Orcish Bowmasters',
  'Fierce Guardianship', 'Deflecting Swat', 'Teferi, Time Raveler', "Urza's Saga",
  'Ancient Tomb', 'Chrome Mox', 'Mox Diamond', 'Grim Monolith', 'Doubling Season',
  'Craterhoof Behemoth', 'Natural Order', 'Vampiric Tutor', 'Imperial Seal',
]

const MODERN_UPGRADES = [
  'Ragavan, Nimble Pilferer', 'Murktide Regent', "Dragon's Rage Channeler",
  'Expressive Iteration', 'Counterspell', 'Unholy Heat', 'Consider', 'Spell Pierce',
  'Fury', 'Solitude', 'Endurance', 'Subtlety', 'Grief', 'Scalding Tarn',
]

// Decks. `cards` : [nom, qté] ou nom seul (1). `fill` : basiques pour
// atteindre `size` dans le mainboard.
const DECKS = [
  {
    name: 'Krenko Goblins', format: 'commander', state: 'built', folder: 'Commander', gradient: 'red',
    commander: 'Krenko, Mob Boss', size: 100, fill: { Mountain: 1 },
    cards: [
      'Goblin Chieftain', 'Goblin King', 'Goblin Warchief', 'Goblin Matron', 'Goblin Recruiter',
      'Goblin Ringleader', 'Goblin Lackey', 'Goblin Piledriver', 'Goblin Rabblemaster', 'Legion Warboss',
      'Skirk Prospector', 'Mogg War Marshal', 'Siege-Gang Commander', 'Beetleback Chief',
      'Krenko, Tin Street Kingpin', "Krenko's Command", 'Goblin Instigator', 'Goblin Bombardment',
      'Purphoros, God of the Forge', 'Impact Tremors', 'Shared Animosity', 'Coat of Arms',
      'Goblin Sharpshooter', 'Muxus, Goblin Grandee', 'Conspicuous Snoop', 'Goblin Trashmaster',
      'Battle Cry Goblin', 'Legion Loyalist', 'Ib Halfheart, Goblin Tactician', 'Moggcatcher',
      'Boggart Shenanigans', 'Pashalik Mons', 'Hordeling Outburst', 'Goblin Electromancer',
      'Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts', 'Throne of the God-Pharaoh', 'Skullclamp',
      'Sol Ring', 'Arcane Signet', 'Fire Diamond', 'Mind Stone', 'Thought Vessel',
      'Lightning Greaves', 'Swiftfoot Boots', 'Chaos Warp', 'Blasphemous Act', 'Vandalblast',
      'Lightning Bolt', 'Abrade', 'Faithless Looting', 'Gamble', "Jeska's Will", 'Seething Song',
      'Goblin Bushwhacker', 'Goblin Grenade', 'Goblin Chainwhirler', 'Dragon Fodder', 'Mogg Fanatic',
      'Gempalm Incinerator', 'Goblin Rally', 'Massive Raid',
      'Castle Embereth', 'Den of the Bugbear', 'Reliquary Tower', 'War Room', "Rogue's Passage",
      'Myriad Landscape',
    ],
  },
  {
    name: 'Meren Recursion', format: 'commander', state: 'built', folder: 'Commander', gradient: 'green',
    commander: 'Meren of Clan Nel Toth', size: 100, fill: { Swamp: 1, Forest: 1 },
    cards: [
      'Sakura-Tribe Elder', 'Eternal Witness', 'Fleshbag Marauder', 'Merciless Executioner',
      'Plaguecrafter', 'Viscera Seer', 'Carrion Feeder', 'Acidic Slime', 'Shriekmaw',
      'Ravenous Chupacabra', 'Grave Titan', 'Golgari Grave-Troll', 'Spore Frog', 'Satyr Wayfinder',
      'Mulch', 'Grisly Salvage', "Stitcher's Supplier", 'Sidisi, Brood Tyrant', 'Deathrite Shaman',
      'Pernicious Deed', 'Golgari Signet', 'Sol Ring', 'Arcane Signet', "Commander's Sphere",
      'Birds of Paradise', 'Llanowar Elves', 'Elvish Mystic', 'Survival of the Fittest',
      'Phyrexian Altar', "Ashnod's Altar", 'Grim Harvest', 'Living Death', 'Victimize', 'Reanimate',
      'Animate Dead', 'Necromancy', 'Demonic Tutor', 'Worldly Tutor', 'Beast Within',
      "Assassin's Trophy", 'Putrefy', 'Rampant Growth', 'Cultivate', "Kodama's Reach",
      'Three Visits', "Nature's Lore", 'Sylvan Library', 'Gravecrawler', 'Reassembling Skeleton',
      'Bloodghast', 'Kokusho, the Evening Star', 'Massacre Wurm', 'Dread Return',
      'Caustic Caterpillar', 'Reclamation Sage', "Liliana, Death's Majesty", 'Ramunap Excavator',
      'Mazirek, Kraul Death Priest', 'Butcher of Malakir', 'Grave Pact', 'Dictate of Erebos',
      'Overgrown Tomb', 'Woodland Cemetery', 'Llanowar Wastes', 'Golgari Rot Farm', 'Jungle Hollow',
      'Twilight Mire', 'Verdant Catacombs', 'Command Tower', 'Bojuka Bog',
      'Urborg, Tomb of Yawgmoth', 'Phyrexian Tower', 'Evolving Wilds', 'Myriad Landscape',
    ],
  },
  {
    name: 'Talrand Spellslinger', format: 'commander', state: 'built', folder: 'Commander', gradient: 'blue',
    commander: 'Talrand, Sky Summoner', size: 100, fill: { Island: 1 },
    cards: [
      'Brainstorm', 'Ponder', 'Preordain', 'Opt', 'Consider', 'Counterspell', 'Arcane Denial',
      'Swan Song', 'Negate', 'Dispel', 'Mystic Confluence', 'Cryptic Command', 'Mystical Dispute',
      'Pongify', 'Rapid Hybridization', 'Cyclonic Rift', 'Rite of Replication', 'Frantic Search',
      'High Tide', 'Snap', 'Gitaxian Probe', 'Impulse', 'Fact or Fiction', 'Dig Through Time',
      'Treasure Cruise', 'Gush', 'Mystic Remora', 'Rhystic Study', 'Murmuring Mystic',
      'Archmage Emeritus', 'Docent of Perfection', 'Sai, Master Thopterist',
      'Baral, Chief of Compliance', 'Jace, Wielder of Mysteries', "Jace's Archivist", 'Sol Ring',
      'Arcane Signet', 'Sapphire Medallion', 'Sky Diamond', 'Mind Stone', 'Thought Vessel',
      'Isochron Scepter', 'Aetherflux Reservoir', 'Mana Leak', 'Remand', 'Memory Lapse', 'Delay',
      'Spell Pierce', 'Miscalculation', 'Flusterstorm', 'Serum Visions', 'Sleight of Hand',
      'Thought Scour', 'Think Twice', 'Deep Analysis', "Blue Sun's Zenith", 'Stroke of Genius',
      'Turnabout', 'Snapback', 'Into the Roil', 'Repeal', 'Capsize', 'Ghostly Flicker',
      'Mystic Sanctuary', 'Reliquary Tower',
      'Halimar Depths', 'Castle Vantress', 'Otawara, Soaring City', 'Cephalid Coliseum',
    ],
  },
  {
    name: 'Mono-red burn', format: 'modern', state: 'built', folder: 'Constructed', gradient: 'red',
    size: 60,
    cards: [
      ['Goblin Guide', 4], ['Monastery Swiftspear', 4], ['Eidolon of the Great Revel', 4],
      ['Lightning Bolt', 4], ['Lava Spike', 4], ['Rift Bolt', 4], ['Skewer the Critics', 4],
      ['Boros Charm', 4], ['Lightning Helix', 4], ['Searing Blaze', 4], ['Inspiring Vantage', 4],
      ['Sacred Foundry', 4], ['Arid Mesa', 2], ['Bloodstained Mire', 2], ['Wooded Foothills', 2],
      ['Mountain', 6],
    ],
    side: [
      ['Path to Exile', 2], ['Kor Firewalker', 3], ['Deflecting Palm', 2],
      ['Smash to Smithereens', 2], ['Rest in Peace', 3], ['Skullcrack', 3],
    ],
  },
  {
    name: 'Mono-blue Faeries', format: 'pauper', state: 'built', folder: 'Constructed', gradient: 'blue',
    size: 60,
    cards: [
      ['Faerie Miscreant', 4], ['Spellstutter Sprite', 4], ['Ninja of the Deep Hours', 4],
      ['Faerie Seer', 4], ['Delver of Secrets', 4], ['Counterspell', 4], ['Preordain', 4],
      ['Ponder', 4], ['Brainstorm', 2], ['Snap', 4], ['Mutagenic Growth', 2], ['Island', 20],
    ],
    side: [['Hydroblast', 4], ['Annul', 3], ['Stormbound Geist', 4], ['Relic of Progenitus', 4]],
  },
  {
    name: 'Edgar Vampires', format: 'commander', state: 'plan', folder: 'Brews', gradient: 'gold',
    commander: 'Edgar Markov', size: 100, fill: { Plains: 1, Swamp: 1, Mountain: 1 },
    cards: [
      'Bloodline Keeper', 'Captivating Vampire', 'Legion Lieutenant', 'Sorin, Imperious Bloodlord',
      'Vampire Nocturnus', 'Stromkirk Captain', 'Elenda, the Dusk Rose', 'Olivia Voldaren',
      'Cordial Vampire', 'Drana, Liberator of Malakir', 'Kalastria Highborn',
      'Vito, Thorn of the Dusk Rose', 'Sanctum Seeker', 'Champion of Dusk', 'Twilight Prophet',
      'Bloodghast', 'Exquisite Blood', 'Sanguine Bond', 'Patron of the Vein', 'Vein Ripper',
      'Swords to Plowshares', 'Path to Exile', 'Lightning Helix', 'Anguished Unmaking', 'Vindicate',
      'Mortify', 'Terminate', 'Utter End', "Kolaghan's Command", 'Sol Ring', 'Arcane Signet',
      'Talisman of Hierarchy', 'Talisman of Conviction', 'Boros Signet', 'Rakdos Signet',
      'Orzhov Signet', 'Lightning Greaves', 'Blood Artist', 'Zulaport Cutthroat', 'Cruel Celebrant',
      'Stensia Masquerade', 'Indulgent Aristocrat', 'Carmen, Cruel Skymarcher',
      'Vona, Butcher of Magan', "Teferi's Protection", 'Vampire of the Dire Moon', 'Falkenrath Noble',
      'Bloodlord of Vaasgoth', 'New Blood', 'Sorin, Lord of Innistrad', 'Sorin, Vengeful Bloodlord',
      'Mavren Fein, Dusk Apostle', 'Edgar, Charmed Groom', 'Malakir Bloodwitch', 'Necropolis Regent',
      'Bloodthirsty Aerialist', 'Licia, Sanguine Tribune', 'Butcher of Malakir', 'Village Rites',
      'Deadly Dispute', 'Bastion of Remembrance', 'Viscera Seer',
      'Command Tower', 'Sacred Foundry', 'Godless Shrine', 'Blood Crypt', 'Nomad Outpost',
      'Exotic Orchard', 'Path of Ancestry', 'Clifftop Retreat', 'Isolated Chapel',
      'Dragonskull Summit', 'Savai Triome', 'Smoldering Marsh', 'Caves of Koilos', 'Battlefield Forge',
    ],
  },
  {
    name: 'Ezuri Elves', format: 'commander', state: 'assemble', folder: 'Commander', gradient: 'green',
    commander: 'Ezuri, Renegade Leader', size: 100, fill: { Forest: 1 },
    cards: [
      'Llanowar Elves', 'Elvish Mystic', 'Fyndhorn Elves', 'Elvish Archdruid', 'Priest of Titania',
      'Heritage Druid', 'Nettle Sentinel', 'Elvish Visionary', 'Wirewood Symbiote',
      'Craterhoof Behemoth', "Ezuri's Predation", 'Elvish Champion', 'Imperious Perfect',
      "Dwynen's Elite", 'Joraga Warcaller', 'Elvish Warmaster', 'Lys Alana Huntmaster',
      'Copperhorn Scout', 'Marwyn, the Nurturer', 'Leaf-Crowned Visionary', 'Allosaurus Shepherd',
      'Sylvan Library', 'Beast Within', 'Heroic Intervention', 'Natural Order', "Green Sun's Zenith",
      'Chord of Calling', 'Finale of Devastation', 'Regal Force', 'Beast Whisperer',
      'Guardian Project', 'Sol Ring', 'Skullclamp', 'Cultivate', 'Elvish Harbinger',
      'Elvish Clancaller', 'Elvish Promenade', 'Timberwatch Elf', 'Wellwisher', 'Gilt-Leaf Archdruid',
      'Arbor Elf', 'Boreal Druid', 'Quirion Ranger', 'Devoted Druid', 'Harmonize',
      'Return of the Wildspeaker', 'Overwhelming Stampede', 'Triumph of the Hordes', 'Worldly Tutor',
      'Sylvan Messenger', 'Dwynen, Gilt-Leaf Daen', 'Fierce Empath', 'Selvala, Heart of the Wilds',
      'Tyvar Kell', 'Elvish Reclaimer', 'Rampant Growth', "Nature's Lore", 'Three Visits',
      'Lightning Greaves', 'Swiftfoot Boots', 'Arcane Signet', 'Krosan Grip', 'Reclamation Sage',
      "Gaea's Cradle",
      'Nykthos, Shrine to Nyx', 'Yavimaya, Cradle of Growth', 'Castle Garenbrig',
    ],
  },
  {
    name: 'Rakdos Midrange', format: 'pioneer', state: 'plan', folder: 'Brews', gradient: 'purple',
    size: 60,
    cards: [
      ['Fable of the Mirror-Breaker', 4], ['Thoughtseize', 4], ['Fatal Push', 4],
      ['Bloodtithe Harvester', 4], ['Sheoldred, the Apocalypse', 4], ['Graveyard Trespasser', 4],
      ['Bonecrusher Giant', 2], ['Go for the Throat', 3], ['Invoke Despair', 2], ['Duress', 1],
      ['Cut Down', 4], ['Blood Crypt', 4], ['Sulfurous Springs', 4], ['Haunted Ridge', 4],
      ['Takenuma, Abandoned Mire', 2], ['Sokenzan, Crucible of Defiance', 1], ['Swamp', 4],
      ['Mountain', 3], ['Hive of the Eye Tyrant', 2],
    ],
  },
  {
    name: 'Izzet Phoenix', format: 'modern', state: 'dismantled', folder: 'Constructed', gradient: 'grey',
    size: 60,
    cards: [
      ['Arclight Phoenix', 4], ['Crackling Drake', 4], ['Thing in the Ice', 4], ['Lightning Bolt', 4],
      ['Opt', 4], ['Manamorphose', 4], ['Faithless Looting', 4], ['Serum Visions', 4],
      ['Thought Scour', 4], ['Burst Lightning', 4], ['Lightning Axe', 2], ['Spirebluff Canal', 4],
      ['Steam Vents', 4], ['Scalding Tarn', 4], ['Polluted Delta', 2], ['Island', 2], ['Mountain', 2],
    ],
  },
  // Deck sans dossier : apparaît dans `Unsorted`.
  {
    name: 'Kitchen table Slivers', format: 'commander', state: 'plan', folder: null, gradient: 'gold',
    commander: 'Sliver Overlord', size: 100, fill: { Plains: 1, Island: 1, Swamp: 1, Mountain: 1, Forest: 1 },
    cards: [
      'Sliver Hivelord', 'The First Sliver', 'Sliver Legion', 'Galerider Sliver', 'Manaweft Sliver',
      'Gemhide Sliver', 'Sinew Sliver', 'Muscle Sliver', 'Predatory Sliver', 'Megantic Sliver',
      'Sliver Hive', 'Harmonic Sliver', 'Necrotic Sliver', 'Crystalline Sliver', 'Heart Sliver',
      'Cloudshredder Sliver', 'Lavabelly Sliver', 'Diffusion Sliver', 'Cleaving Sliver',
      'Striking Sliver', 'Blur Sliver', 'Venom Sliver', 'Sedge Sliver', 'Brood Sliver',
      'Synapse Sliver', 'Sliver Queen', 'Coat of Arms', 'Door of Destinies', "Herald's Horn",
      'Kindred Discovery', 'Hibernation Sliver', 'Spiteful Sliver', 'Bonescythe Sliver',
      'Shifting Sliver', 'Dregscape Sliver', 'Frenetic Sliver', 'Quick Sliver', 'Virulent Sliver',
      'Watcher Sliver', 'Constricting Sliver', 'Telekinetic Sliver', 'Battering Sliver',
      'Hollowhead Sliver', 'Belligerent Sliver', 'Hunter Sliver', 'Two-Headed Sliver',
      'Sentinel Sliver', 'Root Sliver', 'Fury Sliver', 'Might Sliver', 'Ward Sliver', 'Plated Sliver',
      'Horned Sliver', 'Talon Sliver', 'Thorncaster Sliver', 'Farseek', 'Cultivate',
      'Birds of Paradise', "Kodama's Reach", 'Exotic Orchard', 'Mana Confluence', 'City of Brass',
      'Reflecting Pool', 'Plaza of Heroes', 'Path of Ancestry', 'Command Tower', 'Unclaimed Territory',
      'Secluded Courtyard', 'Cavern of Souls', 'Sol Ring', 'Arcane Signet', 'Chromatic Lantern',
    ],
  },
]

const FOLDERS = ['Commander', 'Constructed', 'Brews']

// ---------------------------------------------------------------------------
// Résolution des cartes
// ---------------------------------------------------------------------------

// Types de set « jouables » pour choisir une impression par nom : évite
// tokens, art series, promos et cartes mémoire.
const PRINT_SET_TYPES = ['expansion', 'core', 'masters', 'commander', 'draft_innovation', 'duel_deck', 'starter', 'funny']
const EXCLUDED_LAYOUTS = ['token', 'double_faced_token', 'art_series', 'emblem']

async function resolveByName(client, names) {
  const wanted = [...new Set(names)]
  const lower = wanted.map((n) => n.toLowerCase())
  const { rows } = await client.query(
    `select distinct on (key) key, c.id, c.name, c.finishes
     from (
       select c.*, lower(split_part(c.name, ' // ', 1)) as front, lower(c.name) as full_name
       from cards c
     ) c
     join sets s on s.code = c.set_code
     left join card_prices p on p.card_id = c.id and p.day = (select max(day) from card_prices)
     cross join lateral (select case when c.full_name = any($1) then c.full_name else c.front end as key) k
     where (c.full_name = any($1) or c.front = any($1))
       and coalesce(c.layout, '') <> all($2)
       and s.set_type = any($3)
       and c.image_uris is not null
     order by key, (p.eur is null), (c.collector_number ~ '^[0-9]+$') desc, s.released_at desc`,
    [lower, EXCLUDED_LAYOUTS, PRINT_SET_TYPES],
  )
  const map = new Map(rows.map((r) => [r.key, r]))
  const missing = wanted.filter((n) => !map.has(n.toLowerCase()))
  return { get: (name) => map.get(name.toLowerCase()), missing }
}

async function draftPool(client, setCodes) {
  const { rows } = await client.query(
    `select distinct on (c.oracle_id) c.id, c.rarity, c.finishes, c.set_code
     from cards c
     where c.set_code = any($1)
       and coalesce(c.layout, '') <> all($2)
       and c.rarity in ('common', 'uncommon', 'rare', 'mythic')
       and c.type_line not like 'Basic Land%'
       and c.collector_number ~ '^[0-9]+$'
       and c.image_uris is not null
     order by c.oracle_id, c.collector_number::int`,
    [setCodes, EXCLUDED_LAYOUTS],
  )
  return rows
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

const LANGS = ['en', 'en', 'en', 'en', 'en', 'en', 'en', 'en', 'fr', 'de', 'ja', 'it']
const CONDITIONS = ['nm', 'nm', 'nm', 'nm', 'nm', 'lp', 'lp', 'mp', 'hp']
const NOTES = ['for trade', 'signed', 'from prerelease', 'misprint?', 'artist proof', 'gift from Sam']

function physicalDetails() {
  return {
    language: pick(LANGS),
    condition: pick(CONDITIONS),
    notes: rand() < 0.015 ? pick(NOTES) : null,
  }
}

async function main() {
  const client = await pool.connect()
  const missingReport = []
  try {
    await client.query('begin')

    // --- Nettoyage (idempotence) -------------------------------------------
    const { rows: old } = await client.query('select id from users where email = $1', [EMAIL])
    if (old[0]) {
      await client.query(
        'delete from collections where id in (select collection_id from collection_members where user_id = $1)',
        [old[0].id],
      )
      await client.query('delete from users where id = $1', [old[0].id])
    }

    // --- Compte & collection -----------------------------------------------
    const {
      rows: [user],
    } = await client.query(
      `insert into users (email, email_verified, username, display_name, role, collection_style, tool_life_tracker)
       values ($1, now(), $2, $3, 'member', 'shelves', true) returning id`,
      [EMAIL, USERNAME, DISPLAY_NAME],
    )
    const {
      rows: [collection],
    } = await client.query(`insert into collections (name) values ($1) returning id`, [`${DISPLAY_NAME} collection`])
    await client.query(`insert into collection_members (collection_id, user_id, role) values ($1, $2, 'owner')`, [
      collection.id,
      user.id,
    ])

    let sortOrder = 0
    async function createContainer(fields) {
      const { rows } = await client.query(
        `insert into containers (collection_id, kind, name, cover_card_id, cover_gradient, visibility,
                                 deck_state, format, folder_id, description, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [
          collection.id,
          fields.kind,
          fields.name,
          fields.coverCardId ?? null,
          fields.coverGradient ?? null,
          fields.visibility ?? 'private',
          fields.deckState ?? null,
          fields.format ?? null,
          fields.folderId ?? null,
          fields.description ?? null,
          sortOrder++,
        ],
      )
      return rows[0].id
    }

    // Holdings agrégés en mémoire puis insérés en lot (clé = container,
    // carte, finition, zone, langue, état) : jamais deux lignes identiques.
    const holdings = new Map()
    function addHolding(containerId, card, qty, opts = {}) {
      const finish = opts.finish ?? 'nonfoil'
      const zone = opts.zone ?? 'main'
      const language = opts.language ?? 'en'
      const condition = opts.condition ?? 'nm'
      const key = [containerId, card.id, finish, zone, language, condition].join('|')
      const existing = holdings.get(key)
      if (existing) {
        existing.qty += qty
        return
      }
      holdings.set(key, {
        containerId, cardId: card.id, qty, finish, zone, language, condition,
        notes: opts.notes ?? null, isCommander: zone === 'commander',
        // Ajouts étalés sur ~2 ans, pour que « Recently added » ait du sens.
        daysAgo: opts.daysAgo ?? between(0, 720),
      })
    }
    const foilable = (card) => card.finishes.includes('foil')

    // --- Résolution de tous les noms ---------------------------------------
    const allNames = [
      ...Object.keys(COMMANDER_STAPLES),
      ...Object.keys(DUAL_LANDS),
      ...WISHLIST,
      ...MODERN_UPGRADES,
      'Plains', 'Island', 'Swamp', 'Mountain', 'Forest',
      'Sheoldred, the Apocalypse', 'Atraxa, Grand Unifier', 'Ugin, the Spirit Dragon', 'Sliver Overlord',
      ...DECKS.flatMap((d) => [
        ...(d.commander ? [d.commander] : []),
        ...d.cards.map((c) => (Array.isArray(c) ? c[0] : c)),
        ...(d.side ?? []).map((c) => c[0]),
        ...Object.keys(d.fill ?? {}),
      ]),
    ]
    const cards = await resolveByName(client, allNames)
    missingReport.push(...cards.missing)

    // --- Collection racine : pools de boosters -----------------------------
    const rootId = await createContainer({ kind: 'collection', name: `${DISPLAY_NAME} collection` })
    const boosterPool = await draftPool(client, DRAFT_SETS)
    for (const card of boosterPool) {
      const keepChance = { common: 0.7, uncommon: 0.6, rare: 0.35, mythic: 0.18 }[card.rarity]
      if (rand() > keepChance) continue
      const qty =
        card.rarity === 'common' ? between(1, 6) : card.rarity === 'uncommon' ? between(1, 3) : between(1, 2)
      const foil = foilable(card) && rand() < 0.07
      addHolding(rootId, card, qty, { ...physicalDetails(), finish: foil ? 'foil' : 'nonfoil' })
    }
    // Basiques en vrac : on en a toujours trop.
    for (const basic of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) {
      const card = cards.get(basic)
      if (card) addHolding(rootId, card, between(25, 60))
    }

    // --- Binders -------------------------------------------------------------
    const cover = (name) => cards.get(name)?.id ?? null

    const staplesId = await createContainer({
      kind: 'binder', name: 'Commander staples', coverGradient: 'purple', coverCardId: cover('Rhystic Study'),
    })
    for (const [name, qty] of Object.entries(COMMANDER_STAPLES)) {
      const card = cards.get(name)
      if (card) addHolding(staplesId, card, qty, physicalDetails())
    }

    const landsId = await createContainer({
      kind: 'binder', name: 'Dual lands', coverGradient: 'green', coverCardId: cover('Overgrown Tomb'),
    })
    for (const [name, qty] of Object.entries(DUAL_LANDS)) {
      const card = cards.get(name)
      if (card) addHolding(landsId, card, qty, { ...physicalDetails(), finish: foilable(card) && rand() < 0.15 ? 'foil' : 'nonfoil' })
    }

    const rares = shuffle(boosterPool.filter((c) => c.rarity === 'rare' || c.rarity === 'mythic'))
    const tradeId = await createContainer({
      kind: 'binder', name: 'Trade binder', coverGradient: 'gold', visibility: 'public',
      coverCardId: cover('Sheoldred, the Apocalypse'),
      description: 'Everything in here is up for trade. Ask!',
    })
    for (const card of rares.slice(0, 160)) {
      addHolding(tradeId, card, between(1, 2), { ...physicalDetails(), notes: rand() < 0.1 ? 'for trade' : null })
    }

    const foilsId = await createContainer({
      kind: 'binder', name: 'Foils', coverGradient: 'blue', coverCardId: cover('Atraxa, Grand Unifier'),
    })
    for (const card of shuffle(boosterPool.filter(foilable)).slice(0, 90)) {
      addHolding(foilsId, card, 1, { ...physicalDetails(), finish: 'foil' })
    }

    const oldPool = await draftPool(client, OLD_SETS)
    const oldId = await createContainer({ kind: 'binder', name: 'Old school', coverGradient: 'grey' })
    for (const card of shuffle(oldPool).slice(0, 240)) {
      const condition = pick(['lp', 'lp', 'mp', 'mp', 'hp', 'nm', 'dmg'])
      addHolding(oldId, card, card.rarity === 'common' ? between(1, 4) : 1, {
        condition, language: pick(['en', 'en', 'en', 'de', 'fr', 'it']),
      })
    }

    const bulkRaresId = await createContainer({
      kind: 'binder', name: 'Bulk rares', coverGradient: 'red', coverCardId: cover('Ugin, the Spirit Dragon'),
    })
    for (const card of rares.slice(160, 420)) addHolding(bulkRaresId, card, between(1, 3), physicalDetails())

    // --- Listes ------------------------------------------------------------
    const wishId = await createContainer({ kind: 'list', name: 'Wishlist', coverGradient: 'gold' })
    for (const name of WISHLIST) {
      const card = cards.get(name)
      if (card) addHolding(wishId, card, 1)
    }
    const upgradesId = await createContainer({ kind: 'list', name: 'Modern upgrades', coverGradient: 'blue' })
    for (const name of MODERN_UPGRADES) {
      const card = cards.get(name)
      if (card) addHolding(upgradesId, card, name === 'Counterspell' || name === 'Consider' ? 4 : between(1, 4))
    }
    const cubeId = await createContainer({ kind: 'list', name: 'Cube candidates', coverGradient: 'purple' })
    for (const card of shuffle(rares).slice(0, 45)) addHolding(cubeId, card, 1)

    // --- Dossiers & decks ---------------------------------------------------
    const folderIds = {}
    for (const [position, name] of FOLDERS.entries()) {
      const { rows } = await client.query(
        'insert into deck_folders (collection_id, name, position) values ($1, $2, $3) returning id',
        [collection.id, name, position],
      )
      folderIds[name] = rows[0].id
    }

    for (const deck of DECKS) {
      const commanderCard = deck.commander ? cards.get(deck.commander) : null
      const deckId = await createContainer({
        kind: 'deck',
        name: deck.name,
        deckState: deck.state,
        format: deck.format,
        folderId: deck.folder ? folderIds[deck.folder] : null,
        coverGradient: deck.gradient,
        coverCardId: commanderCard?.id ?? cards.get(Array.isArray(deck.cards[0]) ? deck.cards[0][0] : deck.cards[0])?.id,
      })
      // Un deck monté repose sur du stock physique : ses exemplaires sont
      // ajoutés à la collection racine (`availableQtyExpr`).
      const owned = deck.state === 'built'
      let mainCount = 0
      if (commanderCard) {
        addHolding(deckId, commanderCard, 1, { zone: 'commander' })
        if (owned) addHolding(rootId, commanderCard, 1)
      }
      for (const entry of deck.cards) {
        const [name, qty] = Array.isArray(entry) ? entry : [entry, 1]
        const card = cards.get(name)
        if (!card) continue
        addHolding(deckId, card, qty)
        if (owned) addHolding(rootId, card, qty, { daysAgo: between(30, 400) })
        mainCount += qty
      }
      for (const [name, qty] of deck.side ?? []) {
        const card = cards.get(name)
        if (!card) continue
        addHolding(deckId, card, qty, { zone: 'side' })
        if (owned) addHolding(rootId, card, qty)
      }
      // Complète avec des basiques jusqu'à la taille du format.
      const target = deck.size - (commanderCard ? 1 : 0)
      const basics = Object.keys(deck.fill ?? {}).map((n) => cards.get(n)).filter(Boolean)
      for (let i = 0; mainCount < target && basics.length; i++, mainCount++) {
        addHolding(deckId, basics[i % basics.length], 1)
        if (owned) addHolding(rootId, basics[i % basics.length], 1)
      }
    }

    // --- Insertion en lot ----------------------------------------------------
    const rows = [...holdings.values()]
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000)
      const values = []
      const params = []
      chunk.forEach((h, j) => {
        const b = j * 10
        values.push(
          `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, now() - ($${b + 10} || ' days')::interval)`,
        )
        params.push(h.containerId, h.cardId, h.qty, h.finish, h.condition, h.language, h.notes, h.isCommander, h.zone, String(h.daysAgo))
      })
      await client.query(
        `insert into holdings (container_id, card_id, qty, finish, condition, language, notes, is_commander, zone, added_at)
         values ${values.join(', ')}`,
        params,
      )
    }

    // --- container_stats (même calcul que lib/containers/stats.ts) ---------
    await client.query(
      `insert into container_stats (container_id, card_count, unique_count, value_usd_minor, value_eur_minor, computed_at)
       select c.id,
         coalesce(sum(h.qty), 0)::int,
         count(h.id)::int,
         coalesce(sum(round(h.qty * coalesce(case when h.finish = 'nonfoil' then p.usd else p.usd_foil end, 0) * 100)), 0)::bigint,
         coalesce(sum(round(h.qty * coalesce(case when h.finish = 'nonfoil' then p.eur else p.eur_foil end, 0) * 100)), 0)::bigint,
         now()
       from containers c
       left join holdings h on h.container_id = c.id
       left join card_prices p on p.card_id = h.card_id and p.day = (select max(day) from card_prices)
       where c.collection_id = $1
       group by c.id`,
      [collection.id],
    )

    await client.query('commit')

    const { rows: summary } = await client.query(
      `select c.kind, c.name, c.deck_state, c.format, s.card_count, s.unique_count, s.value_eur_minor / 100.0 as eur
       from containers c join container_stats s on s.container_id = c.id
       where c.collection_id = $1 order by c.sort_order`,
      [collection.id],
    )
    console.table(summary)
    if (missingReport.length) console.warn('Noms introuvables (ignorés) :', [...new Set(missingReport)])
    console.log(`Compte : ${EMAIL} (username ${USERNAME})`)
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
