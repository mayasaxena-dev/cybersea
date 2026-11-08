// A made-up game for tests and the dev server. All "rules" text here is invented
// placeholder prose; the real rulebook text only ever lives in the spreadsheet.
import { png } from './png.mjs';

const R = (kind, group, name, text, meta = '', vis = 'crew') => [kind, group, name, text, meta, vis];

// A game's own wording for a book row: [...row, Override name, Override text, Override meta].
const O = (row, oname = '', otext = '', ometa = '') => [...row, oname, otext, ometa];

// Pictures placed in the Map tab's Image cells (Insert > Image > Insert image in cell).
const pic = image => ({ image });
export const IMAGES = {
  map: { type: 'image/png', bytes: png(64, 40, [20, 60, 120]) },
  level1: { type: 'image/png', bytes: png(32, 32, [120, 40, 20]) },
  level2: { type: 'image/png', bytes: png(32, 32, [20, 120, 40]) },
  dock: { type: 'image/png', bytes: png(48, 30, [90, 90, 160]) },
};

// The Images tab: pictures kept once, named from Image cells (or, for a crew member, by their name).
export const imagesRows = () => [['Name', 'Image'], ['Dock picture', pic(IMAGES.dock)], ['Bo Brine', pic(IMAGES.level1)]];

export const RULES_HEADER = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis', 'Override name', 'Override text', 'Override meta'];
export const MAP_HEADER = ['Region', 'Location', 'Level', 'Image', 'Text', 'GM notes', 'Shown', 'On', 'Where', 'Depth'];

// The world: a region's map with places on it (one floating, one static, the ship), places that
// are only cards (one hidden, one with levels) and the GM's notes.
export const mapRows = () => [
  ['The Test Server', '', '', pic(IMAGES.map), 'Everything, all at once.', 'The map is upside down.', '', '', '', ''],
  ['The Test Server', 'Packet Reef', '', pic(IMAGES.map), 'A reef of lost packets.', 'Sharks below.', 'on', '', '', ''],
  ['The Test Server', 'Scrap Town', '', '', 'A town of scrap.', '', '', '', '', ''],
  ['', 'Scrap Town', 'Level 1', pic(IMAGES.level1), 'The docks.', '', '', '', '', ''],
  ['', 'Scrap Town', 'Level 2', pic(IMAGES.level2), 'The market.', '', '', '', '', ''],
  ['The Test Server', 'Bit Lagoon', '', pic(IMAGES.dock), 'Warm, shallow and full of bits.', '', 'on', '', '28 62 24', '2'],
  ['The Test Server', 'Old Relay', '', pic(IMAGES.level1), 'A tower that still hums.', 'Someone is listening.', 'on', '', '72 34 14', ''],
  ['The Test Server', 'Dark Vault', '', pic(IMAGES.dock), 'Locked tight.', 'The crew have not found it yet.', 'static', '', '84 78 12', ''],
  ['The Test Server', 'The Gull', '', pic(IMAGES.level2), 'Our ship.', '', 'on', '', '50 48 8', ''],
  ['Far Away', 'Hidden Dock', '', 'Dock picture', 'Only the GM knows.', '', '', '', '', ''],
];
export const HEADER = ['Kind', 'Name', 'Value', 'Notes'];

