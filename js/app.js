"use strict";

/* ============================================================
 * JENGA-CODE MAPAPP
 * app.js
 *
 * Main application controller.
 *
 * Pipeline:
 *
 *   RouteMap
 *      ↓
 *   MapGeocoder
 *      ↓
 *   MapData
 *      ↓
 *   RoadGraph
 *      ↓
 *   AStarSearch
 *      ↓
 *   SearchVisualiser
 *      ↓
 *   RouteRenderer
 *
 * This controller deliberately does NOT implement pathfinding.
 * AStarSearch is responsible for deciding when the goal has
 * been reached.
 *
 * ============================================================ */


class MapApp {

    /* ========================================================
     * CONSTRUCTOR
     * ======================================================== */

    constructor(options = {}) {

        /* ----------------------------------------------------
         * Core components
         * ---------------------------------------------------- */

        this.routeMap = null;
        this.geocoder = null;
        this.mapData = null;

        this.graph = null;
        this.search = null;

        this.visualiser = null;
        this.routeRenderer = null;


        /* ----------------------------------------------------
         * Current snapped graph nodes
         * ---------------------------------------------------- */

        this.startGraphNode = null;
        this.destinationGraphNode = null;


        /* ----------------------------------------------------
         * Application state
         * ---------------------------------------------------- */

        this.initialised = false;

        this.running = false;

        this.loadingRoadData = false;

        this.lastResult = null;


        /*
         * Used to invalidate an old asynchronous route request
         * after Clear, a new point selection, etc.
         */

        this.requestGeneration = 0;


        /* ----------------------------------------------------
         * Progress display
         * ---------------------------------------------------- */

        this.progressTimer = null;

        this.progressStage = null;

        this.progressStartedAt = 0;


        /* ----------------------------------------------------
         * Live search statistics
         * ---------------------------------------------------- */

        this.liveVisited = 0;

        this.liveFrontier = 0;


        /* ----------------------------------------------------
         * DOM cache
         * ---------------------------------------------------- */

        this.elements = {};


        /* ----------------------------------------------------
         * Options
         * ---------------------------------------------------- */

        this.options = {

            routingProfile:
                options.routingProfile
                ||
                "distance",

            excludePrivateAccess:
                options.excludePrivateAccess
                ??
                true,

            yieldEvery:
                options.yieldEvery
                ??
                75,

            progressInterval:
                options.progressInterval
                ??
                500

        };

    }


    /* ========================================================
     * INITIALISE
     * ======================================================== */

    async initialise() {

        if (this.initialised) {

            return this;

        }


        console.log(
            "========================================"
        );

        console.log(
            "JENGA-CODE MAPAPP"
        );

        console.log(
            "Initialising..."
        );

        console.log(
            "========================================"
        );


        try {

            this.cacheElements();


            this.setStatus(
                "Loading map...",
                "loading"
            );


            /* ------------------------------------------------
             * Map
             * ------------------------------------------------ */

            this.requireClass(
                "RouteMap"
            );


            this.routeMap =
                new RouteMap();


            if (
                typeof this.routeMap.initialise
                ===
                "function"
            ) {

                await this.routeMap.initialise();

            }
            else if (
                typeof this.routeMap.initialize
                ===
                "function"
            ) {

                await this.routeMap.initialize();

            }


            /* ------------------------------------------------
             * Geocoder
             * ------------------------------------------------ */

            if (
                typeof window.MapGeocoder
                ===
                "function"
            ) {

                this.geocoder =
                    new MapGeocoder(
                        this.routeMap
                    );


                if (
                    typeof this.geocoder.initialise
                    ===
                    "function"
                ) {

                    await this.geocoder.initialise();

                }
                else if (
                    typeof this.geocoder.initialize
                    ===
                    "function"
                ) {

                    await this.geocoder.initialize();

                }


                this.installGeocoderEvents();

            }


            /* ------------------------------------------------
             * Road-data loader
             * ------------------------------------------------ */

            this.requireClass(
                "MapData"
            );


            this.mapData =
                new MapData();


            this.installMapDataEvents();


            /* ------------------------------------------------
             * Final route renderer
             * ------------------------------------------------ */

            if (
                typeof window.RouteRenderer
                ===
                "function"
            ) {

                this.routeRenderer =
                    new RouteRenderer(
                        this.routeMap
                    );

            }


            /* ------------------------------------------------
             * UI / map events
             * ------------------------------------------------ */

            this.installInterfaceEvents();

            this.installMapEvents();


            /* ------------------------------------------------
             * Initial interface
             * ------------------------------------------------ */

            this.updateAlgorithmInterface();

            this.updateSpeedLabel();

            this.resetStatistics();

            this.updatePauseButton();

            this.updateButtonStates();


            this.initialised =
                true;


            this.setStatus(
                "Map ready. Choose a start and destination.",
                "ready"
            );


            console.log(
                "MapApp ready."
            );


            return this;

        }
        catch (error) {

            console.error(
                "MapApp initialisation failed:",
                error
            );


            this.setStatus(
                "Initialisation failed: "
                +
                (
                    error?.message
                    ||
                    "Unknown error"
                ),
                "error"
            );


            throw error;

        }

    }


    initialize() {

        return this.initialise();

    }


    /* ========================================================
     * CLASS CHECK
     * ======================================================== */

    requireClass(name) {

        if (
            typeof window[name]
            !==
            "function"
        ) {

            throw new Error(
                `${name} is unavailable.`
            );

        }

    }


    /* ========================================================
     * DOM
     * ======================================================== */

