"use strict";
/* ============================================================
 * JENGA-CODE MAPAPP
 * map-data.js
 *
 * OpenStreetMap road-network loader for MapApp.
 *
 * MapLibre displays the map.
 *
 * THIS CLASS downloads the actual road network searched by
 * RoadGraph + AStarSearch.
 *
 * Pipeline:
 *
 *      start / destination
 *              ↓
 *      calculate intelligent bounds
 *              ↓
 *      Overpass API
 *              ↓
 *      OpenStreetMap ways + nodes
 *              ↓
 *      parse / clean network
 *              ↓
 *      RoadGraph
 *              ↓
 *      A* / Dijkstra
 *
 * Coordinate convention:
 *
 *      [longitude, latitude]
 *
 * ============================================================ */


class MapData {

    /* ========================================================
     * CONSTRUCTOR
     * ======================================================== */

    constructor(options = {}) {

        /* ----------------------------------------------------
         * OVERPASS
         * ----------------------------------------------------
         *
         * Overpass is a distributed public service.
         *
         * Individual instances can occasionally return:
         *
         *      HTTP 429  Too Many Requests
         *      HTTP 502  Bad Gateway
         *      HTTP 503  Service Unavailable
         *      HTTP 504  Gateway Timeout
         *
         * Rather than retrying the same failed server, MapData
         * keeps a list of compatible Overpass instances.
         *
         * loadBounds() can therefore move to another server when
         * the current one is temporarily unavailable.
         * ---------------------------------------------------- */


        this.overpassEndpoints =
                options.overpassEndpoints
                ||
                [

                    /*
                     * Primary/default Overpass instance.
                     *
                     * A caller can still override this using:
                     *
                     *      new MapData({
                     *          overpassEndpoint: "..."
                     *      });
                     */

                    options.overpassEndpoint
                            ||
                            "https://overpass-api.de/api/interpreter",

                    /*
                     * Fallback instance 1.
                     */

                    "https://overpass.kumi.systems/api/interpreter",

                    /*
                     * Fallback instance 2.
                     */

                    "https://overpass.private.coffee/api/interpreter"

                ];


        /*
         * Preserve the original public property.
         *
         * Existing MapApp code may inspect:
         *
         *      mapData.overpassEndpoint
         *
         * loadBounds() will update this property whenever it moves
         * to another Overpass instance.
         */

        this.overpassEndpoint =
                this.overpassEndpoints[0];


        /*
         * Timeout embedded inside the Overpass QL query.
         *
         * This tells the Overpass server how long it may spend
         * executing the query.
         */

        this.overpassTimeout =
                options.overpassTimeout
                ??
                30;


        /*
         * Browser-side request timeout.
         *
         * This is deliberately slightly longer than the Overpass
         * query timeout.
         */

        this.requestTimeoutMilliseconds =
                options.requestTimeoutMilliseconds
                ??
                40000;


        /*
         * Short delay before switching to another public Overpass
         * instance.
         *
         * There is no reason to wait several seconds here because
         * the next request is going to a different server.
         */

        this.retryDelayMilliseconds =
                options.retryDelayMilliseconds
                ??
                700;


        /* ----------------------------------------------------
         * SEARCH AREA
         *
         * We deliberately avoid downloading an unnecessarily
         * enormous rectangle.
         *
         * Short journeys receive generous minimum padding.
         *
         * Longer journeys receive proportionally smaller padding
         * because the start/destination rectangle is already large.
         * ---------------------------------------------------- */


        this.shortRoutePaddingFactor =
                options.shortRoutePaddingFactor
                ??
                0.45;


        this.mediumRoutePaddingFactor =
                options.mediumRoutePaddingFactor
                ??
                0.30;


        this.longRoutePaddingFactor =
                options.longRoutePaddingFactor
                ??
                0.18;


        /*
         * Minimum padding in degrees.
         *
         * Roughly:
         *
         *      latitude 0.008 ≈ 0.9 km
         *
         * Longitude distance varies with latitude.
         *
         * These minimums are particularly important for short
         * routes because otherwise two nearby markers could create
         * an extremely narrow Overpass bounding box.
         */

        this.minimumLatitudePadding =
                options.minimumLatitudePadding
                ??
                0.008;


        this.minimumLongitudePadding =
                options.minimumLongitudePadding
                ??
                0.012;


        /*
         * ----------------------------------------------------
         * ABSOLUTE SEARCH-AREA SAFETY LIMITS
         * ----------------------------------------------------
         *
         * MapApp is an interactive educational routing visualiser,
         * not a national routing server.
         *
         * These limits prevent an accidental marker placement from
         * requesting an enormous amount of OSM data.
         */

        this.maximumLatitudeSpan =
                options.maximumLatitudeSpan
                ??
                0.40;


        this.maximumLongitudeSpan =
                options.maximumLongitudeSpan
                ??
                0.65;


        /*
         * Approximate journey limits used by loadBetween() when
         * deciding how much padding should surround the direct
         * start -> destination rectangle.
         */

        this.shortRouteKilometres =
                options.shortRouteKilometres
                ??
                5;


        this.mediumRouteKilometres =
                options.mediumRouteKilometres
                ??
                20;


        /* ----------------------------------------------------
         * CACHE
         * ----------------------------------------------------
         *
         * Overpass data is relatively expensive to download.
         *
         * If the user repeats a route in the same geographical
         * area we should reuse the existing road network whenever
         * possible.
         * ---------------------------------------------------- */


        this.cacheEnabled =
                options.cacheEnabled
                ??
                true;


        this.maximumCacheEntries =
                options.maximumCacheEntries
                ??
                8;


        this.cache =
                new Map();


        /* ----------------------------------------------------
         * ACTIVE REQUEST
         * ----------------------------------------------------
         *
         * Only one road-data download should be considered active
         * at a time.
         *
         * Starting another request allows cancel() to abort the
         * previous fetch cleanly.
         * ---------------------------------------------------- */


        this.abortController =
                null;


        /*
         * Current human-readable download state.
         *
         * loadBounds() updates this with values such as:
         *
         *      Downloading road data
         *
         *      Road server fallback 2/3
         *
         *      Road server busy — trying fallback 3/3
         */

        this.downloadState =
                null;


        /* ----------------------------------------------------
         * EVENTS
         * ----------------------------------------------------
         *
         * MapData remains independent from the UI.
         *
         * MapApp can subscribe to these events and decide how they
         * should be displayed.
         * ---------------------------------------------------- */


        this.listeners = {

            loading: [],

            loaded: [],

            error: [],

            cancelled: []

        };


        /* ----------------------------------------------------
         * ROUTABLE ROAD TYPES
         * ----------------------------------------------------
         *
         * These are the OSM highway values which will be requested
         * from Overpass and converted into RoadGraph edges.
         *
         * Footways, paths, cycleways etc. are intentionally absent
         * because the current application is modelling ordinary
         * road routing.
         * ---------------------------------------------------- */


        this.allowedHighways =
                new Set(
                        options.allowedHighways
                        ||
                        [

                            /*
                             * Motorway network.
                             */

                            "motorway",

                            "motorway_link",

                            /*
                             * Major strategic roads.
                             */

                            "trunk",

                            "trunk_link",

                            /*
                             * Primary roads.
                             */

                            "primary",

                            "primary_link",

                            /*
                             * Secondary roads.
                             */

                            "secondary",

                            "secondary_link",

                            /*
                             * Tertiary roads.
                             */

                            "tertiary",

                            "tertiary_link",

                            /*
                             * Ordinary/local roads.
                             */

                            "unclassified",

                            "residential",

                            "living_street",

                            /*
                             * Access/service roads.
                             *
                             * These are retained because legitimate start
                             * and destination locations can be reached via
                             * service roads.
                             *
                             * The new RoadGraph endpoint snapping code
                             * prevents an isolated service-road node from
                             * automatically killing an otherwise valid
                             * route.
                             */

                            "service",

                            /*
                             * Generic OSM road classification.
                             */

                            "road"

                        ]

                        );


        /* ----------------------------------------------------
         * DIAGNOSTICS
         * ----------------------------------------------------
         */


        console.info(
                "MapData initialised.",
                {

                    primaryOverpass:
                            this.overpassEndpoint,

                    overpassServers:
                            this.overpassEndpoints.length,

                    overpassTimeout:
                            this.overpassTimeout,

                    requestTimeoutMilliseconds:
                            this.requestTimeoutMilliseconds,

                    cacheEnabled:
                            this.cacheEnabled,

                    routableHighwayTypes:
                            this.allowedHighways.size

                }
        );

    }

