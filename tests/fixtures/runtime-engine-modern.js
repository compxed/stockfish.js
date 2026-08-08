"use strict";

function initEngine()
{
    /// Generated Emscripten glue can replace its CommonJS export while the
    /// first module is created. Reproduce that behavior for cache tests.
    module.exports = function changedExport()
    {
        return Promise.resolve({changed: true});
    };

    return function createEngine(options)
    {
        var commands = [];
        var instance;
        var onUncaughtException = function () {};
        var onUnhandledRejection = function () {};

        process.on("uncaughtException", onUncaughtException);
        process.on("unhandledRejection", onUnhandledRejection);

        instance = {
            receivedWasmBinary: options.wasmBinary,
            commands: commands,
            terminateCalls: 0,
            _isReady: function ()
            {
                return true;
            },
            ccall: function (name, returnType, argumentTypes, argumentsList)
            {
                var command = argumentsList[0];

                if (command === "throw") {
                    throw new Error("fixture command failed");
                }
                if (command === "reject") {
                    return Promise.reject(new Error("fixture command rejected"));
                }
                commands.push({
                    name: name,
                    returnType: returnType,
                    argumentTypes: argumentTypes,
                    argumentsList: argumentsList
                });
                return command;
            },
            emit: function (line)
            {
                options.listener(line);
            },
            terminate: function ()
            {
                instance.terminateCalls += 1;
            }
        };

        /// Modern Emscripten returns a new module instead of mutating options.
        return new Promise(function (resolve)
        {
            setImmediate(function ()
            {
                resolve(instance);
            });
        });
    };
}

module.exports = initEngine;
