# Setting up a game

Each game is one Google Sheet. The site (these pages) reads and writes that sheet through a
small script attached to it. Setting up a game means copying the template sheet and deploying its
script: about five minutes, once.

The template already has the rules, the tabs and the script in it:
**[Cybersea game template](https://docs.google.com/spreadsheets/d/1AmAkrjylcTcy5kSTqKIoY6fteysFN6FNFn1LP5lA2vk/edit?usp=sharing)**.
Access to it is restricted because it holds the rulebook text, so ask its owner to share it with
you. The rulebook text is never put in this repository.

## 1. Copy the template

1. Open the template and choose **File → Make a copy**. The script comes with the copy.
2. Name the copy. The spreadsheet's name is the game's name on the site.

## 2. Set the GM passphrase

1. In your copy, open **Extensions → Apps Script**.
2. Open **Project Settings** (the gear on the left).
3. Under **Script properties**, set `GM_KEY` to a passphrase for the GM. If `GM_KEY` is already
   there (copied from the template), change its value.

Players don't need a passphrase: the invite link is enough. If you'd rather they needed one too,
also add `CREW_KEY` with the players' passphrase.

## 3. Deploy it

1. Still in Apps Script, click **Deploy → New deployment**.
2. Next to "Select type", click the gear and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. "Anyone" is needed for the site to
   reach it. The web app URL is long and unguessable; only people you give the invite link to
   can find the game.
4. Click **Deploy**, then **Authorize access** and pick your Google account.
   - Google will warn that it "hasn't verified this app". It's your own script, so click
     **Advanced → Go to (project name)** and **Allow**.
   - It asks for access to "the spreadsheet it's attached to" (only this one), to show menus
     and dialogs in it, and to "connect to an external service", which it uses to read the
     pictures in the Map tab (see [The Map tab](#the-map-tab)) and to fetch new versions of
     itself from GitHub.
   - It also asks to manage Apps Script projects and their deployments. That's only for
     **Cybersea → Update the script**, which updates this script and nothing else (see
     [Updating from the menu](#updating-from-the-menu)); without that setup it does nothing.
5. Copy the **Web app URL**. It ends in `/exec`.

## 4. Check it and open the game

1. Open `diag.html` on the site.
2. Paste the URL and the **GM** passphrase, and click **Run checks**.
3. Every line should be green. If one isn't, it says what to fix.
4. Click **Open this game**. You're signed in as the GM.

## 5. Invite the crew

- In the GM's **⋯** menu, click **Copy crew invite** and send it to the players. It has no
  passphrase in it. Anyone with it can open the crew pages, so share it only with your crew.
- **Copy GM link** carries the GM passphrase. Keep it to yourself; it's how you open the game on
  another device.
- Opening an invite link once remembers the game in that browser.

### Signing in as a character

Players click their character to sign in, either on the Crew page or from the button at the top
right (it shows **Sign in**, the character's name, or **GM**). Clicking the character again signs
out. Everyone sees who's signed in, and it stays that way until someone signs out.

Signing in is what lets you edit: your own character's sheet, plus the shared Ship and Lore
pages. Until then (and on other characters' sheets) pages are read-only. The GM can edit
everything. It's the honor system: the site keeps to these rules, but the sheet itself doesn't
check, and anyone can still read any sheet.

On the sheet, signing in sets a `signin | Signed in | yes` row on the character's tab. Clearing
that cell signs them out.

### In Notion

On a character's sheet, open its **⋯** menu and click **Copy Notion embed link**. Then paste the
link into a Notion `/embed` block. Notion embeds keep their own browser storage, so the link
carries the game (and the passphrase, if you copied it as the GM).

## Editing the sheet directly

You can edit any tab in Google Sheets as well; the site picks up changes within about 15
seconds, or at once with [live updates](#live-updates). The README tab explains the columns and symbols. Keep **Kind + Name** unique on each
tab: that pair is how the site finds a row.

The tabs the site edits also get a hidden **Version** column, which the script keeps up to date,
for edits made in Google Sheets too. If a page sends an edit made to an out-of-date copy of a
row (a player who was offline, say), the sheet keeps the newer row and the player is told their
edit wasn't saved. Leave that column alone. The one change the script can't notice is a whole
row being deleted, so a page that missed it could add the row back: to remove a row, clear its
cells instead.

### Live updates

Without them, every open page checks the sheet for changes every 15 seconds. With them, a page
reads the sheet once when it opens, then again only when something changes: the script pings a
Firebase Realtime Database after every change, and every open page of the game hears it at once.
A page skips the ping for a change it made itself. The ping holds only the time; the game itself
stays in the sheet. It's free (Firebase's Spark plan, no billing), and one database can serve
several games.

1. In the [Firebase console](https://console.firebase.google.com), open your project (the one
   from [Updating from the menu](#updating-from-the-menu) does), then **Build → Realtime
   Database → Create database**, any location, **Start in locked mode**.
2. On the database's **Rules** tab, paste this and click **Publish**. Anyone can read a game's
   pings if they know where it is, which only the game's own pages are told; nobody can list
   them or write, except the script.
   ```json
   {
     "rules": {
       ".read": false,
       ".write": false,
       "games": { "$topic": { ".read": true } }
     }
   }
   ```
3. Copy the database's URL from the top of its **Data** tab (like
   `https://your-project-default-rtdb.firebaseio.com`).
4. In the game's Apps Script **Project Settings → Script properties**, add `FIREBASE_URL` (the
   URL). There's no secret to copy: the script writes as the Google account it runs as (yours,
   the one that deployed it), which can write because the project is yours. Leave it off the
   template: copies couldn't write to your database anyway, so their pages would only go back to
   polling after their first change.
5. The script needs your permission to write to the database: pick **onOpen** in the editor's
   function list, click **Run** and allow it ("View and administer all your Firebase data" and
   "See your primary Google Account email address", which Firebase uses to check who's writing).
6. For edits made in Google Sheets: in Apps Script, open **Triggers** (the alarm clock) **→ Add
   Trigger**, choose the function **pushChange**, event source **From spreadsheet**, event type
   **On change**, and **Save** (allow it if asked). Without it, the site's own changes are still
   live, and changes made in Sheets show when a page next opens or comes back into view.

Make sure the script has `Push.gs` (**Cybersea → Update the script** brings it in). Pages pick up
live updates at their next read. To turn them off, delete `FIREBASE_URL`; the script notices
within two minutes. If the database turns a ping away (the permission isn't allowed yet, say),
pages go back to checking every 15 seconds for ten minutes, then try again; the script's
**Executions** log says why.

### Scratchpad and feedback

Each character sheet (and the Ship) has a **Scratchpad** at the top of its Notes tab, for anything
the sheet has no place for yet. It needs no edit mode: it saves as you type, in the browser first
and then to the sheet, as a `jot | Notes | …` row on that tab.

The round button at the bottom right of every page sends feedback about the site. It lands on the
**Feedback** tab (Date | Feedback), which the script makes the first time someone sends some.
Only the day and the text are kept, not who sent it. The site never shows that tab; read it in
Google Sheets.

## Theming the rules (Cybersea over Rapscallion)

The Rules tab keeps the book's rows as they are. Three more columns, after **Vis**, hold the
game's own wording, and the site uses them first:

- **Override name**: a new name. Moves keep the book's name, because character sheets remember
  moves by it; give a move new text instead.
- **Override text**: new text (a kit's items, …).
- **Override meta**: added to **Meta**, key by key. `hide` hides the row everywhere.

The Rules page shows the book's wording under each overridden row, as "Rapscallion original".
The columns are found by their headers, so add the three headers to an existing game's Rules tab
and update the script (below). A script older than version 4 ignores them.

## The Map tab

The **Map** page, open to everyone, shows the **Map** tab. Its columns (found by their headers):

| Region | Location | Level | Image | Text | GM notes | Shown |
|---|---|---|---|---|---|---|
| Vega Server | | | *(picture)* | The server's sea. | | |
| Vega Server | Hacker's Haven | | Hackers Haven | A city of scrap. | Who really runs it. | on |
| | Hacker's Haven | Level 1 | *(picture)* | The docks. | | |
| | Hacker's Haven | Level 2 | *(picture)* | The market. | | |
| Vega Server | DeepPort | | *(picture)* | A pool of links. | | |

- A row with a **Region** and no **Location** is that region's own map. It always shows.
- A row with a **Location** and no **Level** is a place, listed under its region.
- A row with a **Location** and a **Level** is a floor or level of that place, in order. The page
  shows a tab for each level. A place with no level rows is a single picture (DeepPort above).
- **Image**: click the cell and use **Insert → Image → Insert image in cell**, type
  `=IMAGE("https://…")` for a picture that's already online, or type the name of a picture in
  the **Images** tab (below), like `Hackers Haven` above. To change a picture, replace the
  one in the cell. Pictures floating over the grid (**Insert image over cells**) belong to no
  row and aren't read.
  Keep this column's format **Automatic**, not plain text, or Sheets shows a formula as typed.
- **GM notes** are only sent to the GM.
- **Shown**: the GM chooses which places the crew see, with the **On the map** / **Hidden**
  button on each place (only the GM sees it), which writes `on` here; or type it. Every place
  starts hidden. The script never sends the crew a hidden place, its levels or its pictures.

The GM can also add, change and remove regions' maps, places and levels on the Map page: the pencil
on each one, **+ Place**, **+ Region map**, and **+ Level** on a place. A picture is picked from the
Images tab or uploaded there from the computer (big ones are scaled down). Renaming a place
renames its levels too, and deleting it deletes them. A place added this way starts hidden.

The **Lore** tab can have an **Image** column too, after Notes: a picture for each entry, added
the same way. Players edit lore on the site, but pictures are added in the spreadsheet.

### The Images tab

An **Images** tab keeps every picture once, so you never upload one twice:

| Name | Image |
|---|---|
| Hackers Haven | *(picture)* |
| Vega Server | *(picture)* |

Put each picture in its **Image** cell (**Insert → Image → Insert image in cell**, or
`=IMAGE("https://…")`), then type its **Name** into any Map or Lore Image cell to show it there.
Names ignore capitals and spaces at the ends; the first row with a name wins. Pictures the GM
uploads on the Map page land here too.

The site never reads the Images tab itself. The crew get a picture from it only while a place
they can see, a region's map, or a Lore entry names it. **Import an xlsx…** never replaces
or removes the Images tab (an .xlsx can't carry its pictures); a file's Images tab is only brought
in when this sheet doesn't have one yet.

### Character pictures

Each character (and the ship) can have a picture beside their name. A player adds it on their
sheet in edit mode (the **+ Picture** box by the name); it's scaled down, added to the Images tab
under the character's name, and named in the **Image** cell of the tab's `info | Name` row. The
site adds that **Image** column (after Notes) the first time. To set one in the spreadsheet, give
the tab an **Image** column and put a picture, an `=IMAGE("https://…")` formula or an Images
tab name in the `info | Name` row. A crew member's picture (on the ship's crew tab) is the
**Image** cell of their `crew` row on the Ship tab, set the same way.

The Map tab and pictures need script version 5; the Images tab and editing the map on the site,
version 8; character pictures, version 10; crew members' pictures, version 11.
Deploying it asks you to authorize again, for "connect to an external service": that's how the
script reads a picture out of its cell.

`tools/xlsx/build.py --theme theme.json` lays a theme's rows over the book when building the
template, or, without `--rules`, makes a workbook of just the theme's rows to paste into an
existing game. A theme's change to a book row this workbook doesn't have (a kit's Override text, say)
goes in an `_Overrides` tab, to copy into that row by hand.

## Bringing in a fresh xlsx

The spreadsheet has a **Cybersea** menu (it appears a few seconds after the sheet opens). Its
**Import an xlsx…** picks an `.xlsx` file from your computer, such as a freshly built
workbook, and lists its tabs, all ticked, and this sheet's tabs the file doesn't have, unticked.

- Each ticked tab from the file updates this sheet's tab of the same name, in the same place,
  or is added at the end. Tabs you leave unticked stay as they are.
- With **Keep this sheet's changes** ticked (the default), a tab this sheet already has is merged
  with the file's rather than replaced. Rows are matched by Kind + Name (Kind + Group + Name on
  Rules and System, Region + Location + Level on Map), and each is compared with what the last
  import brought in. Its **Import** first only lists what will change, row by row (your own edits
  it keeps included), and **Import these changes** does it:
  - A row you added here stays, after the row it followed. A row you removed here stays removed.
    A cell you edited here keeps your edit.
  - What only the file changed comes in: new rows, updated cells, and rows the file no longer has.
  - Where both changed the same cell, or one side removed a row the other changed, the dialog
    lists each one with both versions. Pick **Keep this sheet's** (the default) or **Use the
    file's**, then **Import with these choices**. Nothing changes until then.
  - The first time, there's no earlier import to compare with, so every cell that differs (and
    isn't blank here) is listed.
  - Columns this sheet has and the file doesn't (the hidden Version column, say) stay, and so do
    pictures placed in the cells of rows it keeps.
- Untick it to replace each ticked tab whole, as the file has it. Everything on a replaced tab goes,
  including pictures placed in cells. **File → Version history** brings the old tabs back if you
  need them. Keep pictures in the **Images** tab, which is never touched, and name them from Map
  and Lore.
- README and tabs starting with `_` are always replaced whole: they have no Kind and Name.
- Ticking one of this sheet's own tabs removes it. If you bring in every tab and remove the rest,
  the tabs end up in the file's order.
- The spreadsheet, its script, the GM passphrase and the deployment stay as they are, so the
  site's URL and everyone's invite links keep working.
- The sheet must end up with a **Rules** tab; otherwise nothing changes.
- It keeps the file's values and formulas, plain-text, bold, fill and wrap formatting, column
  widths, hidden tabs and columns, frozen rows and columns, and drop-down (list) data
  validation. A protected sheet is protected for everyone but the spreadsheet's owner, except
  Excel's "allow edit" ranges. Anything else (merged cells, other kinds of validation) is left
  out, and the dialog lists it.
- If the site saves a change to a tab while it's being merged, the import stops without changing
  anything; run it again.
- The first time you use it, Google asks you to authorize the script.

What each import brought in is kept in a hidden **_Import** tab, which the next import compares
against. Leave it alone; deleting it only means the next import lists every difference.

### Schema versions and migrations

A workbook says which version of the layout (schema) it uses: `tools/xlsx/build.py` writes it as
the file's "Cybersea schema" property, and **_Import** remembers each tab's. When the layout
changes (a tab or row kind renamed, say), `MIGRATIONS` in `Import.gs` gets a step that upgrades
older tabs, and `SCHEMA` in `build.py` goes up by one. An import brings the file's tabs, this
sheet's tabs and what **_Import** remembers up to date before merging, so rows you changed here
still meet their counterparts in the newer file. A file newer than the sheet's script is turned
down: update the script first.

The script reads the file itself, so it needs no access to anything but this spreadsheet. The new
tabs get the checks **setUpChecks** makes (see below) as they come in.

## The game's mechanics

The site knows no stat, track or move names and no numbers of its own. The **System** tab holds
them, as `Kind | Group | Name | Text | Meta` rows of these kinds (Group is a playbook type, as in a
playbook's `type=`: a character type such as `pirate`, `ship`, or `npc`). Everyone can read it;
it's edited only in the spreadsheet.

- `stat`: a stat, in sheet order (Blood, Vinegar, …). An oddity's or ship kit's `traits=` follows that order.
- `track`: a track new sheets start with. Meta: `role=` (what the site does with it: `harm`,
  `luck`, `vice`, `xp`, `treasure`, `hoard`), `size=` (pips: `6`, `Steadfast+3`, `level+6`; a
  playbook's `harm=8` overrides it), `start=` (marks it starts with, e.g. `Spitfire`), `refill=`
  (Session Begins marks it back up to this).
- `section`: a card new sheets start with. Meta: `role=`, `tab=` (sheet, notes, kit or crew),
  `fill=` (vices, oddity, kit, specials, questions, lastwords: copied from the playbook). Its Text
  is the card's starting note; `{Fortune+5}` in it is worked out. The `role=kit` and `role=cargo`
  cards list the sheet's `item` and `cargo` rows (`item | Name | how many | Notes`;
  leave how many blank for things that aren't counted); a new sheet's kit becomes `item` rows. An
  item's Notes can start with a `Tags: loud, 2-harm` line, then a blank line and its notes. Their
  section's `tags=` (e.g. `tags=item,weapon,range,armor`) names the Rules tab's tag groups its items'
  tags are picked from and explained by; without it, every tag group. Tags not in those groups are
  kept as plain text. The bonds section's `size=` is
  the pips per bond and `full=xp:1` what filling one gives. The `role=crew` card is the ship
  page's crew tab (see [The ship's crew](#the-ships-crew)).
- `choice`: an option. Group `chapter-end` (`pick` for the two picks; `gain=xp:1`, `heal=harm:2`,
  `refresh=bonds`), `begin-downtime` (`slots=2`), `npc` (NPC sizes: `size=` harm), `clock` (`size=`).

Rules rows say what they do in their own Meta, instead of the site reading their wording:

- Moves, vices and oddities: `roll=Vinegar` (or `2d6`, `1d6`, `"+bonds spent"` for a number the
  player says), `per="-1 per scar"`, `adj` (a free modifier), `session=start` / `end` /
  `start,end`, `gain=luck:1` (or `xp:1`, or `luck:unrest` for what the unrest track has marked),
  `spend=luck:1` (or `luck:x`).
- The log's actions: `action=session-begin`, `session-end`, `chapter-end`, `begin-downtime`,
  `leave-downtime` or `level-up`, with `label="Session Begins"`, on the procedure (and downtime
  move) rows whose text the action shows. Chapter's End takes `picks=2`.
- House rules: `floor=luck:1`. The trait advance: `cap=3` (traits stop at +3).

### The ship's crew

The Ship tab's `crew` rows are its crew members, one row each, and the ship page shows a
little sheet for each on its crew tab:

| Kind | Name | Value | Notes |
|---|---|---|---|
| crew | Bo Brine | ○○ | Type: Deckhand<br>Serves: Testa<br>Tags: 1-harm, good at knots, jumpy<br><br>Found asleep in the hold. |

- **Value**: their harm pips.
- **Notes**: `Type:` (a kind of crew member), `Serves:` (the tab name of the character whose
  they are), `Tags:` (comma-separated), each line left out when blank; anything after a blank
  line is notes.

The crew section's System row says the rest, e.g.
`section | ship | Crew | ({Fortune+5} crew space) | role=crew tab=crew type=npc table=Hands serves="Hand of"`:

- `type=`: the playbook type crew members are: its `track` rows (`role=harm`) and its `tag` rows
  (the Rules tab's `tag | npc | …`), which explain each tag on the sheet. "Good at [something]"
  explains "good at knots"; "Armor-x" explains "armor-2".
- `table=`: the Rules `table` group whose rows are the kinds of crew member, each with `tags=` and
  its track sizes (`harm=2`). Its Text lists sample members, "Name, what they look like; …": a
  new crew member of that kind takes the first name not on the crew yet.
- `serves=`: what to call whose they are ("Hand of Testa").

A character's bond links to who it names: a character (by tab name or full name), the ship ("Ship"
or its name) or a crew member ("Bo" finds Bo Brine when no one else is called Bo). To link
it to someone else, put their name in the bond row's Notes (`-` links it to no one), or pick them
in edit mode. A crew member's sheet shows the bonds the characters have with them.

`tools/xlsx/mechanics.py` adds a game's System tab and Rules Meta to a workbook. The System tab
needs script version 6.

## Guarding the sheet

Run **setUpChecks** once per game: in the Apps Script editor, pick it in the function list next
to **Run** and click **Run**. Run it again after adding tabs by hand; tabs the site makes, and tabs
replaced from an xlsx, get the checks themselves. It:

- protects the Rules, System and README tabs with a warning, so editing them takes a deliberate click;
- limits the Kind column on Rules and System, and Rules' Vis column, to what the site knows;
- on character and Ship tabs, suggests the site's kinds and refuses a stat that isn't a number
  or a track or bond that isn't pip symbols;
- warns before anyone edits the hidden Version column.

The site itself never edits the Rules or System tab, and the script isn't held back by any of this.

## Updating the script later

Once the game is set up for it, **Cybersea → Update the script** in the sheet does all of this
for you (see [Updating from the menu](#updating-from-the-menu)). Otherwise, when a file in
[`apps-script/`](apps-script/) changes in this repository:
1. Paste the new version over the file of the same name in the game's Apps Script editor and
   save (**+ → Script** adds a missing `.gs` file, such as `Import.gs`). To see
   `appsscript.json`, turn on **Project Settings → Show "appsscript.json" manifest file in
   editor**.
2. Open **Deploy → Manage deployments**, click the pencil, set **Version: New version**, and
   click **Deploy**.
3. If `appsscript.json` changed, Google doesn't ask for the new permissions when you deploy, and
   the site can't reach the sheet until you approve them: pick **onOpen** in the editor's
   function list, click **Run** and allow it.

Editing the deployment keeps the same URL. Creating a *new* deployment gives a new URL, and
everyone would need a new invite link.

The site keeps working with an older script, without what came later; `diag.html` says when
there's a newer one.

Whoever owns the template should paste the new files into the template's script too, so new
games start with the current version.

### Updating from the menu

**Cybersea → Update the script** fetches the latest files in `apps-script/` from GitHub, puts
them in the script (keeping any files of your own), saves a new version and points the web app's
deployment at it. The URL and invite links stay the same. If the new version needs new
permissions, it saves the code, asks you to pick **Update the script** again, and deploys once
you've allowed them.

It uses the Apps Script API, which Google won't turn on for the hidden project every script
starts with, so the script needs a Google Cloud project of your own first. It's free and needs no
billing. You do this once per game (and once for the template, if you want to update it from
the menu too). A copy of the sheet starts on a hidden project again, so other GMs' games aren't
affected until they do it too.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project (any
   name), and note its **project number** on its dashboard. A Firebase project is a Google Cloud
   project too, so you can use one of those.
2. In that project, open **APIs & Services → Library**, find **Apps Script API** and click
   **Enable**.
3. Open **Google Auth Platform** (the OAuth consent screen) and click **Get started**: any app
   name, your email, audience **External**. Then, under **Audience**, click **Publish app** so
   it's **In production**. Left in testing, Google makes you approve the script again every 7
   days. You don't need to submit it for verification: you're its only user.
4. Turn on **Google Apps Script API** in your own settings at
   [script.google.com/home/usersettings](https://script.google.com/home/usersettings).
5. In the game's Apps Script editor, open **Project Settings → Google Cloud Platform (GCP)
   Project → Change project**, paste the project number and click **Set project**. A script
   can't go back to its hidden project after this, only move to another of yours.
6. If the script doesn't have `Update.gs` yet, update it by hand one last time (above).
7. Reload the sheet and pick **Cybersea → Update the script**. Allow what it asks for (Google
   warns that it "hasn't verified this app": click **Advanced → Go to (app name)**).

To update from somewhere other than this repository's `main` (a fork, say), set the script
property `UPDATE_FROM` to `owner/repo` or `owner/repo@branch`. `apps-script/files.txt` lists the
files it brings in.

## Handing the game to someone else (e.g. the GM)

1. They open the Google Sheet and choose **File → Make a copy**. The script is copied with it.
2. In their copy, they do steps 2 (GM passphrase) and 3 (deploy) again.
3. They send everyone new invite links. The old URL keeps working until the old owner deletes
   the deployment or the sheet.

## Running the site locally (developers)

```
node tools/dev-server.mjs            # site on :8080, a test game on :8081
npm test                             # unit tests
npm run lint                         # eslint, if installed (no packages needed)
npm run test:py                      # workbook tool tests (needs openpyxl)
npm run e2e                          # browser tests (Playwright + Chromium)
```

`git config core.hooksPath .githooks` turns on a pre-push hook that runs eslint (when installed), the unit tests, the
workbook tool tests and, when `RAPSCALLION_TXT` points at the rulebook text, the book text check.
The repository has no CI, so this is what stands in for it; run `npm run e2e` yourself before
pushing a change to the site.

The dev server runs the real `Code.gs` against an in-memory sheet with made-up rules. Nothing in
this repository contains rulebook text: `tools/check-booktext.mjs` checks for it, and runs as a
pre-commit hook where the rulebook text file is available. The template sheet was first built
from `tools/xlsx/build.py`, which needs the private `rules.json`.