// The System tab (assets/system.js): stats, tracks and cards for a new sheet, and the options of
// the log's actions, NPC sizes and clocks. Kind | Group | Name | Text | Meta.
const S = (kind, group, name, text, meta = '') => [kind, group, name, text, meta];
export const SYSTEM_HEADER = ['Kind', 'Group', 'Name', 'Text', 'Meta'];
export const system = [
  S('stat', 'pirate', 'Blood', 'grit/nerve'),
  ...['Vinegar', 'Polish', 'Spitfire'].map(n => S('stat', 'pirate', n, '')),
  ...['Steadfast', 'Speed', 'Fortune'].map(n => S('stat', 'ship', n, '')),
  S('track', 'pirate', 'Harm', '', 'role=harm size=6 skulls=3'),
  S('track', 'pirate', 'Luck', '', 'role=luck size=5 start=Spitfire refill=Spitfire'),
  S('track', 'pirate', 'Vice', '', 'role=vice size=1'),
  S('track', 'pirate', 'Experience', '', 'role=xp size=level+6'),
  S('track', 'pirate', 'Treasure', '', 'role=treasure size=5'),
  S('track', 'pirate', 'Hoard', '', 'role=hoard size=5'),
  S('section', 'pirate', 'Vice', '', 'role=vice fill=vices'),
  S('section', 'pirate', 'Oddity', '', 'role=oddity fill=oddity'),
  S('section', 'pirate', 'Bonds', '', 'role=bonds size=3 full=xp:1'),
  S('section', 'pirate', 'Troubles', '', 'role=troubles'),
  S('section', 'pirate', 'Experience', '', 'role=xp'),
  S('section', 'pirate', 'Treasure', '(5-treasure = 1-hoard)', 'role=treasure tab=kit'),
  S('section', 'pirate', 'Items', '', 'role=kit tab=kit tags=item,weapon'),
  S('section', 'pirate', 'Questions', '', 'tab=notes fill=questions'),
  S('section', 'pirate', 'Last Words', '', 'tab=notes fill=lastwords'),
  S('track', 'ship', 'Wreck', '', 'role=harm size=Steadfast+3'),
  S('track', 'ship', 'Renown', '', 'role=luck size=5'),
  S('section', 'ship', 'Oddity', '', 'role=oddity fill=oddity'),
  S('section', 'ship', 'Kit', '', 'role=kit fill=kit tags=item,weapon'),
  S('section', 'ship', 'Cargo', '({Fortune+5} cargo space)', 'role=cargo'),
  S('section', 'ship', 'Crew', '({Fortune+5} crew space)', 'role=crew tab=crew type=npc table=Hands serves="Hand of"'),
  S('section', 'ship', 'Specials', '', 'role=specials fill=specials'),
  S('section', 'ship', 'Questions', '', 'tab=notes fill=questions'),
  S('track', 'npc', 'Harm', '', 'role=harm'),
  S('choice', 'chapter-end', 'Replenish all bonds', '', 'refresh=bonds'),
  S('choice', 'chapter-end', '+1 experience', '', 'pick gain=xp:1'),
  S('choice', 'chapter-end', '+2 luck', '', 'pick gain=luck:2'),
  S('choice', 'chapter-end', 'Heal 2 harm', '', 'pick heal=harm:2'),
  S('choice', 'begin-downtime', 'In port', '', 'slots=2'),
  S('choice', 'begin-downtime', 'At sea', '', 'slots=1'),
  ...[['Mook', 1], ['Combatant', 2], ['Threat', 4], ['Villain', 6]].map(([n, k]) => S('choice', 'npc', n, '', `size=${k}`)),
  S('choice', 'clock', 'Clock', '', 'size=6'),
];