    cacheElements() {

        const ids = [

            "startLocation",
            "destinationLocation",

            "pickStart",
            "pickDestination",

            "swapRoute",
            "findRoute",

            "moveMapTool",
            "startPointTool",
            "destinationPointTool",

            "algorithmSelect",
            "heuristicSelect",

            "searchSpeed",
            "searchSpeedValue",

            "runSearch",
            "pauseSearch",
            "clearSearch",

            "algorithmStatus",
            "statusText",

            "visitedNodes",
            "frontierNodes",
            "routeDistance",
            "searchTime"

        ];


        for (const id of ids) {

            this.elements[id] =
                document.getElementById(
                    id
                );

        }

    }


    /* ========================================================
     * INTERFACE EVENTS
     * ======================================================== */

    installInterfaceEvents() {

        const on =
            (
                element,
                eventName,
                callback
            ) => {

                if (!element) {

                    return;

                }


                element.addEventListener(
                    eventName,
                    callback
                );

            };


        on(
            this.elements.findRoute,
            "click",
            () => this.runRoute()
        );


        on(
            this.elements.runSearch,
            "click",
            () => this.runRoute()
        );


        on(
            this.elements.pauseSearch,
            "click",
            () => this.togglePause()
        );


        on(
            this.elements.clearSearch,
            "click",
            () => this.clearSearch()
        );


        on(
            this.elements.swapRoute,
            "click",
            () => this.swapLocations()
        );


        on(
            this.elements.pickStart,
            "click",
            () => this.setMapSelectionMode(
                "start"
            )
        );


        on(
            this.elements.pickDestination,
            "click",
            () => this.setMapSelectionMode(
                "destination"
            )
        );


        on(
            this.elements.moveMapTool,
            "click",
            () => this.setMapSelectionMode(
                "move"
            )
        );


        on(
            this.elements.startPointTool,
            "click",
            () => this.setMapSelectionMode(
                "start"
            )
        );


        on(
            this.elements.destinationPointTool,
            "click",
            () => this.setMapSelectionMode(
                "destination"
            )
        );


        on(
            this.elements.algorithmSelect,
            "change",
            () => {

                this.updateAlgorithmInterface();

            }
        );


        on(
            this.elements.searchSpeed,
            "input",
            () => {

                this.updateSpeedLabel();


                if (
                    this.search
                    &&
                    typeof this.search.setStepDelay
                    ===
                    "function"
                ) {

                    this.search.setStepDelay(
                        this.getSearchDelay()
                    );

                }

            }
        );


    }

    installMapEvents() {

        if (
            !this.routeMap
            ||
            typeof this.routeMap.on
            !==
            "function"
        ) {

            return;

        }


        this.routeMap.on(
            "startChanged",
            () => {

                this.routePointsChanged();

            }
        );


        this.routeMap.on(
            "destinationChanged",
            () => {

                this.routePointsChanged();

            }
        );


        this.routeMap.on(
            "selectionModeChanged",
            mode => {

                this.updateMapToolButtons(
                    mode
                );

            }
        );

    }


    /* ========================================================
     * GEOCODER EVENTS
     * ======================================================== */

    installGeocoderEvents() {

        if (
            !this.geocoder
            ||
            typeof this.geocoder.on
            !==
            "function"
        ) {

            return;

        }


        try {

            this.geocoder.on(
                "locationSelected",
                () => {

                    this.routePointsChanged();

                }
            );

        }
        catch (error) {

            console.warn(
                "Could not attach locationSelected event:",
                error
            );

        }


        try {

            this.geocoder.on(
                "searchFailed",
                error => {

                    console.error(
                        "Geocoder error:",
                        error
                    );


                    this.setStatus(
                        "Location search failed.",
                        "error"
                    );

                }
            );

        }
        catch (error) {

            console.warn(
                "Could not attach searchFailed event:",
                error
            );

        }

    }


    /* ========================================================
     * MAP DATA EVENTS
     * ======================================================== */

    installMapDataEvents() {

        if (
            !this.mapData
            ||
            typeof this.mapData.on
            !==
            "function"
        ) {

            return;

        }


        try {

            this.mapData.on(
                "loading",
                () => {

                    this.loadingRoadData =
                        true;


                    this.updateButtonStates();

                }
            );

        }
        catch (error) {

            console.warn(
                error
            );

        }


        try {

            this.mapData.on(
                "loaded",
                data => {

                    this.loadingRoadData =
                        false;


                    console.info("Road data loaded", {nodes:data.nodeCount, ways:data.wayCount});


                    this.updateButtonStates();

                }
            );

        }
        catch (error) {

            console.warn(
                error
            );

        }


        try {

            this.mapData.on(
                "error",
                error => {

                    this.loadingRoadData =
                        false;


                    console.error(
                        "Road-data error:",
                        error
                    );


                    this.updateButtonStates();

                }
            );

        }
        catch (error) {

            console.warn(
                error
            );

        }

    }


    /* ========================================================
     * ROUTE POINTS CHANGED
     * ======================================================== */

    routePointsChanged() {

        /*
         * Invalidate any old asynchronous route operation.
         */

        this.requestGeneration++;


        this.stopProgressMonitor();

        this.cancelCurrentWork();


        this.running =
            false;


        this.loadingRoadData =
            false;


        this.graph =
            null;


        this.search =
            null;


        this.startGraphNode =
            null;


        this.destinationGraphNode =
            null;


        this.lastResult =
            null;


        this.liveVisited =
            0;


        this.liveFrontier =
            0;


        this.destroyVisualiser();

        this.clearRenderedRoute();

        this.clearAlgorithmVisualisation();

        this.resetStatistics();


        const start =
            this.routeMap?.getStart?.();


        const destination =
            this.routeMap?.getDestination?.();


        if (
            start
            &&
            destination
        ) {

            this.routeMap
                ?.fitRoutePoints
                ?.();


            this.setStatus(
                "Start and destination selected. Ready to find a route.",
                "ready"
            );

        }
        else if (start) {

            this.setStatus(
                "Start selected. Choose a destination.",
                "ready"
            );

        }
        else if (destination) {

            this.setStatus(
                "Destination selected. Choose a start.",
                "ready"
            );

        }
        else {

            this.setStatus(
                "Choose a start and destination.",
                "ready"
            );

        }


        this.updatePauseButton();

        this.updateButtonStates();

    }


