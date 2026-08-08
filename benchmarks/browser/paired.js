#!/usr/bin/env node

"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const DEFAULTS = {
    browser: "chromium",
    nodes: 500000,
    threads: 1,
    pairs: 12,
    warmupPairs: 2,
    hash: 16,
    timeout: 120000,
    controlLabel: "control",
    candidateLabel: "candidate",
    positions: path.join(__dirname, "..", "positions.json")
};

function usage()
{
    return `Usage:
  node benchmarks/browser/paired.js \\
    --control-engine PATH --candidate-engine PATH [options]

Options:
  --control-label NAME       Label stored in the report (default: control)
  --candidate-label NAME     Label stored in the report (default: candidate)
  --browser NAME             chromium, firefox, or webkit (default: chromium)
  --positions PATH           Position suite (default: benchmarks/positions.json)
  --nodes N                  Nodes per position (default: ${DEFAULTS.nodes})
  --threads N                Threads for both engines (default: 1)
  --control-threads N        Override control engine threads
  --candidate-threads N      Override candidate engine threads
  --pairs N                  Measured pairs, multiple of four (default: 12)
  --warmup-pairs N           Unmeasured pairs (default: 2)
  --hash MB                  Hash per worker (default: 16)
  --timeout MS               Per-operation timeout (default: 120000)
  --json                     Write JSON instead of a short summary
`;
}

function positiveInteger(value, option)
{
    const number = Number(value);

    if (!Number.isSafeInteger(number) || number < 1) {
        throw new Error(`${option} must be a positive integer`);
    }
    return number;
}

function parseArguments(argv)
{
    const options = Object.assign({
        controlEngine: null,
        candidateEngine: null,
        controlThreads: null,
        candidateThreads: null,
        json: false
    }, DEFAULTS);
    const values = new Map([
        ["--control-engine", "controlEngine"],
        ["--candidate-engine", "candidateEngine"],
        ["--control-label", "controlLabel"],
        ["--candidate-label", "candidateLabel"],
        ["--browser", "browser"],
        ["--positions", "positions"]
    ]);
    const integers = new Map([
        ["--nodes", "nodes"],
        ["--threads", "threads"],
        ["--control-threads", "controlThreads"],
        ["--candidate-threads", "candidateThreads"],
        ["--pairs", "pairs"],
        ["--warmup-pairs", "warmupPairs"],
        ["--hash", "hash"],
        ["--timeout", "timeout"]
    ]);

    for (let index = 0; index < argv.length; index += 1) {
        const option = argv[index];

        if (option === "--json") {
            options.json = true;
            continue;
        }
        if (option === "--help" || option === "-h") {
            options.help = true;
            continue;
        }
        if (!values.has(option) && !integers.has(option)) {
            throw new Error(`unknown option: ${option}`);
        }
        if (index + 1 >= argv.length) {
            throw new Error(`${option} requires a value`);
        }

        const value = argv[index + 1];
        const key = values.get(option) || integers.get(option);
        options[key] = integers.has(option) ? positiveInteger(value, option) : value;
        index += 1;
    }

    if (options.help) {
        return options;
    }
    if (!options.controlEngine || !options.candidateEngine) {
        throw new Error("--control-engine and --candidate-engine are required");
    }
    if (!new Set(["chromium", "firefox", "webkit"]).has(options.browser)) {
        throw new Error("--browser must be chromium, firefox, or webkit");
    }
    if (options.pairs % 4 !== 0) {
        throw new Error("--pairs must be a multiple of four");
    }
    if (options.warmupPairs % 2 !== 0) {
        throw new Error("--warmup-pairs must be even so both worker lanes are warmed");
    }
    for (const key of ["controlLabel", "candidateLabel"]) {
        if (!/^[A-Za-z0-9._-]+$/.test(options[key])) {
            throw new Error(`${key} contains unsupported characters`);
        }
    }

    options.controlThreads = options.controlThreads || options.threads;
    options.candidateThreads = options.candidateThreads || options.threads;
    options.controlEngine = path.resolve(options.controlEngine);
    options.candidateEngine = path.resolve(options.candidateEngine);
    options.positions = path.resolve(options.positions);
    return options;
}

function validateEngine(file, label)
{
    if (path.extname(file) !== ".js" || !fs.existsSync(file)) {
        throw new Error(`${label} engine JavaScript does not exist: ${file}`);
    }
    if (!fs.existsSync(file.slice(0, -3) + ".wasm")) {
        throw new Error(`${label} engine WebAssembly does not exist beside its JavaScript`);
    }
}

function loadPositions(file)
{
    const positions = JSON.parse(fs.readFileSync(file, "utf8"));

    if (!Array.isArray(positions) || !positions.length) {
        throw new Error("position suite must be a non-empty array");
    }
    positions.forEach(function (position, index) {
        if (!position || typeof position.name !== "string" ||
                typeof position.fen !== "string") {
            throw new Error(`invalid position at index ${index}`);
        }
    });
    return positions;
}

function contentType(file)
{
    const extension = path.extname(file);

    if (extension === ".js") {
        return "text/javascript; charset=utf-8";
    }
    if (extension === ".wasm") {
        return "application/wasm";
    }
    return "application/octet-stream";
}

