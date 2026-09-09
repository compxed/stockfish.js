# Stockfish 19 smallnet patch

`stockfish-19-smallnet.patch` is the original format-patch used by
[`lichess-org/stockfish-web`](https://github.com/lichess-org/stockfish-web/tree/main/patches/sf_19_smallnet)
for its `sf_19_smallnet` target. It retains the original author, commit message,
and test results.

The patch is applied to a temporary copy of the Stockfish 19 sources during a
`--lite` build. It changes the network architecture and therefore must never be
applied only to the network file or mixed with the standard Stockfish 19 source.
The primary source tree is left untouched, so standard and lite builds can run
at the same time.

- Stockfish base: `edb0d9db6731067ec50ce619ff372b463bc4dd5d` (`sf_19`)
- Network: `nn-61e7af4bb97d.nnue`
- Network SHA-256: `61e7af4bb97d51eeeb25d322916f86513b5cd3a827ce189c98c6e31946f99e5b`
- Expected bench signature: `2793281`

Any update to the Stockfish base or this patch must be validated against that
signature before release.