    /* ========================================================
     * RUN ROUTE
     * ======================================================== */

    async runRoute() {
        if (this.running || this.loadingRoadData) return null;
        const start = this.routeMap?.getStart(), destination = this.routeMap?.getDestination();
        if (!start || !destination) {
            this.setStatus("Choose both a start and destination first.", "error");
            return null;
        }
        const generation = ++this.requestGeneration;
        const check = () => this.assertCurrentRequest(generation);
        this.running = true;
        this.lastResult = null;
        this.liveVisited = this.liveFrontier = 0;
        this.destroyVisualiser();
        this.clearRenderedRoute();
        this.clearAlgorithmVisualisation();
        this.resetStatistics();
        this.updateButtonStates();
        try {
            let snapped;
            for (let attempt = 1; attempt <= 2; attempt++) {
                check();
                this.loadingRoadData = true;
                this.downloadAttempt = attempt;
                this.startProgressMonitor("download");
                const network = await this.mapData.loadBetween(start, destination, {
                    paddingMultiplier: attempt === 1 ? 1 : 2.5
                });
                check();
                this.stopProgressMonitor();
                this.loadingRoadData = false;
                this.setStatus("Building the road graph… please wait", "loading");
                await this.yieldToBrowser();
                check();
                this.graph = RoadGraph.fromNetwork(network, this.options);
                this.setStatus("Checking which destination roads are reachable…", "loading");
                snapped = await this.graph.snapReachable(start, destination, {
                    maximumDistance: 500,
                    maximumExtraDistance: 150,
                    checkCancelled: check,
                    onProgress: count => {
                        if (count % 10000 === 1) this.setStatus(
                            `Checking road connectivity… ${count.toLocaleString()} nodes`, "loading");
                    }
                });
                check();
                console.info("ROUTE REQUEST", {
                    attempt, bounds: network.bounds, markerA:start, markerB:destination,
                    snappedA:snapped.start, snappedB:snapped.destination,
                    nearestB:snapped.nearestDestination,
                    reachableNodes:snapped.reachableCount, candidates:snapped.candidateCount,
                    graph:this.graph.getStatistics(), algorithm:this.getSelectedAlgorithm(),
                    heuristic:this.getSelectedHeuristic(), reachable:snapped.success
                });
                if (snapped.success) break;
                if (attempt === 1) {
                    this.setStatus("No connected endpoint yet. Retrying with a larger road area…", "loading");
                    await this.yieldToBrowser();
                }
            }
            if (!snapped.success) {
                const reason = snapped.reason === "snap-distance"
                    ? "No suitable road node within 500 m of A or B. Move the marker closer to a road."
                    : "No directed route to a nearby B node in either downloaded area. Try another road or closer points; the required detour may lie outside the download.";
                this.lastResult = {success:false, cancelled:false, reason, diagnostics:snapped};
                this.showFailedRoute(this.lastResult);
                return this.lastResult;
            }
            this.startGraphNode = snapped.start;
            this.destinationGraphNode = snapped.destination;
            this.routeMap.showSnappedEndpoints?.(snapped.start, snapped.destination);
            const algorithm = this.getSelectedAlgorithm();
            const search = new AStarSearch(this.graph, {
                algorithm, heuristic:this.getSelectedHeuristic(),
                stepDelay:this.getSearchDelay(), yieldEvery:this.options.yieldEvery
            });
            this.search = search;
            this.visualiser = new SearchVisualiser(this.routeMap, this.graph);
            this.visualiser.attach(search);
            this.installSearchEvents(search, generation);
            this.startProgressMonitor("search");
            const result = await search.search(snapped.start.nodeId, snapped.destination.nodeId);
            check();
            this.lastResult = result;
            if (result.success) this.showSuccessfulRoute(result, algorithm);
            else if (result.cancelled) this.setStatus("Search cancelled.", "ready");
            else {
                console.error("SEARCH CONTRACT FAILURE: goal was proven reachable", result);
                this.showFailedRoute(result);
            }
            return result;
        } catch (error) {
            if (generation !== this.requestGeneration) return null;
            console.error("MAPAPP ROUTE ERROR", error);
            this.setStatus(error.name === "AbortError" ? "Request cancelled."
                : `Route failed: ${error.message}`, error.name === "AbortError" ? "ready" : "error");
            return null;
        } finally {
            // An old cancelled request must never stop a newer request's timer.
            if (generation === this.requestGeneration) {
                this.stopProgressMonitor();
                this.running = this.loadingRoadData = false;
                this.updateButtonStates();
            }
        }
    }

    assertCurrentRequest(generation) {

        if (
            generation
            ===
            this.requestGeneration
        ) {

            return;

        }


        const error =
            new Error(
                "This route request is no longer current."
            );


        error.name =
            "StaleRouteRequestError";


        throw error;

    }


    /* ========================================================
     * SUCCESS
     * ======================================================== */