    /* ========================================================
     * LOAD BETWEEN TWO LOCATIONS
     * ======================================================== */

    async loadBetween(
            start,
            destination,
            options = {}
    ) {

        MapUtils.assertCoordinate(
                start,
                "start"
                );


        MapUtils.assertCoordinate(
                destination,
                "destination"
                );


        /*
         * Determine the direct geographical distance first.
         *
         * This lets MapApp choose a sensible amount of search
         * padding instead of applying the same 30% everywhere.
         */

        const directDistanceMetres =
                MapUtils.haversineDistance(
                        start,
                        destination
                        );


        const directDistanceKilometres =
                directDistanceMetres / 1000;


        const paddingFactor =
                this.#choosePaddingFactor(
                        directDistanceKilometres
                        );


        const bounds =
                this.createBounds(
                        start,
                        destination,
                        paddingFactor,
                        options.paddingMultiplier ?? 1
                        );


        console.log(
                "MapData: preparing road network.",
                {
                    start,
                    destination,
                    directDistanceKilometres:
                            Number(
                                    directDistanceKilometres.toFixed(2)
                                    ),
                    paddingFactor,
                    bounds
                }
        );


        return this.loadBounds(
                bounds
                );

    }

    /* ========================================================
     * CHOOSE SEARCH PADDING
     * ======================================================== */

    #choosePaddingFactor(
            distanceKilometres
            ) {

        if (
                distanceKilometres
                <=
                this.shortRouteKilometres
                ) {

            return this.shortRoutePaddingFactor;

        }


        if (
                distanceKilometres
                <=
                this.mediumRouteKilometres
                ) {

            return this.mediumRoutePaddingFactor;

        }


        return this.longRoutePaddingFactor;

    }

    /* ========================================================
     * CREATE SEARCH BOUNDS
     * ======================================================== */

    createBounds(
            start,
            destination,
            paddingFactor = null,
            paddingMultiplier = 1
            ) {

        MapUtils.assertCoordinate(
                start,
                "start"
                );


        MapUtils.assertCoordinate(
                destination,
                "destination"
                );


        /*
         * Maintain compatibility with callers that simply use:
         *
         *      createBounds(start, destination)
         */

        if (
                paddingFactor === null
                ||
                !Number.isFinite(
                        paddingFactor
                        )
                ) {

            const distanceKilometres =
                    MapUtils.haversineDistance(
                            start,
                            destination
                            )
                    /
                1000;


            paddingFactor =
                    this.#choosePaddingFactor(
                            distanceKilometres
                            );

        }


        let west =
                Math.min(
                        start[0],
                        destination[0]
                        );


        let east =
                Math.max(
                        start[0],
                        destination[0]
                        );


        let south =
                Math.min(
                        start[1],
                        destination[1]
                        );


        let north =
                Math.max(
                        start[1],
                        destination[1]
                        );


        const longitudeDifference =
                east - west;


        const latitudeDifference =
                north - south;


        /*
         * Route-aware padding.
         */

        const longitudePadding =
                Math.max(
                        longitudeDifference
                        *
                        paddingFactor,
                        this.minimumLongitudePadding

                        );


        const latitudePadding =
                Math.max(
                        latitudeDifference
                        *
                        paddingFactor,
                        this.minimumLatitudePadding

                        );


        west -= longitudePadding * paddingMultiplier;

        east += longitudePadding * paddingMultiplier;

        south -= latitudePadding * paddingMultiplier;

        north += latitudePadding * paddingMultiplier;


        /*
         * Legal geographical values.
         */

        west =
                MapUtils.clamp(
                        west,
                        -180,
                        180
                        );


        east =
                MapUtils.clamp(
                        east,
                        -180,
                        180
                        );


        south =
                MapUtils.clamp(
                        south,
                        -90,
                        90
                        );


        north =
                MapUtils.clamp(
                        north,
                        -90,
                        90
                        );


        const bounds = {

            south,

            west,

            north,

            east

        };


        this.validateBounds(
                bounds
                );


        return bounds;

    }

    /* ========================================================
     * LOAD BOUNDS
     * ======================================================== */

    async loadBounds(bounds) {
        this.validateBounds(bounds);
        this.#validateBoundsSize(bounds);
        const cacheKey = this.#createCacheKey(bounds);
        this.cancel();
        if (this.cacheEnabled && this.cache.has(cacheKey))
            return this.cache.get(cacheKey);
        const controller = new AbortController();
        this.abortController = controller;
        const started = MapUtils.now();
        const query = this.buildOverpassQuery(bounds);
        try {
            for (let attempt = 1; attempt <= 2; attempt++) {
                controller.signal.throwIfAborted();
                this.downloadState = attempt === 1 ? "Downloading road data" : "Road server retry 2/2";
                this.#emit("loading", {bounds, query, attempt});
                controller.signal.throwIfAborted();
                try {
                    const signal = AbortSignal.any([controller.signal,
                        AbortSignal.timeout(this.requestTimeoutMilliseconds)]);
                    const response = await fetch(this.overpassEndpoint, {
                        method: "POST", signal,
                        headers: {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json"},
                        body: new URLSearchParams({data: query})
                    });
                    if (!response.ok) {
                        const error = new Error(`Road-data server returned HTTP ${response.status}.`);
                        error.retryable = [502, 503, 504].includes(response.status);
                        throw error;
                    }
                    const rawData = await response.json();
                    controller.signal.throwIfAborted();
                    const network = this.parseOverpassData(rawData, bounds);
                    network.downloadMilliseconds = MapUtils.now() - started;
                    if (this.cacheEnabled)
                        this.#cacheResult(cacheKey, network);
                    this.#emit("loaded", network);
                    return network;
                } catch (error) {
                    controller.signal.throwIfAborted();
                    const transient = error.retryable || error.name === "TimeoutError" || error instanceof TypeError;
                    if (!transient)
                        throw error;
                    if (attempt === 2)
                        throw new Error(
                                "The road-data service is still unavailable after two attempts. A and B are saved; try Find route again shortly.");
                    this.downloadState = "Road server busy or timed out — retrying shortly";
                    console.warn("Road-data request failed; retrying the same area once.", error.message);
                    await MapUtils.sleep(this.retryDelayMilliseconds ?? 1500);
                    controller.signal.throwIfAborted();
                }
            }
        } catch (error) {
            this.#emit(controller.signal.aborted ? "cancelled" : "error", {bounds, error});
            throw error;
        } finally {
            if (this.abortController === controller) {
                this.abortController = null;
                this.downloadState = null;
            }
        }
    }

    buildOverpassQuery(bounds) {

        this.validateBounds(
                bounds
                );


        const highwayExpression =
                Array.from(
                        this.allowedHighways
                        )
                .map(
                        highway =>
                    this.#escapeRegex(
                            highway
                            )
                )
                .join("|");


        /*
         * Overpass bounding-box order:
         *
         *      south, west, north, east
         */

        const bbox =
                `${bounds.south},`
                +
                `${bounds.west},`
                +
                `${bounds.north},`
                +
                `${bounds.east}`;


        /*
         * We ask Overpass for routable highway ways and then
         * recursively retrieve the nodes belonging to them.
         *
         * "out body" preserves way tags such as:
         *
         *      highway
         *      oneway
         *      maxspeed
         *      access
         *      junction
         */

        return `
[out:json][timeout:${this.overpassTimeout}];

way
    ["highway"~"^(${highwayExpression})$"]
    (${bbox});

out body;

>;

out skel qt;
        `.trim();

    }

    /* ========================================================
     * PARSE OVERPASS DATA
     * ======================================================== */

    parseOverpassData(
            rawData,
            bounds = null
            ) {

        if (
                !rawData
                ||
                !Array.isArray(
                        rawData.elements
                        )
                ) {

            throw new Error(
                    "Invalid Overpass road-network response."
                    );

        }


        if (rawData.remark) {
            throw new Error(`Overpass returned incomplete data: ${rawData.remark}`);
        }

        const nodes =
                new Map();


        const rawWays =
                [];


        /* ----------------------------------------------------
         * NODES
         * ---------------------------------------------------- */

        for (
                const element
                of
                rawData.elements
                ) {

            if (
                    element.type
                    !==
                    "node"
                    ) {

                continue;
            }


            const longitude =
                    Number(
                            element.lon
                            );


            const latitude =
                    Number(
                            element.lat
                            );


            const coordinate = [

                longitude,

                latitude

            ];


            if (
                    !MapUtils.isValidCoordinate(
                            coordinate
                            )
                    ) {

                continue;

            }


            const id =
                    String(
                            element.id
                            );


            nodes.set(
                    id,
                    {

                        id,

                        osmId:
                                element.id,

                        longitude,

                        latitude,

                        coordinate

                    }
            );

        }


        /* ----------------------------------------------------
         * WAYS
         * ---------------------------------------------------- */

        for (
                const element
                of
                rawData.elements
                ) {

            if (
                    element.type
                    !==
                    "way"
                    ) {

                continue;
            }


            if (
                    !element.tags
                    ||
                    !this.allowedHighways.has(
                            element.tags.highway
                            )
                    ) {

                continue;

            }


            if (
                    !Array.isArray(
                            element.nodes
                            )
                    ||
                    element.nodes.length < 2
                    ) {

                continue;

            }


            rawWays.push(
                    element
                    );

        }


        const ways =
                [];


        let segmentCount =
                0;


        for (
                const rawWay
                of
                rawWays
                ) {

            const nodeIds = rawWay.nodes.map(String);
            // Never join the neighbours of a missing node into a fictitious road.
            if (nodeIds.some(id => !nodes.has(id))) {
                throw new Error(`Incomplete OSM way ${rawWay.id}: missing node data. Please retry.`);
            }


            if (
                    nodeIds.length < 2
                    ) {

                continue;

            }


            const tags =
                    rawWay.tags
                    ||
                    {};


            const direction =
                    this.#getWayDirection(
                            tags
                            );


            const way = {

                id:
                        String(
                                rawWay.id
                                ),

                osmId:
                        rawWay.id,

                nodeIds,

                highway:
                        tags.highway
                        ||
                        "road",

                name:
                        tags.name
                        ||
                        null,

                ref:
                        tags.ref
                        ||
                        null,

                oneWay:
                        direction
                        !==
                        "both",

                direction,

                bridge:
                        this.#tagIsTrue(
                                tags.bridge
                                ),

                tunnel:
                        this.#tagIsTrue(
                                tags.tunnel
                                ),

                roundabout:
                        tags.junction
                        ===
                        "roundabout",

                maxSpeed:
                        this.#parseMaxSpeed(
                                tags.maxspeed
                                ),

                access:
                        tags.access
                        ||
                        null,

                motorVehicle:
                        tags.motor_vehicle
                        ||
                        null,

                service:
                        tags.service
                        ||
                        null,

                tags

            };


            ways.push(
                    way
                    );


            segmentCount +=
                    nodeIds.length - 1;

        }


        /* ----------------------------------------------------
         * REMOVE UNUSED NODES
         * ---------------------------------------------------- */

        const usedNodeIds =
                new Set();


        for (
                const way
                of
                ways
                ) {

            for (
                    const nodeId
                    of
                    way.nodeIds
                    ) {

                usedNodeIds.add(
                        nodeId
                        );
            }

        }


        for (
                const nodeId
                of
                nodes.keys()
                ) {

            if (
                    !usedNodeIds.has(
                            nodeId
                            )
                    ) {

                nodes.delete(
                        nodeId
                        );
            }

        }


        if (
                nodes.size === 0
                ||
                ways.length === 0
                ) {

            throw new Error(
                    "No usable roads were found in this area."
                    );

        }


        return {

            nodes,

            ways,

            nodeCount:
                    nodes.size,

            wayCount:
                    ways.length,

            segmentCount,

            bounds:
                    bounds
                    ? {...bounds}
            : null,

            source:
                    "OpenStreetMap",

            downloadedAt:
                    new Date(),

            downloadMilliseconds:
                    null

        };

    }

    /* ========================================================
     * WAY DIRECTION
     * ======================================================== */

    #getWayDirection(tags) {

        const oneway =
                String(
                        tags.oneway
                        ||
                        ""
                        )
                .trim()
                .toLowerCase();


        if (
                oneway === "-1"
                ||
                oneway === "reverse"
                ) {

            return "reverse";

        }


        if (
                oneway === "yes"
                ||
                oneway === "1"
                ||
                oneway === "true"
                ) {

            return "forward";

        }


        /*
         * OSM roundabouts normally follow the direction in
         * which the way was defined.
         */

        if (["no", "0", "false"].includes(oneway))
            return "both";

        if (
                tags.junction
                ===
                "roundabout"
                ) {

            return "forward";

        }


        /*
         * Motorways are normally represented as directional
         * carriageways.
         */

        if (
                tags.highway
                ===
                "motorway"
                || tags.highway === "motorway_link"
                ) {

            return "forward";

        }


        return "both";

    }

    /* ========================================================
     * MAX SPEED
     * ======================================================== */

    #parseMaxSpeed(value) {

        if (
                value === undefined
                ||
                value === null
                ) {

            return null;

        }


        const text =
                String(value)
                .trim()
                .toLowerCase();


        /*
         * Explicit MPH.
         */

        const mphMatch =
                text.match(
                        /^(\d+(?:\.\d+)?)\s*mph$/
                        );


        if (
                mphMatch
                ) {

            return Number(
                    mphMatch[1]
                    );

        }


        /*
         * Plain OSM maxspeed numbers are normally km/h.
         */

        const numericMatch =
                text.match(
                        /^(\d+(?:\.\d+)?)$/
                        );


        if (
                numericMatch
                ) {

            const kilometresPerHour =
                    Number(
                            numericMatch[1]
                            );


            return (
                    kilometresPerHour
                    *
                    0.6213711922
                    );

        }


        return null;

    }

    /* ========================================================
     * TAG HELPERS
     * ======================================================== */

    #tagIsTrue(value) {

        const text =
                String(
                        value
                        ||
                        ""
                        )
                .trim()
                .toLowerCase();


        return (
                text === "yes"
                ||
                text === "true"
                ||
                text === "1"

                );

    }

    /* ========================================================
     * VALIDATE BOUNDS
     * ======================================================== */

    validateBounds(bounds) {

        if (
                !bounds
                ||
                typeof bounds
                !==
                "object"
                ) {

            throw new TypeError(
                    "Road-network bounds are required."
                    );

        }


        const {

            south,

            west,

            north,

            east

        } = bounds;


        if (
                !MapUtils.isFiniteNumber(
                        south
                        )
                ||
                !MapUtils.isFiniteNumber(
                        west
                        )
                ||
                !MapUtils.isFiniteNumber(
                        north
                        )
                ||
                !MapUtils.isFiniteNumber(
                        east
                        )
                ) {

            throw new TypeError(
                    "Road-network bounds must contain finite numbers."
                    );

        }


        if (
                south < -90
                ||
                north > 90
                ||
                west < -180
                ||
                east > 180
                ) {

            throw new RangeError(
                    "Road-network bounds contain invalid coordinates."
                    );

        }


        if (
                south >= north
                ) {

            throw new RangeError(
                    "South must be less than north."
                    );

        }


        if (
                west >= east
                ) {

            throw new RangeError(
                    "West must be less than east."
                    );

        }

    }

    /* ========================================================
     * BOUNDS SAFETY
     * ======================================================== */

    #validateBoundsSize(bounds) {

        const latitudeSpan =
                bounds.north
                -
                bounds.south;


        const longitudeSpan =
                bounds.east
                -
                bounds.west;


        if (
                latitudeSpan
                >
                this.maximumLatitudeSpan
                ||
                longitudeSpan
                >
                this.maximumLongitudeSpan
                ) {

            throw new Error(
                    "The selected route covers too large an area "
                    +
                    "for the interactive MapApp A* visualiser. "
                    +
                    "Choose two closer locations."

                    );

        }

    }

    /* ========================================================
     * CACHE KEY
     * ======================================================== */

    #createCacheKey(bounds) {

        return [

            bounds.south.toFixed(4),

            bounds.west.toFixed(4),

            bounds.north.toFixed(4),

            bounds.east.toFixed(4)

        ].join(":");

    }

    /* ========================================================
     * CACHE RESULT
     * ======================================================== */

    #cacheResult(
            key,
            network
            ) {

        if (
                this.cache.has(
                        key
                        )
                ) {

            this.cache.delete(
                    key
                    );

        }


        this.cache.set(
                key,
                network
                );


        /*
         * Simple LRU eviction.
         */

        while (
                this.cache.size
                >
                this.maximumCacheEntries
                ) {

            const oldestKey =
                    this.cache
                    .keys()
                    .next()
                    .value;


            this.cache.delete(
                    oldestKey
                    );

        }

    }

    /* ========================================================
     * CLEAR CACHE
     * ======================================================== */

    clearCache() {

        this.cache.clear();

    }

    /* ========================================================
     * CANCEL ACTIVE REQUEST
     * ======================================================== */

    cancel() {

        if (
                this.abortController
                ) {

            this.abortController.abort();

            this.abortController =
                    null;

        }

    }

    /* ========================================================
     * NETWORK -> GEOJSON
     * ======================================================== */

    toGeoJSON(network) {

        if (
                !network
                ||
                !(network.nodes instanceof Map)
                ||
                !Array.isArray(
                        network.ways
                        )
                ) {

            throw new TypeError(
                    "Invalid road network."
                    );

        }


        const features =
                [];


        for (
                const way
                of
                network.ways
                ) {

            const coordinates =
                    [];
            for (
                    const nodeId
                    of
                    way.nodeIds
                    ) {

                const node =
                        network.nodes.get(
                                nodeId
                                );
                if (
                        node
                        ) {

                    coordinates.push(
                            MapUtils.copyCoordinate(
                                    node.coordinate
                                    )
                            );

                }

            }


            if (
                    coordinates.length < 2
                    ) {

                continue;

            }


            features.push(
                    MapUtils.lineStringFeature(
                            coordinates,
                            {

                                osmId:
                                        way.osmId,

                                highway:
                                        way.highway,

                                name:
                                        way.name,

                                oneWay:
                                        way.oneWay,

                                direction:
                                        way.direction

                            }

                    )

                    );

        }


        return MapUtils.featureCollection(
                features
                );

    }

    /* ========================================================
     * STATISTICS
     * ======================================================== */

    getStatistics(network) {

        if (
                !network
                ) {

            return {

                nodes:
                        0,

                ways:
                        0,

                segments:
                        0,

                downloadMilliseconds:
                        null

            };

        }


        return {

            nodes:
                    network.nodeCount
                    ??
                    0,

            ways:
                    network.wayCount
                    ??
                    0,

            segments:
                    network.segmentCount
                    ??
                    0,

            downloadMilliseconds:
                    network.downloadMilliseconds
                    ??
                    null

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
                    `Unknown MapData event: ${eventName}`
                    );

        }


        if (
                typeof callback
                !==
                "function"
                ) {

            throw new TypeError(
                    "MapData event callback must be a function."
                    );

        }


        this.listeners[eventName].push(
                callback
                );

    }

    off(
            eventName,
            callback
            ) {

        if (
                !this.listeners[eventName]
                ) {

            return;

        }


        this.listeners[eventName] =
                this.listeners[eventName]
                .filter(
                        listener =>
                    listener !== callback
                );

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
            } catch (error) {

                console.error(
                        `MapData ${eventName} listener failed:`,
                        error
                        );

            }

        }

    }

    /* ========================================================
     * REGEX ESCAPING
     * ======================================================== */

    #escapeRegex(value) {

        return String(value)
                .replace(
                        /[.*+?^${}()|[\]\\]/g,
                        "\\$&"
                        );

    }

    /* ========================================================
     * DESTROY
     * ======================================================== */

    destroy() {

        this.cancel();

        this.clearCache();


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

window.MapData =
        MapData;