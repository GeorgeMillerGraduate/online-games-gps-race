"use strict";

/* ============================================================
 * JENGA-CODE ROUTE EXPLORER
 * map.js
 *
 * MapLibre controller for the Route Explorer.
 *
 * Basemap:
 *     CARTO Positron
 *
 * Purpose:
 *     - Display a real road map.
 *     - Place start/destination markers.
 *     - Display A* / Dijkstra search visualisation.
 *     - Display the final route.
 *
 * Coordinate convention:
 *
 *     [longitude, latitude]
 *
 * ============================================================ */


/* ============================================================
 * CARTO BASEMAP
 * ============================================================
 *
 * Browser basemap key used for CARTO raster tiles.
 *
 * IMPORTANT:
 * Restrict this key to jenga-code.com in CARTO if domain
 * restrictions are available.
 * ============================================================ */

const CARTO_API_KEY =
        "cb1_491y_1_55d2b5f8d24cd4cfbf22bd5d";


class RouteMap {

    /* ========================================================
     * CONSTRUCTOR
     * ======================================================== */

    constructor(options = {}) {

        this.containerId =
                options.containerId || "map";


        /*
         * Default map position: London.
         */

        this.initialCenter =
                options.center || [
                    -0.1276,
                    51.5072
                ];


        this.initialZoom =
                options.zoom ?? 11;


        this.minZoom =
                options.minZoom ?? 3;


        this.maxZoom =
                options.maxZoom ?? 19;


        /*
         * MapLibre map instance.
         */

        this.map = null;

        this.ready = false;


        /*
         * Journey coordinates.
         */

        this.startCoordinate = null;

        this.destinationCoordinate = null;


        /*
         * Map markers.
         */

        this.startMarker = null;

        this.destinationMarker = null;


        /*
         * Interaction mode:
         *
         *     move
         *     start
         *     destination
         */

        this.selectionMode = "move";


        /*
         * Application events.
         */

        this.listeners = {

            ready: [],

            startChanged: [],

            destinationChanged: [],

            mapClicked: [],

            selectionModeChanged: []

        };


        /*
         * A* visualisation sources/layers.
         */

        this.ids = {

            exploredSource:
                    "astar-explored-source",

            exploredLayer:
                    "astar-explored-layer",

            frontierSource:
                    "astar-frontier-source",

            frontierLayer:
                    "astar-frontier-layer",

            routeSource:
                    "astar-route-source",

            routeOutlineLayer:
                    "astar-route-outline-layer",

            routeLayer:
                    "astar-route-layer"

        };

    }


    /* ========================================================
     * INITIALISE MAP
     * ======================================================== */

