#!/usr/bin/env node

"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var externPre = fs.readFileSync(
    path.join(__dirname, "..", "src", "emscripten", "extern-pre.js"),
    "utf8"
);
var factorySource = externPre.match(
    /\/\/\/ COMMAND_QUEUE_FACTORY_BEGIN([\s\S]+?)\/\/\/ COMMAND_QUEUE_FACTORY_END/
);
var context = {
    setTimeout: setTimeout
};

assert(factorySource, "command queue factory markers are missing");
vm.runInNewContext(factorySource[1] +
    "\nthis.createCommandQueue = createCommandQueue;", context);

function createHarness()
{
    var sent = [];
    var searching = false;
    var scheduler = context.createCommandQueue(function send(cmd)
    {
        sent.push(cmd);
        if (/^go\b/.test(cmd)) {
            searching = true;
        }
    }, function isSearching()
    {
        return searching;
    });

    return {
        sent: sent,
        process: scheduler.processCommand,
        setSearching: function (value)
        {
            searching = value;
        },
        done: function ()
        {
            searching = false;
            scheduler.onSearchDone();
        }
    };
}

function testLatestPositionWins()
{
    var harness = createHarness();

    harness.process("position startpos");
    harness.process("go infinite");
    harness.process("position startpos moves e2e4");
    harness.process("go depth 10");
    harness.process("position startpos moves d2d4");
    harness.process("go depth 20");

    assert.deepStrictEqual(harness.sent, [
        "position startpos",
        "go infinite",
        "stop"
    ]);

    harness.done();
    assert.deepStrictEqual(harness.sent, [
        "position startpos",
        "go infinite",
        "stop",
        "position startpos moves d2d4",
        "go depth 20"
    ]);
}

function testLatestGoWins()
{
    var harness = createHarness();

    harness.process("go depth 19");
    harness.process("go depth 20");
    harness.process("go depth 21");

    assert.deepStrictEqual(harness.sent, ["go depth 19", "stop"]);
    harness.done();
    assert.deepStrictEqual(harness.sent, [
        "go depth 19",
        "stop",
        "go depth 21"
    ]);
}

function testExplicitStopCancelsPendingGo()
{
    var harness = createHarness();

    harness.process("go infinite");
    harness.process("go depth 12");
    harness.process("stop");
    harness.done();

    assert.deepStrictEqual(harness.sent, ["go infinite", "stop"]);
}

function testConfigurationAndReadyBarrier()
{
    var harness = createHarness();

    harness.process("go infinite");
    harness.process("setoption name MultiPV value 2");
    harness.process("isready");
    harness.process("position startpos moves e2e4");
    harness.process("go depth 14");

    assert.deepStrictEqual(harness.sent, ["go infinite", "stop"]);
    harness.done();
    assert.deepStrictEqual(harness.sent, [
        "go infinite",
        "stop",
        "setoption name MultiPV value 2",
        "isready",
        "position startpos moves e2e4",
        "go depth 14"
    ]);
}

function testReadyPingDuringSearch()
{
    var harness = createHarness();

    harness.process("go infinite");
    harness.process("isready");

    assert.deepStrictEqual(harness.sent, ["go infinite", "isready"]);
}

function testNewGameReplacesPendingAnalysis()
{
    var harness = createHarness();

    harness.process("go infinite");
    harness.process("position startpos moves e2e4");
    harness.process("go depth 10");
    harness.process("ucinewgame");
    harness.process("position startpos moves d2d4");
    harness.process("go depth 11");
    harness.done();

    assert.deepStrictEqual(harness.sent, [
        "go infinite",
        "stop",
        "ucinewgame",
        "position startpos moves d2d4",
        "go depth 11"
    ]);
}

function testCoalescingDoesNotCrossReadyBarrier()
{
    var harness = createHarness();

    harness.process("go infinite");
    harness.process("position startpos moves e2e4");
    harness.process("isready");
    harness.process("position startpos moves d2d4");
    harness.process("go depth 15");
    harness.done();

    assert.deepStrictEqual(harness.sent, [
        "go infinite",
        "stop",
        "isready",
        "position startpos moves d2d4",
        "go depth 15"
    ]);
}