    showSuccessfulRoute(
        result,
        algorithm
    ) {

        this.stopProgressMonitor();


        if (
            this.routeRenderer
            &&
            typeof this.routeRenderer.showResult
            ===
            "function"
        ) {

            this.routeRenderer.showResult(
                result,
                {
                    fit:
                        true
                }
            );

        }


        this.updateResultStatistics(
            result
        );


        const algorithmName =
            this.getAlgorithmDisplayName(
                algorithm
            );


        const distance =
            this.formatDistance(
                result.distance
            );


        const travel =
            this.formatTravelTime(
                result.travelSeconds
            );


        let message =
            `${algorithmName} found the route • ${distance}`;


        if (travel) {

            message +=
                ` • ${travel}`;

        }


        if (this.startGraphNode && this.destinationGraphNode) {
            message += ` • road offsets A ${Math.round(this.startGraphNode.distance)} m / B ${Math.round(this.destinationGraphNode.distance)} m`;
        }
        this.setStatus(
            message,
            "success"
        );

    }


    /* ========================================================
     * FAILURE
     * ======================================================== */

    showFailedRoute(result) {

        this.stopProgressMonitor();


        if (
            this.routeRenderer
            &&
            typeof this.routeRenderer.showFailure
            ===
            "function"
        ) {

            this.routeRenderer.showFailure(
                result
            );

        }


        this.updateResultStatistics(
            result
        );


        this.setStatus(
            result?.reason
            ||
            "No connected route could be found between A and B.",
            "error"
        );

    }


    /* ========================================================
     * SEARCH EVENTS
     * ======================================================== */

    installSearchEvents(
        search,
        generation
    ) {

        if (
            !search
            ||
            typeof search.on
            !==
            "function"
        ) {

            return;

        }


        search.on("start", () => {
            if (generation === this.requestGeneration) this.updatePauseButton();
        });

        const valid =
            () => {

                return (
                    generation
                    ===
                    this.requestGeneration
                );

            };


        /*
         * Live statistics only.
         *
         * We deliberately do NOT attempt to detect the goal
         * from nodeVisited events.
         */

        try {

            search.on(
                "nodeVisited",
                event => {

                    if (!valid()) {

                        return;

                    }


                    const visited =
                        Number(
                            event?.visitedCount
                            ??
                            event?.expandedCount
                            ??
                            this.liveVisited
                        );


                    const frontier =
                        Number(
                            event?.frontierCount
                            ??
                            this.liveFrontier
                        );


                    if (
                        Number.isFinite(
                            visited
                        )
                    ) {

                        this.liveVisited =
                            visited;

                    }


                    if (
                        Number.isFinite(
                            frontier
                        )
                    ) {

                        this.liveFrontier =
                            frontier;

                    }


                    this.updateLiveStatistics();

                }
            );

        }
        catch (error) {

            console.warn(
                error
            );

        }


        try {

            search.on(
                "frontierChanged",
                event => {

                    if (!valid()) {

                        return;

                    }


                    const frontier =
                        Number(
                            event?.frontierCount
                            ??
                            event?.size
                            ??
                            this.liveFrontier
                        );


                    if (
                        Number.isFinite(
                            frontier
                        )
                    ) {

                        this.liveFrontier =
                            frontier;

                    }


                    this.updateLiveStatistics();

                }
            );

        }
        catch (error) {

            console.warn(
                error
            );

        }


        try {

            search.on(
                "pause",
                () => {

                    if (!valid()) {

                        return;

                    }


                    this.stopProgressMonitor();


                    this.setStatus(
                        "Search paused.",
                        "paused"
                    );


                    this.updatePauseButton();

                }
            );

        }
        catch (error) {

            console.warn(
                error
            );

        }


        try {

            search.on(
                "resume",
                () => {

                    if (!valid()) {

                        return;

                    }


                    this.startProgressMonitor(
                        "search"
                    );


                    this.updatePauseButton();

                }
            );

        }
        catch (error) {

            console.warn(
                error
            );

        }


        try {

            search.on(
                "cancelled",
                () => {

                    if (!valid()) {

                        return;

                    }


                    this.stopProgressMonitor();

                    this.updatePauseButton();

                }
            );

        }
        catch (error) {

            console.warn(
                error
            );

        }


        try {

            search.on(
                "complete",
                result => {

                    if (!valid()) {

                        return;

                    }


                    this.stopProgressMonitor();


                    this.updateResultStatistics(
                        result
                    );


                    this.updatePauseButton();

                }
            );

        }
        catch (error) {

            console.warn(
                error
            );

        }

    }


    /* ========================================================
     * LIVE STATISTICS
     * ======================================================== */

    updateLiveStatistics() {
        const now = performance.now();
        if (this.lastStatisticsPaint && now - this.lastStatisticsPaint < 100) return;
        this.lastStatisticsPaint = now;

        this.setCounter(
            this.elements.visitedNodes,
            this.liveVisited
        );


        this.setCounter(
            this.elements.frontierNodes,
            this.liveFrontier
        );

    }


    /* ========================================================
     * PROGRESS MONITOR
     * ======================================================== */

    startProgressMonitor(stage) {

        this.stopProgressMonitor();


        this.progressStage =
            stage;


        this.progressStartedAt =
            performance.now();


        /*
         * Update immediately, then every 0.5 seconds.
         */

        this.updateProgressMessage();


        this.progressTimer =
            window.setInterval(
                () => {

                    this.updateProgressMessage();

                },
                this.options.progressInterval
            );

    }


    stopProgressMonitor() {

        if (
            this.progressTimer
            !==
            null
        ) {

            window.clearInterval(
                this.progressTimer
            );


            this.progressTimer =
                null;

        }


        this.progressStage =
            null;


        this.progressStartedAt =
            0;

    }


    /* ========================================================
     * PROGRESS MESSAGE
     * ======================================================== */

