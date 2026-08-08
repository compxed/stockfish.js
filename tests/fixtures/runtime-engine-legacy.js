"use strict";

module.exports = function initEngine()
{
    return function createEngine(options)
    {
        var commands = [];

        options.receivedWasmBinary = options.wasmBinary;
        options.commands = commands;
        options.terminateCalls = 0;
        options._isReady = function ()
        {
            return true;
        };
        options.ccall = function (name, returnType, argumentTypes, argumentsList)
        {
            commands.push({
                name: name,
                returnType: returnType,
                argumentTypes: argumentTypes,
                argumentsList: argumentsList
            });
            return argumentsList[0];
        };
        options.emit = function (line)
        {
            options.listener(line);
        };
        options.terminate = function ()
        {
            options.terminateCalls += 1;
        };

        /// Emscripten 3.1.7 mutates and returns the supplied options object.
        return Promise.resolve(options);
    };
};
