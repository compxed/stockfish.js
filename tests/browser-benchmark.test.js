"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const core = require("../benchmarks/browser/core.js");
const runner = require("../benchmarks/browser/paired.js");

let failures = 0;
const cases = [];

function test(name, callback)
{
    cases.push({name, callback});
}

function request(origin, pathname)
{
    return new Promise(function (resolve, reject) {
        http.get(origin + pathname, function (response) {
            response.resume();
            response.once("end", function () {
                resolve(response.statusCode);
            });
        }).once("error", reject);
    });
}

test("parseInfo extracts the final UCI search counters", function () {
    assert.deepStrictEqual(
        core.parseInfo("info depth 15 seldepth 22 score cp -17 nodes 500000 nps 900000 time 555"),
        {
            depth: 15,
            seldepth: 22,
            nodes: 500000,
            engineMs: 555,
            reportedNps: 900000,
            score: {type: "cp", value: -17}
        }
    );
    assert.throws(() => core.parseInfo("info depth 1 nodes 2"), /incomplete final info/);
});

test("pairPlan balances execution order and worker lane", function () {
    const plan = core.pairPlan(8);

    assert.strictEqual(plan.filter(item => item.order[0] === "control").length, 4);
    assert.strictEqual(plan.filter(item => item.order[0] === "candidate").length, 4);
    assert.strictEqual(plan.filter(item => item.lane === "direct").length, 4);
    assert.strictEqual(plan.filter(item => item.lane === "mirrored").length, 4);
    assert.throws(() => core.pairPlan(6), /multiple of four/);
});

test("summarizePaired uses pair ratios rather than raw medians", function () {
    const plan = core.pairPlan(4);
    const pairs = plan.map(function (item, index) {
        const control = 100 + index * 100;
        return Object.assign({}, item, {
            control: {wallNps: control},
            candidate: {wallNps: control * 1.1}
        });
    });
    const result = core.summarizePaired(pairs);

    assert.ok(Math.abs(result.deltaPercent - 10) < 1e-10);
    assert.ok(Math.abs(result.order.biasPercent) < 1e-10);
    assert.ok(Math.abs(result.lane.biasPercent) < 1e-10);
    assert.ok(result.confidence95);
});

test("summarizeRound keeps a deterministic bestmove signature", function () {
    const round = core.summarizeRound(0, [
        {nodes: 100, engineMs: 2, wallMs: 4, bestmove: "e2e4"},
        {nodes: 200, engineMs: 3, wallMs: 6, bestmove: "d2d4"}
    ]);

    assert.strictEqual(round.wallNps, 30000);
    assert.strictEqual(round.engineNps, 60000);
    assert.strictEqual(round.signature, "e2e4 d2d4");
});

test("the runner validates comparison arguments before launching a browser", function () {
    const options = runner.parseArguments([
        "--control-engine", "control.js",
        "--candidate-engine", "candidate.js",
        "--pairs", "8",
        "--control-threads", "1",
        "--candidate-threads", "4"
    ]);

    assert.strictEqual(options.pairs, 8);
    assert.strictEqual(options.controlThreads, 1);
    assert.strictEqual(options.candidateThreads, 4);
    assert.throws(() => runner.parseArguments([
        "--control-engine", "control.js",
        "--candidate-engine", "candidate.js",
        "--pairs", "6"
    ]), /multiple of four/);
    assert.throws(() => runner.parseArguments([
        "--control-engine", "control.js",
        "--candidate-engine", "candidate.js",
        "--warmup-pairs", "1"
    ]), /must be even/);
    assert.throws(() => runner.parseArguments(["--unknown"]), /unknown option/);
});

test("the benchmark server exposes only the selected assets on loopback", async function () {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "stockfish-browser-security-"));
    const outside = path.join(temporary, "outside.txt");
    const controlDirectory = path.join(temporary, "control");
    const candidateDirectory = path.join(temporary, "candidate");
    const control = path.join(controlDirectory, "control.js");
    const candidate = path.join(candidateDirectory, "candidate.js");
    let server;

    try {
        fs.mkdirSync(controlDirectory);
        fs.mkdirSync(candidateDirectory);
        fs.writeFileSync(outside, "secret");
        for (const file of [control, candidate]) {
            fs.writeFileSync(file, "// engine");
            fs.writeFileSync(file.slice(0, -3) + ".wasm", "wasm");
        }
        fs.symlinkSync(outside, path.join(controlDirectory, "leak.js"));

        server = await runner.startServer({control, candidate});
        assert.strictEqual(server.host, "127.0.0.1");
        assert.strictEqual(await request(server.origin, server.controlUrl), 200);
        assert.strictEqual(await request(server.origin,
            "/engine/control/control.wasm"), 200);

        for (const pathname of [
            "/engine/control/../outside.txt",
            "/engine/control/%2e%2e%2foutside.txt",
            "/engine/control/%252e%252e%252foutside.txt",
            "/engine/control/leak.js",
            "/engine/control/unknown.js",
            "/etc/passwd"
        ]) {
            assert.strictEqual(await request(server.origin, pathname), 404, pathname);
        }
    } finally {
        if (server) {
            await server.close();
        }
        fs.rmSync(temporary, {recursive: true, force: true});
    }
});

(async function run() {
    for (const item of cases) {
        try {
            await item.callback();
            process.stdout.write(`ok - ${item.name}\n`);
        } catch (error) {
            failures += 1;
            process.stderr.write(
                `not ok - ${item.name}\n${error.stack || error.message}\n`
            );
        }
    }
    if (failures) {
        process.exitCode = 1;
    }
}());
