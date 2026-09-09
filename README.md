### Stockfish.js

<a href="https://github.com/nmrugg/stockfish.js">Stockfish.js</a> is a WASM implementation by Nathan Rugg of the <a href="https://github.com/official-stockfish/Stockfish">Stockfish</a> chess engine, for [Chess.com's](https://www.chess.com/analysis) in-browser engine.

Stockfish.js is currently updated to Stockfish 19.

This edition of Stockfish.js comes in five flavors:

 * The large multi-threaded engine:
    * This is the strongest version of the engine, but it is very large (≈94MB) and will only run in browsers with the proper <a href=https://web.dev/articles/cross-origin-isolation-guide>CORS headers</a> applied.
    * Files: [`stockfish-19.js`](https://github.com/nmrugg/stockfish.js/releases/download/v19.0.0/stockfish-19.js) & [`stockfish-19.wasm`](https://github.com/nmrugg/stockfish.js/releases/download/v19.0.0/stockfish-19.wasm)
 * The large single-threaded engine:
    * This is also large but will run in browsers without CORS headers; however it cannot use multiple threads via the UCI command `setoption name Threads`.
    * Files: [`stockfish-19-single.js`](https://github.com/nmrugg/stockfish.js/releases/download/v19.0.0/stockfish-19-single.js) & [`stockfish-19-single.wasm`](https://github.com/nmrugg/stockfish.js/releases/download/v19.0.0/stockfish-19-single.wasm)
 * The lite multi-threaded engine:
    * This is the same as the first multi-threaded but much smaller (≈1.6MB) and quite a bit weaker.
    * Files: [`stockfish-19-lite.js`](https://github.com/nmrugg/stockfish.js/releases/download/v19.0.0/stockfish-19-lite.js) & [`stockfish-19-lite.wasm`](https://github.com/nmrugg/stockfish.js/releases/download/v19.0.0/stockfish-19-lite.wasm)
 * The lite single-threaded engine:
    * Same as the first single-threaded engine but much smaller (≈1.6MB) and quite a bit weaker.
    * Files: [`stockfish-19-lite-single.js`](https://github.com/nmrugg/stockfish.js/releases/download/v19.0.0/stockfish-19-lite-single.js) & [`stockfish-19-lite-single.wasm`](https://github.com/nmrugg/stockfish.js/releases/download/v19.0.0/stockfish-19-lite-single.wasm)
 * The ASM-JS engine:
    * Compiled to JavaScript, not WASM. Compatible with every browser that runs JavaScript. Very slow and weak. Larger than the lite WASM engines (≈3MB). This engine should only be used as a last resort.
    * File: [`stockfish-19-asm.js`](https://github.com/nmrugg/stockfish.js/releases/download/v19.0.0/stockfish-19-asm.js)

This fork's package build includes regular-SIMD and relaxed-SIMD lite artifacts
side by side. Use `loader.js` to select a compatible artifact and retain
an automatic fallback. The upstream release links above do not include these
additional variants.

#### Which engine should I use?

It depends on your project, but most likely, you should use the `lite single-threaded` engine because it is fast and does not require any complicated setup. Although the full engine is objectively stronger, the lite engine is still far stronger than any human will ever be, and the full engine is so large that it can be very slow to load, which would cause a poor user experience.

The WASM Stockfish engines will run on all modern browsers (e.g., Chrome/Edge/Firefox/Opera/Safari) on supported systems (Windows 10+/macOS 11+/iOS 16+/Linux/Android), as well as currently supported versions of Node.js. For slightly older browsers, see the <a href=../../tree/Stockfish16>Stockfish.js 16 branch</a>. The ASM-JS engine will run in essentially any browser/runtime that supports JavaScript. For an engine that supports chess variants (like three-check and crazyhouse), see the <a href=../../tree/Stockfish11>Stockfish.js 11 branch</a>.

### How do I use stockfish.js?

Stockfish.js is simply a raw engine. You'll need to bring the rest of the parts to make it into a working vehicle.

To learn how to use the engine in your own projects, see the <a href="https://github.com/nmrugg/stockfish.js/tree/master/examples">examples folder</a>. In particular, see `examples/loadEngine.js` for a sample implementation of how to load and run engines.

#### Node.js module lifecycle

The Node.js entry point supports both Promises and callbacks. `sendCommand()`
returns a Promise and waits for module initialization, so it is safe to call as
soon as the callback-style loader returns. The callback receives the same
stable engine object that was returned by the loader.

Call `dispose()` (or its backwards-compatible alias `terminate()`) when the
engine is no longer needed. Disposal sends `quit`, terminates Emscripten worker
threads, and releases process listeners owned by that engine instance. It is
safe to call more than once.

Initialization is cancelled after 60 seconds by default. Applications that
need a different limit can pass `initializationTimeout` in milliseconds as the
second argument, for example
`require("stockfish")("lite-single", {initializationTimeout: 30000})`.

```js
const engine = await require("stockfish")("lite-single");

engine.listener = console.log;
await engine.sendCommand("uci");

// Later, after the last search has finished:
engine.dispose();
```

#### Rapid live-analysis updates

The generated worker serializes commands that change engine state. If a client
sends positions faster than the active search can stop, pending `position` and
`go` commands are coalesced so only the newest analysis starts. Configuration
commands retain FIFO order, and `isready` remains behind any earlier queued
changes. A standalone `isready` still pings an active search immediately, as
required by UCI.

#### Automatic browser build selection

`loader.js` selects by WebAssembly capabilities instead of the user-agent string. It probes the exact relaxed NNUE dot-product instruction, tries compatible builds in priority order, and falls back after worker initialization errors. The default list covers relaxed and regular SIMD, threaded and single-threaded lite builds, followed by ASM.js.

```html
<script src="./loader.js"></script>
<script>
StockfishLoader.load({
    baseUrl: "./engines",
    onFallback: function (error, variant) {
        console.warn("Could not start " + variant.id, error);
    }
}).then(function (engine) {
    console.log(engine.stockfishVariant.id);
    console.log(engine.stockfishSelection);
    engine.onmessage = function (event) {
        console.log(event.data);
    };
    engine.postMessage("position startpos");
    engine.postMessage("go depth 18");
});
</script>
```

Applications can pass a `variants` array to use a different artifact set or priority. Set `threads`, `relaxedSimd`, or `allowAsm` to `false` to remove those default choices. Selecting the search thread count remains the application's responsibility.

The loader executes the selected JavaScript artifact in a Web Worker. Treat
`baseUrl`, `variants`, and `workerOptions` as trusted application configuration;
do not populate them from URL parameters or other untrusted user input. The
application is responsible for serving engine artifacts from an origin it
controls and for applying its usual integrity and Content Security Policy.

### How do I compile the engine?

You only need to compile the engine if you want to make changes to the engine itself.

In order to compile the engine, you need to have <a href="https://emscripten.org/docs/getting_started/downloads.html">Emscripten `6.0.6`</a> installed and in your path. Then you can compile Stockfish.js with the build script: `./build.js`. See `./build.js --help` for details. To build all flavors, run `./build.js --all`.

To build an optional variant for browsers that support WebAssembly relaxed SIMD, add `--relaxed-simd`. For example, `./build.js --lite --single-threaded --relaxed-simd` creates `stockfish-19-lite-single-relaxed.js` and its matching WASM file. This build uses the relaxed integer dot-product instruction in the NNUE evaluation path. Applications loading this artifact directly must detect support for that exact instruction and keep the regular SIMD build as a fallback. When `StockfishLoader` is used, it performs this exact probe and fallback automatically.

### Thanks

- <a href="https://github.com/exoticorn/stockfish-js">exoticorn</a> for the original Stockfish to JS conversion
- <a href="https://github.com/ddugovic/Stockfish">ddugovic</a> for his Stockfish with many variants
- <a href="https://github.com/niklasf/">niklasf</a> for his <a href="https://github.com/niklasf/stockfish.js">stockfish.js</a> & <a href="https://github.com/niklasf/stockfish.wasm">stockfish.wasm</a>
- <a href="https://github.com/hi-ogawa/Stockfish">hi-ogawa</a> for his optimizations
- <a href="https://github.com/linrock">linrock</a> for older <a href="https://tests.stockfishchess.org/nns?network_name=nn-9067e33176e">lite nets</a>
- <a href="https://github.com/sscg13/Stockfish/tree/sf19-1mb">sscg13</a> for Stockfish 19 <a href="https://tests.stockfishchess.org/nns?network_name=nn-61e7af4bb97d">lite nets</a>
- <a href="https://github.com/lichess-org/stockfish-web">Lichess WASM Builds</a> for their patches
- <a href="https://github.com/official-stockfish/Stockfish">The Stockfish team</a> for everything

See <a href="https://raw.githubusercontent.com/nmrugg/stockfish.js/master/AUTHORS">AUTHORS</a> for more credits.

### License

Stockfish.js (c) 2026, Chess.com, LLC
GPLv3 (see <a href="https://raw.githubusercontent.com/nmrugg/stockfish.js/master/Copying.txt">Copying.txt</a>)
