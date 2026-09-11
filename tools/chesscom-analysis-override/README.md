# Stockfish 19 for Chess.com Analysis

This Chrome extension replaces the local Stockfish Worker used by the Chess.com
analysis page with this repository's Stockfish.js 19 lite build. It follows
Chess.com's choice between the threaded and single-threaded variants and leaves
the Chess.com interface and its UCI integration unchanged.

Only Chess.com's lite engine selection is replaced. Selecting a full NNUE,
Torch, Komodo, or any other engine keeps the original Chess.com Worker; silently
replacing a full engine with a lite build would be misleading.

The extension is deliberately limited to `https://www.chess.com/analysis` and
URLs below that path. It does not run on live-game, daily-game, play, puzzle, or
event pages. Do not use engine assistance in a game in progress.

## Build

Users can install the ready-made ZIP attached to the GitHub release without
building Stockfish.js. Download and extract the archive, open
`chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select the extracted directory.

To build the extension from source instead, build the required engines and
assemble the unpacked extension:

```sh
npm run build-lite
npm run build-single-lite
npm run build:chesscom-extension
```

An existing artifact directory can be supplied instead:

```sh
node tools/chesscom-analysis-override/build.js --engine-dir /path/to/bin
```

The unpacked extension is written to
`tools/chesscom-analysis-override/dist/`. Open `chrome://extensions`, enable
Developer mode, choose **Load unpacked**, and select that directory. Reload the
Chess.com analysis tab after loading or rebuilding the extension.

For a manual comparison, analyze the same position with the extension enabled,
then disable it and reload the page to restore Chess.com's engine. Re-enable the
extension and reload again to return to Stockfish 19.

## Status badge

The badge in the bottom-right corner reports whether Stockfish 19 is ready,
active, or whether startup failed and the page fell back to Chess.com's original
engine. The override is activated only when Chess.com constructs a Worker whose
URL is one of its Stockfish engine assets.

## Scope and compatibility

This version uses the standard-SIMD lite artifacts. The build step adjusts the
threaded engine's self-Worker URL so its PThread Workers can reload the generated
`blob:` script. Relaxed-SIMD selection can be added after this baseline has been
verified across supported browsers.

The integration depends on Chess.com's internal engine asset URL pattern. A
future Chess.com frontend release may require updating that matcher.

## Browser smoke test

`verify-browser.js` loads the unpacked extension into a temporary Chromium
profile and runs a short search with both Stockfish 19 variants on a controlled
page with the Chess.com analysis origin. It expects `playwright` to be resolvable
and a Chromium-compatible executable in `CHROME_PATH`:

```sh
CHROME_PATH=/path/to/chromium node \
  tools/chesscom-analysis-override/verify-browser.js
```

`verify-chesscom.js` performs the same check against the current public
Chess.com analysis page. It uses a fresh temporary browser profile and does not
sign in or access any game in progress.

## License and source

The extension and bundled Stockfish engine are distributed under the GNU GPL
version 3. The release package includes `Copying.txt` and `SOURCE.txt`; the
latter links to the corresponding source revision. This project is not
affiliated with or endorsed by Chess.com.
