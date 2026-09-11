#!/usr/bin/env node

/* License: GPL-3.0 */

"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var chromium = require("playwright").chromium;

async function verify()
{
    var extensionDir = path.join(__dirname, "dist");
    var chromePath = process.env.CHROME_PATH;
    var profileDir;
    var context;

    if (!chromePath) {
        throw new Error("Set CHROME_PATH to a Chromium-compatible executable.");
    }
    if (!fs.existsSync(path.join(extensionDir, "manifest.json"))) {
        throw new Error("Build the extension before running the Chess.com check.");
    }
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf19-chesscom-live-"));
    try {
        context = await chromium.launchPersistentContext(profileDir, {
            executablePath: chromePath,
            headless: process.env.HEADED !== "1",
            args: [
                "--disable-extensions-except=" + extensionDir,
                "--load-extension=" + extensionDir,
                "--lang=en-US",
            ],
        });
        await context.addInitScript(function ()
        {
            window.__sf19OverrideStatuses = [];
            document.addEventListener("compxed-stockfish-override:status", function (event)
            {
                try {
                    window.__sf19OverrideStatuses.push(JSON.parse(event.detail));
                } catch (ignore) {}
            });
        });
        var page = context.pages()[0] || await context.newPage();

        page.on("console", function (message)
        {
            if (message.type() === "error") {
                process.stderr.write("Browser console: " + message.text() + "\n");
            }
        });
        await page.goto("https://www.chess.com/analysis", {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });
        var firstTimeDialog = page.locator("#first-time-modal dialog");

        if (await firstTimeDialog.isVisible().catch(function () { return false; })) {
            await page.keyboard.press("Escape");
            if (await firstTimeDialog.isVisible().catch(function () { return false; })) {
                await firstTimeDialog.getByRole("button").last().click();
            }
        }
        var newAnalysis = page.getByText("New Analysis", {exact: true}).first();

        if (await newAnalysis.isVisible({timeout: 10000}).catch(function () { return false; })) {
            await newAnalysis.click();
        }
        await page.waitForFunction(function ()
        {
            return window.__sf19OverrideStatuses.some(function (status)
            {
                return status.state === "active";
            });
        }, null, {timeout: 60000});
        await page.waitForTimeout(3000);
        var statuses = await page.evaluate(function ()
        {
            return window.__sf19OverrideStatuses;
        });

        if (statuses.some(function (status)
        {
            return status.state === "fallback" || status.state === "error";
        })) {
            throw new Error("The replacement engine did not stay active.");
        }
        process.stdout.write("Current Chess.com analysis page uses the SF19 override.\n");
        process.stdout.write("States: " + statuses.map(function (status)
        {
            return status.state;
        }).join(" -> ") + "\n");
        process.stdout.write(statuses.find(function (status)
        {
            return status.state === "starting";
        }).message + "\n");
    } finally {
        if (context) {
            await context.close();
        }
        fs.rmSync(profileDir, {recursive: true, force: true});
    }
}

verify().catch(function (error)
{
    process.stderr.write(error.stack + "\n");
    process.exitCode = 1;
});
