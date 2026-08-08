(function (global) {
    "use strict";

    const core = global.StockfishBenchmarkCore;

    if (!core) {
        throw new Error("benchmark core was not loaded");
    }

    function createEngine(url, timeout)
    {
        const worker = new Worker(url);
        const waiters = new Set();
        let name = null;
        let stopped = false;

        function rejectWaiters(error)
        {
            waiters.forEach(function (waiter) {
                clearTimeout(waiter.timer);
                waiter.reject(error);
            });
            waiters.clear();
        }

        function handleLine(line)
        {
            const value = line.trim();
            const nameMatch = value.match(/^id name (.+)$/);

            if (nameMatch) {
                name = nameMatch[1];
            }

            Array.from(waiters).forEach(function (waiter) {
                try {
                    if (waiter.onLine) {
                        waiter.onLine(value);
                    }
                    if (waiter.predicate(value)) {
                        clearTimeout(waiter.timer);
                        waiters.delete(waiter);
                        waiter.resolve(value);
                    }
                } catch (error) {
                    clearTimeout(waiter.timer);
                    waiters.delete(waiter);
                    waiter.reject(error);
                }
            });
        }

        worker.addEventListener("message", function (event) {
            if (typeof event.data === "string") {
                event.data.split(/\r?\n/).forEach(handleLine);
            }
        });
        worker.addEventListener("error", function (event) {
            rejectWaiters(new Error(event.message || "Stockfish worker failed"));
        });
        worker.addEventListener("messageerror", function () {
            rejectWaiters(new Error("Stockfish worker returned an unreadable message"));
        });

        function send(command)
        {
            if (stopped) {
                throw new Error("cannot write to a stopped engine");
            }
            worker.postMessage(command);
        }

        function waitFor(command, predicate, label, onLine)
        {
            const promise = new Promise(function (resolve, reject) {
                const waiter = {predicate, resolve, reject, onLine, timer: null};

                waiter.timer = setTimeout(function () {
                    waiters.delete(waiter);
                    reject(new Error(`timed out waiting for ${label}`));
                }, timeout);
                waiters.add(waiter);
            });

            send(command);
            return promise;
        }

        async function ready()
        {
            await waitFor("isready", line => line === "readyok", "readyok");
        }

        return {
            async initialize(hash, threads) {
                await waitFor("uci", line => line === "uciok", "uciok");
                send(`setoption name Threads value ${threads}`);
                send(`setoption name Hash value ${hash}`);
                send("setoption name MultiPV value 1");
                await ready();
            },

            async search(position, nodes) {
                let lastInfo = null;

                send("ucinewgame");
                send("setoption name Clear Hash");
                await ready();
                send(`position fen ${position.fen}`);

                const started = performance.now();
                const bestmove = await waitFor(
                    `go nodes ${nodes}`,
                    line => /^bestmove\s+\S+/.test(line),
                    `bestmove for ${position.name}`,
                    function (line) {
                        if (/^info\s/.test(line) && /\snodes\s+\d+/.test(line)) {
                            lastInfo = line;
                        }
                    }
                );

                if (!lastInfo) {
                    throw new Error(`engine returned no search info for ${position.name}`);
                }

                return Object.assign({
                    name: position.name,
                    bestmove: bestmove.split(/\s+/)[1],
                    wallMs: performance.now() - started
                }, core.parseInfo(lastInfo));
            },

            get name() {
                return name;
            },

            async stop() {
                if (stopped) {
                    return;
                }
                stopped = true;
                worker.postMessage("quit");
                await new Promise(resolve => setTimeout(resolve, 50));
                worker.terminate();
                rejectWaiters(new Error("engine stopped"));
            }
        };
    }

    async function runSuite(engine, positions, nodes)
    {
        const results = [];

        for (const position of positions) {
            results.push(await engine.search(position, nodes));
        }
        return results;
    }

    async function progress(message)
    {
        if (typeof global.reportBenchmarkProgress === "function") {
            await global.reportBenchmarkProgress(message);
        }
    }

    global.runStockfishPairedBenchmark = async function (config) {
        const directControl = createEngine(config.controlEngineUrl, config.timeout);
        const directCandidate = createEngine(config.candidateEngineUrl, config.timeout);
        const mirroredCandidate = createEngine(config.candidateEngineUrl, config.timeout);
        const mirroredControl = createEngine(config.controlEngineUrl, config.timeout);
        const lanes = {
            direct: {
                control: directControl,
                candidate: directCandidate
            },
            mirrored: {
                control: mirroredControl,
                candidate: mirroredCandidate
            }
        };
        const engines = Object.values(lanes).flatMap(lane => Object.values(lane));
        const pairs = [];

        async function runPair(item, warmup)
        {
            const results = {};
            const lane = lanes[item.lane];

            for (const variant of item.order) {
                await progress(
                    `${warmup ? "warmup" : "pair"} ${item.pair}/` +
                    `${warmup ? config.warmupPairs : config.pairs} ` +
                    `lane=${item.lane} variant=${variant}`
                );
                results[variant] = await runSuite(
                    lane[variant], config.positions, config.nodes
                );
            }

            if (!warmup) {
                pairs.push(Object.assign({}, item, {
                    control: core.summarizeRound(item.pair - 1, results.control),
                    candidate: core.summarizeRound(item.pair - 1, results.candidate)
                }));
            }
        }

        try {
            await lanes.direct.control.initialize(config.hash, config.controlThreads);
            await lanes.direct.candidate.initialize(config.hash, config.candidateThreads);
            await lanes.mirrored.candidate.initialize(config.hash, config.candidateThreads);
            await lanes.mirrored.control.initialize(config.hash, config.controlThreads);

            for (let index = 0; index < config.warmupPairs; index += 1) {
                await runPair({
                    pair: index + 1,
                    lane: index % 2 === 0 ? "direct" : "mirrored",
                    order: index % 2 === 0 ? ["control", "candidate"] :
                        ["candidate", "control"]
                }, true);
            }
            for (const item of core.pairPlan(config.pairs)) {
                await runPair(item, false);
            }
        } finally {
            await Promise.allSettled(engines.map(engine => engine.stop()));
        }

        const control = pairs.map(pair => pair.control);
        const candidate = pairs.map(pair => pair.candidate);

        return {
            timestamp: new Date().toISOString(),
            engines: {
                control: {label: config.controlLabel, name: lanes.direct.control.name},
                candidate: {label: config.candidateLabel, name: lanes.direct.candidate.name}
            },
            runtime: {
                userAgent: navigator.userAgent,
                hardwareConcurrency: navigator.hardwareConcurrency,
                crossOriginIsolated: global.crossOriginIsolated,
                secureContext: global.isSecureContext
            },
            config: {
                positionCount: config.positions.length,
                nodesPerPosition: config.nodes,
                pairs: config.pairs,
                warmupPairs: config.warmupPairs,
                hashMiB: config.hash,
                variantThreads: {
                    control: config.controlThreads,
                    candidate: config.candidateThreads
                },
                ordering: "balanced four-pair cycle across order and worker lane"
            },
            summary: {
                control: core.summarizeVariant(control),
                candidate: core.summarizeVariant(candidate),
                paired: core.summarizePaired(pairs),
                bestmovesMatchAcrossVariants: pairs.every(
                    pair => pair.control.signature === pair.candidate.signature
                )
            },
            pairs
        };
    };
}(window));
