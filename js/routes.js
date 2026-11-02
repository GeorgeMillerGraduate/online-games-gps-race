"use strict";

/* ============================================================
 * JENGA-CODE ROUTE EXPLORER
 * routes.js
 *
 * Final route presentation and route-result management.
 *
 * Responsibilities:
 *
 *   - Accept successful A* / Dijkstra results
 *   - Draw the final shortest route on MapLibre
 *   - Draw a dark outline beneath the route
 *   - Update route-result statistics
 *   - Format distance and search time
 *   - Fit the map around the completed route
 *   - Clear / replace existing routes
 *   - Preserve the actual graph path and result data
 *
 *
 * This class DOES NOT calculate the route.
 *
 * astar.js:
 *
 *      calculates the shortest path
 *
 * visualiser.js:
 *
 *      displays the search process
 *
 * routes.js:
 *
 *      displays the finished result
 *
 * ============================================================ */


class RouteRenderer {

    /* ============================================================
     * CONSTRUCTOR
     * ============================================================ */

    constructor(
        map,
        options = {}
    ) {

        /*
         * Keep the RouteMap wrapper where available.
         *
         * This lets us use its fitCoordinates() method.
         */

        this.mapController =
            map;


        /*
         * Resolve the underlying MapLibre instance.
         */

        this.map =
            this.#resolveMap(
                map
            );


        if (
            !this.map
        ) {

            throw new TypeError(
                "RouteRenderer requires a MapLibre map or RouteMap."
            );

        }


        /* --------------------------------------------------------
         * SOURCE
         * -------------------------------------------------------- */

        this.sourceId =
            options.sourceId
            ||
            "route-result-source";


        /* --------------------------------------------------------
         * LAYERS
         * -------------------------------------------------------- */

        this.outlineLayerId =
            options.outlineLayerId
            ||
            "route-result-outline";


        this.routeLayerId =
            options.routeLayerId
            ||
            "route-result-line";


        /* --------------------------------------------------------
         * STYLE
         * -------------------------------------------------------- */

        this.routeColour =
            options.routeColour
            ||
            "#36d8ff";


        this.outlineColour =
            options.outlineColour
            ||
            "#00111e";


        this.routeWidth =
            options.routeWidth
            ??
            6;


        this.outlineWidth =
            options.outlineWidth
            ??
            11;


        this.routeOpacity =
            options.routeOpacity
            ??
            1;


        this.outlineOpacity =
            options.outlineOpacity
            ??
            0.92;


        /* --------------------------------------------------------
         * FIT OPTIONS
         * -------------------------------------------------------- */

        this.fitPadding =
            options.fitPadding
            ??
            80;


        this.fitDuration =
            options.fitDuration
            ??
            850;


        this.fitMaxZoom =
            options.fitMaxZoom
            ??
            16;


        /*
         * Whether successful routes automatically move the map.
         */

        this.autoFit =
            options.autoFit
            ??
            true;


        /* --------------------------------------------------------
         * CURRENT RESULT
         * -------------------------------------------------------- */

        this.currentResult =
            null;


        this.currentFeature =
            null;


        this.layersReady =
            false;


        this.destroyed =
            false;


        /* --------------------------------------------------------
         * DOM ELEMENTS
         * -------------------------------------------------------- */

        this.resultPanel =
            document.getElementById(
                "routeResult"
            );


        this.distanceElement =
            document.getElementById(
                "resultDistance"
            );


        this.nodesElement =
            document.getElementById(
                "resultNodes"
            );


        this.timeElement =
            document.getElementById(
                "resultTime"
            );


        /*
         * Main sidebar statistics.
         */

        this.sidebarDistanceElement =
            document.getElementById(
                "routeDistance"
            );


        this.sidebarTimeElement =
            document.getElementById(
                "searchTime"
            );


        /*
         * Initialise MapLibre source/layers.
         */

        this.#initialiseLayers();


        /*
         * Begin with an empty result display.
         */

