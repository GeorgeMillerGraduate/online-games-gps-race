"use strict";

/* ============================================================
 * JENGA-CODE ROUTE EXPLORER
 * visualiser.js
 *
 * Visualises the real A* / Dijkstra search on MapLibre.
 *
 * Responsibilities:
 *
 *   - Listen to AStarSearch events
 *   - Draw discovered/frontier road segments
 *   - Draw visited/explored road segments
 *   - Highlight the currently expanded road segment
 *   - Update visited/frontier statistics
 *   - Batch MapLibre GeoJSON updates for performance
 *   - Clear/reset the visualisation
 *   - Attach/detach cleanly from search instances
 *
 *
 * Layer order:
 *
 *      road map
 *          ↓
 *      visited search
 *          ↓
 *      frontier search
 *          ↓
 *      current expansion
 *          ↓
 *      final route      <-- routes.js will handle this
 *
 *
 * This class DOES NOT calculate a route.
 *
 * It only displays what AStarSearch is genuinely doing.
 * ============================================================ */


class SearchVisualiser {

    /* ============================================================
     * CONSTRUCTOR
     * ============================================================ */

    constructor(
        map,
        graph = null,
        options = {}
    ) {

        /*
         * Accept either:
         *
         *      raw MapLibre map
         *
         * or:
         *
         *      our RouteMap wrapper
         *
         * provided the wrapper exposes getMap().
         */

        this.mapController =
            map;


        this.map =
            this.#resolveMap(
                map
            );


        if (
            !this.map
        ) {

            throw new TypeError(
                "SearchVisualiser requires a MapLibre map."
            );

        }


        this.graph =
            graph;


        this.search =
            null;


        /* --------------------------------------------------------
         * SOURCE IDS
         * -------------------------------------------------------- */

        this.sourceIds = {

            visited:
                options.visitedSourceId
                ||
                "route-search-visited",

            frontier:
                options.frontierSourceId
                ||
                "route-search-frontier",

            current:
                options.currentSourceId
                ||
                "route-search-current"

        };


        /* --------------------------------------------------------
         * LAYER IDS
         * -------------------------------------------------------- */

        this.layerIds = {

            visited:
                options.visitedLayerId
                ||
                "route-search-visited-layer",

            frontier:
                options.frontierLayerId
                ||
                "route-search-frontier-layer",

            current:
                options.currentLayerId
                ||
                "route-search-current-layer"

        };


        /* --------------------------------------------------------
         * COLOURS
         *
         * These match the Jenga-Code Route Explorer design.
         * -------------------------------------------------------- */

        this.colours = {

            visited:
                options.visitedColour
                ||
                "#6d91ae",

            frontier:
                options.frontierColour
                ||
                "#d3ad50",

            current:
                options.currentColour
                ||
                "#a35228"

        };


        /* --------------------------------------------------------
         * LINE WIDTHS
         * -------------------------------------------------------- */

        this.lineWidths = {

            visited:
                options.visitedWidth
                ??
                4,

            frontier:
                options.frontierWidth
                ??
                5,

            current:
                options.currentWidth
                ??
                7

        };


        /* --------------------------------------------------------
         * OPACITY
         * -------------------------------------------------------- */

        this.opacity = {

            visited:
                options.visitedOpacity
                ??
                0.62,

            frontier:
                options.frontierOpacity
                ??
                0.88,

            current:
                options.currentOpacity
                ??
                1

        };


        /*
         * How often accumulated geometry is pushed into MapLibre.
         *
         * Updating a GeoJSON source for every single examined edge
         * becomes expensive on larger searches. Instead we collect
         * changes and flush them at most once per animation frame.
         */

        this.useAnimationFrameBatching =
            options.useAnimationFrameBatching
            ??
            true;


        /*
         * Keep the visualisation from becoming unnecessarily huge.
         *
         * The algorithm itself is NOT limited by this number.
         * This only limits how many search features are retained
         * for rendering.
         */

        this.maximumRenderedVisited =
            options.maximumRenderedVisited
            ??
            30000;


        this.maximumRenderedFrontier =
            options.maximumRenderedFrontier
            ??
            15000;


        /* --------------------------------------------------------
         * DOM COUNTERS
         * -------------------------------------------------------- */

        this.visitedCounter =
            document.getElementById(
                "visitedNodes"
            );


        this.frontierCounter =
            document.getElementById(
                "frontierNodes"
            );


