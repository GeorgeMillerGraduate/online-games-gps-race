"use strict";

/* ============================================================
 * JENGA-CODE MAPAPP
 * astar.js
 *
 * A* and Dijkstra shortest-path search engine.
 *
 * This class searches RoadGraph.
 *
 * It knows nothing about MapLibre or the user interface.
 *
 * Supported algorithms:
 *
 *      A*
 *      Dijkstra
 *
 * A*:
 *
 *      f(n) = g(n) + h(n)
 *
 * where:
 *
 *      g(n) = known cost from start to n
 *      h(n) = estimated remaining cost
 *      f(n) = estimated total route cost
 *
 * Dijkstra:
 *
 *      h(n) = 0
 *
 * The graph decides what "cost" means.
 *
 * For example:
 *
 *      distance profile -> metres
 *      time profile     -> seconds
 *
 * visualiser.js can subscribe to the events emitted here.
 *
 * ============================================================ */


class AStarSearch {

    /* ========================================================
     * CONSTRUCTOR
     * ======================================================== */

    constructor(
        graph,
        options = {}
    ) {

        if (
            !graph
            ||
            typeof graph.getNeighbours
            !==
            "function"
            ||
            typeof graph.getNode
            !==
            "function"
            ||
            typeof graph.hasNode
            !==
            "function"
        ) {

            throw new TypeError(
                "AStarSearch requires a valid RoadGraph."
            );

        }


        this.graph =
            graph;


        /* ----------------------------------------------------
         * ALGORITHM
         * ---------------------------------------------------- */

        this.algorithm =
            "astar";


        this.heuristicMode =
            "distance";


        this.setAlgorithm(
            options.algorithm
            ??
            "astar"
        );


        this.setHeuristic(
            options.heuristic
            ??
            "distance"
        );


        /* ----------------------------------------------------
         * VISUALISATION SPEED
         * ---------------------------------------------------- */

        this.stepDelay =
            0;


        this.setStepDelay(
            options.stepDelay
            ??
            0
        );


        /*
         * Even when running at full speed, periodically yield to
         * the browser so MapApp remains responsive.
         */

        this.yieldEvery =
            Math.max(
                1,
                Math.floor(
                    Number(
                        options.yieldEvery
                        ??
                        100
                    )
                )
            );


        /* ----------------------------------------------------
         * SAFETY LIMIT
         * ---------------------------------------------------- */

        this.maximumVisitedNodes =
            options.maximumVisitedNodes
            ??
            Infinity;


        /* ----------------------------------------------------
         * SEARCH STATE
         * ---------------------------------------------------- */

        this.running =
            false;


        this.paused =
            false;


        this.cancelled =
            false;


        this.finished =
            false;


        this.startNodeId =
            null;


        this.goalNodeId =
            null;


        /* ----------------------------------------------------
         * SEARCH DATA
         * ---------------------------------------------------- */

        this.openQueue =
            null;


        this.openSet =
            new Set();


        this.closedSet =
            new Set();


        this.gScore =
            new Map();


        this.fScore =
            new Map();


        this.cameFrom =
            new Map();


        this.cameFromEdge =
            new Map();


        /* ----------------------------------------------------
         * STATISTICS
         * ---------------------------------------------------- */

        this.statistics =
            this.#createEmptyStatistics();


        /* ----------------------------------------------------
         * EVENTS
         *
         * Keep these names compatible with visualiser.js.
         * ---------------------------------------------------- */

        this.listeners = {

            start: [],

            nodeVisited: [],

            edgeExamined: [],

            nodeDiscovered: [],

            nodeImproved: [],

            frontierChanged: [],

            pause: [],

            resume: [],

            cancelled: [],

            pathFound: [],

            noPath: [],

            complete: []

        };

    }


    /* ========================================================
     * SEARCH
     * ======================================================== */

    async search(
        startNodeId,
        goalNodeId,
        options = {}
    ) {

        if (
            this.running
        ) {

            throw new Error(
                "A pathfinding search is already running."
            );

        }


        const startId =
            String(
                startNodeId
            );


        const goalId =
            String(
                goalNodeId
            );


        if (
            !this.graph.hasNode(
                startId
            )
        ) {

            throw new Error(
                `Start node ${startId} does not exist in the graph.`
            );

        }


        if (
            !this.graph.hasNode(
                goalId
            )
        ) {

            throw new Error(
                `Destination node ${goalId} does not exist in the graph.`
            );

        }


        this.#prepareSearch(
            startId,
            goalId,
            options
        );


