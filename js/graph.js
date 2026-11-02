"use strict";
/* ============================================================
 * JENGA-CODE MAPAPP
 * graph.js
 *
 * Weighted directed road graph used by A* and Dijkstra.
 *
 * MapData downloads OpenStreetMap roads.
 *
 * RoadGraph converts those roads into the actual mathematical
 * graph searched by MapApp.
 *
 * Pipeline:
 *
 *      MapData network
 *             ↓
 *      OSM ways + nodes
 *             ↓
 *      RoadGraph
 *             ↓
 *      directed weighted edges
 *             ↓
 *      A* / Dijkstra
 *
 * Current routing profile:
 *
 *      SHORTEST DISTANCE
 *
 * Therefore:
 *
 *      edge.weight = road distance in metres
 *
 * and:
 *
 *      h(n) = straight-line distance to destination
 *
 * Coordinate convention:
 *
 *      [longitude, latitude]
 *
 * ============================================================ */


class RoadGraph {

    /* ========================================================
     * CONSTRUCTOR
     * ======================================================== */

    constructor(options = {}) {

        /* ----------------------------------------------------
         * GRAPH STORAGE
         * ---------------------------------------------------- */

        this.nodes =
                new Map();


        /*
         * Outgoing adjacency:
         *
         *      nodeId -> [edge, edge, ...]
         */

        this.adjacency =
                new Map();


        /*
         * Incoming adjacency.
         *
         * This is useful for:
         *
         *      - destination snapping
         *      - connectivity analysis
         *      - future bidirectional A*
         */

        this.incoming =
                new Map();


        /*
         * OSM ways indexed by ID.
         */

        this.ways =
                new Map();


        /*
         * Prevent duplicate directed edges.
         */

        this.edgeKeys =
                new Set();


        this.edgeCount =
                0;


        this.segmentCount =
                0;


        this.bounds =
                null;


        this.source =
                null;


        /* ----------------------------------------------------
         * ACCESS FILTERING
         * ---------------------------------------------------- */

        this.excludePrivateAccess =
                options.excludePrivateAccess
                ??
                true;


        this.restrictedAccessValues =
                new Set(
                        options.restrictedAccessValues
                        ||
                        [
                            "private",
                            "no"
                        ]

                        );


        /* ----------------------------------------------------
         * ROUTING PROFILE
         *
         * Keep this as "distance" for the current AStarSearch.
         *
         * Later we can add:
         *
         *      fastest
         *      walking
         *      cycling
         *
         * without redesigning the graph.
         * ---------------------------------------------------- */

        this.routingProfile =
                options.routingProfile
                ||
                "distance";


        /* ----------------------------------------------------
         * SPATIAL INDEX
         *
         * Instead of always scanning every node during snapping,
         * nodes are placed into geographical grid cells.
         *
         * This remains deliberately simple and browser-friendly.
         * ---------------------------------------------------- */

        this.spatialCellSize =
                options.spatialCellSize
                ??
                0.01;


        this.spatialIndex =
                new Map();


        /* ----------------------------------------------------
         * STATISTICS
         * ---------------------------------------------------- */

        this.statistics =
                this.#createEmptyStatistics();

    }

    /* ========================================================
     * BUILD GRAPH
     * ======================================================== */

    build(network) {

        this.#validateNetwork(
                network
                );


        const started =
                MapUtils.now();


        this.clear();


        this.bounds =
                network.bounds
                ? {...network.bounds}
        : null;


        this.source =
                network.source
                ||
                null;


        this.statistics.sourceNodes =
                network.nodeCount
                ??
                network.nodes.size;


        this.statistics.sourceWays =
                network.wayCount
                ??
                network.ways.length;


        this.statistics.sourceSegments =
                network.segmentCount
                ??
                0;


        /* ----------------------------------------------------
         * COPY NODES
         * ---------------------------------------------------- */

        for (
                const [
                    nodeId,
                    sourceNode
                ]
                of
                network.nodes
                ) {

            const id =
                    String(
                            nodeId
                            );
            if (
                    !sourceNode
                    ||
                    !MapUtils.isValidCoordinate(
                            sourceNode.coordinate
                            )
                    ) {

                continue;

            }


            const coordinate =
                    MapUtils.copyCoordinate(
                            sourceNode.coordinate
                            );


            this.nodes.set(
                    id,
                    {

                        id,

                        osmId:
                                sourceNode.osmId
                                ??
                                nodeId,

                        coordinate,

                        longitude:
                                coordinate[0],

                        latitude:
                                coordinate[1]

                    }
            );


            this.adjacency.set(
                    id,
                    []
                    );


            this.incoming.set(
                    id,
                    []
                    );

        }


        /* ----------------------------------------------------
         * CONVERT OSM WAYS TO EDGES
         * ---------------------------------------------------- */