        /* --------------------------------------------------------
         * GEOJSON FEATURE STORAGE
         * -------------------------------------------------------- */

        this.visitedFeatures =
            [];


        /*
         * Frontier features are stored by destination node ID.
         *
         * When a node leaves the frontier we can therefore remove
         * its yellow discovery edge.
         */

        this.frontierFeatures =
            new Map();


        this.currentFeatures =
            [];


        /*
         * Prevent duplicate visited segments being rendered again
         * and again.
         */

        this.visitedEdgeKeys =
            new Set();


        /* --------------------------------------------------------
         * RENDER STATE
         * -------------------------------------------------------- */

        this.layersReady =
            false;


        this.renderRequested =
            false;


        this.animationFrameId =
            null;


        this.destroyed =
            false;


        /* --------------------------------------------------------
         * SEARCH EVENT HANDLERS
         *
         * Store bound references so they can later be removed.
         * -------------------------------------------------------- */

        this.boundHandlers = {

            start:
                data =>
                    this.#handleSearchStart(
                        data
                    ),

            nodeVisited:
                data =>
                    this.#handleNodeVisited(
                        data
                    ),

            nodeDiscovered:
                data =>
                    this.#handleNodeDiscovered(
                        data
                    ),

            nodeImproved:
                data =>
                    this.#handleNodeImproved(
                        data
                    ),

            frontierChanged:
                data =>
                    this.#handleFrontierChanged(
                        data
                    ),

            pathFound:
                data =>
                    this.#handlePathFound(
                        data
                    ),

            noPath:
                data =>
                    this.#handleSearchEnd(
                        data
                    ),

            cancelled:
                data =>
                    this.#handleSearchEnd(
                        data
                    ),

            complete:
                data =>
                    this.#handleComplete(
                        data
                    )

        };


        /*
         * Initialise layers as soon as the MapLibre style is ready.
         */

        this.#initialiseLayers();

    }


    /* ============================================================
     * RESOLVE MAP
     * ============================================================ */


    /**
     * Accepts either the MapLibre map itself or our RouteMap
     * controller.
     *
     * @param {*} map
     * @returns {*}
     *
     * @private
     */
    #resolveMap(map) {

        if (!map) {

            return null;

        }


        /*
         * Raw MapLibre map.
         */

        if (
            typeof map.addSource
            ===
            "function"
            &&
            typeof map.addLayer
            ===
            "function"
        ) {

            return map;

        }


        /*
         * RouteMap wrapper.
         */

        if (
            typeof map.getMap
            ===
            "function"
        ) {

            return map.getMap();

        }


        /*
         * A few wrappers expose .map directly.
         */

        if (
            map.map
            &&
            typeof map.map.addSource
            ===
            "function"
        ) {

            return map.map;

        }


        return null;

    }


    /* ============================================================
     * GRAPH
     * ============================================================ */


    /**
     * Changes the graph being visualised.
     *
     * @param {RoadGraph} graph
     */
    setGraph(graph) {

        if (
            graph
            &&
            typeof graph.edgeToGeoJSON
            !==
            "function"
        ) {

            throw new TypeError(
                "SearchVisualiser requires a valid RoadGraph."
            );

        }


        this.graph =
            graph;


        this.clear();

    }


    /**
     * Returns the current graph.
     *
     * @returns {RoadGraph|null}
     */
    getGraph() {

        return this.graph;

    }


    /* ============================================================
     * ATTACH SEARCH
     * ============================================================ */


    /**
     * Connects the visualiser to an AStarSearch instance.
     *
     * @param {AStarSearch} search
     * @returns {SearchVisualiser}
     */
    attach(search) {

        if (
            !search
            ||
            typeof search.on
            !==
            "function"
            ||
            typeof search.off
            !==
            "function"
        ) {

            throw new TypeError(
                "SearchVisualiser requires a valid AStarSearch."
            );

        }


        /*
         * Remove listeners from an earlier search first.
         */

        this.detach();


        this.search =
            search;


        search.on(
            "start",
            this.boundHandlers.start
        );


        search.on(
            "nodeVisited",
            this.boundHandlers.nodeVisited
        );


        search.on(
            "nodeDiscovered",
            this.boundHandlers.nodeDiscovered
        );


        search.on(
            "nodeImproved",
            this.boundHandlers.nodeImproved
        );


        search.on(
            "frontierChanged",
            this.boundHandlers.frontierChanged
        );


        search.on(
            "pathFound",
            this.boundHandlers.pathFound
        );


        search.on(
            "noPath",
            this.boundHandlers.noPath
        );


        search.on(
            "cancelled",
            this.boundHandlers.cancelled
        );


        search.on(
            "complete",
            this.boundHandlers.complete
        );


        return this;

    }


    /* ============================================================
     * DETACH SEARCH
     * ============================================================ */


    /**
     * Disconnects from the current search.
     *
     * @returns {SearchVisualiser}
     */
    detach() {

        if (
            !this.search
        ) {

            return this;

        }


        for (
            const [
                eventName,
                handler
            ]
            of
            Object.entries(
                this.boundHandlers
            )
        ) {

            this.search.off(
                eventName,
                handler
            );

        }


        this.search =
            null;


        return this;

    }


    /* ============================================================
     * MAP LAYERS
     * ============================================================ */


    /**
     * Creates the MapLibre sources/layers when the style is ready.
     *
     * @private
     */
    #initialiseLayers() {

        if (
            this.destroyed
        ) {

            return;

        }


        if (
            this.#isStyleReady()
        ) {

            this.#createLayers();

            return;

        }


        /*
         * style.load is fired whenever a new style finishes
         * loading. Recreating our custom layers here also means the
         * visualiser survives a future map-style change.
         */

        this.map.on(
            "style.load",
            () => {

                if (
                    this.destroyed
                ) {

                    return;

                }


                this.layersReady =
                    false;


                this.#createLayers();


                this.#requestRender();

            }
        );

    }


    /**
     * Returns whether the map style is ready for custom sources.
     *
     * @returns {boolean}
     *
     * @private
     */
    #isStyleReady() {

        try {

            if (
                typeof this.map.isStyleLoaded
                ===
                "function"
            ) {

                return this.map.isStyleLoaded();

            }


            return Boolean(
                this.map.getStyle()
            );

        }
        catch (error) {

            return false;

        }

    }


    /**
     * Creates all GeoJSON sources and line layers.
     *
     * @private
     */
    #createLayers() {

        if (
            this.destroyed
        ) {

            return;

        }


        if (
            !this.#isStyleReady()
        ) {

            return;

        }


        this.#ensureSource(
            this.sourceIds.visited
        );


        this.#ensureSource(
            this.sourceIds.frontier
        );


        this.#ensureSource(
            this.sourceIds.current
        );


        this.#ensureLineLayer(

            this.layerIds.visited,

            this.sourceIds.visited,

            this.colours.visited,

            this.lineWidths.visited,

            this.opacity.visited

        );


        this.#ensureLineLayer(

            this.layerIds.frontier,

            this.sourceIds.frontier,

            this.colours.frontier,

            this.lineWidths.frontier,

            this.opacity.frontier

        );


        this.#ensureLineLayer(

            this.layerIds.current,

            this.sourceIds.current,

            this.colours.current,

            this.lineWidths.current,

            this.opacity.current

        );


        this.layersReady =
            true;

    }


    /**
     * Creates an empty GeoJSON source if it does not already
     * exist.
     *
     * @param {string} sourceId
     *
     * @private
     */
    #ensureSource(sourceId) {

        if (
            this.map.getSource(
                sourceId
            )
        ) {

            return;

        }


        this.map.addSource(
            sourceId,
            {

                type:
                    "geojson",

                data:
                    MapUtils.emptyFeatureCollection()

            }
        );

    }


    /**
     * Creates a MapLibre line layer.
     *
     * @param {string} layerId
     * @param {string} sourceId
     * @param {string} colour
     * @param {number} width
     * @param {number} opacity
     *
     * @private
     */
    #ensureLineLayer(
        layerId,
        sourceId,
        colour,
        width,
        opacity
    ) {

        if (
            this.map.getLayer(
                layerId
            )
        ) {

            return;

        }


        this.map.addLayer(
            {

                id:
                    layerId,

                type:
                    "line",

                source:
                    sourceId,

                layout: {

                    "line-cap":
                        "round",

                    "line-join":
                        "round"

                },

                paint: {

                    "line-color":
                        colour,

                    "line-width":
                        width,

                    "line-opacity":
                        opacity

                }

            }
        );

    }


    /* ============================================================
     * SEARCH START
     * ============================================================ */


    /**
     * Handles a new algorithm run.
     *
     * @param {Object} data
     *
     * @private
     */
    #handleSearchStart(data) {

        this.clear();


        this.#updateCounters(
            0,
            data?.frontierCount
            ??
            1
        );

    }


    /* ============================================================
     * NODE DISCOVERED
     * ============================================================ */


    /**
     * A node has entered the frontier.
     *
     * Its discovery edge is shown in yellow.
     *
     * @param {Object} event
     *
     * @private
     */
    #handleNodeDiscovered(event) {

        this.#setFrontierFeature(
            event
        );


        this.#updateCounters(
            event.visitedCount,
            event.frontierCount
        );


        this.#requestRender();

    }


    /* ============================================================
     * NODE IMPROVED
     * ============================================================ */


    /**
     * A better path to an already-known node has been found.
     *
     * Replace its old frontier edge with the better parent edge.
     *
     * @param {Object} event
     *
     * @private
     */
    #handleNodeImproved(event) {

        this.#setFrontierFeature(
            event
        );


        this.#updateCounters(
            event.visitedCount,
            event.frontierCount
        );


        this.#requestRender();

    }


    /* ============================================================
     * FRONTIER FEATURE
     * ============================================================ */


    /**
     * Adds/replaces a frontier edge.
     *
     * @param {Object} event
     *
     * @private
     */
    #setFrontierFeature(event) {

        if (
            !this.graph
            ||
            !event
            ||
            !event.edge
            ||
            !event.nodeId
        ) {

            return;

        }


        const feature =
            this.graph.edgeToGeoJSON(
                event.edge,
                {

                    state:
                        "frontier",

                    nodeId:
                        String(
                            event.nodeId
                        ),

                    parentId:
                        event.parentId
                        ??
                        null,

                    g:
                        event.g
                        ??
                        null,

                    h:
                        event.h
                        ??
                        null,

                    f:
                        event.f
                        ??
                        null

                }
            );


        if (
            !feature
        ) {

            return;

        }


        this.frontierFeatures.set(
            String(
                event.nodeId
            ),
            feature
        );


        /*
         * Prevent rendering storage from growing indefinitely.
         */

        while (
            this.frontierFeatures.size
            >
            this.maximumRenderedFrontier
        ) {

            const firstKey =
                this.frontierFeatures
                    .keys()
                    .next()
                    .value;


            this.frontierFeatures.delete(
                firstKey
            );

        }

    }


    /* ============================================================
     * NODE VISITED
     * ============================================================ */


    /**
     * A node has been selected as the best current frontier node
     * and is now being expanded.
     *
     * The edge used to reach it moves from the yellow frontier
     * layer into the blue visited layer.
     *
     * @param {Object} event
     *
     * @private
     */
    #handleNodeVisited(event) {

        if (
            !event
            ||
            !event.nodeId
        ) {

            return;

        }


        const nodeId =
            String(
                event.nodeId
            );


        /*
         * Remove the node from the visible frontier.
         */

        this.frontierFeatures.delete(
            nodeId
        );


        /*
         * The starting node has no parent edge.
         */

        const edge =
            this.search
                ? this.search.getParentEdge(
                    nodeId
                )
                : null;


        if (
            edge
            &&
            this.graph
        ) {

            this.#addVisitedEdge(
                edge,
                event
            );


            this.#showCurrentEdge(
                edge,
                event
            );

        }
        else {

            this.currentFeatures =
                [];

        }


        this.#updateCounters(
            event.visitedCount,
            event.frontierCount
        );


        this.#requestRender();

    }


    /* ============================================================
     * ADD VISITED EDGE
     * ============================================================ */


    /**
     * Adds an explored edge to the visited layer.
     *
     * @param {Object} edge
     * @param {Object} event
     *
     * @private
     */
    #addVisitedEdge(
        edge,
        event
    ) {

        const edgeKey =
            this.#createEdgeKey(
                edge
            );


        if (
            this.visitedEdgeKeys.has(
                edgeKey
            )
        ) {

            return;

        }


        const feature =
            this.graph.edgeToGeoJSON(
                edge,
                {

                    state:
                        "visited",

                    nodeId:
                        String(
                            event.nodeId
                        ),

                    g:
                        event.g
                        ??
                        null,

                    h:
                        event.h
                        ??
                        null,

                    f:
                        event.f
                        ??
                        null

                }
            );


        if (
            !feature
        ) {

            return;

        }


        this.visitedEdgeKeys.add(
            edgeKey
        );


        this.visitedFeatures.push(
            feature
        );


        /*
         * Keep memory/rendering bounded.
         */

        if (
            this.visitedFeatures.length
            >
            this.maximumRenderedVisited
        ) {

            const removed =
                this.visitedFeatures.shift();


            if (
                removed
                &&
                removed.properties
            ) {

                /*
                 * The Set is only an optimisation. Rebuilding it
                 * here is simpler and safer than depending on
                 * GeoJSON properties to reconstruct every key.
                 */

                this.#rebuildVisitedEdgeKeys();

            }

        }

    }


    /* ============================================================
     * CURRENT EDGE
     * ============================================================ */


    /**
     * Highlights the edge most recently expanded.
     *
     * @param {Object} edge
     * @param {Object} event
     *
     * @private
     */
    #showCurrentEdge(
        edge,
        event
    ) {

        const feature =
            this.graph.edgeToGeoJSON(
                edge,
                {

                    state:
                        "current",

                    nodeId:
                        String(
                            event.nodeId
                        ),

                    g:
                        event.g
                        ??
                        null,

                    h:
                        event.h
                        ??
                        null,

                    f:
                        event.f
                        ??
                        null

                }
            );


        this.currentFeatures =
            feature
                ? [feature]
                : [];

    }


    /* ============================================================
     * FRONTIER CHANGED
     * ============================================================ */


    /**
     * Updates counters from the algorithm's logical sets.
     *
     * @param {Object} event
     *
     * @private
     */
    #handleFrontierChanged(event) {

        if (!event) {

            return;

        }


        this.#updateCounters(
            event.visitedCount,
            event.frontierCount
        );

    }


    /* ============================================================
     * PATH FOUND
     * ============================================================ */


    /**
     * Search has reached the destination.
     *
     * routes.js will draw the final route. We simply remove the
     * "current expansion" highlight so it does not compete with
     * the final route.
     *
     * @param {Object} result
     *
     * @private
     */
    #handlePathFound(result) {
        this.frontierFeatures.delete(String(result.goalNodeId));

        this.currentFeatures =
            [];


        this.#requestRender();


        const statistics =
            result?.statistics;


        if (
            statistics
        ) {

            this.#updateCounters(
                statistics.currentVisitedSize
                ??
                statistics.visitedNodes
                ??
                0,

                statistics.currentFrontierSize
                ??
                0
            );

        }

    }


    /* ============================================================
     * SEARCH END
     * ============================================================ */


    /**
     * Handles no-route and cancelled searches.
     *
     * @param {Object} result
     *
     * @private
     */
    #handleSearchEnd(result) {

        this.currentFeatures =
            [];


        this.#requestRender();


        const statistics =
            result?.statistics;


        if (
            statistics
        ) {

            this.#updateCounters(
                statistics.currentVisitedSize
                ??
                statistics.visitedNodes
                ??
                0,

                statistics.currentFrontierSize
                ??
                0
            );

        }

    }


    /* ============================================================
     * COMPLETE
     * ============================================================ */


    /**
     * Forces the final pending render after search completion.
     *
     * @private
     */
    #handleComplete() {

        this.currentFeatures =
            [];


        this.renderNow();

    }


    /* ============================================================
     * RENDER REQUEST
     * ============================================================ */


    /**
     * Requests a map update.
     *
     * Multiple algorithm events can occur within a single browser
     * frame. We combine them into one MapLibre source update.
     *
     * @private
     */
    #requestRender() {

        if (
            this.destroyed
        ) {

            return;

        }


        if (
            !this.useAnimationFrameBatching
        ) {

            this.renderNow();

            return;

        }


        if (
            this.renderRequested
        ) {

            return;

        }


        this.renderRequested =
            true;


        this.animationFrameId =
            window.requestAnimationFrame(
                () => {

                    this.animationFrameId =
                        null;


                    this.renderRequested =
                        false;


                    if (MapUtils.now() - (this.lastRenderAt || 0) < 100) {
                        this.#requestRender();
                        return;
                    }
                    this.renderNow();

                }
            );

    }


    /* ============================================================
     * RENDER NOW
     * ============================================================ */


    /**
     * Pushes all current visualisation data into MapLibre.
     */
    renderNow() {
        this.lastRenderAt = MapUtils.now();

        if (
            this.destroyed
        ) {

            return;

        }


        if (
            !this.layersReady
        ) {

            this.#createLayers();

        }


        if (
            !this.layersReady
        ) {

            return;

        }


        this.#setSourceData(

            this.sourceIds.visited,

            MapUtils.featureCollection(
                this.visitedFeatures
            )

        );


        this.#setSourceData(

            this.sourceIds.frontier,

            MapUtils.featureCollection(
                Array.from(
                    this.frontierFeatures.values()
                )
            )

        );


        this.#setSourceData(

            this.sourceIds.current,

            MapUtils.featureCollection(
                this.currentFeatures
            )

        );

    }


    /* ============================================================
     * SET SOURCE DATA
     * ============================================================ */


    /**
     * Safely updates a GeoJSON source.
     *
     * @param {string} sourceId
     * @param {Object} data
     *
     * @private
     */
    #setSourceData(
        sourceId,
        data
    ) {

        const source =
            this.map.getSource(
                sourceId
            );


        if (
            !source
            ||
            typeof source.setData
            !==
            "function"
        ) {

            return;

        }


        source.setData(
            data
        );

    }


    /* ============================================================
     * COUNTERS
     * ============================================================ */


    /**
     * Updates the sidebar counters.
     *
     * @param {number} visited
     * @param {number} frontier
     *
     * @private
     */
    #updateCounters(
        visited,
        frontier
    ) {

        const now = MapUtils.now();
        if (this.lastCounterPaint && now - this.lastCounterPaint < 100) return;
        this.lastCounterPaint = now;
        const visitedValue =
            Number.isFinite(
                Number(visited)
            )
                ? Number(visited)
                : 0;


        const frontierValue =
            Number.isFinite(
                Number(frontier)
            )
                ? Number(frontier)
                : 0;


        if (
            this.visitedCounter
        ) {

            this.visitedCounter.textContent =
                visitedValue.toLocaleString();

        }


        if (
            this.frontierCounter
        ) {

            this.frontierCounter.textContent =
                frontierValue.toLocaleString();

        }

    }


    /* ============================================================
     * EDGE KEY
     * ============================================================ */


    /**
     * Creates a stable directed-edge identifier.
     *
     * @param {Object} edge
     * @returns {string}
     *
     * @private
     */
    #createEdgeKey(edge) {

        return (

            String(
                edge.from
            )
            +
            ">"
            +
            String(
                edge.to
            )
            +
            "@"
            +
            String(
                edge.wayId
                ??
                ""
            )

        );

    }


    /**
     * Rebuilds the visited-edge Set.
     *
     * @private
     */
    #rebuildVisitedEdgeKeys() {

        this.visitedEdgeKeys.clear();


        for (
            const feature
            of
            this.visitedFeatures
        ) {

            const properties =
                feature.properties
                ||
                {};


            if (
                properties.from === undefined
                ||
                properties.to === undefined
            ) {

                continue;

            }


            const key =

                String(
                    properties.from
                )
                +
                ">"
                +
                String(
                    properties.to
                )
                +
                "@"
                +
                String(
                    properties.wayId
                    ??
                    ""
                );


            this.visitedEdgeKeys.add(
                key
            );

        }

    }


    /* ============================================================
     * CLEAR CURRENT
     * ============================================================ */


    /**
     * Removes only the current cyan expansion highlight.
     */
    clearCurrent() {

        this.currentFeatures =
            [];


        this.#requestRender();

    }


    /* ============================================================
     * CLEAR FRONTIER
     * ============================================================ */


    /**
     * Removes the visible frontier while preserving visited roads.
     */
    clearFrontier() {

        this.frontierFeatures.clear();


        this.#requestRender();

    }


    /* ============================================================
     * CLEAR
     * ============================================================ */


    /**
     * Clears the entire search visualisation.
     *
     * The sources and layers remain installed so they can be
     * reused by the next search.
     */
    clear() {

        this.visitedFeatures =
            [];


        this.frontierFeatures.clear();


        this.currentFeatures =
            [];


        this.visitedEdgeKeys.clear();


        this.#updateCounters(
            0,
            0
        );


        this.#requestRender();

    }


    /* ============================================================
     * VISIBILITY
     * ============================================================ */


    /**
     * Shows/hides all search layers.
     *
     * @param {boolean} visible
     */
    setVisible(visible) {

        const visibility =
            visible
                ? "visible"
                : "none";


        for (
            const layerId
            of
            Object.values(
                this.layerIds
            )
        ) {

            if (
                this.map.getLayer(
                    layerId
                )
            ) {

                this.map.setLayoutProperty(
                    layerId,
                    "visibility",
                    visibility
                );

            }

        }

    }


    /**
     * Shows the search visualisation.
     */
    show() {

        this.setVisible(
            true
        );

    }


    /**
     * Hides the search visualisation.
     */
    hide() {

        this.setVisible(
            false
        );

    }


    /* ============================================================
     * SEARCH SPEED
     * ============================================================ */


    /**
     * Convenience method for changing the attached algorithm's
     * delay.
     *
     * @param {number} milliseconds
     */
    setSearchDelay(milliseconds) {

        if (
            !this.search
        ) {

            return;

        }


        this.search.setStepDelay(
            milliseconds
        );

    }


    /* ============================================================
     * STATISTICS
     * ============================================================ */


    /**
     * Returns visualisation statistics.
     *
     * @returns {Object}
     */
    getStatistics() {

        return {

            renderedVisitedEdges:
                this.visitedFeatures.length,

            renderedFrontierEdges:
                this.frontierFeatures.size,

            renderedCurrentEdges:
                this.currentFeatures.length,

            layersReady:
                this.layersReady

        };

    }


    /* ============================================================
     * REMOVE MAP LAYERS
     * ============================================================ */


    /**
     * Completely removes visualiser layers and sources.
     *
     * Normally clear() is preferable. This method is mainly useful
     * during destruction.
     *
     * @private
     */
    #removeLayers() {

        if (
            !this.map
        ) {

            return;

        }


        /*
         * Layers must be removed before their sources.
         */

        for (
            const layerId
            of
            [
                this.layerIds.current,
                this.layerIds.frontier,
                this.layerIds.visited
            ]
        ) {

            try {

                if (
                    this.map.getLayer(
                        layerId
                    )
                ) {

                    this.map.removeLayer(
                        layerId
                    );

                }

            }
            catch (error) {

                console.warn(
                    `Could not remove MapLibre layer ${layerId}.`,
                    error
                );

            }

        }


        for (
            const sourceId
            of
            [
                this.sourceIds.current,
                this.sourceIds.frontier,
                this.sourceIds.visited
            ]
        ) {

            try {

                if (
                    this.map.getSource(
                        sourceId
                    )
                ) {

                    this.map.removeSource(
                        sourceId
                    );

                }

            }
            catch (error) {

                console.warn(
                    `Could not remove MapLibre source ${sourceId}.`,
                    error
                );

            }

        }


        this.layersReady =
            false;

    }


    /* ============================================================
     * DESTROY
     * ============================================================ */


    /**
     * Disconnects events and removes all visualisation resources.
     */
    destroy() {

        if (
            this.destroyed
        ) {

            return;

        }


        this.detach();


        if (
            this.animationFrameId
            !==
            null
        ) {

            window.cancelAnimationFrame(
                this.animationFrameId
            );


            this.animationFrameId =
                null;

        }


        this.renderRequested =
            false;


        this.#removeLayers();


        this.visitedFeatures =
            [];


        this.frontierFeatures.clear();


        this.currentFeatures =
            [];


        this.visitedEdgeKeys.clear();


        this.graph =
            null;


        this.destroyed =
            true;

    }

}


/* ============================================================
 * GLOBAL EXPORT
 *
 *
 * Typical use:
 *
 *      const visualiser =
 *          new SearchVisualiser(
 *              routeMap,
 *              graph
 *          );
 *
 *
 *      const search =
 *          new AStarSearch(
 *              graph,
 *              {
 *                  algorithm: "astar",
 *                  heuristic: "distance",
 *                  stepDelay: 10
 *              }
 *          );
 *
 *
 *      visualiser.attach(
 *          search
 *      );
 *
 *
 *      const result =
 *          await search.search(
 *              startNodeId,
 *              destinationNodeId
 *          );
 *
 *
 * While search() runs:
 *
 *      yellow = frontier
 *      blue   = visited
 *      cyan   = currently expanded edge
 *
 *
 * routes.js will then draw result.path as the final route.
 *
 * ============================================================ */

window.SearchVisualiser =
    SearchVisualiser;