function startServer(engines)
{
    const assets = Object.fromEntries(Object.entries(engines).map(function ([variant, file]) {
        const wasm = file.slice(0, -3) + ".wasm";

        return [variant, new Map([
            [path.basename(file), fs.realpathSync(file)],
            [path.basename(wasm), fs.realpathSync(wasm)]
        ])];
    }));
    const scripts = {
        "/core.js": path.join(__dirname, "core.js"),
        "/benchmark.js": path.join(__dirname, "benchmark.js")
    };
    const html = Buffer.from(
        "<!doctype html><meta charset=\"utf-8\">" +
        "<script src=\"/core.js\"></script><script src=\"/benchmark.js\"></script>"
    );
    const requests = {
        control: {javascript: 0, wasm: 0},
        candidate: {javascript: 0, wasm: 0}
    };

    function send(response, status, body, type)
    {
        response.writeHead(status, {
            "Content-Type": type,
            "Content-Length": body.length,
            "Cache-Control": "no-store",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Resource-Policy": "same-origin"
        });
        response.end(body);
    }

    const server = http.createServer(function (request, response) {
        let pathname;

        try {
            pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
        } catch (error) {
            send(response, 400, Buffer.from("bad request"), "text/plain");
            return;
        }

        if (pathname === "/") {
            send(response, 200, html, "text/html; charset=utf-8");
            return;
        }
        if (scripts[pathname]) {
            send(response, 200, fs.readFileSync(scripts[pathname]), "text/javascript");
            return;
        }

        const match = pathname.match(/^\/engine\/(control|candidate)\/(.+)$/);
        if (match) {
            const file = assets[match[1]].get(match[2]);

            if (file) {
                const extension = path.extname(file);

                if (extension === ".js") {
                    requests[match[1]].javascript += 1;
                } else if (extension === ".wasm") {
                    requests[match[1]].wasm += 1;
                }
                send(response, 200, fs.readFileSync(file), contentType(file));
                return;
            }
        }
        send(response, 404, Buffer.from("not found"), "text/plain");
    });

    return new Promise(function (resolve, reject) {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", function () {
            const address = server.address();
            resolve({
                origin: `http://127.0.0.1:${address.port}`,
                host: address.address,
                controlUrl: `/engine/control/${encodeURIComponent(path.basename(engines.control))}`,
                candidateUrl: `/engine/candidate/${encodeURIComponent(path.basename(engines.candidate))}`,
                requests,
                close: () => new Promise(done => server.close(done))
            });
        });
    });
}

async function main()
{
    const options = parseArguments(process.argv.slice(2));

    if (options.help) {
        process.stdout.write(usage());
        return;
    }

    validateEngine(options.controlEngine, "control");
    validateEngine(options.candidateEngine, "candidate");

    let playwright;
    try {
        playwright = require("playwright");
    } catch (error) {
        throw new Error("Playwright is missing; run npm ci in benchmarks/browser");
    }

    const server = await startServer({
        control: options.controlEngine,
        candidate: options.candidateEngine
    });
    const launchOptions = options.browser === "chromium" ? {channel: "chromium"} : {};
    let browser;

    try {
        browser = await playwright[options.browser].launch(launchOptions);
        const page = await browser.newPage();

        page.on("pageerror", error => process.stderr.write(`page error: ${error.message}\n`));
        await page.exposeFunction("reportBenchmarkProgress", function (message) {
            process.stderr.write(message + "\n");
        });
        await page.goto(server.origin, {waitUntil: "load"});

        const report = await page.evaluate(config =>
            globalThis.runStockfishPairedBenchmark(config), {
            controlEngineUrl: server.controlUrl,
            candidateEngineUrl: server.candidateUrl,
            controlLabel: options.controlLabel,
            candidateLabel: options.candidateLabel,
            positions: loadPositions(options.positions),
            nodes: options.nodes,
            pairs: options.pairs,
            warmupPairs: options.warmupPairs,
            hash: options.hash,
            controlThreads: options.controlThreads,
            candidateThreads: options.candidateThreads,
            timeout: options.timeout
        });

        report.engines.control.path = options.controlEngine;
        report.engines.candidate.path = options.candidateEngine;
        report.runtime.browserName = options.browser;
        report.runtime.browserVersion = browser.version();
        report.runtime.playwrightVersion = require("playwright/package.json").version;
        report.runtime.node = process.version;
        report.runtime.platform = process.platform;
        report.runtime.arch = process.arch;
        report.runtime.engineRequests = server.requests;
        report.config.positions = options.positions;

        for (const variant of ["control", "candidate"]) {
            const count = server.requests[variant];

            if (!count.javascript || !count.wasm || count.wasm > count.javascript) {
                throw new Error(`unexpected ${variant} asset requests: ${JSON.stringify(count)}`);
            }
        }

        if (options.json) {
            process.stdout.write(JSON.stringify(report, null, 2) + "\n");
            return;
        }

        const paired = report.summary.paired;
        process.stdout.write(
            `${options.browser} ${report.runtime.browserVersion}\n` +
            `${options.controlLabel}: ${Math.round(report.summary.control.medianWallNps)} NPS\n` +
            `${options.candidateLabel}: ${Math.round(report.summary.candidate.medianWallNps)} NPS\n` +
            `paired delta: ${paired.deltaPercent.toFixed(3)}%\n` +
            `95% CI: ${paired.confidence95.lowerDeltaPercent.toFixed(3)}% .. ` +
            `${paired.confidence95.upperDeltaPercent.toFixed(3)}%\n` +
            `matching best moves: ${report.summary.bestmovesMatchAcrossVariants ? "yes" : "no"}\n`
        );
    } finally {
        if (browser) {
            await browser.close();
        }
        await server.close();
    }
}

if (require.main === module) {
    main().catch(function (error) {
        process.stderr.write(`error: ${error.stack || error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {loadPositions, parseArguments, startServer, validateEngine};