        for (
                const way
                of
                network.ways
                ) {

            this.#addWay(
                    way
                    );
        }


        /*
         * Remove nodes that ended up with no usable edges.
         */

        this.#removeIsolatedNodes();


        /*
         * Build geographical lookup index after isolated nodes
         * have been removed.
         */

        this.#buildSpatialIndex();
        this.maximumSpeedMph = 70;
        for (const way of this.ways.values())
            this.maximumSpeedMph = Math.max(this.maximumSpeedMph, this.#getEffectiveSpeed(way));
        // Weak components are diagnostic only: directed BFS still decides reachability.
        const unseen = new Set(this.nodes.keys());
        let components = 0, largestComponent = 0;
        while (unseen.size) {
            const first = unseen.values().next().value;
            const queue = [first];
            unseen.delete(first);
            components++;
            for (let head = 0; head < queue.length; head++) {
                const visit = id => {
                    if (unseen.delete(id))
                        queue.push(id);
                };
                for (const edge of this.getNeighbours(queue[head]))
                    visit(edge.to);
                for (const edge of this.getIncomingEdges(queue[head]))
                    visit(edge.from);
            }
            largestComponent = Math.max(largestComponent, queue.length);
        }
        this.statistics.weakComponents = components;
        this.statistics.largestWeakComponent = largestComponent;
        this.statistics.graphNodes =
                this.nodes.size;


        this.statistics.graphEdges =
                this.edgeCount;


        this.statistics.graphSegments =
                this.segmentCount;


        this.statistics.buildMilliseconds =
                MapUtils.now()
                -
                started;


        console.log(
                "RoadGraph: graph built.",
                {
                    nodes:
                            this.nodes.size,

                    edges:
                            this.edgeCount,

                    segments:
                            this.segmentCount,

                    ways:
                            this.ways.size,

                    milliseconds:
                            Math.round(
                                    this.statistics.buildMilliseconds
                                    )
                }
        );


        return this;

    }

    /* ========================================================
     * FACTORY
     * ======================================================== */

    static fromNetwork(
            network,
            options = {}
    ) {

        const graph =
                new RoadGraph(
                        options
                        );


        return graph.build(
                network
                );

    }

    /* ========================================================
     * ADD OSM WAY
     * ======================================================== */

    #addWay(way) {

        if (
                !way
                ||
                !Array.isArray(
                        way.nodeIds
                        )
                ||
                way.nodeIds.length < 2
                ) {

            this.statistics.skippedWays++;

            return;

        }


        if (
                !this.#isWayAccessible(
                        way
                        )
                ) {

            this.statistics.skippedWays++;

            return;

        }


        const wayId =
                String(
                        way.id
                        ??
                        way.osmId
                        );


        this.ways.set(
                wayId,
                way
                );


        for (
                let index = 0;
                index < way.nodeIds.length - 1;
                index++
                ) {

            const firstId =
                    String(
                            way.nodeIds[index]
                            );


            const secondId =
                    String(
                            way.nodeIds[index + 1]
                            );


            if (
                    firstId === secondId
                    ) {

                this.statistics.skippedSegments++;

                continue;

            }


            const firstNode =
                    this.nodes.get(
                            firstId
                            );


            const secondNode =
                    this.nodes.get(
                            secondId
                            );


            if (
                    !firstNode
                    ||
                    !secondNode
                    ) {

                this.statistics.skippedSegments++;

                continue;

            }


            const distance =
                    MapUtils.haversineDistance(
                            firstNode.coordinate,
                            secondNode.coordinate
                            );


            if (
                    !Number.isFinite(
                            distance
                            )
                    ||
                    distance < 0
                    ) {

                this.statistics.skippedSegments++;

                continue;

            }


            this.segmentCount++;


            /* ------------------------------------------------
             * FORWARD ONLY
             * ------------------------------------------------ */

            if (
                    way.direction
                    ===
                    "forward"
                    ) {

                this.#addDirectedEdge(
                        firstId,
                        secondId,
                        distance,
                        way
                        );


                this.statistics.oneWaySegments++;

                continue;

            }


            /* ------------------------------------------------
             * REVERSE ONLY
             * ------------------------------------------------ */

            if (
                    way.direction
                    ===
                    "reverse"
                    ) {

                this.#addDirectedEdge(
                        secondId,
                        firstId,
                        distance,
                        way
                        );


                this.statistics.oneWaySegments++;

                continue;

            }


            /* ------------------------------------------------
             * NORMAL TWO-WAY ROAD
             * ------------------------------------------------ */

            this.#addDirectedEdge(
                    firstId,
                    secondId,
                    distance,
                    way
                    );


            this.#addDirectedEdge(
                    secondId,
                    firstId,
                    distance,
                    way
                    );


            this.statistics.twoWaySegments++;

        }

    }

    /* ========================================================
     * ADD DIRECTED EDGE
     * ======================================================== */

    #addDirectedEdge(
            fromId,
            toId,
            distance,
            way
            ) {

        if (
                !this.nodes.has(
                        fromId
                        )
                ||
                !this.nodes.has(
                        toId
                        )
                ) {

            return;

        }


        const wayId =
                String(
                        way.id
                        ??
                        way.osmId
                        );


        /*
         * Different OSM ways can legitimately connect the same
         * pair of vertices, so way ID forms part of the key.
         */

        const edgeKey =
                `${fromId}>${toId}@${wayId}`;


        if (
                this.edgeKeys.has(
                        edgeKey
                        )
                ) {

            this.statistics.duplicateEdges++;

            return;

        }


        const outgoing =
                this.adjacency.get(
                        fromId
                        );


        const incoming =
                this.incoming.get(
                        toId
                        );


        if (
                !outgoing
                ||
                !incoming
                ) {

            return;

        }


        const speedMph =
                this.#getEffectiveSpeed(
                        way
                        );


        const estimatedTravelSeconds =
                this.#calculateTravelSeconds(
                        distance,
                        speedMph
                        );


        const weight =
                this.#calculateEdgeWeight(
                        distance,
                        estimatedTravelSeconds
                        );


        const edge = {

            from:
                    fromId,

            to:
                    toId,

            distance,

            weight,

            wayId,

            osmWayId:
                    way.osmId
                    ??
                    way.id,

            highway:
                    way.highway
                    ||
                    "road",

            name:
                    way.name
                    ||
                    null,

            ref:
                    way.ref
                    ||
                    null,

            oneWay:
                    Boolean(
                            way.oneWay
                            ),

            direction:
                    way.direction
                    ||
                    "both",

            maxSpeed:
                    way.maxSpeed
                    ??
                    null,

            effectiveSpeedMph:
                    speedMph,

            estimatedTravelSeconds,

            bridge:
                    Boolean(
                            way.bridge
                            ),

            tunnel:
                    Boolean(
                            way.tunnel
                            ),

            roundabout:
                    Boolean(
                            way.roundabout
                            ),

            service:
                    way.service
                    ||
                    null,

            access:
                    way.access
                    ||
                    null,

            motorVehicle:
                    way.motorVehicle
                    ||
                    null

        };


        outgoing.push(
                edge
                );


        incoming.push(
                edge
                );


        this.edgeKeys.add(
                edgeKey
                );


        this.edgeCount++;


        this.statistics.totalDirectedDistance +=
                distance;


        this.statistics.totalEstimatedTravelSeconds +=
                estimatedTravelSeconds;

    }

    /* ========================================================
     * EDGE WEIGHT
     * ======================================================== */

    #calculateEdgeWeight(
            distance,
            travelSeconds
            ) {

        /*
         * IMPORTANT:
         *
         * Current A* heuristic is measured in metres.
         *
         * Therefore the default routing profile must also use
         * metres as its edge weight.
         *
         * We retain travel time now so switching to a proper
         * fastest-route heuristic later becomes straightforward.
         */

        if (
                this.routingProfile
                ===
                "time"
                ) {

            return travelSeconds;

        }


        return distance;

    }

    /* ========================================================
     * ESTIMATED ROAD SPEED
     * ======================================================== */

    #getEffectiveSpeed(way) {

        /*
         * Prefer actual OSM maxspeed information.
         */

        if (
                Number.isFinite(
                        way.maxSpeed
                        )
                &&
                way.maxSpeed > 0
                ) {

            return way.maxSpeed;

        }


        /*
         * Conservative fallback estimates.
         *
         * These are NOT currently used for shortest-distance
         * routing. They are stored for future fastest-route mode.
         */

        switch (
                way.highway
                ) {

            case "motorway":
                return 70;

            case "motorway_link":
                return 40;

            case "trunk":
                return 60;

            case "trunk_link":
                return 40;

            case "primary":
                return 50;

            case "primary_link":
                return 35;

            case "secondary":
                return 40;

            case "secondary_link":
                return 30;

            case "tertiary":
                return 35;

            case "tertiary_link":
                return 25;

            case "living_street":
                return 15;

            case "service":
                return 15;

            case "residential":
                return 25;

            case "unclassified":
                return 30;

            default:
                return 25;

        }

    }

    /* ========================================================
     * TRAVEL TIME
     * ======================================================== */

    #calculateTravelSeconds(
            distanceMetres,
            speedMph
            ) {

        if (
                !Number.isFinite(
                        speedMph
                        )
                ||
                speedMph <= 0
                ) {

            return Infinity;

        }


        const metresPerSecond =
                speedMph
                *
                0.44704;


        return (
                distanceMetres
                /
            metresPerSecond
                );

    }

    /* ========================================================
     * ACCESS FILTERING
     * ======================================================== */

    #isWayAccessible(way) {
        if (!this.excludePrivateAccess)
            return true;
        const tags = way.tags || {};
        // A more specific motor-car tag overrides a general access tag.
        const access = String(tags.motorcar ?? tags.motor_vehicle ?? way.motorVehicle
                ?? tags.vehicle ?? tags.access ?? way.access ?? "").trim().toLowerCase();
        return !this.restrictedAccessValues.has(access);
    }

    #removeIsolatedNodes() {

        for (
                const nodeId
                of
                Array.from(
                        this.nodes.keys()
                        )
                ) {

            const outgoing =
                    this.adjacency.get(
                            nodeId
                            )
                    ||
                    [];
            const incoming =
                    this.incoming.get(
                            nodeId
                            )
                    ||
                    [];


            if (
                    outgoing.length === 0
                    &&
                    incoming.length === 0
                    ) {

                this.nodes.delete(
                        nodeId
                        );


                this.adjacency.delete(
                        nodeId
                        );


                this.incoming.delete(
                        nodeId
                        );

            }

        }

    }

    /* ========================================================
     * SPATIAL INDEX
     * ======================================================== */

    #buildSpatialIndex() {

        this.spatialIndex.clear();


        for (
                const node
                of
                this.nodes.values()
                ) {

            const key =
                    this.#getSpatialCellKey(
                            node.longitude,
                            node.latitude
                            );
            if (
                    !this.spatialIndex.has(
                            key
                            )
                    ) {

                this.spatialIndex.set(
                        key,
                        []
                        );

            }


            this.spatialIndex
                    .get(
                            key
                            )
                    .push(
                            node.id
                            );

        }

    }

    #getSpatialCellKey(
            longitude,
            latitude
            ) {

        const x =
                Math.floor(
                        longitude
                        /
                this.spatialCellSize
                        );


        const y =
                Math.floor(
                        latitude
                        /
                this.spatialCellSize
                        );


        return `${x}:${y}`;

    }

    #getSpatialCellCoordinates(
            coordinate
            ) {

        return {

            x:
                    Math.floor(
                            coordinate[0]
                            /
                    this.spatialCellSize
                            ),

            y:
                    Math.floor(
                            coordinate[1]
                            /
                    this.spatialCellSize
                            )

        };

    }

    /* ========================================================
     * NODE ACCESS
     * ======================================================== */

    getNode(nodeId) {

        return (
                this.nodes.get(
                        String(nodeId)
                        )
                ||
                null
                );

    }

    hasNode(nodeId) {

        return this.nodes.has(
                String(nodeId)
                );

    }

    getCoordinate(nodeId) {

        const node =
                this.getNode(
                        nodeId
                        );


        if (
                !node
                ) {

            return null;

        }


        return MapUtils.copyCoordinate(
                node.coordinate
                );

    }

    /* ========================================================
     * OUTGOING NEIGHBOURS
     * ======================================================== */

    getNeighbours(nodeId) {

        return (
                this.adjacency.get(
                        String(nodeId)
                        )
                ||
                []
                );

    }

    /*
     * US spelling alias.
     */

    getNeighbors(nodeId) {

        return this.getNeighbours(
                nodeId
                );

    }

    /* ========================================================
     * INCOMING EDGES
     * ======================================================== */

    getIncomingEdges(nodeId) {

        return (
                this.incoming.get(
                        String(nodeId)
                        )
                ||
                []
                );

    }

    /* ========================================================
     * DEGREE
     * ======================================================== */

    getDegree(nodeId) {

        return this.getNeighbours(
                nodeId
                ).length;

    }

    getIncomingDegree(nodeId) {

        return this.getIncomingEdges(
                nodeId
                ).length;

    }

    getTotalDegree(nodeId) {

        return (
                this.getDegree(
                        nodeId
                        )
                +
                this.getIncomingDegree(
                        nodeId
                        )
                );

    }

    /* ========================================================
     * EDGE LOOKUP
     * ======================================================== */

    getEdge(
            fromId,
            toId
            ) {

        const destinationId =
                String(
                        toId
                        );


        const edges =
                this.getNeighbours(
                        fromId
                        );


        let best =
                null;


        for (
                const edge
                of
                edges
                ) {

            if (
                    edge.to
                    !==
                    destinationId
                    ) {

                continue;
            }


            if (
                    best === null
                    ||
                    edge.weight
                    <
                    best.weight
                    ) {

                best =
                        edge;

            }

        }


        return best;

    }

    /* ========================================================
     * NEAREST NODE
     * ======================================================== */

    findNearestNode(coordinate, options = {}) {
        return this.findNearestCandidates(coordinate, options)[0] || null;
    }

    findNearestCandidates(coordinate, options = {}) {
        MapUtils.assertCoordinate(coordinate);
        const maximumDistance = options.maximumDistance ?? 500;
        if (!Number.isFinite(maximumDistance) || maximumDistance < 0) {
            throw new RangeError("A finite, non-negative snap radius is required.");
        }
        // Spherical cap bounds include ALL cells intersecting the search radius.
        // Unlike the old ring shortcut, this stays correct near cell boundaries.
        const angle = maximumDistance / MapUtils.EARTH_RADIUS_METRES;
        const lat = MapUtils.degreesToRadians(coordinate[1]);
        const latDelta = MapUtils.radiansToDegrees(angle);
        const polar = Math.abs(lat) + angle >= Math.PI / 2;
        const lonDelta = polar ? 180 : MapUtils.radiansToDegrees(
                Math.asin(Math.min(1, Math.sin(angle) / Math.cos(lat))));
        const south = Math.max(-90, coordinate[1] - latDelta);
        const north = Math.min(90, coordinate[1] + latDelta);
        const candidates = [];
        const inspect = id => {
            const node = this.nodes.get(id);
            if (options.requireOutgoing && !this.getDegree(id))
                return;
            if (options.requireIncoming && !this.getIncomingDegree(id))
                return;
            const distance = MapUtils.haversineDistance(coordinate, node.coordinate);
            if (distance <= maximumDistance)
                candidates.push({
                    node, nodeId: id, coordinate: [...node.coordinate], distance,
                    outgoingDegree: this.getDegree(id), incomingDegree: this.getIncomingDegree(id)
                });
        };
        const west = coordinate[0] - lonDelta, east = coordinate[0] + lonDelta;
        if (polar || west < -180 || east > 180) {
            // Rare polar/dateline query; avoid a huge empty-cell loop.
            for (const id of this.nodes.keys())
                inspect(id);
        } else {
            for (let x = Math.floor(west / this.spatialCellSize); x <= Math.floor(east / this.spatialCellSize); x++) {
                for (let y = Math.floor(south / this.spatialCellSize); y <= Math.floor(north / this.spatialCellSize); y++) {
                    for (const id of this.spatialIndex.get(`${x}:${y}`) || [])
                        inspect(id);
                }
            }
        }
        return candidates.sort((a, b) => a.distance - b.distance || a.nodeId.localeCompare(b.nodeId));
    }

    async snapReachable(start, destination, options = {}) {

        const maximumDistance =
                options.maximumDistance ?? 500;

        const maximumExtraDistance =
                options.maximumExtraDistance ?? 150;

        const check =
                options.checkCancelled || (() => {
                });


        check();


        /*
         * =========================================================
         * FIND POSSIBLE START AND DESTINATION NODES
         * =========================================================
         *
         * IMPORTANT:
         *
         * Do NOT simply use the geographically closest road node.
         *
         * A marker may happen to be closest to:
         *
         *      - a service road
         *      - a car park
         *      - a one-way road
         *      - a disconnected road fragment
         *      - the wrong carriageway of a divided road
         *
         * The previous implementation selected ONE start node and
         * then performed reachability from that node.
         *
         * That meant a perfectly valid route could be rejected just
         * because the nearest OSM node belonged to an inconvenient
         * road fragment.
         *
         * Instead we collect several locally-equivalent candidates
         * at BOTH ends.
         *
         * We then perform a multi-source directed graph search.
         *
         * This still obeys one-way streets because traversal uses
         * getNeighbours(), i.e. the real directed graph.
         * =========================================================
         */


        const startCandidates =
                this.findNearestCandidates(
                        start,
                        {
                            requireOutgoing: true,
                            maximumDistance
                        }
                );


        const destinationCandidates =
                this.findNearestCandidates(
                        destination,
                        {
                            requireIncoming: true,
                            maximumDistance
                        }
                );


        /*
         * Nothing close enough to one of the markers.
         */

        if (
                startCandidates.length === 0
                ||
                destinationCandidates.length === 0
                ) {

            return {

                success: false,

                reason:
                        "snap-distance",

                start:
                        startCandidates[0]
                        ||
                        null,

                destination:
                        null,

                nearestDestination:
                        destinationCandidates[0]
                        ||
                        null,

                candidateCount:
                        0,

                startCandidateCount:
                        0,

                reachableCount:
                        0

            };

        }


        /*
         * =========================================================
         * LIMIT CANDIDATES TO THE LOCAL ROAD
         * =========================================================
         *
         * We do not want the program silently moving the marker
         * hundreds of metres away simply to manufacture a route.
         *
         * Keep everything within maximumExtraDistance of the nearest
         * candidate.
         * =========================================================
         */


        const nearestStartDistance =
                startCandidates[0].distance;


        const nearestDestinationDistance =
                destinationCandidates[0].distance;


        const localStarts =
                startCandidates.filter(
                        candidate =>
                    candidate.distance
                            <=
                            nearestStartDistance
                            +
                            maximumExtraDistance

                );


        const localDestinations =
                destinationCandidates.filter(
                        candidate =>
                    candidate.distance
                            <=
                            nearestDestinationDistance
                            +
                            maximumExtraDistance

                );


        /*
         * Fast destination lookup:
         *
         *      nodeId -> destination candidate
         */

        const destinationById =
                new Map();


        for (
                const candidate
                of
                localDestinations
                ) {

            destinationById.set(
                    String(candidate.nodeId),
                    candidate
                    );
        }


        /*
         * =========================================================
         * MULTI-SOURCE DIRECTED REACHABILITY SEARCH
         * =========================================================
         *
         * All acceptable A nodes are inserted into the queue.
         *
         * Each discovered node remembers WHICH A candidate reached
         * it.
         *
         * Therefore when we eventually encounter a valid B node we
         * know exactly which A/B pair belongs to the same directed
         * component.
         * =========================================================
         */


        const reachable =
                new Set();


        const origin =
                new Map();


        const queue =
                [];


        for (
                const candidate
                of
                localStarts
                ) {

            const nodeId =
                    String(
                            candidate.nodeId
                            );
            if (
                    reachable.has(
                            nodeId
                            )
                    ) {

                continue;

            }


            reachable.add(
                    nodeId
                    );


            origin.set(
                    nodeId,
                    candidate
                    );


            queue.push(
                    nodeId
                    );

        }


        /*
         * Best connected endpoint pair found so far.
         */

        let best =
                null;


        /*
         * =========================================================
         * BREADTH-FIRST CONNECTIVITY SEARCH
         * =========================================================
         *
         * This is NOT the actual route search.
         *
         * A* / Dijkstra still performs the real weighted search
         * afterwards.
         *
         * This stage only answers:
         *
         *      "Can any sensible A road node reach any sensible
         *       B road node using the directed road graph?"
         * =========================================================
         */


        for (
                let head = 0;
                head < queue.length;
                head++
                ) {

            check();


            const currentId =
                    queue[head];


            /*
             * Have we reached one of our destination candidates?
             */

            const destinationCandidate =
                    destinationById.get(
                            currentId
                            );


            if (
                    destinationCandidate
                    ) {

                const startCandidate =
                        origin.get(
                                currentId
                                );


                const score =
                        startCandidate.distance
                        +
                        destinationCandidate.distance;


                if (
                        best === null
                        ||
                        score < best.score
                        ) {

                    best = {

                        start:
                                startCandidate,

                        destination:
                                destinationCandidate,

                        score

                    };

                }


                /*
                 * A valid connected pair has now been established.
                 *
                 * A* will subsequently determine the actual shortest
                 * path, so there is no reason to traverse the entire
                 * road graph here.
                 */

                break;

            }


            /*
             * Traverse the REAL outgoing directed edges.
             *
             * This is important:
             *
             * We are NOT treating the graph as undirected.
             *
             * One-way roads therefore remain respected.
             */

            const neighbours =
                    this.getNeighbours(
                            currentId
                            );


            for (
                    const edge
                    of
                    neighbours
                    ) {

                const nextId =
                        String(
                                edge.to
                                );
                if (
                        reachable.has(
                                nextId
                                )
                        ) {

                    continue;

                }


                reachable.add(
                        nextId
                        );


                /*
                 * Remember which starting candidate generated this
                 * branch of the connectivity search.
                 */

                origin.set(
                        nextId,
                        origin.get(currentId)
                        );


                queue.push(
                        nextId
                        );

            }


            /*
             * =====================================================
             * KEEP THE BROWSER RESPONSIVE
             * =====================================================
             *
             * Large OSM downloads can contain tens of thousands of
             * nodes.
             *
             * Yield periodically so the page does not appear frozen.
             * =====================================================
             */

            if (
                    head % 1000 === 0
                    ) {

                if (
                        typeof options.onProgress
                        ===
                        "function"
                        ) {

                    options.onProgress(
                            head + 1
                            );

                }


                await MapUtils.sleep(
                        0
                        );


                check();

            }

        }


        /*
         * =========================================================
         * SUCCESS
         * =========================================================
         */

        if (
                best
                ) {

            console.info(
                    "RoadGraph: connected endpoint pair found.",
                    {

                        startNode:
                                best.start.nodeId,

                        destinationNode:
                                best.destination.nodeId,

                        startSnapDistance:
                                Math.round(
                                        best.start.distance
                                        ),

                        destinationSnapDistance:
                                Math.round(
                                        best.destination.distance
                                        ),

                        startCandidates:
                                localStarts.length,

                        destinationCandidates:
                                localDestinations.length,

                        reachableNodes:
                                reachable.size

                    }
            );


            return {

                success:
                        true,

                reason:
                        null,

                start:
                        best.start,

                destination:
                        best.destination,

                nearestDestination:
                        destinationCandidates[0],

                candidateCount:
                        localDestinations.length,

                startCandidateCount:
                        localStarts.length,

                reachableCount:
                        reachable.size

            };

        }


        /*
         * =========================================================
         * FAILURE
         * =========================================================
         *
         * At this point:
         *
         *      - nearby start nodes exist
         *      - nearby destination nodes exist
         *      - but none of the acceptable B candidates can be
         *        reached from any acceptable A candidate
         *
         * MapApp can now retry using a larger downloaded road area.
         * =========================================================
         */


        console.warn(
                "RoadGraph: no connected endpoint pair in downloaded graph.",
                {

                    nearestStart:
                            startCandidates[0],

                    nearestDestination:
                            destinationCandidates[0],

                    startCandidates:
                            localStarts.length,

                    destinationCandidates:
                            localDestinations.length,

                    reachableNodes:
                            reachable.size

                }
        );


        return {

            success:
                    false,

            reason:
                    "unreachable",

            start:
                    localStarts[0]
                    ||
                    startCandidates[0],

            destination:
                    null,

            nearestDestination:
                    destinationCandidates[0],

            candidateCount:
                    localDestinations.length,

            startCandidateCount:
                    localStarts.length,

            reachableCount:
                    reachable.size

        };

    }
    #getSpatialRingCandidates(
            centreX,
            centreY,
            ring
            ) {

        const candidates =
                [];


        if (
                ring === 0
                ) {

            const key =
                    `${centreX}:${centreY}`;


            const ids =
                    this.spatialIndex.get(
                            key
                            );


            if (
                    ids
                    ) {

                candidates.push(
                        ...ids
                        );

            }


            return candidates;

        }


        const minimumX =
                centreX - ring;


        const maximumX =
                centreX + ring;


        const minimumY =
                centreY - ring;


        const maximumY =
                centreY + ring;


        /*
         * Top and bottom sides.
         */

        for (
                let x = minimumX;
                x <= maximumX;
                x++
                ) {

            this.#appendSpatialCell(
                    candidates,
                    x,
                    minimumY
                    );


            this.#appendSpatialCell(
                    candidates,
                    x,
                    maximumY
                    );

        }


        /*
         * Left and right sides, excluding corners already added.
         */

        for (
                let y = minimumY + 1;
                y < maximumY;
                y++
                ) {

            this.#appendSpatialCell(
                    candidates,
                    minimumX,
                    y
                    );


            this.#appendSpatialCell(
                    candidates,
                    maximumX,
                    y
                    );

        }


        return candidates;

    }

    #appendSpatialCell(
            destination,
            x,
            y
            ) {

        const key =
                `${x}:${y}`;


        const ids =
                this.spatialIndex.get(
                        key
                        );


        if (
                ids
                ) {

            destination.push(
                    ...ids
                    );

        }

    }

    /* ========================================================
     * NEAREST NODE ID
     * ======================================================== */

    findNearestNodeId(
            coordinate,
            options = {}
    ) {

        const result =
                this.findNearestNode(
                        coordinate,
                        options
                        );


        return result
                ? result.nodeId
                : null;

    }

    /* ========================================================
     * HEURISTIC
     * ======================================================== */

    heuristic(
            fromId,
            toId
            ) {

        const from =
                this.getNode(
                        fromId
                        );


        const to =
                this.getNode(
                        toId
                        );


        if (
                !from
                ||
                !to
                ) {

            return Infinity;

        }


        const straightLineDistance =
                MapUtils.haversineDistance(
                        from.coordinate,
                        to.coordinate
                        );


        /*
         * Current production mode:
         *
         *      shortest distance
         *
         * h(n) is therefore straight-line metres.
         *
         * If time routing is enabled later, the heuristic must
         * use minimum possible travel time instead.
         */

        if (
                this.routingProfile
                ===
                "time"
                ) {

            /*
             * 70 mph is used as the optimistic maximum driving
             * speed. This keeps the heuristic admissible for the
             * road classes currently downloaded by MapData.
             */

            const maximumMetresPerSecond =
                    (this.maximumSpeedMph || 70)
                    *
                    0.44704;


            return (
                    straightLineDistance
                    /
                maximumMetresPerSecond
                    );

        }


        return straightLineDistance;

    }

    /* ========================================================
     * EDGE -> GEOJSON
     * ======================================================== */

    edgeToGeoJSON(
            edge,
            properties = {}
    ) {

        if (
                !edge
                ) {

            return null;

        }


        const from =
                this.getNode(
                        edge.from
                        );


        const to =
                this.getNode(
                        edge.to
                        );


        if (
                !from
                ||
                !to
                ) {

            return null;

        }


        return MapUtils.lineStringFeature(
                [
                    from.coordinate,
                    to.coordinate
                ],
                {

                    from:
                            edge.from,

                    to:
                            edge.to,

                    distance:
                            edge.distance,

                    weight:
                            edge.weight,

                    wayId:
                            edge.wayId,

                    highway:
                            edge.highway,

                    name:
                            edge.name,

                    ...properties

                }

        );

    }

    /* ========================================================
     * EDGES -> GEOJSON
     * ======================================================== */

    edgesToGeoJSON(
            edges,
            properties = {}
    ) {

        if (
                !Array.isArray(
                        edges
                        )
                ) {

            return MapUtils.emptyFeatureCollection();

        }


        const features =
                [];


        for (
                const edge
                of
                edges
                ) {

            const feature =
                    this.edgeToGeoJSON(
                            edge,
                            properties
                            );
            if (
                    feature
                    ) {

                features.push(
                        feature
                        );

            }

        }


        return MapUtils.featureCollection(
                features
                );

    }

    /* ========================================================
     * PATH -> COORDINATES
     * ======================================================== */

    pathToCoordinates(nodeIds) {

        if (
                !Array.isArray(
                        nodeIds
                        )
                ) {

            return [];

        }


        const coordinates =
                [];


        for (
                const nodeId
                of
                nodeIds
                ) {

            const node =
                    this.getNode(
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


        return coordinates;

    }

    /* ========================================================
     * PATH -> EDGES
     * ======================================================== */

    pathToEdges(nodeIds) {

        if (
                !Array.isArray(
                        nodeIds
                        )
                ||
                nodeIds.length < 2
                ) {

            return [];

        }


        const edges =
                [];


        for (
                let index = 0;
                index < nodeIds.length - 1;
                index++
                ) {

            const edge =
                    this.getEdge(
                            nodeIds[index],
                            nodeIds[index + 1]
                            );


            if (
                    edge
                    ) {

                edges.push(
                        edge
                        );

            }

        }


        return edges;

    }

    /* ========================================================
     * PATH DISTANCE
     * ======================================================== */

    calculatePathDistance(nodeIds) {

        const edges =
                this.pathToEdges(
                        nodeIds
                        );


        let total =
                0;


        for (
                const edge
                of
                edges
                ) {

            total +=
                    edge.distance;
        }


        return total;

    }

    /* ========================================================
     * PATH WEIGHT
     * ======================================================== */

    calculatePathWeight(nodeIds) {

        const edges =
                this.pathToEdges(
                        nodeIds
                        );


        let total =
                0;


        for (
                const edge
                of
                edges
                ) {

            total +=
                    edge.weight;
        }


        return total;

    }

    /* ========================================================
     * PATH TRAVEL TIME
     * ======================================================== */

    calculatePathTravelSeconds(nodeIds) {

        const edges =
                this.pathToEdges(
                        nodeIds
                        );


        let total =
                0;


        for (
                const edge
                of
                edges
                ) {

            total +=
                    edge.estimatedTravelSeconds
                    ??
                    0;
        }


        return total;

    }

    /* ========================================================
     * GRAPH INFORMATION
     * ======================================================== */

    getNodeCount() {

        return this.nodes.size;

    }

    getEdgeCount() {

        return this.edgeCount;

    }

    getSegmentCount() {

        return this.segmentCount;

    }

    isEmpty() {

        return this.nodes.size === 0;

    }

    getNodeIds() {

        return Array.from(
                this.nodes.keys()
                );

    }

    getNodes() {

        return Array.from(
                this.nodes.values()
                );

    }

    getEdges() {

        const edges =
                [];


        for (
                const neighbours
                of
                this.adjacency.values()
                ) {

            edges.push(
                    ...neighbours
                    );
        }


        return edges;

    }

    /* ========================================================
     * STATISTICS
     * ======================================================== */

    getStatistics() {

        let noOutgoing =
                0;


        let noIncoming =
                0;


        let maximumOutgoingDegree =
                0;


        let totalOutgoingDegree =
                0;


        for (
                const nodeId
                of
                this.nodes.keys()
                ) {

            const outgoingDegree =
                    this.getDegree(
                            nodeId
                            );
            const incomingDegree =
                    this.getIncomingDegree(
                            nodeId
                            );


            if (
                    outgoingDegree === 0
                    ) {

                noOutgoing++;

            }


            if (
                    incomingDegree === 0
                    ) {

                noIncoming++;

            }


            maximumOutgoingDegree =
                    Math.max(
                            maximumOutgoingDegree,
                            outgoingDegree
                            );


            totalOutgoingDegree +=
                    outgoingDegree;

        }


        const averageDegree =
                this.nodes.size > 0
                ? (
                        totalOutgoingDegree
                        /
                    this.nodes.size
                        )
                : 0;


        return {

            ...this.statistics,

            graphNodes:
                    this.nodes.size,

            graphEdges:
                    this.edgeCount,

            graphSegments:
                    this.segmentCount,

            ways:
                    this.ways.size,

            noOutgoing,

            noIncoming,

            deadEnds:
                    noOutgoing,

            maximumDegree:
                    maximumOutgoingDegree,

            maximumOutgoingDegree,

            averageDegree,

            averageDegreeFormatted:
                    averageDegree.toFixed(2),

            spatialCells:
                    this.spatialIndex.size,

            routingProfile:
                    this.routingProfile,

            totalDirectedDistance:
                    this.statistics
                    .totalDirectedDistance,

            totalEstimatedTravelSeconds:
                    this.statistics
                    .totalEstimatedTravelSeconds

        };

    }

    /* ========================================================
     * VALIDATE NETWORK
     * ======================================================== */

    #validateNetwork(network) {

        if (
                !network
                ||
                typeof network
                !==
                "object"
                ) {

            throw new TypeError(
                    "RoadGraph requires road-network data."
                    );

        }


        if (
                !(network.nodes instanceof Map)
                ) {

            throw new TypeError(
                    "Road network nodes must be a Map."
                    );

        }


        if (
                !Array.isArray(
                        network.ways
                        )
                ) {

            throw new TypeError(
                    "Road network ways must be an array."
                    );

        }


        if (
                network.nodes.size === 0
                ) {

            throw new Error(
                    "Road network contains no nodes."
                    );

        }


        if (
                network.ways.length === 0
                ) {

            throw new Error(
                    "Road network contains no ways."
                    );

        }

    }

    /* ========================================================
     * EMPTY STATISTICS
     * ======================================================== */

    #createEmptyStatistics() {

        return {

            sourceNodes:
                    0,

            sourceWays:
                    0,

            sourceSegments:
                    0,

            graphNodes:
                    0,

            graphEdges:
                    0,

            graphSegments:
                    0,

            skippedWays:
                    0,

            skippedSegments:
                    0,

            duplicateEdges:
                    0,

            oneWaySegments:
                    0,

            twoWaySegments:
                    0,

            totalDirectedDistance:
                    0,

            totalEstimatedTravelSeconds:
                    0,

            buildMilliseconds:
                    0

        };

    }

    /* ========================================================
     * CLEAR
     * ======================================================== */

    clear() {

        this.nodes.clear();

        this.adjacency.clear();

        this.incoming.clear();

        this.ways.clear();

        this.edgeKeys.clear();

        this.spatialIndex.clear();


        this.edgeCount =
                0;


        this.segmentCount =
                0;


        this.bounds =
                null;


        this.source =
                null;


        this.statistics =
                this.#createEmptyStatistics();

    }

}


/* ============================================================
 * GLOBAL EXPORT
 * ============================================================ */

window.RoadGraph =
        RoadGraph;