    updateProgressMessage() {

        if (!this.progressStage) {

            return;

        }


        const elapsed =
            (
                performance.now()
                -
                (this.progressStage === "search" ? (this.search?.statistics.startedAt ?? this.progressStartedAt) : this.progressStartedAt)
            )
            /
            1000;


        const elapsedText =
            `${elapsed.toFixed(1)} s`;


        /* ----------------------------------------------------
         * OSM download
         * ---------------------------------------------------- */

        if (
            this.progressStage
            ===
            "download"
        ) {

            let message =
                (this.mapData?.downloadState || (this.downloadAttempt === 2 ? "Retry 2/2: downloading a larger road area…" : "Downloading OpenStreetMap road data…"));


            if (
                elapsed >= 1
                &&
                elapsed < 4
            ) {

                message +=
                    " please wait";

            }
            else if (
                elapsed >= 4
                &&
                elapsed < 10
            ) {

                message +=
                    " still downloading, please wait";

            }
            else if (
                elapsed >= 10
            ) {

                message +=
                    " this is a large road network, please wait";

            }


            message +=
                ` • ${elapsedText}`;


            this.setStatus(
                message,
                "loading"
            );


            if (
                this.elements.searchTime
            ) {

                this.elements.searchTime.textContent =
                    elapsedText;

            }


            return;

        }


        /* ----------------------------------------------------
         * Search
         * ---------------------------------------------------- */

        if (
            this.progressStage
            ===
            "search"
        ) {

            const algorithm =
                this.getAlgorithmDisplayName(
                    this.getSelectedAlgorithm()
                );


            let visited =
                this.liveVisited;


            let frontier =
                this.liveFrontier;


            /*
             * If AStarSearch exposes live statistics, prefer
             * them. Otherwise use the event counters.
             */

            if (
                this.search
                &&
                typeof this.search.getStatistics
                ===
                "function"
            ) {

                try {

                    const statistics =
                        this.search.getStatistics()
                        ||
                        {};


                    const reportedVisited =
                        Number(
                            statistics.visitedNodes
                            ??
                            statistics.expandedNodes
                        );


                    const reportedFrontier =
                        Number(
                            statistics.currentFrontierSize
                            ??
                            statistics.frontierSize
                        );


                    if (
                        Number.isFinite(
                            reportedVisited
                        )
                    ) {

                        visited =
                            reportedVisited;


                        this.liveVisited =
                            reportedVisited;

                    }


                    if (
                        Number.isFinite(
                            reportedFrontier
                        )
                    ) {

                        frontier =
                            reportedFrontier;


                        this.liveFrontier =
                            reportedFrontier;

                    }

                }
                catch (error) {

                    console.warn(
                        "Could not read live search statistics:",
                        error
                    );

                }

            }


            this.updateLiveStatistics();


            this.setStatus(
                `${algorithm} searching… `
                +
                `${Math.round(visited).toLocaleString()} visited`
                +
                ` • ${Math.round(frontier).toLocaleString()} frontier`
                +
                ` • ${elapsedText}`,
                "searching"
            );


            if (
                this.elements.searchTime
            ) {

                this.elements.searchTime.textContent =
                    elapsedText;

            }

        }

    }


    /* ========================================================
     * RESULT STATISTICS
     * ======================================================== */

    updateResultStatistics(result) {

        if (!result) {

            return;

        }


        const statistics =
            result.statistics
            ||
            {};


        const visited =
            statistics.visitedNodes
            ??
            statistics.expandedNodes
            ??
            result.visitedNodes
            ??
            this.liveVisited;


        const frontier =
            statistics.currentFrontierSize
            ??
            result.frontierNodes
            ??
            this.liveFrontier;


        this.setCounter(
            this.elements.visitedNodes,
            visited
        );


        this.setCounter(
            this.elements.frontierNodes,
            frontier
        );


        if (
            this.elements.routeDistance
        ) {

            const distance =
                Number(
                    result.distance
                );


            if (
                result.success
                &&
                Number.isFinite(
                    distance
                )
            ) {

                this.elements.routeDistance.textContent =
                    this.formatDistance(
                        distance
                    );

            }
            else {

                this.elements.routeDistance.textContent =
                    "—";

            }

        }


        if (
            this.elements.searchTime
        ) {

            const milliseconds =
                statistics.searchMilliseconds
                ??
                statistics.elapsedMilliseconds
                ??
                result.searchMilliseconds;


            this.elements.searchTime.textContent =
                this.formatMilliseconds(
                    milliseconds
                );

        }

    }


    /* ========================================================
     * YIELD TO BROWSER
     * ======================================================== */

    async yieldToBrowser() {

        await new Promise(
            resolve => {

                requestAnimationFrame(
                    () => {

                        window.setTimeout(
                            resolve,
                            0
                        );

                    }
                );

            }
        );

    }


    /* ========================================================
     * PAUSE / RESUME
     * ======================================================== */

    togglePause() {

        if (
            !this.search
            ||
            typeof this.search.isRunning
            !==
            "function"
            ||
            !this.search.isRunning()
        ) {

            return;

        }


        if (
            typeof this.search.togglePause
            ===
            "function"
        ) {

            this.search.togglePause();

        }
        else if (
            typeof this.search.isPaused
            ===
            "function"
        ) {

            if (
                this.search.isPaused()
            ) {

                this.search.resume?.();

            }
            else {

                this.search.pause?.();

            }

        }


        this.updatePauseButton();

    }


    /* ========================================================
     * PAUSE BUTTON
     * ======================================================== */