    async initialise() {

        console.log(
                "========================================"
                );

        console.log(
                "RouteMap: initialise() started"
                );

        console.log(
                "========================================"
                );


        /*
         * -----------------------------------------------------
         * CHECK MAPLIBRE
         * -----------------------------------------------------
         */

        if (
                typeof window.maplibregl === "undefined"
                ) {

            throw new Error(
                    "RouteMap: window.maplibregl is undefined."
                    );

        }


        console.log(
                "RouteMap: MapLibre found."
                );


        /*
         * -----------------------------------------------------
         * FIND MAP CONTAINER
         * -----------------------------------------------------
         */

        const container =
                document.getElementById(
                        this.containerId
                        );


        if (!container) {

            throw new Error(
                    `RouteMap: #${this.containerId} does not exist.`
                    );

        }


        console.log(
                "RouteMap: map container found:",
                container
                );


        /*
         * -----------------------------------------------------
         * CHECK MAP SIZE
         * -----------------------------------------------------
         */

        const rectangle =
                container.getBoundingClientRect();


        console.log(
                "RouteMap: container size:",
                rectangle.width,
                "x",
                rectangle.height
                );


        if (
                rectangle.width === 0
                ||
                rectangle.height === 0
                ) {

            console.warn(
                    "RouteMap: WARNING - map container has zero size."
                    );

        }


        /*
         * Remove anything left in the container from an earlier
         * map instance.
         */

        container.innerHTML = "";


        /*
         * -----------------------------------------------------
         * CARTO BASEMAP STYLE
         * -----------------------------------------------------
         *
         * MapLibre performs the rendering.
         *
         * CARTO supplies the Positron raster tiles.
         *
         * We deliberately do NOT request tiles directly from
         * tile.openstreetmap.org because that endpoint returned
         * HTTP 403 during development.
         *
         * Positron is deliberately light so the search
         * visualisation remains prominent.
         */

        const basemapStyle = {

            version:
                    8,


            sources: {

                "carto-basemap": {

                    type:
                            "raster",

                    tiles: [

                        `https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`,

                        `https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`,

                        `https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`,

                        `https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`

                    ],

                    tileSize:
                            256,

                    minzoom:
                            0,

                    maxzoom:
                            20,

                    attribution:
                            "© OpenStreetMap contributors © CARTO"

                }

            },


            layers: [

                /*
                 * Neutral fallback background.
                 */

                {

                    id:
                            "map-background",

                    type:
                            "background",

                    paint: {

                        "background-color":
                                "#e9eef2"

                    }

                },


                /*
                 * Actual street-map imagery.
                 */

                {

                    id:
                            "carto-basemap-layer",

                    type:
                            "raster",

                    source:
                            "carto-basemap",

                    minzoom:
                            0,

                    maxzoom:
                            20,

                    paint: {

                        "raster-opacity":
                                1,

                        "raster-fade-duration":
                                100

                    }

                }

            ]

        };


        /*
         * -----------------------------------------------------
         * CREATE MAPLIBRE MAP
         * -----------------------------------------------------
         */

        console.log(
                "RouteMap: creating MapLibre map..."
                );


        console.log(
                "RouteMap: basemap = CARTO Positron"
                );


        console.log(
                "RouteMap: initial centre:",
                this.initialCenter
                );


        this.map =
                new window.maplibregl.Map({

                    container:
                            this.containerId,

                    style:
                            basemapStyle,

                    center:
                            this.initialCenter,

                    zoom:
                            this.initialZoom,

                    minZoom:
                            this.minZoom,

                    maxZoom:
                            this.maxZoom,

                    bearing:
                            0,

                    pitch:
                            0,

                    attributionControl:
                            true,

                    /*
                     * Route Explorer is a 2D algorithm
                     * visualiser, so map rotation is disabled.
                     */

                    dragRotate:
                            false,

                    pitchWithRotate:
                            false

                });


        /*
         * -----------------------------------------------------
         * DIAGNOSTICS
         * -----------------------------------------------------
         */

        this.#installDiagnostics();


        /*
         * -----------------------------------------------------
         * MAP INTERACTION
         * -----------------------------------------------------
         */

        this.#installMapEvents();


        /*
         * -----------------------------------------------------
         * WAIT FOR MAP
         * -----------------------------------------------------
         */

        console.log(
                "RouteMap: waiting for basemap style..."
                );


        await this.#waitForMapLoad();


        /*
         * The style is now ready for additional sources/layers.
         */

        this.ready =
                true;


        console.log(
                "RouteMap: MapLibre load event received."
                );


        console.log(
                "RouteMap: basemap style loaded."
                );


        /*
         * -----------------------------------------------------
         * CREATE SEARCH VISUALISATION LAYERS
         * -----------------------------------------------------
         *
         * These are added after the basemap so they appear above
         * the map imagery.
         */

        this.#createAlgorithmLayers();


        /*
         * -----------------------------------------------------
         * CONNECT MAP CONTROLS
         * -----------------------------------------------------
         */

        this.#installControls();


        /*
         * -----------------------------------------------------
         * RESIZE
         * -----------------------------------------------------
         */

        this.resize();


        requestAnimationFrame(
                () => {

            this.resize();

        }
        );


        window.setTimeout(
                () => {

            this.resize();

        },
                250
                );


        /*
         * -----------------------------------------------------
         * INITIAL VIEW
         * -----------------------------------------------------
         */

        this.map.jumpTo({

            center:
                    this.initialCenter,

            zoom:
                    this.initialZoom,

            bearing:
                    0,

            pitch:
                    0

        });


        /*
         * -----------------------------------------------------
         * FINAL DIAGNOSTICS
         * -----------------------------------------------------
         */

        console.log(
                "========================================"
                );

        console.log(
                "RouteMap: READY"
                );


        console.log(
                "RouteMap: basemap = CARTO Positron"
                );


        console.log(
                "RouteMap: centre:",
                this.getCenter()
                );


        console.log(
                "RouteMap: zoom:",
                this.getZoom()
                );


        console.log(
                "========================================"
                );


        /*
         * Tell the rest of Route Explorer that the map is ready.
         */

        this.#emit(
                "ready",
                this
                );


