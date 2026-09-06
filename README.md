# Deadlock Build Optimizer 🔧

<p align="center">
  <img alt="The Infernus build board: Early / Mid / Late Game item tiles in buy order, the ability point order, and a 73% agreement score against a top player" src="docs/build-board.png">
</p>

Pick a [Deadlock](https://store.steampowered.com/app/1422450/Deadlock/) hero
and this spits out a build for it: what to buy, in what order, and which
abilities to level first. It's all based on what high-rank players actually
buy, pulled from [deadlock-api.com](https://deadlock-api.com). To keep myself
honest, every build gets graded against a real top player of that hero (their
games never feed the generator).

There's also a Street Brawl draft helper. It watches your screen during the
draft, figures out which three cards you're being offered, and tells you which
one to take and whether to re-roll. The advice shows up in a little window on
top of the game, or on your phone.

<p align="center">
  <img alt="The Street Brawl advisor reading a live draft: three ranked cards with the enhanced Reactive Barrier marked TAKE" src="docs/brawl-overlay.png">
</p>

## Quickstart 🚀

Needs Node 18 or newer.

```
git clone https://github.com/Gidntsquia/deadlock-build-optimizer
cd deadlock-build-optimizer
npm install
npm run fetch-data   # Downloads everything from the API into public/data/. Takes ~3 min, ~16 MB.
npm run dev          # Open http://localhost:5173
```

That's it for builds, just click a hero. Once the data is fetched the app
doesn't touch the network at all.

For Street Brawl, hit **Brawl** in the top right, then **Capture game screen +
overlay** and pick the Deadlock window. IMPORTANT: run the game in borderless
windowed mode, otherwise the overlay can't sit on top of it. If you really want
exclusive fullscreen, use **Phone display** instead and scan the QR code with
your phone.

Some other stuff you can do from the terminal:

```
npm run generate 1           # Print Infernus's build (any hero id works)
npm run brawl -- --hero 1 --round 2 --owned "Extra Charge" --enemies "Lash,Seven" \
    --set "Improved Spirit,Enchanter's Emblem,Swift Striker"   # Draft advice without the screen reader
npm run verify               # Runs all the checks, prints the held-out scores
```

## What it does 🔬

- One build per hero for all 38 heroes, from the last 30 days of Phantom+
  games (falls back to all ranks for heroes with thin data).
- Buy order comes from when people actually buy each item in real games, not
  from cost.
- Ability order is whatever sequence wins the most in high-rank games.
- Each build is scored against a top player's last 30 games. Right now that's
  64-75% agreement across the four players I check against, and the app shows
  you exactly which of their core items it missed.
- Items you'd only get to in a long game (past your usual final net worth) get
  marked as "stretch".
- Street Brawl: reads the three cards, the round, the enemy heroes, and what
  you've already picked straight off the screen. Nothing is sent to the game,
  it only looks at pixels.
- Overlay works in Chrome/Edge. Firefox doesn't have always-on-top windows, so
  use the phone display there.
- Share a build as an image.
- No backend. Everything runs in the browser off the fetched data.

## More details 📚

The nitty gritty is in the
[wiki](https://github.com/Gidntsquia/deadlock-build-optimizer/wiki):

- [Data Pipeline](https://github.com/Gidntsquia/deadlock-build-optimizer/wiki/Data-Pipeline) — what `fetch-data` grabs, which ranks, rate limits
- [How the Build Generator Works](https://github.com/Gidntsquia/deadlock-build-optimizer/wiki/How-the-Build-Generator-Works) — the scoring formula, buy order, ability order
- [Held-out Validation](https://github.com/Gidntsquia/deadlock-build-optimizer/wiki/Held-out-Validation) — who the four top players are and how "agreement" is measured
- [Street Brawl Advisor](https://github.com/Gidntsquia/deadlock-build-optimizer/wiki/Street-Brawl-Advisor) — card scoring, the re-roll math, the CLI
- [Screen Reader](https://github.com/Gidntsquia/deadlock-build-optimizer/wiki/Screen-Reader) — how cards, round numbers, hero portraits and your picks get recognized
- [Overlay and Phone Display](https://github.com/Gidntsquia/deadlock-build-optimizer/wiki/Overlay-and-Phone-Display) — screen capture, Picture-in-Picture, ntfy.sh
- [Judgment Calls](https://github.com/Gidntsquia/deadlock-build-optimizer/wiki/Judgment-Calls) — every weight I changed and why, with the numbers
- [Development](https://github.com/Gidntsquia/deadlock-build-optimizer/wiki/Development) — code layout, scripts, tests

## License 📄

[MIT](LICENSE). Game data and images come from [deadlock-api.com](https://deadlock-api.com)
when you run `fetch-data`, they aren't included in the repo.