export const rules = [
  R('move', 'basic', 'POKE AROUND', 'When you *poke around* somewhere odd, roll +VINEGAR. On a 10+, ask 2. On a 7-9, ask 1.\n\n- what is hidden here?\n- who is watching?', 'roll=Vinegar'),
  R('move', 'basic', 'START TROUBLE', 'When you *start trouble*, roll +BLOOD. On a hit, deal your harm.', 'roll=Blood'),
  R('move', 'basic', 'SWEET TALK', 'When you *sweet talk* someone, roll +POLISH. On a hit, they listen.', 'roll=Polish'),
  R('move', 'basic', 'FLIP A COIN', 'When you *flip a coin*, pay **1-luck** and invent a helpful detail.', 'spend=luck:1'),
  R('move', 'special', 'CHEAT DEATH', 'When you *cheat death*, **roll blank**. ^Take -1 per scar.^', 'roll=2d6 per="-1 per scar"'),
  R('move', 'special', 'SCARPER', 'When you *scarper*, spend any number of bonds and roll +bonds spent.', 'roll="+bonds spent"'),
  R('move', 'special', 'COUNT THE LOOT', 'When your crew *counts the loot*, one of the crew rolls **1d6**.', 'roll=1d6'),
  R('move', 'ship', 'RAM IT', 'When your crew *rams something*, roll +STEADFAST.', 'roll=Steadfast'),
  R('move', 'ship', 'CHART A COURSE', 'When your crew *charts a course*, the navigator rolls +SPITFIRE.', 'roll=Spitfire'),
  R('move', 'downtime', 'BEGIN DOWNTIME', 'When you *make port*, begin a downtime.', 'action=begin-downtime label="Begin Downtime"'),
  R('move', 'downtime', 'LEAVE DOWNTIME', 'When you *set sail*, finish your downtime and **heal all harm** taken before it began.', 'action=leave-downtime label="Leave Downtime"'),
  R('move', 'downtime', 'DICE GAME', 'When you play dice during downtime, roll +SPITFIRE.', 'roll=Spitfire'),
  R('move', 'downtime', 'FIX IT UP', 'When you fix something during downtime, roll +VINEGAR.', 'roll=Vinegar'),

  R('procedure', 'session', 'SESSION START', 'At the start of a session, luck refills up to your SPITFIRE.', 'action=session-begin label="Session Begins"'),
  R('procedure', 'session', 'SESSION CLOSE', 'When the session closes, look over your moves for anything that happens now.', 'action=session-end label="Session Ends"'),
  R('procedure', 'chapter', 'CHAPTER CLOSE', 'When a chapter closes, refresh every bond and pick two.\n\n- One experience.\n- Two luck.\n- Two harm healed.', 'action=chapter-end label="Chapter’s End" picks=2'),
  R('procedure', 'downtime', 'DOWNTIME LIMITS', 'Two downtime moves in port, one at sea.', 'action=begin-downtime'),
  R('procedure', 'advance', 'LEVELS', 'Fill your tally to level up, then wipe it and pick an advance.', 'action=level-up label="Level Up"'),
  R('procedure', 'experience', 'EXPERIENCE', '- Miss a roll.\n- Fill a bond.'),
  R('house', 'session', 'LUCK FLOOR', 'House rule: take at least 1 luck at session start.', 'floor=luck:1'),

  R('advance', 'all', 'Raise a trait (three times at most).', '', 'kind=trait max=3 cap=3'),
  R('advance', 'all', 'Gain a bond.', '', 'kind=bond'),
  R('advance', 'all', 'Take an unmarked playbook move.', '', 'kind=move'),
  R('advance', 'all', 'Gain a new oddity.', '', 'kind=oddity'),

  R('playbook', 'Trickster', 'Trickster', 'A sly one with a passenger in their head.', 'type=pirate harm=6 luck=8 pick=0'),
  R('vice', 'Trickster', 'HAUNTED', 'While Haunted, you do as the passenger says. Endpoint: say no. At the end of a session, if you are still Haunted, mark experience.', 'session=end gain=xp:1'),
  R('oddity', 'Trickster', 'THIRD EYE', 'You can see secrets, at a price.', 'traits=0,-1,0,+2'),
  R('oddity', 'Trickster', 'CARD SHARP', 'You never lose at cards, almost.', 'traits=-2,+1,+1,+1'),
  R('kit', 'Trickster', 'Kit 1', 'Dagger, cloak, tarot deck'),
  R('kit', 'Trickster', 'Kit 2', 'Bone dice, a lantern (cracked, still works), 6-treasure'),
  R('lastwords', 'Trickster', 'Last Words', 'When you speak your last words, choose one:\n\n- Go out in fire.\n- Make one more deal.'),
  R('question', 'Trickster', '1', 'What does your passenger want?'),
  R('pmove', 'Trickster', 'SUMMON', 'Mark 2 powers. When you summon a power, spend 1-luck and roll +SPITFIRE.\n\n[ ] Shadow cloak.\n[ ] Fire burst.\n[ ] Shape change.', 'start roll=Spitfire spend=luck:1'),
  R('pmove', 'Trickster', 'HAGGLE', 'When you haggle with your passenger, spend a bond and roll +POLISH.', 'start roll=Polish'),
  R('pmove', 'Trickster', 'HEX', 'Your enemy has a run of bad luck.', 'adv'),
  R('pmove', 'Trickster', 'LUCKY BREAK', 'Mark 1-luck when you end a session Haunted.', 'adv session=end gain=luck:1'),
  R('pmove', 'Trickster', 'OMEN', 'At the start of each session, roll +SPITFIRE. On a hit, hold 1 until the end of the session.', 'adv session=start,end roll=Spitfire'),
  R('pmove', 'Trickster', 'BAD PENNY', 'Your passenger turns up when you least want it.', 'adv session=start'),

  R('playbook', 'Brute', 'Brute', 'Big and loud.', 'type=pirate harm=8 luck=5 pick=1'),
  R('vice', 'Brute', 'ANGRY', 'While Angry, you hit first. Endpoint: walk away.'),
  R('oddity', 'Brute', 'IRON SKIN', 'Nothing small hurts you.', 'traits=+2,0,-1,0'),
  R('pmove', 'Brute', 'SMASH', 'When you smash something, roll +BLOOD.', 'start roll=Blood'),
  R('pmove', 'Brute', 'ROAR', 'When you roar, enemies flinch.', 'adv'),

  R('playbook', 'Skiff', 'Skiff', 'A small fast boat.', 'type=ship'),
  R('oddity', 'Skiff', 'PATCHED SAIL', 'It always gets there, somehow.'),
  R('kit', 'Skiff', 'Kit 1', 'Two oars, a lantern', 'traits=0,+2,+1'),
  R('smove', 'Skiff', 'SLIP AWAY', 'When the skiff slips away, roll +SPEED.', 'roll=Speed'),

  R('tag', 'item', 'shiny', 'Worth more than it looks.'),
  R('tag', 'weapon', 'loud', 'Everyone hears it.'),
  R('tag', 'weapon', 'sharp', ''),
  R('tag', 'npc', 'jumpy', 'Startles easily.'),
  R('tag', 'npc', 'Good at [something]', 'Take +1 when they help with it.'),
  R('tag', 'npc', 'Armor-x', 'Ignores that much harm.'),
  R('trouble', 'table', 'Soaked', 'Everything you carry is wet.'),
  R('fate', 'move', 'SPRING A TRAP', 'Something closes in.\n\n- The floor gives way.', '', 'gm'),
  R('fate', 'compass', 'BE CURIOUS', 'Ask questions.', '', 'gm'),
  R('table', 'Gear', 'Rope', 'A coil of rope.', 'cost=1'),
  R('table', 'Hands', 'Deckhand', 'Bo Brine, salt in his beard; Ada Keel, one gold tooth', 'tags="1-harm, good at knots, jumpy" harm=2'),
  R('table', 'Hands', 'Cook', 'Pip Ladle, flour everywhere', 'tags="good at stew, armor-1" harm=1'),

  O(R('kit', 'Brute', 'Kit 1', 'Club, sack, rope'), '', 'Club, sack, data cable'),
];