        return this;

    }


    /*
     * US spelling alias.
     */

    initialize() {

        return this.initialise();

    }


    /* ========================================================
     * WAIT FOR MAP
     * ======================================================== */

    #waitForMapLoad() {

        return new Promise(
                (resolve, reject) => {

            /*
             * The map may already have completed its initial load.
             */

            if (
                    this.map.loaded()
                    ) {

                resolve();

                return;

            }


            let finished = false;


            /*
             * Fail clearly rather than leaving the application
             * permanently displaying "Loading...".
             */

            const timeout =
                    window.setTimeout(
                            () => {

                        if (finished) {

                            return;

                        }


                        finished = true;


                        reject(
                                new Error(
                                        "RouteMap: map did not finish loading within 20 seconds."
                                        )
                                );

                    },
                            20000
                            );


            this.map.once(
                    "load",
                    () => {

                if (finished) {

                    return;

                }


                finished = true;


                clearTimeout(
                        timeout
                        );


                resolve();

            }
            );

        }
        );

    }


    /* ========================================================
     * DIAGNOSTICS
     * ======================================================== */

    #installDiagnostics() {

        /*
         * Genuine MapLibre/tile errors.
         */

        this.map.on(
                "error",
                event => {

                    console.error(
                            "========================================"
                            );

                    console.error(
                            "MAPLIBRE ERROR"
                            );

                    console.error(
                            event?.error || event
                            );

                    console.error(
                            "========================================"
                            );

                }
        );


        /*
         * First rendered frame.
         */

        this.map.once(
                "render",
                () => {

            console.log(
                    "RouteMap: first frame rendered."
                    );

        }
        );


        /*
         * Initial idle state.
         */

        this.map.once(
                "idle",
                () => {

            console.log(
                    "RouteMap: map is idle."
                    );

        }
        );

    }


    /* ========================================================
     * MAP EVENTS
     * ======================================================== */

    #installMapEvents() {

        this.map.on(
                "click",
                event => {

                    const coordinate = [

                        event.lngLat.lng,

                        event.lngLat.lat

                    ];


                    console.log(
                            "RouteMap: clicked:",
                            coordinate
                            );


                    this.#emit(
                            "mapClicked",
                            coordinate
                            );


                    /*
                     * Select start point.
                     */

                    if (
                            this.selectionMode === "start"
                            ) {

                        this.setStart(
                                coordinate
                                );

                        this.setSelectionMode(
                                "move"
                                );

                        return;

                    }


                    /*
                     * Select destination.
                     */

                    if (
                            this.selectionMode === "destination"
                            ) {

                        this.setDestination(
                                coordinate
                                );

                        this.setSelectionMode(
                                "move"
                                );

                    }

                }
        );

    }


    /* ========================================================
     * HTML CONTROLS
     * ======================================================== */

    #installControls() {
        document.getElementById("basemapSelect")?.addEventListener("change", event => this.setBasemap(event.target.value));

        const zoomIn =
                document.getElementById(
                        "zoomIn"
                        );


        const zoomOut =
                document.getElementById(
                        "zoomOut"
                        );


        const reset =
                document.getElementById(
                        "resetView"
                        );


        const fullscreen =
                document.getElementById(
                        "fullscreenMap"
                        );


        if (zoomIn) {

            zoomIn.addEventListener(
                    "click",
                    () => {

                this.zoomIn();

            }
            );

        }


        if (zoomOut) {

            zoomOut.addEventListener(
                    "click",
                    () => {

                this.zoomOut();

            }
            );

        }


        if (reset) {

            reset.addEventListener(
                    "click",
                    () => {

                this.resetView();

            }
            );

        }


        if (fullscreen) {

            fullscreen.addEventListener(
                    "click",
                    () => {

                this.toggleFullscreen();

            }
            );

        }

    }


    /* ========================================================
     * SELECTION MODE
     * ======================================================== */

    setSelectionMode(mode) {

        const validModes = [

            "move",

            "start",

            "destination"

        ];


        if (
                !validModes.includes(mode)
                ) {

            throw new Error(
                    `RouteMap: invalid selection mode "${mode}".`
                    );

        }


        this.selectionMode =
                mode;


        /*
         * Change mouse cursor.
         */

        if (this.map) {

            const canvas =
                    this.map.getCanvas();


            canvas.style.cursor =
                    mode === "move"
                    ? ""
                    : "crosshair";

        }


        this.#emit(
                "selectionModeChanged",
                mode
                );

    }


    setBasemap(name) {
        if (!this.map || !["road", "satellite"].includes(name)) return;
        if (name === "satellite" && !this.map.getSource("satellite-basemap")) {
            this.map.addSource("satellite-basemap", {
                type: "raster", tileSize: 256, maxzoom: 19,
                tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
                attribution: 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community'
            });
            this.map.addLayer({id:"satellite-basemap-layer", type:"raster", source:"satellite-basemap"},
                "carto-basemap-layer");
        }
        this.map.setLayoutProperty("carto-basemap-layer", "visibility", name === "road" ? "visible" : "none");
        if (this.map.getLayer("satellite-basemap-layer")) this.map.setLayoutProperty(
            "satellite-basemap-layer", "visibility", name === "satellite" ? "visible" : "none");
        // Only basemap visibility changes; search and route sources stay intact.
        this.basemap = name;
    }

    showSnappedEndpoints(start, destination) {
        this.clearSnappedEndpoints();
        this.snapMarkers = [start, destination].map((snap, index) => {
            const el = document.createElement("div");
            el.className = "snapped-marker";
            el.textContent = index ? "B′" : "A′";
            el.title = `Road endpoint ${index ? "B" : "A"}: node ${snap.nodeId}, ${Math.round(snap.distance)} m from marker`;
            return new window.maplibregl.Marker({element:el, anchor:"center"})
                .setLngLat(snap.coordinate).addTo(this.map);
        });
        const summary = document.getElementById("snapSummary");
        if (summary) summary.textContent = `Routing A′ → B′ on roads. Marker offsets: A ${Math.round(start.distance)} m; B ${Math.round(destination.distance)} m.`;
    }

    clearSnappedEndpoints() {
        for (const marker of this.snapMarkers || []) marker.remove();
        this.snapMarkers = [];
        const summary = document.getElementById("snapSummary");
        if (summary) summary.textContent = "A′ and B′ will show the exact road nodes used by the search.";
    }

    getSelectionMode() {

        return this.selectionMode;

    }


    /* ========================================================
     * START POINT
     * ======================================================== */

    setStart(
            coordinate,
            options = {}
            ) {

        MapUtils.assertCoordinate(
                coordinate,
                "start coordinate"
                );


        this.startCoordinate = [

            coordinate[0],

            coordinate[1]

        ];


        if (!this.startMarker) {

            this.startMarker =
                    this.#createMarker(
                            "A",
                            "route-map-marker-start"
                            );

        }


        this.startMarker
                .setLngLat(
                        this.startCoordinate
                        )
                .addTo(
                        this.map
                        );


        console.log(
                "RouteMap: start:",
                this.startCoordinate
                );


        if (
                options.flyTo === true
                ) {

            this.flyTo(
                    this.startCoordinate,
                    options.zoom ?? 14
                    );

        }


        this.#emit(
                "startChanged",
                this.getStart()
                );

    }


    getStart() {

        if (!this.startCoordinate) {

            return null;

        }


        return [
            ...this.startCoordinate
        ];

    }


    clearStart() {

        if (this.startMarker) {

            this.startMarker.remove();

        }


        this.startMarker =
                null;


        this.startCoordinate =
                null;


        this.#emit(
                "startChanged",
                null
                );

    }


    /* ========================================================
     * DESTINATION
     * ======================================================== */

    setDestination(
            coordinate,
            options = {}
            ) {

        MapUtils.assertCoordinate(
                coordinate,
                "destination coordinate"
                );


        this.destinationCoordinate = [

            coordinate[0],

            coordinate[1]

        ];


        if (!this.destinationMarker) {

            this.destinationMarker =
                    this.#createMarker(
                            "B",
                            "route-map-marker-destination"
                            );

        }


        this.destinationMarker
                .setLngLat(
                        this.destinationCoordinate
                        )
                .addTo(
                        this.map
                        );


        console.log(
                "RouteMap: destination:",
                this.destinationCoordinate
                );


        if (
                options.flyTo === true
                ) {

            this.flyTo(
                    this.destinationCoordinate,
                    options.zoom ?? 14
                    );

        }


        this.#emit(
                "destinationChanged",
                this.getDestination()
                );

    }


    getDestination() {

        if (
                !this.destinationCoordinate
                ) {

            return null;

        }


        return [
            ...this.destinationCoordinate
        ];

    }


    clearDestination() {

        if (
                this.destinationMarker
                ) {

            this.destinationMarker.remove();

        }


        this.destinationMarker =
                null;


        this.destinationCoordinate =
                null;


        this.#emit(
                "destinationChanged",
                null
                );

    }


    /* ========================================================
     * SWAP
     * ======================================================== */

    swapPoints() {

        const start =
                this.getStart();


        const destination =
                this.getDestination();


        this.clearStart();

        this.clearDestination();


        if (destination) {

            this.setStart(
                    destination
                    );

        }


        if (start) {

            this.setDestination(
                    start
                    );

        }


        if (
                start
                &&
                destination
                ) {

            this.fitRoutePoints();

        }

    }


    /* ========================================================
     * CREATE MARKER
     * ======================================================== */

    #createMarker(
            label,
            className
            ) {

        const element =
                document.createElement(
                        "div"
                        );


        element.className =
                `route-map-marker ${className}`;


        element.textContent =
                label;


        /*
         * Inline fallback styling.
         */

        element.style.width =
                "32px";

        element.style.height =
                "32px";

        element.style.borderRadius =
                "50%";

        element.style.display =
                "flex";

        element.style.alignItems =
                "center";

        element.style.justifyContent =
                "center";

        element.style.fontWeight =
                "700";

        element.style.fontSize =
                "14px";

        element.style.color =
                "#ffffff";

        element.style.background =
                label === "A"
                ? "#00a878"
                : "#e84a7f";

        element.style.border =
                "3px solid #ffffff";

        element.style.boxShadow =
                "0 2px 10px rgba(0,0,0,0.45)";


        return new window.maplibregl.Marker({

            element,

            anchor:
                    "bottom"

        });

    }


    /* ========================================================
     * MAP MOVEMENT
     * ======================================================== */

    flyTo(
            coordinate,
            zoom = 14
            ) {

        if (!this.map) {

            return;

        }


        MapUtils.assertCoordinate(
                coordinate
                );


        this.map.flyTo({

            center:
                    coordinate,

            zoom,

            duration:
                    700,

            essential:
                    true

        });

    }


    zoomIn() {

        if (!this.map) {

            return;

        }


        this.map.zoomIn({

            duration:
                    250

        });

    }


    zoomOut() {

        if (!this.map) {

            return;

        }


        this.map.zoomOut({

            duration:
                    250

        });

    }


    /* ========================================================
     * RESET -> LONDON
     * ======================================================== */

    resetView() {

        if (!this.map) {

            return;

        }


        console.log(
                "RouteMap: resetting to London."
                );


        this.map.flyTo({

            center:
                    this.initialCenter,

            zoom:
                    this.initialZoom,

            bearing:
                    0,

            pitch:
                    0,

            duration:
                    700,

            essential:
                    true

        });

    }


    /* ========================================================
     * FIT START + DESTINATION
     * ======================================================== */

    fitRoutePoints(options = {}) {

        if (
                !this.map
                ||
                !this.startCoordinate
                ||
                !this.destinationCoordinate
                ) {

            return;

        }


        this.fitCoordinates(
                [
                    this.startCoordinate,
                    this.destinationCoordinate
                ],
                options
                );

    }


    /* ========================================================
     * FIT ARBITRARY COORDINATES
     * ======================================================== */

    fitCoordinates(
            coordinates,
            options = {}
            ) {

        if (
                !this.map
                ||
                !Array.isArray(
                        coordinates
                        )
                ||
                coordinates.length === 0
                ) {

            return;

        }


        const valid =
                coordinates.filter(
                        coordinate =>
                    MapUtils.isValidCoordinate(
                            coordinate
                            )
                );


        if (
                valid.length === 0
                ) {

            return;

        }


        /*
         * One coordinate cannot form useful bounds.
         */

        if (
                valid.length === 1
                ) {

            this.flyTo(
                    valid[0],
                    options.maxZoom ?? 15
                    );

            return;

        }


        const bounds =
                new window.maplibregl
                .LngLatBounds();


        for (
                const coordinate
                of valid
                ) {

            bounds.extend(
                    coordinate
                    );

        }


        this.map.fitBounds(
                bounds,
                {

                    padding:
                            options.padding ?? 80,

                    maxZoom:
                            options.maxZoom ?? 15,

                    duration:
                            options.duration ?? 700

                }
        );

    }


    /* ========================================================
     * FULLSCREEN
     * ======================================================== */

    async toggleFullscreen() {

        const container =
                document.getElementById(
                        this.containerId
                        );


        if (!container) {

            return;

        }


        try {

            if (
                    document.fullscreenElement
                    ) {

                await document
                        .exitFullscreen();

            } else {

                await container
                        .requestFullscreen();

            }


            window.setTimeout(
                    () => {

                this.resize();

            },
                    100
                    );

        } catch (error) {

            console.error(
                    "RouteMap: fullscreen failed:",
                    error
                    );

        }

    }


    /* ========================================================
     * RESIZE
     * ======================================================== */

    resize() {

        if (!this.map) {

            return;

        }


        this.map.resize();

    }


    /* ========================================================
     * A* MAP LAYERS
     * ======================================================== */

    #createAlgorithmLayers() {

        console.log(
                "RouteMap: creating A* visualisation layers."
                );


        this.#createExploredLayer();

        this.#createFrontierLayer();

        this.#createRouteLayer();

    }


    /* ========================================================
     * EXPLORED ROADS
     * ======================================================== */

    #createExploredLayer() {

        if (
                !this.map.getSource(
                        this.ids.exploredSource
                        )
                ) {

            this.map.addSource(
                    this.ids.exploredSource,
                    {

                        type:
                                "geojson",

                        data:
                                this.#emptyGeoJSON()

                    }
            );

        }


        if (
                !this.map.getLayer(
                        this.ids.exploredLayer
                        )
                ) {

            this.map.addLayer({

                id:
                        this.ids.exploredLayer,

                type:
                        "line",

                source:
                        this.ids.exploredSource,

                layout: {

                    "line-cap":
                            "round",

                    "line-join":
                            "round"

                },

                paint: {

                    "line-color":
                            "#6d91ae",

                    "line-width":
                            3,

                    "line-opacity":
                            0.55

                }

            });

        }

    }


    /* ========================================================
     * FRONTIER
     * ======================================================== */

    #createFrontierLayer() {

        if (
                !this.map.getSource(
                        this.ids.frontierSource
                        )
                ) {

            this.map.addSource(
                    this.ids.frontierSource,
                    {

                        type:
                                "geojson",

                        data:
                                this.#emptyGeoJSON()

                    }
            );

        }


        if (
                !this.map.getLayer(
                        this.ids.frontierLayer
                        )
                ) {

            this.map.addLayer({

                id:
                        this.ids.frontierLayer,

                type:
                        "line",

                source:
                        this.ids.frontierSource,

                layout: {

                    "line-cap":
                            "round",

                    "line-join":
                            "round"

                },

                paint: {

                    "line-color":
                            "#d3ad50",

                    "line-width":
                            4,

                    "line-opacity":
                            0.9

                }

            });

        }

    }


    /* ========================================================
     * FINAL ROUTE
     * ======================================================== */

    #createRouteLayer() {

        if (
                !this.map.getSource(
                        this.ids.routeSource
                        )
                ) {

            this.map.addSource(
                    this.ids.routeSource,
                    {

                        type:
                                "geojson",

                        data:
                                this.#emptyGeoJSON()

                    }
            );

        }


        /*
         * Dark route outline.
         */

        if (
                !this.map.getLayer(
                        this.ids.routeOutlineLayer
                        )
                ) {

            this.map.addLayer({

                id:
                        this.ids.routeOutlineLayer,

                type:
                        "line",

                source:
                        this.ids.routeSource,

                layout: {

                    "line-cap":
                            "round",

                    "line-join":
                            "round"

                },

                paint: {

                    "line-color":
                            "#00111e",

                    "line-width":
                            9,

                    "line-opacity":
                            0.9

                }

            });

        }


        /*
         * Cyan final route.
         */

        if (
                !this.map.getLayer(
                        this.ids.routeLayer
                        )
                ) {

            this.map.addLayer({

                id:
                        this.ids.routeLayer,

                type:
                        "line",

                source:
                        this.ids.routeSource,

                layout: {

                    "line-cap":
                            "round",

                    "line-join":
                            "round"

                },

                paint: {

                    "line-color":
                            "#a35228",

                    "line-width":
                            5,

                    "line-opacity":
                            1

                }

            });

        }

    }


    /* ========================================================
     * VISUALISATION DATA
     * ======================================================== */

    setExploredFeatures(data) {

        this.#setSourceData(
                this.ids.exploredSource,
                data
                );

    }


    setFrontierFeatures(data) {

        this.#setSourceData(
                this.ids.frontierSource,
                data
                );

    }


    setRoute(coordinates) {

        if (
                !Array.isArray(
                        coordinates
                        )
                ||
                coordinates.length < 2
                ) {

            this.clearRoute();

            return;

        }


        this.#setSourceData(
                this.ids.routeSource,
                {

                    type:
                            "Feature",

                    properties:
                            {},

                    geometry: {

                        type:
                                "LineString",

                        coordinates:
                                coordinates

                    }

                }
        );

    }


    /* ========================================================
     * UPDATE GEOJSON SOURCE
     * ======================================================== */

    #setSourceData(
            sourceId,
            data
            ) {

        if (
                !this.map
                ||
                !this.ready
                ) {

            return;

        }


        const source =
                this.map.getSource(
                        sourceId
                        );


        if (!source) {

            console.warn(
                    `RouteMap: source "${sourceId}" does not exist.`
                    );

            return;

        }


        let geoJSON;


        if (
                Array.isArray(data)
                ) {

            geoJSON = {

                type:
                        "FeatureCollection",

                features:
                        data

            };

        } else if (
                data
                &&
                data.type === "FeatureCollection"
                ) {

            geoJSON =
                    data;

        } else if (
                data
                &&
                data.type === "Feature"
                ) {

            geoJSON = {

                type:
                        "FeatureCollection",

                features: [
                    data
                ]

            };

        } else {

            geoJSON =
                    this.#emptyGeoJSON();

        }


        source.setData(
                geoJSON
                );

    }


    /* ========================================================
     * EMPTY GEOJSON
     * ======================================================== */

    #emptyGeoJSON() {

        return {

            type:
                    "FeatureCollection",

            features:
                    []

        };

    }


    /* ========================================================
     * CLEAR MAP VISUALISATION
     * ======================================================== */

    clearExplored() {

        this.#setSourceData(
                this.ids.exploredSource,
                this.#emptyGeoJSON()
                );

    }


    clearFrontier() {

        this.#setSourceData(
                this.ids.frontierSource,
                this.#emptyGeoJSON()
                );

    }


    clearRoute() {

        this.#setSourceData(
                this.ids.routeSource,
                this.#emptyGeoJSON()
                );

    }


    clearAlgorithmVisualisation() {

        this.clearExplored();

        this.clearFrontier();

        this.clearRoute();

    }


    clearJourney() {

        this.clearAlgorithmVisualisation();

        this.clearStart();

        this.clearDestination();

    }


    /* ========================================================
     * INFORMATION
     * ======================================================== */

    getCenter() {

        if (!this.map) {

            return null;

        }


        const center =
                this.map.getCenter();


        return [

            center.lng,

            center.lat

        ];

    }


    getZoom() {

        if (!this.map) {

            return null;

        }


        return this.map.getZoom();

    }


    getBounds() {

        if (!this.map) {

            return null;

        }


        const bounds =
                this.map.getBounds();


        return {

            west:
                    bounds.getWest(),

            south:
                    bounds.getSouth(),

            east:
                    bounds.getEast(),

            north:
                    bounds.getNorth()

        };

    }


    getMap() {

        return this.map;

    }


    isReady() {

        return this.ready;

    }


    /* ========================================================
     * EVENT SYSTEM
     * ======================================================== */

    on(
            eventName,
            callback
            ) {

        if (
                !Object.prototype
                .hasOwnProperty.call(
                        this.listeners,
                        eventName
                        )
                ) {

            throw new Error(
                    `RouteMap: unknown event "${eventName}".`
                    );

        }


        if (
                typeof callback !== "function"
                ) {

            throw new TypeError(
                    "RouteMap callback must be a function."
                    );

        }


        this.listeners[
                eventName
        ].push(
                callback
                );


        return this;

    }


    off(
            eventName,
            callback
            ) {

        if (
                !Object.prototype
                .hasOwnProperty.call(
                        this.listeners,
                        eventName
                        )
                ) {

            return this;

        }


        this.listeners[
                eventName
        ] =
                this.listeners[
                        eventName
                ].filter(
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
                this.listeners[
                        eventName
                ];


        if (!listeners) {

            return;

        }


        for (
                const listener
                of listeners
                ) {

            try {

                listener(
                        data
                        );

            } catch (error) {

                console.error(
                        `RouteMap: ${eventName} listener failed:`,
                        error
                        );

            }

        }

    }


    /* ========================================================
     * DESTROY
     * ======================================================== */

    destroy() {
        this.clearSnappedEndpoints();

        console.log(
                "RouteMap: destroy()"
                );


        if (
                this.startMarker
                ) {

            this.startMarker.remove();

        }


        if (
                this.destinationMarker
                ) {

            this.destinationMarker.remove();

        }


        this.startMarker =
                null;

        this.destinationMarker =
                null;


        if (
                this.map
                ) {

            this.map.remove();

        }


        this.map =
                null;

        this.ready =
                false;


        for (
                const eventName
                of Object.keys(
                        this.listeners
                        )
                ) {

            this.listeners[
                    eventName
            ] = [];

        }

    }

}


/* ============================================================
 * GLOBAL EXPORT
 * ============================================================ */

window.RouteMap =
        RouteMap;


console.log(
        "map.js loaded: RouteMap exported."
        );