    updatePauseButton() {

        const button =
            this.elements.pauseSearch;


        if (!button) {

            return;

        }


        const running =
            Boolean(
                this.search
                &&
                typeof this.search.isRunning
                ===
                "function"
                &&
                this.search.isRunning()
            );


        const paused =
            Boolean(
                running
                &&
                typeof this.search.isPaused
                ===
                "function"
                &&
                this.search.isPaused()
            );


        button.textContent =
            paused
                ?
                "Resume"
                :
                "Pause";


        button.disabled =
            !running;

    }


    /* ========================================================
     * CLEAR SEARCH
     * ======================================================== */

    clearSearch() {

        /*
         * Invalidate anything currently awaiting a promise.
         */

        this.requestGeneration++;


        this.stopProgressMonitor();

        this.cancelCurrentWork();


        this.running =
            false;


        this.loadingRoadData =
            false;


        this.graph =
            null;


        this.search =
            null;


        this.startGraphNode =
            null;


        this.destinationGraphNode =
            null;


        this.lastResult =
            null;


        this.liveVisited =
            0;


        this.liveFrontier =
            0;


        this.destroyVisualiser();

        this.clearRenderedRoute();

        this.clearAlgorithmVisualisation();

        this.resetStatistics();


        this.setStatus(
            "Search cleared. A and B are ready for another search.",
            "ready"
        );


        this.updatePauseButton();

        this.updateButtonStates();

    }


    /* ========================================================
     * CANCEL CURRENT WORK
     * ======================================================== */

    cancelCurrentWork() {

        try {

            this.mapData?.cancel?.();

        }
        catch (error) {

            console.warn(
                error
            );

        }


        try {

            if (
                this.search
                &&
                typeof this.search.isRunning
                ===
                "function"
                &&
                this.search.isRunning()
            ) {

                this.search.cancel?.();

            }

        }
        catch (error) {

            console.warn(
                error
            );

        }

    }


    /* ========================================================
     * DESTROY VISUALISER
     * ======================================================== */

    destroyVisualiser() {

        if (!this.visualiser) {

            return;

        }


        try {

            this.visualiser.detach?.();

        }
        catch (error) {

            console.warn(
                error
            );

        }


        try {

            this.visualiser.destroy?.();

        }
        catch (error) {

            console.warn(
                error
            );

        }


        this.visualiser =
            null;

    }


    /* ========================================================
     * CLEAR FINAL ROUTE
     * ======================================================== */

    clearRenderedRoute() {

        try {

            this.routeRenderer?.clear?.();

        }
        catch (error) {

            console.warn(
                error
            );

        }

    }


    /* ========================================================
     * CLEAR SEARCH VISUALISATION
     * ======================================================== */

    clearAlgorithmVisualisation() {
        this.routeMap?.clearSnappedEndpoints?.();

        try {

            this.routeMap
                ?.clearAlgorithmVisualisation
                ?.();

        }
        catch (error) {

            console.warn(
                error
            );

        }

    }


    /* ========================================================
     * SWAP LOCATIONS
     * ======================================================== */

    swapLocations() {

        if (
            this.running
            ||
            this.loadingRoadData
        ) {

            this.setStatus(
                "Please wait for the current operation to finish.",
                "loading"
            );


            return;

        }


        this.routeMap
            ?.swapPoints
            ?.();


        // Map point events synchronise the location inputs; do not swap them twice.


        this.setStatus(
            "Start and destination swapped.",
            "ready"
        );


        this.updateButtonStates();

    }


    /* ========================================================
     * MAP SELECTION MODE
     * ======================================================== */

    setMapSelectionMode(mode) {

        if (
            this.running
            ||
            this.loadingRoadData
        ) {

            this.setStatus(
                "Please wait for the current operation to finish.",
                "loading"
            );


            return;

        }


        this.routeMap
            ?.setSelectionMode
            ?.(mode);


        if (
            mode
            ===
            "start"
        ) {

            this.setStatus(
                "Click the map to choose the start point.",
                "selecting"
            );

        }
        else if (
            mode
            ===
            "destination"
        ) {

            this.setStatus(
                "Click the map to choose the destination.",
                "selecting"
            );

        }
        else {

            this.setStatus(
                "Map movement mode.",
                "ready"
            );

        }


        this.updateMapToolButtons(
            mode
        );

    }


    /* ========================================================
     * MAP TOOL BUTTONS
     * ======================================================== */

    updateMapToolButtons(mode) {

        const buttons = {

            move:
                this.elements.moveMapTool,

            start:
                this.elements.startPointTool,

            destination:
                this.elements.destinationPointTool

        };


        for (
            const [
                name,
                button
            ]
            of
            Object.entries(
                buttons
            )
        ) {

            if (!button) {

                continue;

            }


            const active =
                name
                ===
                mode;


            button.classList.toggle(
                "active",
                active
            );


            button.setAttribute(
                "aria-pressed",
                active
                    ?
                    "true"
                    :
                    "false"
            );

        }

    }


    /* ========================================================
     * ALGORITHM
     * ======================================================== */

    getSelectedAlgorithm() {

        const value =
            String(
                this.elements.algorithmSelect
                    ?.value
                ||
                "astar"
            )
            .trim()
            .toLowerCase();


        if (
            value
            ===
            "dijkstra"
        ) {

            return "dijkstra";

        }


        return "astar";

    }


    /* ========================================================
     * HEURISTIC
     * ======================================================== */

    getSelectedHeuristic() {

        if (
            this.getSelectedAlgorithm()
            ===
            "dijkstra"
        ) {

            return "none";

        }


        const selected =
            String(
                this.elements.heuristicSelect
                    ?.value
                ||
                "distance"
            )
            .trim()
            .toLowerCase();


        /*
         * At present the graph supplies the distance heuristic.
         * Keep unknown UI values from breaking A*.
         */

        if (
            selected
            ===
            "none"
        ) {

            return "none";

        }


        return "distance";

    }


