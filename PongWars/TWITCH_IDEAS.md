# Pong Wars — stream waiting screen & Twitch chat integration

This demo is a port of the [vnglst/pong-wars](https://github.com/vnglst/pong-wars)
mechanic (MIT), rebuilt on this repo's modern-HUD canvas pattern and extended for use
as a **stream "starting soon" / BRB screen**:

- **2, 4, 6, or 8 teams** fight over a tiled board — each ball flips the enemy tile it
  touches to its own colour and bounces, so the frontiers slosh around and *never settle*
  (a perfect infinite idle loop). Teams start in rectangular home blocks (2 = left/right,
  4 = quadrants, 6 = 3×2, 8 = 4×2);
- a **live scoreboard** (top-centre) with renameable teams and a per-team territory bar;
- a **"Starting Soon" overlay** with editable title/subtitle;
- colour presets (incl. a Twitch-purple theme) that extend to every team count, plus
  per-team custom colour pickers;
- and — the point of this doc — a small **remote-control API** (`window.PongWars`) plus
  four transports, so Twitch **channel-point redemptions** and **chat commands** can
  reach in and mess with the battle live.

> Everything here works **client-side**. The demo never talks to Twitch directly — a
> tiny bridge (a bot or an EventSub listener you run) translates Twitch events into
> `PongWars` calls. That keeps your tokens/secrets out of the browser source.

---

## 1. Quick start

### Run it locally
ES module imports need an HTTP server (see the repo `CLAUDE.md`):

```bash
python -m http.server 8080
# then open http://localhost:8080/PongWars/PongWars.html
```

Hotkeys: **Space** pause · **R** reset · **N** re-launch balls · **S** save PNG ·
**O** toggle the overlay. The HUD panel (top-left ☰) exposes every setting — team count
(2/4/6/8), per-team names & colours, presets — plus a **"Chat-event preview"** row that
fires the same API a redemption would; use it to rehearse before you go live.

### As an OBS / Streamlabs browser source
Add a **Browser Source** pointing at the page URL. Recommended: 1920×1080, "Shutdown
source when not visible" off. The canvas auto-fills the source; the HUD panel is
harmless on stream but you can hide it (the ☰ toggle) or crop it out.

### Preconfigure with URL parameters
No code needed — bake the look into the browser-source URL:

| Param | Example | Effect |
|-------|---------|--------|
| `teams` | `?teams=4` | number of teams — `2` · `4` · `6` · `8` |
| `names` | `?names=Red,Blue,Green,Gold` | team names, comma-separated (in order) |
| `colors` | `?colors=ff0000,0000ff,00cc66,f5a623` | team colours, comma-separated hex (no `#`) |
| `preset` | `?preset=twitch` | `classic` · `twitch` · `fireice` · `mono` (palette extends to all team counts) |
| `a`, `b` | `?a=Mods&b=Chat` | shortcut for the first two team names (2-team setups) |
| `colorA`, `colorB` | `?colorA=9146ff&colorB=ffffff` | shortcut for the first two team colours (hex, no `#`) |
| `speed` | `?speed=10` | ball speed (2–16) |
| `cell` | `?cell=20` | tile size px (8–48; smaller = finer board) |
| `balls` | `?balls=3` | balls per team (1–8; total capped at 60) |
| `glow` | `?glow=0` | ball glow on/off |
| `score` | `?score=0` | hide the scoreboard |
| `title`, `sub` | `?title=Starting+Soon&sub=back+in+5` | overlay text |
| `soon` | `?soon=1` | show the waiting-screen overlay on load |
| `ws` | `?ws=ws://localhost:8787` | connect to a control WebSocket (see §4) |

Examples:
```
# 2-team classic waiting screen
PongWars.html?a=Team+Mods&b=Team+Chat&balls=3&soon=1&title=Starting+Soon

# 4-way faction war, custom names + colours
PongWars.html?teams=4&names=Reds,Blues,Greens,Golds&colors=e74c3c,3498db,27ae60,f5a623
```

---

## 2. The control API (`window.PongWars`)

Open dev-tools on the page and try `PongWars.boost('a')`. Every method is also reachable
remotely via the transports in §4 (the read/observe methods are local-only).

### Battle actions — the fun stuff for redemptions
| Call | What it does |
|------|--------------|
| `boost(team, factor=2, ms=5000)` | speed up one team's balls for a while |
| `spawnBall(team, n=1)` | add `n` balls to a team (more balls = faster conquest; 60 total cap) |
| `removeBall(team, n=1)` | remove balls from a team |
| `paintBlob(team, x, y, radius)` | flip a circular patch to a team. `x`/`y` accept px **or** normalised `0..1`; omit for random |
| `paintRandom(team, n=40)` | scatter `n` random tiles to a team (chaos sprinkle) |

### Presentation
| Call | What it does |
|------|--------------|
| `setTeamCount(n)` | set the number of teams — `2` · `4` · `6` · `8` (rebuilds the board) |
| `setTeamName(team, name)` | rename a side (updates scoreboard) |
| `setTeamColor(team, color)` | recolour a side (`'#rrggbb'`) |
| `setPreset(name)` | swap colour theme (`classic`/`twitch`/`fireice`/`mono`) |
| `banner(text, ms=3000)` | flash a toast, e.g. `"@user followed! 💜"` |
| `shake()` | screen-shake the board for hype |
| `overlay(on, title?, sub?)` | show/hide the waiting-screen overlay + set text |

### Config
`setSpeed(v)` · `setCellSize(px)` · `setBallsPerTeam(n)`

### Lifecycle
`reset()` (new round) · `relaunch()` (re-throw balls, keep territory) ·
`pause()` · `resume()` · `togglePause()`

### Read / observe (local only)
- `getState()` →
  ```js
  {
    teamCount,                                   // 2 | 4 | 6 | 8
    teams: [{ index, name, color, score, percent }, ...],
    scores: [..], names: [..], colors: [..],     // parallel arrays, length teamCount
    leader,                                      // team index, or null on a tie
    paused, roundOver, ballsPerTeam, cellSize, speed
  }
  ```
- `on(event, cb)` / `off(event, cb)` — events: **`win`**, **`lead`** (lead change),
  **`boost`**, **`reset`**. Also dispatched on `window` as `pongwars:win`, etc. The
  `win`/`lead`/`boost` payloads carry `{ team: <index>, name }`.

> **Team identifiers** are forgiving: the **index** `0..7`, the **letter** `'a'..'h'`
> (`'a'` = team 0), or the team's **display name** (case-insensitive). So once you
> `setTeamName('a','Mods')`, a redemption can target `'Mods'` directly. Out-of-range
> indices are clamped to the live team count.

```js
PongWars.on('win', s => console.log(s.name, 'won the round'));
```

---

## 3. Anti-grief: keep chat fun, not destructive

Wire these into the *bridge*, not the demo, so they're easy to tune:

- **Prefer additive powers** (`boost`, `spawnBall`, `paintBlob`) over destructive ones.
  `paintRandom` with a big `n` or unlimited `spawnBall` can flatten a round — cap them.
- **Rate-limit per user** (e.g. one redemption / 30 s) and **globally** (queue events,
  apply ~1–2/s) so a raid can't freeze the board. The board auto-resets at 99% so it
  can never get permanently stuck, but a calm cadence reads better on stream.
- **Channel points are already gated** by cost/cooldown in the Twitch dashboard — lean
  on that. For chat-command triggers, gate by role (subs/mods) or a points/loyalty cost
  via your bot.
- **Clamp inputs** from chat: validate team names/indices, clamp `factor`/`n`/`radius`.
  The API caps total balls at 60, clamps team ids, and ignores unknown methods, but your
  bridge should sanitise too.

---

## 4. Four ways to drive it remotely

All four funnel through one whitelisted dispatcher, so a transport can only call the
action/config/lifecycle methods above (never read your state). Command shape is always:

```json
{ "method": "boost", "args": ["a", 2.5, 6000] }
```

**1. Direct (`window.PongWars`)** — same page. Use from dev-tools, or from custom JS that
runs *inside* the same browser source (Mix It Up overlay widgets, StreamElements custom
widgets, a `<script>` you add to a local copy of the page).

**2. `postMessage`** — when the demo is in an `<iframe>` (e.g. your own overlay page wraps it):
```js
iframe.contentWindow.postMessage({ type: 'pongwars', method: 'boost', args: ['a', 2, 6000] }, '*');
```

**3. `BroadcastChannel`** — another tab/widget in the **same browser & origin**:
```js
const ch = new BroadcastChannel('pongwars');
ch.postMessage({ method: 'spawnBall', args: ['b', 2] });
```

**4. WebSocket (`?ws=`)** — the **recommended path for a real Twitch bridge** running in a
separate process. Launch the source with `?ws=ws://localhost:8787`; the demo connects and
runs any `{method,args}` JSON it receives (auto-reconnecting). Your bot/EventSub listener
just pushes commands to that socket.

There's also a **`localStorage`** fallback (write key `pongwars-cmd` to a JSON command) for
same-origin cross-tab bots.

---

## 5. Twitch wiring recipes

### Recipe A — Channel-point redemptions (EventSub → WebSocket) ⭐ recommended
A ~40-line Node bridge: subscribe to channel-point redemptions via Twitch EventSub, and
forward each one as a `PongWars` command over a WebSocket the overlay connects to.

```js
// bridge.js  —  npm i ws @twurple/auth @twurple/eventsub-ws
import { WebSocketServer } from 'ws';
import { RefreshingAuthProvider } from '@twurple/auth';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { ApiClient } from '@twurple/api';

// 1) overlay control socket (open PongWars with ?ws=ws://localhost:8787)
const wss = new WebSocketServer({ port: 8787 });
const send = (cmd) => wss.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify(cmd)));

// 2) map each reward title -> a PongWars command (targets by team NAME)
const REWARDS = {
  'Boost Day':    () => send({ method: 'boost',     args: ['Day', 2.5, 6000] }),
  'Boost Night':  () => send({ method: 'boost',     args: ['Night', 2.5, 6000] }),
  'Drop a bomb':  (e) => send({ method: 'paintBlob', args: [pickTeam(e), null, null, 140] }),
  'Add a ball':   (e) => send({ method: 'spawnBall', args: [pickTeam(e), 1] }),
  'Shake it':     () => send({ method: 'shake',      args: [] }),
};
const pickTeam = (e) => e.input?.toLowerCase().includes('night') ? 'Night' : 'Day';

// 3) Twitch auth + EventSub (fill in your app creds / user token)
const authProvider = new RefreshingAuthProvider({ clientId: ID, clientSecret: SECRET });
await authProvider.addUserForToken(TOKEN, ['channel:read:redemptions']);
const api = new ApiClient({ authProvider });
const listener = new EventSubWsListener({ apiClient: api });
listener.start();
listener.onChannelRedemptionAdd(BROADCASTER_ID, (e) => {
  const handler = REWARDS[e.rewardTitle];
  if (handler) { handler(e); send({ method: 'banner', args: [`${e.userDisplayName}: ${e.rewardTitle}!`, 3000] }); }
});
```

Run `node bridge.js`, set each reward up in the Twitch dashboard with its cost/cooldown,
and add the overlay with `?ws=ws://localhost:8787`. Done.

> EventSub needs **app credentials** + a **user token** with `channel:read:redemptions`.
> You can also use the **PubSub**/Helix polling routes, but the EventSub WebSocket is the
> current, simplest first-party option.

> **Multi-team tip:** target teams by **name** (`'Day'`) or **index** (`0`). With 4+
> teams a redemption-input field lets the viewer name their side, e.g.
> `send({ method: 'boost', args: [e.input.trim(), 2.5, 6000] })` — the API resolves the
> name (or clamps a bad one) for you.

### Recipe B — Chat commands (tmi.js)
No channel points required — gate by subs/mods or a bot-managed currency instead.

```js
// chat-bridge.js  —  npm i tmi.js ws
import tmi from 'tmi.js';
import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ port: 8787 });
const send = (cmd) => wss.clients.forEach(c => c.readyState === 1 && c.send(JSON.stringify(cmd)));

const client = new tmi.Client({ channels: ['YOUR_CHANNEL'] });
await client.connect();
client.on('message', (channel, tags, msg, self) => {
  if (self) return;
  const m = msg.trim().toLowerCase();
  // viewers "join" a side: !day / !night → a tiny territory drop for that team
  if (m === '!day')   send({ method: 'paintBlob', args: ['Day',   null, null, 60] });
  if (m === '!night') send({ method: 'paintBlob', args: ['Night', null, null, 60] });
  // mods only: !boost day   (team name or index works)
  if (tags.mod && m.startsWith('!boost ')) send({ method: 'boost', args: [m.split(' ')[1], 2, 5000] });
});
```

### Recipe C — No-code overlay tools
**Mix It Up**, **StreamElements**, and **Streamlabs** let you attach custom actions/widgets
that run JavaScript. Put a copy of the demo (or an `<iframe>` of it) in a custom overlay,
then in the tool's "run JS" action call `PongWars.boost('a')` (same page) or
`postMessage`/`BroadcastChannel` (iframe / sibling widget). Bind those actions to channel-
point redemptions or chat triggers in the tool's UI — no separate process to run.

---

## 6. Redemption ideas (starter menu)

| Reward (dashboard) | Cost idea | Command |
|--------------------|-----------|---------|
| **Boost my team** | low | `boost('<team>', 2.5, 6000)` |
| **Drop a bomb** | medium | `paintBlob('<team>', null, null, 140)` |
| **Reinforcements** (+1 ball) | medium | `spawnBall('<team>', 1)` |
| **Sabotage** (−1 enemy ball) | medium | `removeBall('<enemy>', 1)` |
| **Chaos sprinkle** | high | `paintRandom('<team>', 60)` |
| **Rename the team** (input) | high | `setTeamName('<team>', '<input>')` |
| **Recolour** (input hex) | high | `setTeamColor('<team>', '<input>')` |
| **Shake the arena** | low | `shake()` |
| **Speed round** | high | `setSpeed(14)` (revert with a timer in the bridge) |
| **Split the board** (more teams) | high | `setTeamCount(4)` |
| **Reset the war** | very high | `reset()` |

Pair any of them with a `banner('@user did X!')` so the action is legible on stream.

---

## 7. Bigger engagement ideas

- **Faction war (4/6/8 teams).** Run `setTeamCount(4)` and name the sides after your
  squads / mod groups / community clans; each `!join <team>` nudges that faction. With
  more teams the board reads as a chaotic king-of-the-hill — great background energy.
- **Channel-point betting on the round.** On `win`, the bridge knows the victor (by index
  and name) — pay out a loyalty-points wager, or open/close a native **Twitch Prediction**
  ("Who holds the most at the next reset?") around each round using the Helix Predictions API.
- **Chat vs. Streamer / Mods vs. Chat.** Rename teams to the two camps; every `!join`
  message nudges that side (`paintBlob`, throttled). A passive way for lurkers to "play".
- **Sub / follow / cheer / raid triggers.** Map alerts to powers: a new sub = `spawnBall`
  for the subber's chosen team; a raid = a big `paintBlob` "invasion" for the raiders +
  a `banner` welcome; bits = scaled `boost` (more bits → bigger `factor`/`ms`).
- **Hype Train = speed ramp.** While a Hype Train is active, raise `setSpeed` per level and
  `shake()` on level-ups; reset speed when it ends.
- **Goal overlay.** Use the overlay subtitle as a follower/sub-goal ticker the bridge
  updates: `overlay(true, 'Starting Soon', '38 / 50 followers — let's gooo')`.
- **"First to N% wins" mini-game** between segments: turn off auto-restart, let chat powers
  push a side to 99%, celebrate the winner, then `reset()`.

---

## 8. Files

| File | Purpose |
|------|---------|
| `PongWars.html` | page + HUD + scoreboard/overlay/banner markup and styles |
| `main.js` | simulation, rendering, HUD wiring, and the `window.PongWars` API + transports |
| `TWITCH_IDEAS.md` | this document |

The simulation core (grid, ball, `checkSquareCollision` / `checkBoundaryCollision` /
`addRandomness`) follows the original pong-wars; the multi-team partitioning, scoreboard,
overlay, colour presets, win/auto-restart loop, and the entire remote-control layer are
additions for stream use.
