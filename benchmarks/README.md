# Browser A/B benchmark

This tool compares two Stockfish.js artifacts in real browser Web Workers. It
uses a fixed node count and a balanced four-pair cycle so each build runs first
and second, and on both persistent worker lanes. The primary result is the
geometric mean of per-pair NPS ratios with a 95% confidence interval. Raw median
NPS is diagnostic only.

Install the pinned browser runtime once:

```sh
cd benchmarks/browser
npm ci
npx playwright install --with-deps chromium firefox webkit
```

Run the comparison from the repository root:

```sh
node benchmarks/browser/paired.js \
  --control-engine /path/to/control/stockfish-19-lite-single.js \
  --candidate-engine /path/to/candidate/stockfish-19-lite-single.js \
  --control-label control \
  --candidate-label candidate \
  --browser chromium \
  --pairs 12 \
  --json > result.json
```

Each JavaScript file must have its same-basename `.wasm` companion beside it.
The local server supplies cross-origin isolation headers, records engine asset
requests, and supports both single- and multithreaded artifacts. Use
`--control-threads` and `--candidate-threads` only when thread count is an
intentional part of the comparison.

Keep the browser version, machine, CPU affinity and power state fixed. For
small effects, increase the pair count and investigate order/lane bias and
run-to-run variation before drawing a conclusion. Playwright WebKit is useful
for compatibility checks but is not Safari; final Safari measurements require
an Apple device.