    /* ========================================================
     * ALGORITHM NAME
     * ======================================================== */

    getAlgorithmDisplayName(
        algorithm
    ) {

        return (
            algorithm
            ===
            "dijkstra"
        )
            ?
            "Dijkstra"
            :
            "A*";

    }


    /* ========================================================
     * ALGORITHM UI
     * ======================================================== */

    updateAlgorithmInterface() {

        if (
            !this.elements.heuristicSelect
        ) {

            return;

        }


        const dijkstra =
            this.getSelectedAlgorithm()
            ===
            "dijkstra";


        const name = this.getAlgorithmDisplayName(this.getSelectedAlgorithm());
        const heading = document.querySelector(".algorithm-heading h2");
        if (heading) heading.textContent = `${name} Search`;
        if (this.elements.runSearch) this.elements.runSearch.textContent = `▶ Run ${name}`;
        const formula = document.querySelector(".formula");
        if (formula) formula.textContent = dijkstra ? "f(n) = g(n)" : "f(n) = g(n) + h(n)";
        this.elements.heuristicSelect.disabled =
            dijkstra
            ||
            this.running
            ||
            this.loadingRoadData;

    }


    /* ========================================================
     * SEARCH SPEED
     * ======================================================== */

    getSearchDelay() {

        const slider =
            this.elements.searchSpeed;


        if (!slider) {

            return 8;

        }


        const value =
            Number(
                slider.value
            );


        const minimum =
            Number(
                slider.min
                ||
                0
            );


        const maximum =
            Number(
                slider.max
                ||
                100
            );


        if (
            !Number.isFinite(
                value
            )
            ||
            !Number.isFinite(
                minimum
            )
            ||
            !Number.isFinite(
                maximum
            )
            ||
            maximum <= minimum
        ) {

            return 8;

        }


        const normalised =
            Math.max(
                0,
                Math.min(
                    1,
                    (
                        value
                        -
                        minimum
                    )
                    /
                    (
                        maximum
                        -
                        minimum
                    )
                )
            );


        /*
         * High slider position = faster visualisation.
         *
         * 0%   ≈ 120 ms per visible step
         * 100% = 0 ms
         */

        return Math.round(
            120
            *
            Math.pow(
                1
                -
                normalised,
                2
            )
        );

    }


    /* ========================================================
     * SPEED LABEL
     * ======================================================== */

    updateSpeedLabel() {

        const label =
            this.elements.searchSpeedValue;


        if (!label) {

            return;

        }


        const delay =
            this.getSearchDelay();


        if (
            delay
            ===
            0
        ) {

            label.textContent =
                "Maximum";

        }
        else if (
            delay
            <=
            4
        ) {

            label.textContent =
                "Very fast";

        }
        else if (
            delay
            <=
            15
        ) {

            label.textContent =
                "Fast";

        }
        else if (
            delay
            <=
            45
        ) {

            label.textContent =
                "Medium";

        }
        else if (
            delay
            <=
            85
        ) {

            label.textContent =
                "Slow";

        }
        else {

            label.textContent =
                "Very slow";

        }

    }


    /* ========================================================
     * TRY RUN
     * ======================================================== */

    tryRun() {

        if (
            this.routeMap?.getStart?.()
            &&
            this.routeMap?.getDestination?.()
            &&
            !this.running
            &&
            !this.loadingRoadData
        ) {

            this.runRoute();

        }

    }


    /* ========================================================
     * BUTTON STATES
     * ======================================================== */

    updateButtonStates() {

        const busy =
            this.running
            ||
            this.loadingRoadData;


        const hasStart =
            Boolean(
                this.routeMap
                    ?.getStart
                    ?.()
            );


        const hasDestination =
            Boolean(
                this.routeMap
                    ?.getDestination
                    ?.()
            );


        const canRun =
            hasStart
            &&
            hasDestination
            &&
            !busy;


        if (
            this.elements.findRoute
        ) {

            this.elements.findRoute.disabled =
                !canRun;

        }


        if (
            this.elements.runSearch
        ) {

            this.elements.runSearch.disabled =
                !canRun;

        }


        if (
            this.elements.swapRoute
        ) {

            this.elements.swapRoute.disabled =
                busy;

        }


        const locked = [

            this.elements.pickStart,
            this.elements.pickDestination,

            this.elements.moveMapTool,
            this.elements.startPointTool,
            this.elements.destinationPointTool,

            this.elements.algorithmSelect

        ];


        for (
            const element
            of
            locked
        ) {

            if (element) {

                element.disabled =
                    busy;

            }

        }


        this.updateAlgorithmInterface();

        this.updatePauseButton();

    }


    /* ========================================================
     * RESET STATISTICS
     * ======================================================== */

    resetStatistics() {

        this.setCounter(
            this.elements.visitedNodes,
            0
        );


        this.setCounter(
            this.elements.frontierNodes,
            0
        );


        if (
            this.elements.routeDistance
        ) {

            this.elements.routeDistance.textContent =
                "—";

        }


        if (
            this.elements.searchTime
        ) {

            this.elements.searchTime.textContent =
                "—";

        }

    }


    /* ========================================================
     * COUNTER
     * ======================================================== */

    setCounter(
        element,
        value
    ) {

        if (!element) {

            return;

        }


        const number =
            Number(
                value
            );


        if (
            !Number.isFinite(
                number
            )
        ) {

            element.textContent =
                "0";


            return;

        }


        element.textContent =
            Math.max(
                0,
                Math.round(
                    number
                )
            )
            .toLocaleString();

    }


