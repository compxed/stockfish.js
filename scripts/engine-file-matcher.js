#!/usr/bin/env node

/// License: MIT

"use strict";

function escapeRegExp(value)
{
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = function createEngineFileMatcher(version)
{
    var flavor = "(?:-asm|-(?:lite|single|lite-single)(?:-relaxed)?|-relaxed)?";
    var hash = "(?:-[a-f0-9]{7})?";
    var part = "(?:-part-\\d+)?";

    return new RegExp("^stockfish-" + escapeRegExp(version) + flavor + hash + part +
        "\\.(?:js|wasm)$", "i");
};
