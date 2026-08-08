(function () {
var Stockfish;
/// These variables are set by build.js.
var engineTotalBytes;
var enginePartsCount;
var isASMEngine;

/// COMMAND_QUEUE_FACTORY_BEGIN
function createCommandQueue(sendCommand, isSearching)
{
    // State-changing UCI commands must not enter the engine while a search is
    // active. Live clients may replace position/go faster than a search can
    // stop, so retain only the newest pending analysis without reordering
    // configuration commands or isready barriers.
    var queue = [];
    var stopRequested = false;
    var asyncSearchPending = false;

    function isCommand(cmd, name)
    {
        return cmd === name || cmd.substring(0, name.length + 1) === name + " ";
    }

    function removePending(predicate)
    {
        queue = queue.filter(function (cmd)
        {
            return !predicate(cmd);
        });
    }

    function removePendingAnalysis()
    {
        removePending(function (cmd)
        {
            return isCommand(cmd, "position") || isCommand(cmd, "go");
        });
    }

    function removePendingGo()
    {
        removePending(function (cmd)
        {
            return isCommand(cmd, "go");
        });
    }

    function finishSearch()
    {
        stopRequested = false;
        processQueue();
    }

    function dispatch(cmd)
    {
        var result = sendCommand(cmd);

        // An Asyncify ccall resolves only after its WebAssembly stack has
        // unwound. Its C++ completion callback can run earlier, so a new search
        // must wait for both signals.
        if (isCommand(cmd, "go") && result && typeof result.then === "function") {
            asyncSearchPending = true;
            result.then(function ()
            {
                asyncSearchPending = false;
                finishSearch();
            }, function (error)
            {
                asyncSearchPending = false;
                stopRequested = false;
                setTimeout(function ()
                {
                    throw error;
                }, 0);
            });
        }

        return result;
    }

    function requestStop()
    {
        if (isSearching() && !stopRequested) {
            stopRequested = true;
            dispatch("stop");
        }
    }

    function processQueue()
    {
        if (stopRequested) {
            return;
        }

        while (queue.length && !isSearching() && !asyncSearchPending) {
            dispatch(queue.shift());
        }
    }

    function processCommand(cmd)
    {
        cmd = String(cmd).trim();
        if (!cmd) {
            return;
        }

        if (isCommand(cmd, "position")) {
            removePendingAnalysis();
            queue.push(cmd);
            requestStop();
        } else if (cmd === "ucinewgame") {
            removePendingAnalysis();
            queue.push(cmd);
            requestStop();
        } else if (isCommand(cmd, "go")) {
            removePendingGo();
            queue.push(cmd);
            requestStop();
        } else if (isCommand(cmd, "setoption")) {
            queue.push(cmd);
            requestStop();
        } else if (cmd === "isready") {
            // isready may ping an active search immediately, but it becomes a
            // FIFO barrier when earlier commands are waiting for that search
            // to stop.
            if (queue.length || stopRequested || asyncSearchPending) {
                queue.push(cmd);
            } else {
                dispatch(cmd);
            }
        } else if (cmd === "stop") {
            removePendingGo();
            requestStop();
            if (!isSearching() && !stopRequested && !asyncSearchPending) {
                dispatch(cmd);
            }
        } else if (cmd === "quit") {
            queue = [];
            stopRequested = false;
            dispatch(cmd);
            return;
        } else {
            dispatch(cmd);
        }

        processQueue();
    }

    function onSearchDone()
    {
        if (!asyncSearchPending) {
            finishSearch();
        }
    }

    return {
        processCommand: processCommand,
        onSearchDone: onSearchDone
    };
}
/// COMMAND_QUEUE_FACTORY_END

function INIT_ENGINE() {