        const started =
            MapUtils.now();


        this.statistics.startedAt =
            started;


        this.#emit(
            "start",
            this.getState()
        );


        /* ----------------------------------------------------
         * START == DESTINATION
         * ---------------------------------------------------- */

        if (
            startId === goalId
        ) {
            this.openSet.delete(startId);
            console.info("GOAL REACHED", {nodeId:goalId, distance:0});

            this.statistics.searchMilliseconds =
                MapUtils.now()
                -
                started;


            const result =
                this.#createSuccessfulResult(
                    [
                        startId
                    ]
                );


            this.running =
                false;


            this.finished =
                true;


            this.#emit(
                "pathFound",
                result
            );


            this.#emit(
                "complete",
                result
            );


            return result;

        }


        let expansionsSinceYield =
            0;


        try {

            while (
                !this.openQueue.isEmpty()
            ) {

                /* --------------------------------------------
                 * CANCELLATION
                 * -------------------------------------------- */

                if (
                    this.cancelled
                ) {

                    return this.#finishCancelled(
                        started
                    );

                }


                /* --------------------------------------------
                 * PAUSE
                 * -------------------------------------------- */

                if (this.paused) await this.#waitWhilePaused();


                if (
                    this.cancelled
                ) {

                    return this.#finishCancelled(
                        started
                    );

                }


                /* --------------------------------------------
                 * TAKE BEST FRONTIER NODE
                 * -------------------------------------------- */

                const queueEntry =
                    this.openQueue.dequeue();


                if (
                    !queueEntry
                ) {

                    break;

                }


                const currentId =
                    String(
                        queueEntry.value
                    );


                const queuedPriority =
                    Number(
                        queueEntry.priority
                    );


                /*
                 * PriorityQueue may contain old entries after a
                 * better route to the same node was discovered.
                 */

                const currentBestF =
                    this.fScore.get(
                        currentId
                    );


                if (
                    currentBestF === undefined
                ) {

                    this.statistics.staleQueueEntries++;

                    continue;

                }


                if (
                    queuedPriority
                    >
                    currentBestF
                    +
                    1e-9
                ) {

                    this.statistics.staleQueueEntries++;

                    continue;

                }


                if (
                    this.closedSet.has(
                        currentId
                    )
                ) {

                    this.statistics.staleQueueEntries++;

                    continue;

                }


                this.openSet.delete(
                    currentId
                );


                /* --------------------------------------------
                 * GOAL TEST
                 *
                 * The goal is accepted when it becomes the
                 * cheapest frontier node, not merely when it is
                 * first discovered.
                 * -------------------------------------------- */

                if (
                    currentId === goalId
                ) {
                    console.info("GOAL REACHED", {nodeId:goalId, g:this.gScore.get(goalId)});

                    this.statistics.searchMilliseconds =
                        MapUtils.now()
                        -
                        started;


                    const path =
                        this.#reconstructPath(
                            goalId
                        );


                    const result =
                        this.#createSuccessfulResult(
                            path
                        );


                    this.running =
                        false;


                    this.finished =
                        true;


                    this.#emit(
                        "pathFound",
                        result
                    );


                    this.#emit(
                        "complete",
                        result
                    );


                    return result;

                }


                /* --------------------------------------------
                 * CLOSE CURRENT NODE
                 * -------------------------------------------- */

                this.closedSet.add(
                    currentId
                );


                this.statistics.visitedNodes++;

                this.statistics.expandedNodes++;


                const currentG =
                    this.gScore.get(
                        currentId
                    )
                    ??
                    Infinity;


                const currentH =
                    this.#heuristic(
                        currentId,
                        goalId
                    );


                const currentF =
                    currentG
                    +
                    currentH;


                this.#emit(
                    "nodeVisited",
                    {

                        nodeId:
                            currentId,

                        node:
                            this.graph.getNode(
                                currentId
                            ),

                        g:
                            currentG,

                        h:
                            currentH,

                        f:
                            currentF,

                        visitedCount:
                            this.statistics.visitedNodes,

                        frontierCount:
                            this.openSet.size

                    }
                );


                /* --------------------------------------------
                 * SAFETY LIMIT
                 * -------------------------------------------- */

                if (
                    this.statistics.visitedNodes
                    >=
                    this.maximumVisitedNodes
                ) {

                    return this.#finishNoPath(
                        started,
                        "Search node limit reached."
                    );

                }


                /* --------------------------------------------
                 * EXPAND NEIGHBOURS
                 * -------------------------------------------- */

                const neighbours =
                    this.graph.getNeighbours(
                        currentId
                    );


                for (
                    const edge
                    of
                    neighbours
                ) {

                    if (
                        this.cancelled
                    ) {

                        return this.#finishCancelled(
                            started
                        );

                    }


                    this.statistics.examinedEdges++;


                    const neighbourId =
                        String(
                            edge.to
                        );


                    const edgeWeight =
                        Number(
                            edge.weight
                        );


                    /*
                     * Dijkstra and A* require non-negative edge
                     * weights.
                     */

                    if (
                        !Number.isFinite(
                            edgeWeight
                        )
                        ||
                        edgeWeight < 0
                    ) {

                        this.statistics.invalidEdges++;

                        continue;

                    }


                    const tentativeG =
                        currentG
                        +
                        edgeWeight;


                    const previousG =
                        this.gScore.get(
                            neighbourId
                        )
                        ??
                        Infinity;


                    this.#emit(
                        "edgeExamined",
                        {

                            from:
                                currentId,

                            to:
                                neighbourId,

                            edge,

                            tentativeG,

                            previousG

                        }
                    );


                    /*
                     * Existing route is already as good or better.
                     */

                    if (
                        tentativeG
                        >=
                        previousG
                        -
                        1e-9
                    ) {

                        continue;

                    }


                    if (neighbourId === goalId && !Number.isFinite(previousG)) {
                        console.info("GOAL DISCOVERED", {nodeId:goalId, g:tentativeG});
                    }
                    const wasPreviouslyKnown =
                        Number.isFinite(
                            previousG
                        );


                    /* ----------------------------------------
                     * IMPROVED ROUTE
                     * ---------------------------------------- */

                    this.cameFrom.set(
                        neighbourId,
                        currentId
                    );


                    this.cameFromEdge.set(
                        neighbourId,
                        edge
                    );


                    this.gScore.set(
                        neighbourId,
                        tentativeG
                    );


                    const heuristic =
                        this.#heuristic(
                            neighbourId,
                            goalId
                        );


                    const totalScore =
                        tentativeG
                        +
                        heuristic;


                    this.fScore.set(
                        neighbourId,
                        totalScore
                    );


                    /*
                     * Reopening normally isn't needed with a
                     * consistent heuristic, but supporting it
                     * makes the engine robust if MapApp later
                     * experiments with other cost functions.
                     */

                    if (
                        this.closedSet.has(
                            neighbourId
                        )
                    ) {

                        this.closedSet.delete(
                            neighbourId
                        );


                        this.statistics.reopenedNodes++;

                    }


                    this.openQueue.enqueue(
                        neighbourId,
                        totalScore
                    );


                    this.openSet.add(
                        neighbourId
                    );


                    this.statistics.queueInsertions++;


                    this.statistics.maximumFrontierSize =
                        Math.max(
                            this.statistics.maximumFrontierSize,
                            this.openSet.size
                        );


                    const eventData = {

                        nodeId:
                            neighbourId,

                        node:
                            this.graph.getNode(
                                neighbourId
                            ),

                        parentId:
                            currentId,

                        edge,

                        g:
                            tentativeG,

                        h:
                            heuristic,

                        f:
                            totalScore,

                        frontierCount:
                            this.openSet.size,

                        visitedCount:
                            this.closedSet.size

                    };


                    if (
                        wasPreviouslyKnown
                    ) {

                        this.statistics.improvedNodes++;


                        this.#emit(
                            "nodeImproved",
                            eventData
                        );

                    }
                    else {

                        this.statistics.discoveredNodes++;


                        this.#emit(
                            "nodeDiscovered",
                            eventData
                        );

                    }

                }


                /* --------------------------------------------
                 * FRONTIER UPDATE
                 * -------------------------------------------- */

                this.#emit(
                    "frontierChanged",
                    {

                        frontierCount:
                            this.openSet.size,

                        visitedCount:
                            this.closedSet.size

                    }
                );


                /* --------------------------------------------
                 * BROWSER YIELD / ANIMATION DELAY
                 * -------------------------------------------- */

                expansionsSinceYield++;


                if (
                    this.stepDelay > 0
                ) {

                    await MapUtils.sleep(
                        this.stepDelay
                    );


                    expansionsSinceYield =
                        0;

                }
                else if (
                    expansionsSinceYield
                    >=
                    this.yieldEvery
                ) {

                    await MapUtils.sleep(
                        0
                    );


                    expansionsSinceYield =
                        0;

                }

            }


            return this.#finishNoPath(
                started,
                "No route could be found between the selected nodes."
            );

        }
        catch (error) {

            this.running =
                false;


            this.finished =
                true;


            throw error;

        }

    }


    /* ========================================================
     * PREPARE SEARCH
     * ======================================================== */

    #prepareSearch(
        startId,
        goalId,
        options
    ) {

        this.reset();


        if (
            options.algorithm
            !==
            undefined
        ) {

            this.setAlgorithm(
                options.algorithm
            );

        }


        if (
            options.heuristic
            !==
            undefined
        ) {

            this.setHeuristic(
                options.heuristic
            );

        }


        if (
            options.stepDelay
            !==
            undefined
        ) {

            this.setStepDelay(
                options.stepDelay
            );

        }


        if (
            options.maximumVisitedNodes
            !==
            undefined
        ) {

            this.setMaximumVisitedNodes(
                options.maximumVisitedNodes
            );

        }


        this.startNodeId =
            startId;


        this.goalNodeId =
            goalId;


        this.openQueue =
            new PriorityQueue();


        this.running =
            true;


        this.paused =
            false;


        this.cancelled =
            false;


        this.finished =
            false;


        /* ----------------------------------------------------
         * g(start) = 0
         * ---------------------------------------------------- */

        this.gScore.set(
            startId,
            0
        );


        /* ----------------------------------------------------
         * f(start) = h(start)
         * ---------------------------------------------------- */

        const initialHeuristic =
            this.#heuristic(
                startId,
                goalId
            );


        this.fScore.set(
            startId,
            initialHeuristic
        );


        this.openQueue.enqueue(
            startId,
            initialHeuristic
        );


        this.openSet.add(
            startId
        );


        this.statistics.queueInsertions =
            1;


        this.statistics.maximumFrontierSize =
            1;

    }


    /* ========================================================
     * HEURISTIC
     * ======================================================== */

    #heuristic(
        nodeId,
        goalId
    ) {

        /*
         * Dijkstra is A* with h(n) = 0.
         */

        if (
            this.algorithm
            ===
            "dijkstra"
        ) {

            return 0;

        }


        if (
            this.heuristicMode
            ===
            "none"
        ) {

            return 0;

        }


        const value =
            this.graph.heuristic(
                nodeId,
                goalId
            );


        /*
         * A broken heuristic must never poison the queue with
         * NaN or Infinity.
         */

        if (
            !Number.isFinite(
                value
            )
            ||
            value < 0
        ) {

            return 0;

        }


        return value;

    }


    /* ========================================================
     * PATH RECONSTRUCTION
     * ======================================================== */

    #reconstructPath(goalId) {

        const path = [

            goalId

        ];


        let current =
            goalId;


        const safety =
            new Set(
                [
                    current
                ]
            );


        while (
            this.cameFrom.has(
                current
            )
        ) {

            current =
                this.cameFrom.get(
                    current
                );


            /*
             * cameFrom should always form a tree.
             *
             * Guard against accidental cycles if another graph
             * implementation is used in future.
             */

            if (
                safety.has(
                    current
                )
            ) {

                throw new Error(
                    "Path reconstruction detected a parent cycle."
                );

            }


            safety.add(
                current
            );


            path.push(
                current
            );

        }


        path.reverse();


        if (
            path.length === 0
            ||
            path[0]
            !==
            this.startNodeId
        ) {

            throw new Error(
                "Path reconstruction did not reach the start node."
            );

        }


        return path;

    }


    /* ========================================================
     * SUCCESS RESULT
     * ======================================================== */

    #createSuccessfulResult(path) {

        const coordinates =
            this.graph.pathToCoordinates(
                path
            );


        const edges =
            this.graph.pathToEdges(
                path
            );


        const distance =
            path.length > 1
                ?
                this.graph.calculatePathDistance(
                    path
                )
                :
                0;


        const weight =
            typeof this.graph.calculatePathWeight
            ===
            "function"
                ?
                this.graph.calculatePathWeight(
                    path
                )
                :
                distance;


        const travelSeconds =
            typeof this.graph.calculatePathTravelSeconds
            ===
            "function"
                ?
                this.graph.calculatePathTravelSeconds(
                    path
                )
                :
                null;


        this.statistics.pathNodes =
            path.length;


        this.statistics.pathEdges =
            edges.length;


        this.statistics.pathDistance =
            distance;


        this.statistics.pathWeight =
            weight;


        this.statistics.pathTravelSeconds =
            travelSeconds;


        return {

            success:
                true,

            cancelled:
                false,

            reason:
                null,

            algorithm:
                this.algorithm,

            heuristic:
                this.#effectiveHeuristicName(),

            routingProfile:
                this.graph.routingProfile
                ??
                "distance",

            startNodeId:
                this.startNodeId,

            goalNodeId:
                this.goalNodeId,

            path,

            edges,

            coordinates,

            distance,

            weight,

            travelSeconds,

            distanceKilometres:
                MapUtils.metresToKilometres(
                    distance
                ),

            distanceMiles:
                MapUtils.metresToMiles(
                    distance
                ),

            statistics:
                this.getStatistics()

        };

    }


    /* ========================================================
     * NO PATH
     * ======================================================== */

    #finishNoPath(
        started,
        reason
    ) {

        this.statistics.searchMilliseconds =
            MapUtils.now()
            -
            started;


        this.running =
            false;


        this.finished =
            true;


        const result = {

            success:
                false,

            cancelled:
                false,

            reason,

            algorithm:
                this.algorithm,

            heuristic:
                this.#effectiveHeuristicName(),

            routingProfile:
                this.graph.routingProfile
                ??
                "distance",

            startNodeId:
                this.startNodeId,

            goalNodeId:
                this.goalNodeId,

            path:
                [],

            edges:
                [],

            coordinates:
                [],

            distance:
                Infinity,

            weight:
                Infinity,

            travelSeconds:
                null,

            statistics:
                this.getStatistics()

        };


        this.#emit(
            "noPath",
            result
        );


        this.#emit(
            "complete",
            result
        );


        return result;

    }


    /* ========================================================
     * CANCELLED RESULT
     * ======================================================== */

    #finishCancelled(started) {

        this.statistics.searchMilliseconds =
            MapUtils.now()
            -
            started;


        this.running =
            false;


        this.finished =
            true;


        const result = {

            success:
                false,

            cancelled:
                true,

            reason:
                "Search cancelled.",

            algorithm:
                this.algorithm,

            heuristic:
                this.#effectiveHeuristicName(),

            routingProfile:
                this.graph.routingProfile
                ??
                "distance",

            startNodeId:
                this.startNodeId,

            goalNodeId:
                this.goalNodeId,

            path:
                [],

            edges:
                [],

            coordinates:
                [],

            distance:
                Infinity,

            weight:
                Infinity,

            travelSeconds:
                null,

            statistics:
                this.getStatistics()

        };


        this.#emit(
            "cancelled",
            result
        );


        this.#emit(
            "complete",
            result
        );


        return result;

    }


    /* ========================================================
     * ALGORITHM
     * ======================================================== */

    setAlgorithm(algorithm) {

        const value =
            String(
                algorithm
            )
            .trim()
            .toLowerCase();


        if (
            value !== "astar"
            &&
            value !== "dijkstra"
        ) {

            throw new Error(
                `Unknown search algorithm: ${algorithm}`
            );

        }


        this.algorithm =
            value;


        return this;

    }


    getAlgorithm() {

        return this.algorithm;

    }


    /* ========================================================
     * HEURISTIC
     * ======================================================== */

    setHeuristic(heuristic) {

        let value =
            String(
                heuristic
            )
            .trim()
            .toLowerCase();


        /*
         * Friendly aliases.
         */

        if (
            value === "haversine"
            ||
            value === "straight-line"
            ||
            value === "straightline"
        ) {

            value =
                "distance";

        }


        if (
            value !== "distance"
            &&
            value !== "none"
        ) {

            throw new Error(
                `Unknown heuristic: ${heuristic}`
            );

        }


        this.heuristicMode =
            value;


        return this;

    }


    getHeuristic() {

        return this.heuristicMode;

    }


    #effectiveHeuristicName() {

        if (
            this.algorithm
            ===
            "dijkstra"
        ) {

            return "none";

        }


        return this.heuristicMode;

    }


    /* ========================================================
     * SEARCH SPEED
     * ======================================================== */

    setStepDelay(milliseconds) {

        const value =
            Number(
                milliseconds
            );


        if (
            !Number.isFinite(
                value
            )
            ||
            value < 0
        ) {

            throw new RangeError(
                "Search step delay must be zero or greater."
            );

        }


        this.stepDelay =
            value;


        return this;

    }


    getStepDelay() {

        return this.stepDelay;

    }


    /* ========================================================
     * MAXIMUM VISITED NODES
     * ======================================================== */

    setMaximumVisitedNodes(value) {

        if (
            value === Infinity
        ) {

            this.maximumVisitedNodes =
                Infinity;


            return this;

        }


        const number =
            Number(
                value
            );


        if (
            !Number.isFinite(
                number
            )
            ||
            number <= 0
        ) {

            throw new RangeError(
                "Maximum visited nodes must be greater than zero."
            );

        }


        this.maximumVisitedNodes =
            Math.floor(
                number
            );


        return this;

    }


    /* ========================================================
     * PAUSE
     * ======================================================== */

    pause() {

        if (
            !this.running
            ||
            this.paused
        ) {

            return false;

        }


        this.paused =
            true;


        this.#emit(
            "pause",
            this.getState()
        );


        return true;

    }


    /* ========================================================
     * RESUME
     * ======================================================== */

    resume() {

        if (
            !this.running
            ||
            !this.paused
        ) {

            return false;

        }


        this.paused =
            false;


        this.#emit(
            "resume",
            this.getState()
        );


        return true;

    }


    /* ========================================================
     * TOGGLE PAUSE
     * ======================================================== */

    togglePause() {

        if (
            this.paused
        ) {

            this.resume();

        }
        else {

            this.pause();

        }


        return this.paused;

    }


    /* ========================================================
     * WAIT WHILE PAUSED
     * ======================================================== */

    async #waitWhilePaused() {

        while (
            this.paused
            &&
            !this.cancelled
        ) {

            await MapUtils.sleep(
                25
            );

        }

    }


    /* ========================================================
     * CANCEL
     * ======================================================== */

    cancel() {

        if (
            !this.running
        ) {

            return false;

        }


        this.cancelled =
            true;


        /*
         * A paused search must be allowed to leave its wait loop.
         */

        this.paused =
            false;


        return true;

    }


    /* ========================================================
     * RESET
     * ======================================================== */

    reset() {

        this.running =
            false;


        this.paused =
            false;


        this.cancelled =
            false;


        this.finished =
            false;


        this.startNodeId =
            null;


        this.goalNodeId =
            null;


        this.openQueue =
            null;


        this.openSet.clear();

        this.closedSet.clear();

        this.gScore.clear();

        this.fScore.clear();

        this.cameFrom.clear();

        this.cameFromEdge.clear();


        this.statistics =
            this.#createEmptyStatistics();


        return this;

    }


    /* ========================================================
     * STATE
     * ======================================================== */

    getState() {

        return {

            running:
                this.running,

            paused:
                this.paused,

            cancelled:
                this.cancelled,

            finished:
                this.finished,

            algorithm:
                this.algorithm,

            heuristic:
                this.#effectiveHeuristicName(),

            routingProfile:
                this.graph.routingProfile
                ??
                "distance",

            startNodeId:
                this.startNodeId,

            goalNodeId:
                this.goalNodeId,

            visitedCount:
                this.closedSet.size,

            frontierCount:
                this.openSet.size,

            statistics:
                this.getStatistics()

        };

    }


    isRunning() {

        return this.running;

    }


    isPaused() {

        return this.paused;

    }


    isCancelled() {

        return this.cancelled;

    }


    isFinished() {

        return this.finished;

    }


    /* ========================================================
     * FRONTIER
     * ======================================================== */

    getFrontierNodeIds() {

        return Array.from(
            this.openSet
        );

    }


    /* ========================================================
     * VISITED
     * ======================================================== */

    getVisitedNodeIds() {

        return Array.from(
            this.closedSet
        );

    }


    /* ========================================================
     * PARENT EDGE
     * ======================================================== */

    getParentEdge(nodeId) {

        return (
            this.cameFromEdge.get(
                String(nodeId)
            )
            ||
            null
        );

    }


    /* ========================================================
     * PARENT NODE
     * ======================================================== */

    getParentNodeId(nodeId) {

        return (
            this.cameFrom.get(
                String(nodeId)
            )
            ??
            null
        );

    }


    /* ========================================================
     * G SCORE
     * ======================================================== */

    getGScore(nodeId) {

        return (
            this.gScore.get(
                String(nodeId)
            )
            ??
            Infinity
        );

    }


    /* ========================================================
     * F SCORE
     * ======================================================== */

    getFScore(nodeId) {

        return (
            this.fScore.get(
                String(nodeId)
            )
            ??
            Infinity
        );

    }


    /* ========================================================
     * STATISTICS
     * ======================================================== */

    #createEmptyStatistics() {

        return {

            startedAt:
                null,

            searchMilliseconds:
                0,

            visitedNodes:
                0,

            expandedNodes:
                0,

            discoveredNodes:
                0,

            improvedNodes:
                0,

            reopenedNodes:
                0,

            examinedEdges:
                0,

            invalidEdges:
                0,

            queueInsertions:
                0,

            staleQueueEntries:
                0,

            maximumFrontierSize:
                0,

            pathNodes:
                0,

            pathEdges:
                0,

            pathDistance:
                0,

            pathWeight:
                0,

            pathTravelSeconds:
                null

        };

    }


    getStatistics() {

        return {

            ...this.statistics,

            currentFrontierSize:
                this.openSet.size,

            currentVisitedSize:
                this.closedSet.size

        };

    }


    /* ========================================================
     * EVENTS
     * ======================================================== */

    on(
        eventName,
        callback
    ) {

        if (
            !Object.prototype.hasOwnProperty.call(
                this.listeners,
                eventName
            )
        ) {

            throw new Error(
                `Unknown AStarSearch event: ${eventName}`
            );

        }


        if (
            typeof callback
            !==
            "function"
        ) {

            throw new TypeError(
                "AStarSearch callback must be a function."
            );

        }


        this.listeners[eventName].push(
            callback
        );


        return this;

    }


    off(
        eventName,
        callback
    ) {

        if (
            !this.listeners[eventName]
        ) {

            return this;

        }


        this.listeners[eventName] =
            this.listeners[eventName]
                .filter(
                    listener =>
                        listener !== callback
                );


        return this;

    }


    #emit(
        eventName,
        data
    ) {

        const listeners =
            this.listeners[eventName];


        if (
            !listeners
        ) {

            return;

        }


        for (
            const listener
            of
            listeners
        ) {

            try {

                listener(
                    data
                );

            }
            catch (error) {

                /*
                 * The map visualisation must never be capable of
                 * crashing the pathfinding algorithm.
                 */

                console.error(
                    `AStarSearch ${eventName} listener failed:`,
                    error
                );

            }

        }

    }


    /* ========================================================
     * DESTROY
     * ======================================================== */

    destroy() {

        this.cancel();

        this.reset();


        for (
            const eventName
            of
            Object.keys(
                this.listeners
            )
        ) {

            this.listeners[eventName] =
                [];

        }

    }

}


/* ============================================================
 * GLOBAL EXPORT
 * ============================================================ */

window.AStarSearch =
    AStarSearch;