function testQueueWaitsForCompletionCallback()
{
    var harness = createHarness();

    harness.process("go infinite");
    harness.process("position startpos moves e2e4");
    harness.setSearching(false);
    harness.process("go depth 13");

    assert.deepStrictEqual(harness.sent, ["go infinite", "stop"]);
    harness.done();
    assert.deepStrictEqual(harness.sent, [
        "go infinite",
        "stop",
        "position startpos moves e2e4",
        "go depth 13"
    ]);
}

function testQuitDropsPendingWork()
{
    var harness = createHarness();

    harness.process("go infinite");
    harness.process("position startpos moves e2e4");
    harness.process("go depth 10");
    harness.process("quit");
    harness.done();

    assert.deepStrictEqual(harness.sent, ["go infinite", "stop", "quit"]);
}

function testAnalysisFloodRemainsCoalescedAndDisposable()
{
    var latest = 24999;
    var harness = createHarness();
    var index;

    harness.process("go infinite");
    for (index = 0; index <= latest; index += 1) {
        harness.process("position startpos moves e2e4 e7e5 g1f3 " + index);
        harness.process("go nodes " + (1000 + index));
    }

    assert.deepStrictEqual(harness.sent, ["go infinite", "stop"],
        "a live-analysis flood must request only one stop");
    harness.done();
    assert.deepStrictEqual(harness.sent, [
        "go infinite",
        "stop",
        "position startpos moves e2e4 e7e5 g1f3 " + latest,
        "go nodes " + (1000 + latest)
    ], "only the newest analysis may survive the flood");

    harness = createHarness();
    harness.process("go infinite");
    for (index = 0; index <= latest; index += 1) {
        harness.process("position startpos moves d2d4 " + index);
        harness.process("go depth " + (index % 64 + 1));
    }
    harness.process("quit");
    harness.done();
    assert.deepStrictEqual(harness.sent, ["go infinite", "stop", "quit"],
        "quit must discard a flooded pending analysis without replaying it");
}

async function testAsyncSearchWaitsForPromiseCompletion()
{
    var sent = [];
    var searching = false;
    var firstSearch = true;
    var resolveFirstSearch;
    var scheduler = context.createCommandQueue(function send(cmd)
    {
        sent.push(cmd);
        if (/^go\b/.test(cmd)) {
            searching = true;
            if (firstSearch) {
                firstSearch = false;
                return new Promise(function (resolve)
                {
                    resolveFirstSearch = function ()
                    {
                        searching = false;
                        resolve();
                    };
                });
            }
        }
    }, function isSearching()
    {
        return searching;
    });

    scheduler.processCommand("go infinite");
    scheduler.processCommand("position startpos moves e2e4");
    scheduler.processCommand("go depth 13");
    assert.deepStrictEqual(sent, ["go infinite", "stop"]);

    searching = false;
    scheduler.onSearchDone();
    assert.deepStrictEqual(sent, ["go infinite", "stop"],
        "the C++ callback must not outrun Asyncify stack restoration");

    resolveFirstSearch();
    await Promise.resolve();
    assert.deepStrictEqual(sent, [
        "go infinite",
        "stop",
        "position startpos moves e2e4",
        "go depth 13"
    ]);
}

async function main()
{
    testLatestPositionWins();
    testLatestGoWins();
    testExplicitStopCancelsPendingGo();
    testConfigurationAndReadyBarrier();
    testReadyPingDuringSearch();
    testNewGameReplacesPendingAnalysis();
    testCoalescingDoesNotCrossReadyBarrier();
    testQueueWaitsForCompletionCallback();
    testQuitDropsPendingWork();
    testAnalysisFloodRemainsCoalescedAndDisposable();
    await testAsyncSearchWaitsForPromiseCompletion();
    console.log("command queue tests passed");
}

main().catch(function (error)
{
    console.error(error);
    process.exitCode = 1;
});