        this.resetResultDisplay();

    }


    /* ============================================================
     * RESOLVE MAP
     * ============================================================ */


    /**
     * Accepts:
     *
     *      RouteMap
     *
     * or:
     *
     *      raw MapLibre map
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
         * Generic wrapper exposing .map.
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
     * INITIALISE MAP LAYERS
     * ============================================================ */


    /**
     * Creates the final-route layers once the style is ready.
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

        }


        /*
         * Recreate custom layers if the map style is replaced.
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


                if (
                    this.currentFeature
                ) {

                    this.#setSourceData(
                        this.currentFeature
                    );

                }

            }
        );

    }


    /* ============================================================
     * STYLE READY
     * ============================================================ */


    /**
     * Checks whether MapLibre can accept sources/layers.
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


    /* ============================================================
     * CREATE LAYERS
     * ============================================================ */


    /**
     * Creates source and route layers.
     *
     * @private
     */
    #createLayers() {

        if (
            !this.#isStyleReady()
        ) {

            return;

        }


        /* --------------------------------------------------------
         * SOURCE
         * -------------------------------------------------------- */

        if (
            !this.map.getSource(
                this.sourceId
            )
        ) {

            this.map.addSource(
                this.sourceId,
                {

                    type:
                        "geojson",

                    data:
                        MapUtils.emptyFeatureCollection()

                }
            );

        }


        /* --------------------------------------------------------
         * DARK OUTLINE
         * -------------------------------------------------------- */

        if (
            !this.map.getLayer(
                this.outlineLayerId
            )
        ) {

            this.map.addLayer(
                {

                    id:
                        this.outlineLayerId,

                    type:
                        "line",

                    source:
                        this.sourceId,

                    layout: {

                        "line-cap":
                            "round",

                        "line-join":
                            "round"

                    },

                    paint: {

                        "line-color":
                            this.outlineColour,

                        "line-width":
                            this.outlineWidth,

                        "line-opacity":
                            this.outlineOpacity

                    }

                }
            );

        }


        /* --------------------------------------------------------
         * BRIGHT FINAL ROUTE
         * -------------------------------------------------------- */

        if (
            !this.map.getLayer(
                this.routeLayerId
            )
        ) {

            this.map.addLayer(
                {

                    id:
                        this.routeLayerId,

                    type:
                        "line",

                    source:
                        this.sourceId,

                    layout: {

                        "line-cap":
                            "round",

                        "line-join":
                            "round"

                    },

                    paint: {

                        "line-color":
                            this.routeColour,

                        "line-width":
                            this.routeWidth,

                        "line-opacity":
                            this.routeOpacity

                    }

                }
            );

        }


        this.layersReady =
            true;

    }


    /* ============================================================
     * SHOW RESULT
     * ============================================================ */


    /**
     * Displays a successful AStarSearch result.
     *
     * @param {Object} result
     * @param {Object} options
     *
     * @returns {Object}
     */
    showResult(
        result,
        options = {}
    ) {

        this.#validateSuccessfulResult(
            result
        );


        this.currentResult =
            result;


        /*
         * Build route GeoJSON.
         */

        this.currentFeature = result.coordinates.length === 1
            ? MapUtils.pointFeature(result.coordinates[0])
            : MapUtils.lineStringFeature(

                result.coordinates,

                {

                    algorithm:
                        result.algorithm
                        ||
                        "astar",

                    heuristic:
                        result.heuristic
                        ||
                        null,

                    distance:
                        result.distance,

                    pathNodes:
                        result.path
                            ? result.path.length
                            : result.coordinates.length

                }

            );


        /*
         * Make sure layers exist.
         */

        if (
            !this.layersReady
        ) {

            this.#createLayers();

        }


        /*
         * Draw route.
         */

        this.#setSourceData(
            this.currentFeature
        );


        /*
         * Ensure route layers are visible.
         */

        // Search layers are created after the renderer. Bring the final route above them.
        this.map.moveLayer(this.outlineLayerId);
        this.map.moveLayer(this.routeLayerId);
        this.show();


        /*
         * Update all route statistics.
         */

        this.#updateResultDisplay(
            result
        );


        /*
         * Fit map around the route.
         */

        const shouldFit =
            options.fit
            ??
            this.autoFit;


        if (
            shouldFit
        ) {

            this.fitRoute(
                result.coordinates,
                options
            );

        }


        return result;

    }


    /* ============================================================
     * DISPLAY FAILED RESULT
     * ============================================================ */


    /**
     * Updates the result area for an unsuccessful search.
     *
     * Normally app.js will also display a status message.
     *
     * @param {Object} result
     */
    showFailure(result) {

        this.clearRouteGeometry();


        this.currentResult =
            result
            ||
            null;


        const reason =
            result?.reason
            ||
            "No route found.";


        if (
            this.resultPanel
        ) {

            this.resultPanel.classList.remove(
                "has-route"
            );


            this.resultPanel.classList.add(
                "route-failed"
            );


            this.resultPanel.dataset.status =
                "failed";


            this.resultPanel.dataset.message =
                reason;

        }


        this.#setText(
            this.distanceElement,
            "—"
        );


        this.#setText(
            this.nodesElement,
            "—"
        );


        if (
            result?.statistics
        ) {

            this.#setText(

                this.timeElement,

                this.#formatSearchTime(
                    result.statistics.searchMilliseconds
                )

            );


            this.#setText(

                this.sidebarTimeElement,

                this.#formatSearchTime(
                    result.statistics.searchMilliseconds
                )

            );

        }
        else {

            this.#setText(
                this.timeElement,
                "—"
            );


            this.#setText(
                this.sidebarTimeElement,
                "—"
            );

        }


        this.#setText(
            this.sidebarDistanceElement,
            "—"
        );

    }


    /* ============================================================
     * RESULT DISPLAY
     * ============================================================ */


    /**
     * Updates route-result UI.
     *
     * @param {Object} result
     *
     * @private
     */
    #updateResultDisplay(result) {

        const distance =
            Number(
                result.distance
            );


        const pathNodes =
            Array.isArray(
                result.path
            )
                ? result.path.length
                : result.coordinates.length;


        const searchMilliseconds =
            result.statistics
                ?.searchMilliseconds
            ??
            0;


        const formattedDistance =
            this.#formatRouteDistance(
                distance
            );


        const formattedTime =
            this.#formatSearchTime(
                searchMilliseconds
            );


        /* --------------------------------------------------------
         * RESULT PANEL
         * -------------------------------------------------------- */

        this.#setText(
            this.distanceElement,
            formattedDistance
        );


        this.#setText(
            this.nodesElement,
            pathNodes.toLocaleString()
        );


        this.#setText(
            this.timeElement,
            formattedTime
        );


        /* --------------------------------------------------------
         * SIDEBAR
         * -------------------------------------------------------- */

        this.#setText(
            this.sidebarDistanceElement,
            formattedDistance
        );


        this.#setText(
            this.sidebarTimeElement,
            formattedTime
        );


        /* --------------------------------------------------------
         * PANEL STATE
         * -------------------------------------------------------- */

        if (
            this.resultPanel
        ) {

            this.resultPanel.classList.add(
                "has-route"
            );


            this.resultPanel.classList.remove(
                "route-failed"
            );


            this.resultPanel.dataset.status =
                "success";


            this.resultPanel.dataset.algorithm =
                result.algorithm
                ||
                "astar";

        }

    }


    /* ============================================================
     * FORMAT DISTANCE
     * ============================================================ */


    /**
     * Formats route distance.
     *
     * UK-facing interface:
     *
     *      under 1 km  -> metres
     *      otherwise   -> miles
     *
     * Examples:
     *
     *      418 m
     *      2.64 mi
     *
     * @param {number} metres
     * @returns {string}
     *
     * @private
     */
    #formatRouteDistance(metres) {

        if (
            !Number.isFinite(
                metres
            )
            ||
            metres < 0
        ) {

            return "—";

        }


        if (
            metres < 1000
        ) {

            return (
                Math.round(
                    metres
                ).toLocaleString()
                +
                " m"
            );

        }


        const miles =
            MapUtils.metresToMiles(
                metres
            );


        if (
            miles < 10
        ) {

            return (
                miles.toFixed(2)
                +
                " mi"
            );

        }


        return (
            miles.toFixed(1)
            +
            " mi"
        );

    }


    /* ============================================================
     * FORMAT SEARCH TIME
     * ============================================================ */


    /**
     * Formats algorithm execution time.
     *
     * @param {number} milliseconds
     * @returns {string}
     *
     * @private
     */
    #formatSearchTime(milliseconds) {

        if (
            !Number.isFinite(
                Number(milliseconds)
            )
        ) {

            return "—";

        }


        const value =
            Number(
                milliseconds
            );


        if (
            value < 1000
        ) {

            return (
                Math.round(
                    value
                )
                +
                " ms"
            );

        }


        if (
            value < 60000
        ) {

            return (
                (value / 1000)
                    .toFixed(2)
                +
                " s"
            );

        }


        const minutes =
            Math.floor(
                value / 60000
            );


        const seconds =
            (
                (
                    value
                    %
                    60000
                )
                /
                1000
            )
            .toFixed(1);


        return (
            `${minutes}m ${seconds}s`
        );

    }


    /* ============================================================
     * FIT ROUTE
     * ============================================================ */


    /**
     * Fits the map around route coordinates.
     *
     * @param {Array<Array<number>>} coordinates
     * @param {Object} options
     */
    fitRoute(
        coordinates,
        options = {}
    ) {

        if (
            !Array.isArray(
                coordinates
            )
            ||
            coordinates.length === 0
        ) {

            return;

        }


        /* --------------------------------------------------------
         * Prefer RouteMap's own helper.
         * -------------------------------------------------------- */

        if (
            this.mapController
            &&
            typeof this.mapController.fitCoordinates
            ===
            "function"
        ) {

            this.mapController.fitCoordinates(

                coordinates,

                {

                    padding:
                        options.padding
                        ??
                        this.fitPadding,

                    duration:
                        options.duration
                        ??
                        this.fitDuration,

                    maxZoom:
                        options.maxZoom
                        ??
                        this.fitMaxZoom

                }

            );


            return;

        }


        /* --------------------------------------------------------
         * Raw MapLibre fallback.
         * -------------------------------------------------------- */

        if (
            coordinates.length === 1
        ) {

            this.map.flyTo(
                {

                    center:
                        coordinates[0],

                    zoom:
                        options.maxZoom
                        ??
                        this.fitMaxZoom

                }
            );


            return;

        }


        let west =
            coordinates[0][0];


        let east =
            coordinates[0][0];


        let south =
            coordinates[0][1];


        let north =
            coordinates[0][1];


        for (
            const coordinate
            of
            coordinates
        ) {

            if (
                !MapUtils.isValidCoordinate(
                    coordinate
                )
            ) {

                continue;

            }


            west =
                Math.min(
                    west,
                    coordinate[0]
                );


            east =
                Math.max(
                    east,
                    coordinate[0]
                );


            south =
                Math.min(
                    south,
                    coordinate[1]
                );


            north =
                Math.max(
                    north,
                    coordinate[1]
                );

        }


        this.map.fitBounds(

            [
                [west, south],
                [east, north]
            ],

            {

                padding:
                    options.padding
                    ??
                    this.fitPadding,

                duration:
                    options.duration
                    ??
                    this.fitDuration,

                maxZoom:
                    options.maxZoom
                    ??
                    this.fitMaxZoom

            }

        );

    }


    /* ============================================================
     * SET SOURCE DATA
     * ============================================================ */


    /**
     * Updates route GeoJSON source.
     *
     * @param {Object} feature
     *
     * @private
     */
    #setSourceData(feature) {

        if (
            !this.layersReady
        ) {

            this.#createLayers();

        }


        const source =
            this.map.getSource(
                this.sourceId
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


        const collection =
            feature
                ? MapUtils.featureCollection(
                    [feature]
                )
                : MapUtils.emptyFeatureCollection();


        source.setData(
            collection
        );

    }


    /* ============================================================
     * CLEAR ROUTE GEOMETRY
     * ============================================================ */


    /**
     * Removes the route line but does not reset every UI field.
     */
    clearRouteGeometry() {

        this.currentFeature =
            null;


        this.#setSourceData(
            null
        );

    }


    /* ============================================================
     * CLEAR
     * ============================================================ */


    /**
     * Clears route geometry and result information.
     */
    clear() {

        this.currentResult =
            null;


        this.currentFeature =
            null;


        this.#setSourceData(
            null
        );


        this.resetResultDisplay();

    }


    /* ============================================================
     * RESET RESULT DISPLAY
     * ============================================================ */


    /**
     * Restores route statistics to their empty state.
     */
    resetResultDisplay() {

        this.#setText(
            this.distanceElement,
            "—"
        );


        this.#setText(
            this.nodesElement,
            "—"
        );


        this.#setText(
            this.timeElement,
            "—"
        );


        this.#setText(
            this.sidebarDistanceElement,
            "—"
        );


        this.#setText(
            this.sidebarTimeElement,
            "—"
        );


        if (
            this.resultPanel
        ) {

            this.resultPanel.classList.remove(
                "has-route"
            );


            this.resultPanel.classList.remove(
                "route-failed"
            );


            delete this.resultPanel.dataset.status;

            delete this.resultPanel.dataset.algorithm;

            delete this.resultPanel.dataset.message;

        }

    }


    /* ============================================================
     * SHOW / HIDE
     * ============================================================ */


    /**
     * Sets final route layer visibility.
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
            [
                this.outlineLayerId,
                this.routeLayerId
            ]
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
     * Shows the route.
     */
    show() {

        this.setVisible(
            true
        );

    }


    /**
     * Hides the route without deleting it.
     */
    hide() {

        this.setVisible(
            false
        );

    }


    /* ============================================================
     * CURRENT RESULT
     * ============================================================ */


    /**
     * Returns the current route result.
     *
     * @returns {Object|null}
     */
    getResult() {

        return this.currentResult;

    }


    /**
     * Returns whether a successful route is currently loaded.
     *
     * @returns {boolean}
     */
    hasRoute() {

        return Boolean(
            this.currentResult
            &&
            this.currentResult.success
            &&
            this.currentFeature
        );

    }


    /**
     * Returns a copy of the route coordinates.
     *
     * @returns {Array<Array<number>>}
     */
    getCoordinates() {

        if (
            !this.currentResult
            ||
            !Array.isArray(
                this.currentResult.coordinates
            )
        ) {

            return [];

        }


        return this.currentResult.coordinates.map(
            coordinate =>
                MapUtils.copyCoordinate(
                    coordinate
                )
        );

    }


    /* ============================================================
     * RESULT SUMMARY
     * ============================================================ */


    /**
     * Returns a compact summary of the current route.
     *
     * Useful later if we add route export/share features.
     *
     * @returns {Object|null}
     */
    getSummary() {

        if (
            !this.currentResult
        ) {

            return null;

        }


        const result =
            this.currentResult;


        return {

            success:
                Boolean(
                    result.success
                ),

            algorithm:
                result.algorithm
                ||
                null,

            heuristic:
                result.heuristic
                ||
                null,

            distance:
                result.distance
                ??
                null,

            formattedDistance:
                Number.isFinite(
                    result.distance
                )
                    ? this.#formatRouteDistance(
                        result.distance
                    )
                    : null,

            pathNodes:
                Array.isArray(
                    result.path
                )
                    ? result.path.length
                    : 0,

            visitedNodes:
                result.statistics
                    ?.visitedNodes
                ??
                0,

            examinedEdges:
                result.statistics
                    ?.examinedEdges
                ??
                0,

            searchMilliseconds:
                result.statistics
                    ?.searchMilliseconds
                ??
                0

        };

    }


    /* ============================================================
     * VALIDATE RESULT
     * ============================================================ */


    /**
     * Ensures the result contains enough information to draw.
     *
     * @param {Object} result
     *
     * @private
     */
    #validateSuccessfulResult(result) {

        if (
            !result
            ||
            typeof result
            !==
            "object"
        ) {

            throw new TypeError(
                "RouteRenderer requires a search result."
            );

        }


        if (
            result.success
            !==
            true
        ) {

            throw new Error(
                "Cannot draw an unsuccessful route result."
            );

        }


        if (
            !Array.isArray(
                result.coordinates
            )
            ||
            result.coordinates.length === 0
        ) {

            throw new Error(
                "Route result contains no coordinates."
            );

        }


        for (
            const coordinate
            of
            result.coordinates
        ) {

            if (
                !MapUtils.isValidCoordinate(
                    coordinate
                )
            ) {

                throw new Error(
                    "Route result contains an invalid coordinate."
                );

            }

        }


        if (
            !Number.isFinite(
                Number(
                    result.distance
                )
            )
        ) {

            throw new Error(
                "Route result contains an invalid distance."
            );

        }

    }


    /* ============================================================
     * SET TEXT
     * ============================================================ */


    /**
     * Safely updates an optional DOM element.
     *
     * @param {HTMLElement|null} element
     * @param {*} value
     *
     * @private
     */
    #setText(
        element,
        value
    ) {

        if (
            !element
        ) {

            return;

        }


        element.textContent =
            String(
                value
            );

    }


    /* ============================================================
     * REMOVE MAP RESOURCES
     * ============================================================ */


    /**
     * Completely removes route layers and source.
     *
     * @private
     */
    #removeLayers() {

        /*
         * Layers must be removed before their source.
         */

        for (
            const layerId
            of
            [
                this.routeLayerId,
                this.outlineLayerId
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
                    `Could not remove route layer ${layerId}.`,
                    error
                );

            }

        }


        try {

            if (
                this.map.getSource(
                    this.sourceId
                )
            ) {

                this.map.removeSource(
                    this.sourceId
                );

            }

        }
        catch (error) {

            console.warn(
                `Could not remove route source ${this.sourceId}.`,
                error
            );

        }


        this.layersReady =
            false;

    }


    /* ============================================================
     * DESTROY
     * ============================================================ */


    /**
     * Removes the route renderer from the map.
     */
    destroy() {

        if (
            this.destroyed
        ) {

            return;

        }


        this.clear();


        this.#removeLayers();


        this.currentResult =
            null;


        this.currentFeature =
            null;


        this.destroyed =
            true;

    }

}


/* ============================================================
 * GLOBAL EXPORT
 *
 *
 * Typical usage:
 *
 *      const routeRenderer =
 *          new RouteRenderer(
 *              routeMap
 *          );
 *
 *
 *      const result =
 *          await search.search(
 *              startNodeId,
 *              destinationNodeId
 *          );
 *
 *
 *      if (
 *          result.success
 *      ) {
 *
 *          routeRenderer.showResult(
 *              result
 *          );
 *
 *      }
 *      else {
 *
 *          routeRenderer.showFailure(
 *              result
 *          );
 *
 *      }
 *
 *
 * The final flow is therefore:
 *
 *
 *      User chooses locations
 *              |
 *              v
 *          Geocoder
 *              |
 *              v
 *          MapData
 *              |
 *              v
 *          RoadGraph
 *              |
 *              v
 *         AStarSearch
 *          /       \
 *         /         \
 *        v           v
 * SearchVisualiser  RouteRenderer
 *        |           |
 *        v           v
 * explored roads   final route
 *
 * ============================================================ */

window.RouteRenderer =
    RouteRenderer;