    /* ========================================================
     * STATUS
     * ======================================================== */

    setStatus(
        message,
        state = "ready"
    ) {

        // Progress changes twice a second; keep these out of the console.


        if (
            this.elements.statusText
        ) {

            this.elements.statusText.textContent =
                message;

        }


        if (
            !this.elements.algorithmStatus
        ) {

            return;

        }


        this.elements.algorithmStatus.dataset.state =
            state;


        const states = [

            "ready",
            "loading",
            "searching",
            "paused",
            "success",
            "error",
            "selecting"

        ];


        for (
            const item
            of
            states
        ) {

            this.elements.algorithmStatus
                .classList.remove(
                    `status-${item}`
                );

        }


        this.elements.algorithmStatus
            .classList.add(
                `status-${state}`
            );

    }


    /* ========================================================
     * FORMAT DISTANCE
     * ======================================================== */

    formatDistance(metres) {

        const value =
            Number(
                metres
            );


        if (
            !Number.isFinite(
                value
            )
        ) {

            return "unknown distance";

        }


        if (
            value
            <
            1000
        ) {

            return `${Math.round(value)} m`;

        }


        const miles =
            value
            /
            1609.344;


        if (
            miles
            <
            10
        ) {

            return `${miles.toFixed(2)} mi`;

        }


        return `${miles.toFixed(1)} mi`;

    }


    /* ========================================================
     * FORMAT MILLISECONDS
     * ======================================================== */

    formatMilliseconds(
        milliseconds
    ) {

        const value =
            Number(
                milliseconds
            );


        if (
            !Number.isFinite(
                value
            )
        ) {

            return "—";

        }


        if (
            value
            <
            1000
        ) {

            return `${Math.round(value)} ms`;

        }


        return `${(value / 1000).toFixed(2)} s`;

    }


    /* ========================================================
     * FORMAT TRAVEL TIME
     * ======================================================== */

    formatTravelTime(seconds) {

        const value =
            Number(
                seconds
            );


        if (
            !Number.isFinite(
                value
            )
            ||
            value < 0
        ) {

            return null;

        }


        const minutes =
            Math.max(
                1,
                Math.round(
                    value
                    /
                    60
                )
            );


        if (
            minutes
            <
            60
        ) {

            return `${minutes} min`;

        }


        const hours =
            Math.floor(
                minutes
                /
                60
            );


        const remainder =
            minutes
            %
            60;


        if (
            remainder
            ===
            0
        ) {

            return `${hours} hr`;

        }


        return `${hours} hr ${remainder} min`;

    }


    /* ========================================================
     * DEBUG ACCESS
     * ======================================================== */

    getRouteMap() {

        return this.routeMap;

    }


    getGraph() {

        return this.graph;

    }


    getSearch() {

        return this.search;

    }


    getResult() {

        return this.lastResult;

    }


    getSnappedStart() {

        return this.startGraphNode;

    }


    getSnappedDestination() {

        return this.destinationGraphNode;

    }


    /* ========================================================
     * DESTROY
     * ======================================================== */

    destroy() {

        this.requestGeneration++;


        this.stopProgressMonitor();

        this.cancelCurrentWork();


        this.destroyVisualiser();


        try {

            this.routeRenderer
                ?.destroy
                ?.();

        }
        catch (error) {

            console.warn(
                error
            );

        }


        try {

            this.geocoder
                ?.destroy
                ?.();

        }
        catch (error) {

            console.warn(
                error
            );

        }


        try {

            this.routeMap
                ?.destroy
                ?.();

        }
        catch (error) {

            console.warn(
                error
            );

        }


        this.routeMap =
            null;


        this.geocoder =
            null;


        this.mapData =
            null;


        this.graph =
            null;


        this.search =
            null;


        this.visualiser =
            null;


        this.routeRenderer =
            null;


        this.startGraphNode =
            null;


        this.destinationGraphNode =
            null;


        this.lastResult =
            null;


        this.running =
            false;


        this.loadingRoadData =
            false;


        this.initialised =
            false;

    }

}


/* ============================================================
 * EXPORT
 * ============================================================ */

window.MapApp =
    MapApp;


/*
 * Temporary compatibility with the original Route Explorer
 * name while the rest of the project moves to MapApp.
 */

window.RouteExplorerApp =
    MapApp;


/* ============================================================
 * STARTUP
 * ============================================================ */

async function startMapApp() {

    if (
        window.mapApp
        instanceof
        MapApp
    ) {

        return window.mapApp;

    }


    try {

        console.log(
            "Starting Jenga-Code MapApp..."
        );


        const app =
            new MapApp();


        window.mapApp =
            app;


        /*
         * Temporary backwards-compatible global.
         */

        window.routeExplorer =
            app;


        await app.initialise();


        return app;

    }
    catch (error) {

        console.error(
            "FATAL MAPAPP ERROR:",
            error
        );
        const message = /WebGL/i.test(String(error))
            ? 'This browser could not start the map. WebGL2 support is required.'
            : 'The map could not start. Reload the page to try again.';
        const status = document.getElementById('statusText');
        if (status) status.textContent = message;
        const container = document.getElementById('map');
        if (container) {
            container.textContent = message;
            container.classList.add('map-unavailable');
        }



        return null;

    }

}


window.startMapApp =
    startMapApp;


window.startRouteExplorer =
    startMapApp;


/* ============================================================
 * AUTOMATIC START
 * ============================================================ */

if (
    document.readyState
    ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        startMapApp,
        {
            once:
                true
        }
    );

}
else {

    startMapApp();

}