/*
 * Stockfish 19 for Chess.com Analysis
 * License: GPL-3.0
 */

(function initializeBridge()
{
    "use strict";

    var CONFIG_EVENT = "compxed-stockfish-override:config";
    var STATUS_EVENT = "compxed-stockfish-override:status";
    var host = null;
    var label = null;

    function isAnalysisPage()
    {
        return location.pathname === "/analysis" ||
            location.pathname.indexOf("/analysis/") === 0;
    }

    function ensureBadge()
    {
        var shadow;
        var style;

        if (host || !document.documentElement || !isAnalysisPage()) {
            return;
        }
        host = document.createElement("div");
        host.id = "compxed-stockfish-override-status";
        host.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647";
        shadow = host.attachShadow({mode: "closed"});
        style = document.createElement("style");
        style.textContent =
            ":host{all:initial}" +
            "span{display:block;padding:6px 9px;border-radius:6px;" +
            "background:#262522;color:#d6d3d1;border:1px solid #4a4845;" +
            "font:600 12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;" +
            "box-shadow:0 2px 8px #0006;cursor:default}" +
            "span[data-state=active]{color:#b7e4a8;border-color:#629924}" +
            "span[data-state=fallback],span[data-state=error]{color:#ffd6a5;border-color:#c77d26}";
        label = document.createElement("span");
        label.textContent = "SF19: preparing";
        label.title = "The override is loading its local engine files.";
        shadow.appendChild(style);
        shadow.appendChild(label);
        document.documentElement.appendChild(host);
    }

    function renderStatus(status)
    {
        var text = {
            waiting: "SF19: preparing",
            ready: "SF19: ready",
            starting: "SF19: starting",
            active: "SF19 override active",
            native: "Chess.com engine selected",
            fallback: "Chess.com engine fallback",
            error: "SF19 override error",
        }[status.state] || "SF19 override";

        ensureBadge();
        if (label) {
            label.dataset.state = status.state;
            label.textContent = text;
            label.title = status.message || text;
        }
    }

    function encodeBase64(buffer)
    {
        var bytes = new Uint8Array(buffer);
        var chunks = [];
        var chunkSize = 32768;
        var offset;

        for (offset = 0; offset < bytes.length; offset += chunkSize) {
            chunks.push(String.fromCharCode.apply(null,
                bytes.subarray(offset, offset + chunkSize)));
        }
        return btoa(chunks.join(""));
    }

    document.addEventListener(STATUS_EVENT, function (event)
    {
        try {
            renderStatus(JSON.parse(event.detail));
        } catch (ignore) {}
    });

    ensureBadge();
    Promise.all([
        fetch(chrome.runtime.getURL("engine/stockfish-19-lite.js")),
        fetch(chrome.runtime.getURL("engine/stockfish-19-lite.wasm")),
        fetch(chrome.runtime.getURL("engine/stockfish-19-lite-single.js")),
        fetch(chrome.runtime.getURL("engine/stockfish-19-lite-single.wasm")),
    ])
        .then(function (responses)
        {
            var failed = responses.find(function (response) { return !response.ok; });

            if (failed) {
                throw new Error("HTTP " + failed.status);
            }
            return Promise.all([
                responses[0].text(),
                responses[1].arrayBuffer(),
                responses[2].text(),
                responses[3].arrayBuffer(),
            ]);
        })
        .then(function (files)
        {
            document.dispatchEvent(new CustomEvent(CONFIG_EVENT, {
                detail: JSON.stringify({
                    variants: {
                        threaded: {
                            engineSource: files[0],
                            wasmBase64: encodeBase64(files[1]),
                        },
                        single: {
                            engineSource: files[2],
                            wasmBase64: encodeBase64(files[3]),
                        },
                    },
                    timeoutMs: 30000,
                }),
            }));
        })
        .catch(function (error)
        {
            renderStatus({
                state: "error",
                message: "Could not load Stockfish 19: " + error.message,
            });
        });

    window.setInterval(function ()
    {
        if (!isAnalysisPage() && host) {
            host.remove();
            host = null;
            label = null;
        } else if (isAnalysisPage()) {
            ensureBadge();
        }
    }, 1000);
}());
