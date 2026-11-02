"use strict";

/* ============================================================
 * JENGA-CODE ROUTE EXPLORER
 * utils.js
 *
 * Shared utility functions used throughout the map application.
 *
 * Responsibilities:
 *
 *   - Geographic distance calculations
 *   - Coordinate validation
 *   - Coordinate conversion
 *   - Distance formatting
 *   - Duration formatting
 *   - Numeric helpers
 *   - GeoJSON creation
 *   - Performance timing
 *   - General-purpose application helpers
 *
 * No MapLibre-specific code should live in this file.
 * ============================================================ */


/* ============================================================
 * MAP UTILS
 * ============================================================ */

const MapUtils = (() => {

    /* ------------------------------------------------------------
     * CONSTANTS
     * ------------------------------------------------------------ */

    const EARTH_RADIUS_METRES = 6371008.8;

    const METRES_PER_KILOMETRE = 1000;

    const METRES_PER_MILE = 1609.344;

    const DEFAULT_COORDINATE_PRECISION = 6;


    /* ============================================================
     * NUMBER UTILITIES
     * ============================================================ */


    /**
     * Converts degrees to radians.
     *
     * @param {number} degrees
     * @returns {number}
     */
    function degreesToRadians(degrees) {

        return degrees * Math.PI / 180;

    }


    /**
     * Converts radians to degrees.
     *
     * @param {number} radians
     * @returns {number}
     */
    function radiansToDegrees(radians) {

        return radians * 180 / Math.PI;

    }


    /**
     * Restricts a number to a supplied range.
     *
     * @param {number} value
     * @param {number} minimum
     * @param {number} maximum
     * @returns {number}
     */
    function clamp(
        value,
        minimum,
        maximum
    ) {

        return Math.min(
            maximum,
            Math.max(
                minimum,
                value
            )
        );

    }


    /**
     * Returns true when the supplied value is a finite number.
     *
     * @param {*} value
     * @returns {boolean}
     */
    function isFiniteNumber(value) {

        return (
            typeof value === "number"
            &&
            Number.isFinite(value)
        );

    }


    /**
     * Rounds a number to a requested number of decimal places.
     *
     * @param {number} value
     * @param {number} decimals
     * @returns {number}
     */
    function round(
        value,
        decimals = 2
    ) {

        if (!isFiniteNumber(value)) {

            return 0;

        }

        const factor = Math.pow(
            10,
            decimals
        );

        return Math.round(
            value * factor
        ) / factor;

    }


    /* ============================================================
     * COORDINATE VALIDATION
     * ============================================================ */


    /**
     * Checks whether a latitude is valid.
     *
     * Valid latitude:
     *
     *      -90 <= latitude <= 90
     *
     * @param {number} latitude
     * @returns {boolean}
     */
    function isValidLatitude(latitude) {

        return (
            isFiniteNumber(latitude)
            &&
            latitude >= -90
            &&
            latitude <= 90
        );

    }


    /**
     * Checks whether a longitude is valid.
     *
     * Valid longitude:
     *
     *      -180 <= longitude <= 180
     *
     * @param {number} longitude
     * @returns {boolean}
     */
    function isValidLongitude(longitude) {

        return (
            isFiniteNumber(longitude)
            &&
            longitude >= -180
            &&
            longitude <= 180
        );

    }


    /**
     * Checks whether a coordinate pair is valid.
     *
     * The application uses GeoJSON / MapLibre ordering:
     *
     *      [longitude, latitude]
     *
     * NOT:
     *
     *      [latitude, longitude]
     *
     * @param {Array<number>} coordinate
     * @returns {boolean}
     */
    function isValidCoordinate(coordinate) {

        if (!Array.isArray(coordinate)) {

            return false;

        }

        if (coordinate.length < 2) {

            return false;

        }

        const longitude = coordinate[0];
        const latitude = coordinate[1];

        return (
            isValidLongitude(longitude)
            &&
            isValidLatitude(latitude)
        );

    }


    /**
     * Throws an error if a coordinate is invalid.
     *
     * Useful for catching programming errors early.
     *
     * @param {Array<number>} coordinate
     * @param {string} name
     */
    function assertCoordinate(
        coordinate,
        name = "coordinate"
    ) {

        if (!isValidCoordinate(coordinate)) {

            throw new Error(
                `${name} must be [longitude, latitude].`
            );

        }

    }


    /* ============================================================
     * COORDINATE HELPERS
     * ============================================================ */


    /**
     * Creates a clean coordinate array.
     *
     * @param {number} longitude
     * @param {number} latitude
     * @returns {Array<number>}
     */
    function createCoordinate(
        longitude,
        latitude
    ) {

        const coordinate = [
            Number(longitude),
            Number(latitude)
        ];

        assertCoordinate(
            coordinate,
            "coordinate"
        );

        return coordinate;

    }


    /**
     * Copies a coordinate.
     *
     * This prevents accidental mutation of the original array.
     *
     * @param {Array<number>} coordinate
     * @returns {Array<number>}
     */
    function copyCoordinate(coordinate) {

        assertCoordinate(coordinate);

        return [
            coordinate[0],
            coordinate[1]
        ];

    }


    /**
     * Rounds a coordinate for display or serialisation.
     *
     * @param {Array<number>} coordinate
     * @param {number} precision
     * @returns {Array<number>}
     */
    function roundCoordinate(
        coordinate,
        precision = DEFAULT_COORDINATE_PRECISION
    ) {

        assertCoordinate(coordinate);

        return [
            round(
                coordinate[0],
                precision
            ),
            round(
                coordinate[1],
                precision
            )
        ];

    }


    /**
     * Compares two coordinates.
     *
     * The tolerance prevents tiny floating-point differences from
     * causing otherwise identical coordinates to compare unequal.
     *
     * @param {Array<number>} a
     * @param {Array<number>} b
     * @param {number} tolerance
     * @returns {boolean}
     */
    function coordinatesEqual(
        a,
        b,
        tolerance = 1e-9
    ) {

        if (
            !isValidCoordinate(a)
            ||
            !isValidCoordinate(b)
        ) {

            return false;

        }

        return (
            Math.abs(a[0] - b[0]) <= tolerance
            &&
            Math.abs(a[1] - b[1]) <= tolerance
        );

    }


    /**
     * Converts a coordinate into a stable string key.
     *
     * Useful when coordinates need to be placed into Maps or Sets.
     *
     * Example:
     *
     *      [-1.549077, 53.800755]
     *
     * becomes:
     *
     *      "-1.549077,53.800755"
     *
     * @param {Array<number>} coordinate
     * @param {number} precision
     * @returns {string}
     */
    function coordinateKey(
        coordinate,
        precision = DEFAULT_COORDINATE_PRECISION
    ) {

        assertCoordinate(coordinate);

        return (
            coordinate[0].toFixed(precision)
            +
            ","
            +
            coordinate[1].toFixed(precision)
        );

    }


    /* ============================================================
     * HAVERSINE DISTANCE
     * ============================================================ */


    /**
     * Calculates the great-circle distance between two coordinates.
     *
     * Uses the Haversine formula.
     *
     * Coordinates MUST use:
     *
     *      [longitude, latitude]
     *
     * Result is returned in metres.
     *
     * This function will later be useful for:
     *
     *   - A* heuristic h(n)
     *   - Graph edge distances
     *   - Route length calculations
     *   - Finding nearby graph nodes
     *
     * @param {Array<number>} from
     * @param {Array<number>} to
     * @returns {number}
     */
    function haversineDistance(
        from,
        to
    ) {

        assertCoordinate(
            from,
            "from"
        );

        assertCoordinate(
            to,
            "to"
        );


        const longitude1 = degreesToRadians(
            from[0]
        );

        const latitude1 = degreesToRadians(
            from[1]
        );

        const longitude2 = degreesToRadians(
            to[0]
        );

        const latitude2 = degreesToRadians(
            to[1]
        );


        const deltaLatitude =
            latitude2 - latitude1;

        const deltaLongitude =
            longitude2 - longitude1;


        const sinLatitude =
            Math.sin(
                deltaLatitude / 2
            );

        const sinLongitude =
            Math.sin(
                deltaLongitude / 2
            );


        const haversine =
            sinLatitude * sinLatitude
            +
            Math.cos(latitude1)
            *
            Math.cos(latitude2)
            *
            sinLongitude
            *
            sinLongitude;


        /*
         * Floating-point calculations can theoretically push
         * the value microscopically outside the range [0, 1].
         */

        const safeHaversine = clamp(
            haversine,
            0,
            1
        );


        const angularDistance =
            2
            *
            Math.atan2(
                Math.sqrt(safeHaversine),
                Math.sqrt(1 - safeHaversine)
            );


        return (
            EARTH_RADIUS_METRES
            *
            angularDistance
        );

    }


    /**
     * Alias used by the graph/pathfinding code.
     *
     * @param {Array<number>} from
     * @param {Array<number>} to
     * @returns {number}
     */
    function straightLineDistance(
        from,
        to
    ) {

        return haversineDistance(
            from,
            to
        );

    }


    /* ============================================================
     * DISTANCE CONVERSION
     * ============================================================ */


    /**
     * Converts metres to kilometres.
     *
     * @param {number} metres
     * @returns {number}
     */
    function metresToKilometres(metres) {

        return metres / METRES_PER_KILOMETRE;

    }


    /**
     * Converts kilometres to metres.
     *
     * @param {number} kilometres
     * @returns {number}
     */
    function kilometresToMetres(kilometres) {

        return kilometres * METRES_PER_KILOMETRE;

    }


    /**
     * Converts metres to miles.
     *
     * @param {number} metres
     * @returns {number}
     */
    function metresToMiles(metres) {

        return metres / METRES_PER_MILE;

    }


    /* ============================================================
     * DISTANCE FORMATTING
     * ============================================================ */


    /**
     * Produces a human-readable metric distance.
     *
     * Examples:
     *
     *      235       -> "235 m"
     *      1534      -> "1.53 km"
     *      18250     -> "18.3 km"
     *
     * @param {number} metres
     * @returns {string}
     */
    function formatDistance(metres) {

        if (
            !isFiniteNumber(metres)
            ||
            metres < 0
        ) {

            return "—";

        }


        if (metres < 1000) {

            return (
                Math.round(metres)
                +
                " m"
            );

        }


        const kilometres =
            metresToKilometres(metres);


        if (kilometres < 10) {

            return (
                kilometres.toFixed(2)
                +
                " km"
            );

        }


        if (kilometres < 100) {

            return (
                kilometres.toFixed(1)
                +
                " km"
            );

        }


        return (
            Math.round(kilometres)
            +
            " km"
        );

    }


    /**
     * Formats metres as miles.
     *
     * @param {number} metres
     * @returns {string}
     */
    function formatMiles(metres) {

        if (
            !isFiniteNumber(metres)
            ||
            metres < 0
        ) {

            return "—";

        }

        const miles =
            metresToMiles(metres);

        return (
            miles.toFixed(
                miles < 10 ? 2 : 1
            )
            +
            " mi"
        );

    }


    /* ============================================================
     * TIME FORMATTING
     * ============================================================ */


    /**
     * Formats an algorithm execution time.
     *
     * @param {number} milliseconds
     * @returns {string}
     */
    function formatMilliseconds(milliseconds) {

        if (
            !isFiniteNumber(milliseconds)
            ||
            milliseconds < 0
        ) {

            return "—";

        }


        if (milliseconds < 1) {

            return (
                milliseconds.toFixed(3)
                +
                " ms"
            );

        }


        if (milliseconds < 1000) {

            return (
                milliseconds.toFixed(2)
                +
                " ms"
            );

        }


        return (
            (milliseconds / 1000).toFixed(2)
            +
            " s"
        );

    }


    /**
     * Formats a duration supplied in seconds.
     *
     * Useful later if estimated journey time is added.
     *
     * @param {number} seconds
     * @returns {string}
     */
    function formatDuration(seconds) {

        if (
            !isFiniteNumber(seconds)
            ||
            seconds < 0
        ) {

            return "—";

        }


        const roundedSeconds =
            Math.round(seconds);


        if (roundedSeconds < 60) {

            return (
                roundedSeconds
                +
                " sec"
            );

        }


        const minutes =
            Math.floor(
                roundedSeconds / 60
            );

        const remainingSeconds =
            roundedSeconds % 60;


        if (minutes < 60) {

            if (remainingSeconds === 0) {

                return (
                    minutes
                    +
                    " min"
                );

            }

            return (
                minutes
                +
                " min "
                +
                remainingSeconds
                +
                " sec"
            );

        }


        const hours =
            Math.floor(
                minutes / 60
            );

        const remainingMinutes =
            minutes % 60;


        if (remainingMinutes === 0) {

            return (
                hours
                +
                " hr"
            );

        }


        return (
            hours
            +
            " hr "
            +
            remainingMinutes
            +
            " min"
        );

    }


    /* ============================================================
     * PERFORMANCE TIMER
     * ============================================================ */


    /**
     * Returns a high-resolution timestamp where available.
     *
     * performance.now() is preferable for measuring A* execution
     * because it has better resolution than Date.now().
     *
     * @returns {number}
     */
    function now() {

        if (
            typeof performance !== "undefined"
            &&
            typeof performance.now === "function"
        ) {

            return performance.now();

        }

        return Date.now();

    }


    /**
     * Creates a simple timer.
     *
     * Example:
     *
     *      const timer = MapUtils.createTimer();
     *
     *      runAlgorithm();
     *
     *      console.log(timer.elapsed());
     *
     * @returns {{elapsed: function(): number}}
     */
    function createTimer() {

        const started =
            now();

        return {

            elapsed() {

                return (
                    now()
                    -
                    started
                );

            }

        };

    }


    /* ============================================================
     * GEOJSON HELPERS
     * ============================================================ */


    /**
     * Creates an empty GeoJSON FeatureCollection.
     *
     * @returns {Object}
     */
    function emptyFeatureCollection() {

        return {
            type: "FeatureCollection",
            features: []
        };

    }


    /**
     * Creates a GeoJSON Point feature.
     *
     * @param {Array<number>} coordinate
     * @param {Object} properties
     * @returns {Object}
     */
    function pointFeature(
        coordinate,
        properties = {}
    ) {

        assertCoordinate(coordinate);

        return {

            type: "Feature",

            properties: {
                ...properties
            },

            geometry: {

                type: "Point",

                coordinates:
                    copyCoordinate(coordinate)

            }

        };

    }


    /**
     * Creates a GeoJSON LineString.
     *
     * This will later be used to draw routes and explored roads.
     *
     * @param {Array<Array<number>>} coordinates
     * @param {Object} properties
     * @returns {Object}
     */
    function lineStringFeature(
        coordinates,
        properties = {}
    ) {

        if (
            !Array.isArray(coordinates)
            ||
            coordinates.length < 2
        ) {

            throw new Error(
                "LineString requires at least two coordinates."
            );

        }


        const cleanCoordinates =
            coordinates.map(
                coordinate => {

                    assertCoordinate(
                        coordinate
                    );

                    return copyCoordinate(
                        coordinate
                    );

                }
            );


        return {

            type: "Feature",

            properties: {
                ...properties
            },

            geometry: {

                type: "LineString",

                coordinates:
                    cleanCoordinates

            }

        };

    }


    /**
     * Creates a GeoJSON FeatureCollection.
     *
     * @param {Array<Object>} features
     * @returns {Object}
     */
    function featureCollection(features = []) {

        if (!Array.isArray(features)) {

            throw new Error(
                "features must be an array."
            );

        }

        return {

            type: "FeatureCollection",

            features: [
                ...features
            ]

        };

    }


    /* ============================================================
     * PATH UTILITIES
     * ============================================================ */


    /**
     * Calculates the total geographical length of a path.
     *
     * The path must contain coordinates:
     *
     *      [
     *          [longitude, latitude],
     *          [longitude, latitude],
     *          ...
     *      ]
     *
     * @param {Array<Array<number>>} coordinates
     * @returns {number}
     */
    function calculatePathDistance(coordinates) {

        if (
            !Array.isArray(coordinates)
            ||
            coordinates.length < 2
        ) {

            return 0;

        }


        let total = 0;


        for (
            let index = 1;
            index < coordinates.length;
            index++
        ) {

            total += haversineDistance(
                coordinates[index - 1],
                coordinates[index]
            );

        }


        return total;

    }


    /* ============================================================
     * INTERPOLATION
     * ============================================================ */


    /**
     * Performs linear interpolation.
     *
     * @param {number} start
     * @param {number} end
     * @param {number} amount
     * @returns {number}
     */
    function lerp(
        start,
        end,
        amount
    ) {

        const t =
            clamp(
                amount,
                0,
                1
            );

        return (
            start
            +
            (end - start)
            *
            t
        );

    }


    /**
     * Interpolates between two geographical coordinates.
     *
     * This is simple linear coordinate interpolation rather than
     * great-circle interpolation. It is intended for short visual
     * animations on the map.
     *
     * @param {Array<number>} from
     * @param {Array<number>} to
     * @param {number} amount
     * @returns {Array<number>}
     */
    function interpolateCoordinate(
        from,
        to,
        amount
    ) {

        assertCoordinate(from);
        assertCoordinate(to);

        return [

            lerp(
                from[0],
                to[0],
                amount
            ),

            lerp(
                from[1],
                to[1],
                amount
            )

        ];

    }


    /* ============================================================
     * ASYNC HELPERS
     * ============================================================ */


    /**
     * Waits for the requested number of milliseconds.
     *
     * This will be useful when visualiser.js animates A* one
     * iteration at a time.
     *
     * @param {number} milliseconds
     * @returns {Promise<void>}
     */
    function sleep(milliseconds) {

        const duration =
            Math.max(
                0,
                Number(milliseconds) || 0
            );

        return new Promise(
            resolve => {

                window.setTimeout(
                    resolve,
                    duration
                );

            }
        );

    }


    /* ============================================================
     * IDENTIFIER HELPERS
     * ============================================================ */


    /**
     * Generates a small unique identifier.
     *
     * Useful for temporary map features.
     *
     * @param {string} prefix
     * @returns {string}
     */
    function uniqueId(prefix = "id") {

        const timestamp =
            Date.now().toString(36);

        const random =
            Math.random()
                .toString(36)
                .slice(2, 9);

        return (
            prefix
            +
            "-"
            +
            timestamp
            +
            "-"
            +
            random
        );

    }


    /* ============================================================
     * PUBLIC API
     * ============================================================ */

    return {

        /* Constants */

        EARTH_RADIUS_METRES,
        METRES_PER_KILOMETRE,
        METRES_PER_MILE,


        /* Numbers */

        degreesToRadians,
        radiansToDegrees,
        clamp,
        round,
        isFiniteNumber,


        /* Coordinates */

        isValidLatitude,
        isValidLongitude,
        isValidCoordinate,
        assertCoordinate,

        createCoordinate,
        copyCoordinate,
        roundCoordinate,
        coordinatesEqual,
        coordinateKey,


        /* Distance */

        haversineDistance,
        straightLineDistance,

        metresToKilometres,
        kilometresToMetres,
        metresToMiles,

        formatDistance,
        formatMiles,


        /* Time */

        formatMilliseconds,
        formatDuration,
        now,
        createTimer,


        /* GeoJSON */

        emptyFeatureCollection,
        pointFeature,
        lineStringFeature,
        featureCollection,


        /* Paths */

        calculatePathDistance,


        /* Interpolation */

        lerp,
        interpolateCoordinate,


        /* Async */

        sleep,


        /* IDs */

        uniqueId

    };

})();


/* ============================================================
 * GLOBAL EXPORT
 *
 * Other files can access:
 *
 *      MapUtils.haversineDistance(...)
 *      MapUtils.formatDistance(...)
 *      MapUtils.pointFeature(...)
 *
 * ============================================================ */

window.MapUtils = MapUtils;