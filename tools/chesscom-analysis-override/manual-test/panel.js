/* License: GPL-3.0 */

(function () {
    "use strict";
    var prefix = "compxed-stockfish-manual-test:";
    var nativeMode = false;
    var savedChecks = [];
    try {
        nativeMode = sessionStorage.getItem(prefix + "mode") === "native";
        savedChecks = JSON.parse(sessionStorage.getItem(prefix + (nativeMode ? "native" : "override")) || "[]");
    } catch (ignore) {}
    if (!Array.isArray(savedChecks)) savedChecks = [];
    window.__compxedStockfishTestNative = nativeMode;

    var host;
    var exportButton;
    var checks = [];
    var metadata = fetch(chrome.runtime.getURL("TEST-BUILD.json"))
        .then(function (response) {
            if (!response.ok) throw new Error("Cannot load test build metadata.");
            return response.json();
        });
    // Retain the rejection for the export handler without an unhandled rejection.
    metadata.catch(function () {});

    function isAnalysis() {
        return location.pathname === "/analysis" || location.pathname.indexOf("/analysis/") === 0;
    }

    function mount() {
        if (host || !document.documentElement || !isAnalysis()) return;
        host = document.createElement("div");
        host.id = "compxed-stockfish-manual-test";
        host.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483647";
        var shadow = host.attachShadow({mode: "open"});
        var style = document.createElement("style");
        style.textContent = ":host{all:initial}section{width:275px;padding:12px;border:1px solid #777;" +
            "border-radius:8px;background:#262522;color:#eee;font:13px/1.4 sans-serif}" +
            "button{margin:6px 4px 0 0;padding:5px;cursor:pointer}label{display:block;margin:8px 0}" +
            "summary{cursor:pointer;font-weight:bold}p{margin:8px 0}";
        shadow.appendChild(style);
        var section = document.createElement("section");
        var details = document.createElement("details");
        details.open = true;
        var summary = document.createElement("summary");
        summary.textContent = "Test: " + (nativeMode ? "silnik Chess.com" : "nasz SF19");
        details.appendChild(summary);
        var instructions = document.createElement("p");
        instructions.textContent = "Włącz lokalną analizę. Sprawdź poniższe punkty, potem eksportuj JSON. " +
            "Dla naszego silnika wymagany jest wariant lite i zielony znacznik SF19 na dole.";
        details.appendChild(instructions);
        checks = [];
        ["Widać ocenę i wariant ruchów", "Po szybkim przewijaniu ocena dotyczy ostatniej pozycji",
            "Pauza / wznowienie analizy działa", "Po przeładowaniu strony analiza znów działa"]
            .forEach(function (text, index) {
                var label = document.createElement("label");
                var input = document.createElement("input");
                input.type = "checkbox";
                input.checked = savedChecks[index] === true;
                checks.push(input);
                input.addEventListener("change", function () {
                    savedChecks = checks.map(function (check) { return check.checked; });
                    try { sessionStorage.setItem(prefix + (nativeMode ? "native" : "override"), JSON.stringify(savedChecks)); }
                    catch (ignore) {}
                });
                label.appendChild(input);
                label.appendChild(document.createTextNode(" " + text));
                details.appendChild(label);
            });
        var switchButton = document.createElement("button");
        switchButton.textContent = nativeMode ? "Przełącz na nasz silnik" : "Przełącz na Chess.com";
        switchButton.addEventListener("click", function () {
            try {
                sessionStorage.setItem(prefix + "mode", nativeMode ? "override" : "native");
                location.reload();
            } catch (error) { switchButton.textContent = "Przełączanie wymaga sessionStorage."; }
        });
        details.appendChild(switchButton);
        exportButton = document.createElement("button");
        exportButton.textContent = "Eksportuj JSON";
        exportButton.addEventListener("click", function () {
            exportButton.disabled = true;
            exportButton.textContent = "Zbieram raport…";
            document.dispatchEvent(new CustomEvent(prefix + "export"));
        });
        details.appendChild(exportButton);
        section.appendChild(details);
        shadow.appendChild(section);
        document.documentElement.appendChild(host);
    }

    document.addEventListener(prefix + "report", async function (event) {
        try {
            var report = JSON.parse(event.detail);
            report.build = await metadata;
            report.manualChecks = checks.map(function (check) { return check.checked; });
            var url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type: "application/json"}));
            var anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "stockfish-js-chesscom-" + (nativeMode ? "native" : "override") + "-" +
                new Date().toISOString().replace(/[:.]/g, "-") + ".json";
            document.documentElement.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            exportButton.textContent = "Eksportuj JSON";
        } catch (error) { exportButton.textContent = "Błąd eksportu — spróbuj ponownie"; }
        exportButton.disabled = false;
    });
    mount();
    setInterval(function () {
        if (!isAnalysis() && host) {
            host.remove();
            host = null;
        } else { mount(); }
    }, 1000);
}());