export const sampleCharacter = [
  ['info', 'Name', 'Testa', ''],
  ['info', 'Playbook', 'Trickster', ''],
  ['info', 'Player', 'Sam', ''],
  ['info', 'Level', '0', ''],
  ['stat', 'Blood', '0', ''],
  ['stat', 'Vinegar', '-1', ''],
  ['stat', 'Polish', '0', ''],
  ['stat', 'Spitfire', '+2', ''],
  ['track', 'Harm', '●○○○○○', ''],
  ['track', 'Luck', '●●●●○○○○', ''],
  ['track', 'Vice', '○', ''],
  ['track', 'Experience', '●●○○○○', ''],
  ['bond', 'Ship', '●●·', ''],
  ['bond', 'Passenger', '●○·', ''],
  ['bond', 'Bo', '●··', ''],
  ['sheet', 'Vice', '**Haunted:** a made-up vice for testing.', ''],
  ['sheet', 'Bonds', '', ''],
  ['sheet', 'Kit', '- Dagger\n  - rusty\n- Cloak', ''],
  ['sheet', 'Troubles', '', ''],
  ['sheet', 'Experience', '- 1 (a test)', '(6 exp = 1 advancement)'],
  ['notes', 'Story', '- Once a librarian.', ''],
  ['move', 'SUMMON', '●', 'Mark 2 powers. When you summon a power, spend 1-luck and roll +SPITFIRE.\n\n[x] Shadow cloak.\n[ ] Fire burst.\n[x] Shape change.'],
  ['move', 'HAGGLE', '●', ''],
];

export const sampleShip = [
  ['info', 'Name', 'The Gull', ''],
  ['info', 'Playbook', 'Skiff', ''],
  ['stat', 'Steadfast', '0', ''],
  ['stat', 'Speed', '+2', ''],
  ['stat', 'Fortune', '+1', ''],
  ['track', 'Wreck', '○○○', ''],
  ['track', 'Renown', '●○○○○', ''],
  ['sheet', 'Kit', '', ''],
  ['sheet', 'Cargo', '', '(6 cargo space)'],
  ['item', 'Two oars', '', ''],
  ['cargo', 'Crate of limes', '2', ''],
  ['sheet', 'Crew', '', '(6 crew space)'],
  ['crew', 'Bo Brine', '●○', 'Type: Deckhand\nServes: Testa\nTags: 1-harm, good at knots, jumpy\n\nFound asleep in the hold.'],
];

// Tabs for the fake spreadsheet, as they'd be typed in (row 1 = header).
export function gameTabs({ withCharacter = true } = {}) {
  return {
    Rules: [RULES_HEADER, ...rules],
    System: [SYSTEM_HEADER, ...system],
    Lore: [[...HEADER, 'Image'], ['place', 'Gull Harbor', 'A rainy port.', 'Sam', pic(IMAGES.level1)]],
    GM: [HEADER, ['npc', 'Captain Vex', 'jumpy, loud', 'Owes the crew money.'], ['secret', 'Twist', 'The map is fake.', '']],
    Ship: [HEADER, ...sampleShip],
    Map: [MAP_HEADER, ...mapRows()],
    Images: imagesRows(),
    ...(withCharacter ? { Testa: [HEADER, ...sampleCharacter] } : {}),
  };
}

// Crew need no passphrase unless CREW_KEY is set; the fixture game leaves it unset.
export const KEYS = { GM_KEY: 'gm-pass' };

// Code.gs as an older deployment still runs it: one version behind what the site needs.
export function asOldScript(src) {
  const now = src.match(/const API_VERSION = (\d+);/);
  if (!now) throw new Error('asOldScript: no API_VERSION');
  return src.replace(now[0], `const API_VERSION = ${now[1] - 1};`);
}
