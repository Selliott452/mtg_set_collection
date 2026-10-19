# MTG Master Sets

A static site that tracks which cards you own in every printed Magic: The Gathering set. A card counts once per collector number, so finishes (foil, etched) aren't tracked separately.

- **Card data** comes straight from [Scryfall](https://scryfall.com/docs/api) in your browser.
- **Your collection** lives in a Google Sheet. A small Apps Script web app reads and writes the sheet.
- **Hosting** is GitHub Pages. There's no build step: it's plain HTML, CSS, and JS.

## 1. Google Sheet + Apps Script

1. Create a Google Sheet and open **Extensions → Apps Script**.
2. Replace `Code.gs` with `apps-script/Code.gs` from this repo.
3. Choose `setup` in the function dropdown and click **Run**, then authorize it. Open **View → Logs** (or the execution log) and copy the **write token** it prints.
4. Click **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (this lets the site call it without a Google sign-in)
5. Copy the web app URL. It ends in `/exec`.

Anyone with that URL can *read* your collection. Writing requires the token.

## 2. Configure the site

Paste the URL into `config.js`:

```js
window.MTG_CONFIG = { scriptUrl: 'https://script.google.com/macros/s/…/exec' };
```

If you leave `scriptUrl` empty, the site still works, but it saves to your browser's localStorage. That's handy for trying it out.

## Run it locally

You need Node.js 22.6 or newer. Nothing has to be installed first:

```sh
npm start        # serves the site at http://localhost:8000
```

On Windows you can double-click `start-server.bat` instead. `server.ts` is a small TypeScript static server built only on Node's own modules. GitHub Pages doesn't use it.

## 3. Deploy to GitHub Pages

The site is published from the `main` branch of
[Selliott452/mtg_set_collection](https://github.com/Selliott452/mtg_set_collection)
at **https://selliott452.github.io/mtg_set_collection/**.

To publish a change, just push:

```sh
git add -A && git commit -m "what changed" && git push
```

Pages rebuilds within a minute or so. (`.nojekyll` tells Pages to serve the files
as they are instead of running them through Jekyll.)

Open the site, click **Write key**, and paste the token. It's stored in that browser only, so do this once per device.

## Using it

- The overview lists every printed set, newest first, with your progress. Click a set to open it.
- In a set, click a card (or press Enter or Space while it's focused) to mark it owned. Click again to unmark it. Grey cards are ones you don't have yet.
- Each collector number is one card. If Scryfall lists more than one printing with the same number, only the first one is shown.
- Changes save automatically about a second after you stop clicking.
- The sheet's `Collection` tab has one row per card you own (set code + collector number), so you can sort, filter, and pivot it like any other sheet.

## Updating the Apps Script

After you edit `Code.gs`, go to **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. Doing it this way keeps the same `/exec` URL.
