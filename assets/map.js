// The world: map.html?g=<game>. Everyone sees it; see mapview.js for what it shows.
import { bootstrap } from './games.js';
import { GameClient } from './api.js';
import { pageShell, refreshNav, noGame } from './core.js';
import { mountMap } from './mapview.js';

const app = document.getElementById('app');
const game = bootstrap();
if (!game) noGame(app, 'map');
const client = new GameClient(game);
pageShell(app, client, 'map');
const main = document.createElement('main');
const drawer = document.createElement('div'); // the card a place on the map opens
drawer.id = 'mapcard';
drawer.className = 'mapcard';
app.append(main, drawer);
const view = mountMap({ client, game, main, drawer });
client.on(e => { if (e.list) refreshNav(client, 'map'); });
client.watch('Map', 'Ship');
client.read(['Map', 'Ship']).catch(() => view.render());
client.startPolling();
