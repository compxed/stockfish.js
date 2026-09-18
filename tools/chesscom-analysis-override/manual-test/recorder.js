/* License: GPL-3.0 */

(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        api.install(root);
    }
}(typeof window === "object" ? window : this, function () {
    "use strict";

    var MODE_KEY = "compxed-stockfish-manual-test:mode";
    var EXPORT_EVENT = "compxed-stockfish-manual-test:export";
    var REPORT_EVENT = "compxed-stockfish-manual-test:report";
    var STATUS_EVENT = "compxed-stockfish-override:status";

    function install(root) {
        var NativeWorker = root.Worker;
        var workers = [];
        var statuses = [];
        var started = root.performance.now();
        var nativeMode = false;

        try { nativeMode = root.sessionStorage.getItem(MODE_KEY) === "native"; }
        catch (ignore) {}
        root.__compxedStockfishTestNative = nativeMode;

        function elapsed() { return Math.round(root.performance.now() - started); }

        function assetUrl(value) {
            try {
                var url = new URL(String(value), root.location.href);
                return url.protocol === "https:" && url.hostname === "www.chess.com" &&
                    /\/stockfish-[^/]+\.js$/i.test(url.pathname) ?
                    url.origin + url.pathname : null;
            } catch (ignore) { return null; }
        }

        function ObservedWorker(url, options) {
            if (!(this instanceof ObservedWorker)) {
                throw new TypeError("Worker must be constructed with new.");
            }
            var worker = arguments.length > 1 ?
                new NativeWorker(url, options) : new NativeWorker(url);
            var asset = assetUrl(url);
            if (workers.length >= 32 || (!asset && String(url).indexOf("blob:") !== 0)) {
                return worker;
            }
            var record = {
                asset: asset,
                createdMs: elapsed(),
                engineName: null,
                commands: {uci: 0, isready: 0, position: 0, go: 0, stop: 0},
                requestedThreads: null,
                uciok: 0,
                readyok: 0,
                infoCount: 0,
                lastInfo: null,
                bestmoveCount: 0,
                lastBestmove: null,
                errors: [],
                terminated: false,
            };
            workers.push(record);
            var postMessage = worker.postMessage;
            var terminate = worker.terminate;
            worker.postMessage = function (message) {
                if (typeof message === "string") {
                    var command = message.trim().split(/\s/)[0];
                    if (Object.prototype.hasOwnProperty.call(record.commands, command)) {
                        record.commands[command]++;
                    }
                    var threads = message.match(/^setoption name Threads value (\d+)$/);
                    if (threads) record.requestedThreads = Number(threads[1]);
                }
                return postMessage.apply(worker, arguments);
            };
            worker.terminate = function () {
                record.terminated = true;
                return terminate.apply(worker, arguments);
            };
            worker.addEventListener("message", function (event) {
                if (typeof event.data !== "string") return;
                event.data.split("\n").forEach(function (line) {
                    if (/^id name /.test(line)) record.engineName = line.slice(8, 168);
                    if (line === "uciok") record.uciok++;
                    if (line === "readyok") record.readyok++;
                    var info = line.match(/^info depth (\d+).*?\bscore (cp|mate) (-?\d+)/);
                    if (info) {
                        record.infoCount++;
                        record.lastInfo = {ms: elapsed(), depth: Number(info[1]),
                            scoreType: info[2], score: Number(info[3])};
                    }
                    var bestmove = line.match(/^bestmove ([a-h][1-8][a-h][1-8][qrbn]?|\(none\)|0000)(?:\s|$)/);
                    if (bestmove) {
                        record.bestmoveCount++;
                        record.lastBestmove = {ms: elapsed(), move: bestmove[1]};
                    }
                });
            });
            worker.addEventListener("error", function (event) {
                if (record.errors.length < 10) {
                    record.errors.push({ms: elapsed(), message:
                        String(event.message || "Worker error").slice(0, 240)});
                }
            });
            worker.addEventListener("messageerror", function () {
                if (record.errors.length < 10) {
                    record.errors.push({ms: elapsed(), message: "Worker messageerror"});
                }
            });
            return worker;
        }
        ObservedWorker.prototype = NativeWorker.prototype;
        Object.setPrototypeOf(ObservedWorker, NativeWorker);
        root.Worker = ObservedWorker;

        root.document.addEventListener(STATUS_EVENT, function (event) {
            try {
                var status = JSON.parse(event.detail);
                if (statuses.length < 100) {
                    statuses.push({ms: elapsed(), state: String(status.state).slice(0, 40)});
                }
            } catch (ignore) {}
        });

        function snapshot() {
            return {
                schema: "stockfish-js-chesscom-manual-test-v1",
                exportedAt: new Date().toISOString(),
                mode: nativeMode ? "native" : "override",
                environment: {
                    userAgent: root.navigator.userAgent,
                    hardwareConcurrency: root.navigator.hardwareConcurrency,
                    crossOriginIsolated: root.crossOriginIsolated === true,
                    sharedArrayBuffer: typeof root.SharedArrayBuffer === "function",
                },
                durationMs: elapsed(),
                workers: workers.filter(function (record) {
                    return record.asset || /Stockfish/i.test(record.engineName || "") || record.errors.length;
                }),
                statuses: statuses,
                limitations: "Passive functional check, not a speed benchmark. " +
                    "Position correctness must be checked manually. Asset hashes identify " +
                    "the JavaScript fetched at export time, not the WASM or complete source tree.",
            };
        }

        root.document.addEventListener(EXPORT_EVENT, async function () {
            // Copy before awaiting network requests; later searches must not change this report.
            var report = JSON.parse(JSON.stringify(snapshot()));
            var assets = report.workers.map(function (record) { return record.asset; })
                .filter(function (asset, index, all) { return asset && all.indexOf(asset) === index; });
            report.assets = await Promise.all(assets.map(async function (url) {
                try {
                    var response = await root.fetch(url, {signal: root.AbortSignal.timeout(10000)});
                    if (!response.ok) throw new Error("HTTP " + response.status);
                    var bytes = await response.arrayBuffer();
                    var hash = new Uint8Array(await root.crypto.subtle.digest("SHA-256", bytes));
                    return {url: url, bytes: bytes.byteLength, sha256:
                        Array.from(hash, function (byte) { return byte.toString(16).padStart(2, "0"); }).join("")};
                } catch (error) { return {url: url, error: String(error.message).slice(0, 160)}; }
            }));
            root.document.dispatchEvent(new root.CustomEvent(REPORT_EVENT, {
                detail: JSON.stringify(report),
            }));
        });
        return {snapshot: snapshot};
    }
    return {install: install};
}));
