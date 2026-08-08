(function () {
/// COMMAND_QUEUE_FACTORY_BEGIN
function createCommandQueue(sendCommand, isSearching)
{
    // State-changing UCI commands must not enter the engine while a search is
    // active. Live clients may replace position/go faster than a search can
    // stop, so retain only the newest pending analysis without reordering
    // configuration commands or isready barriers.
    var queue = [];
    var stopRequested = false;
    var searchPending = false;
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
        searchPending = false;
        stopRequested = false;
        processQueue();
    }

    function dispatch(cmd)
    {
        var isGo = isCommand(cmd, "go");
        var result;

        if (isGo) {
            // The multithreaded ccall only enqueues the UCI command. Keep the
            // queue blocked even before _isSearching() observes the search.
            searchPending = true;
        }
        try {
            result = sendCommand(cmd);
        } catch (error) {
            if (isGo) {
                searchPending = false;
            }
            throw error;
        }

        // An Asyncify ccall resolves only after its WebAssembly stack has
        // unwound. Its C++ completion callback can run earlier, so a new search
        // must wait for both signals.
        if (isGo && result && typeof result.then === "function") {
            asyncSearchPending = true;
            result.then(function ()
            {
                asyncSearchPending = false;
                finishSearch();
            }, function (error)
            {
                asyncSearchPending = false;
                searchPending = false;
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
        if ((searchPending || isSearching()) && !stopRequested) {
            stopRequested = true;
            dispatch("stop");
        }
    }

    function processQueue()
    {
        if (stopRequested) {
            return;
        }

        while (queue.length && !searchPending && !isSearching() && !asyncSearchPending) {
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
            if (queue.length || stopRequested) {
                queue.push(cmd);
            } else {
                dispatch(cmd);
            }
        } else if (cmd === "stop") {
            removePendingGo();
            requestStop();
            if (!searchPending && !isSearching() && !stopRequested && !asyncSearchPending) {
                dispatch(cmd);
            }
        } else if (cmd === "quit") {
            queue = [];
            searchPending = false;
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
