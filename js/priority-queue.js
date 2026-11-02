"use strict";

/* ============================================================
 * JENGA-CODE ROUTE EXPLORER
 * priority-queue.js
 *
 * Binary min-heap priority queue.
 *
 * Used by:
 *
 *   - A* Search
 *   - Dijkstra's Algorithm
 *
 * The item with the LOWEST numerical priority is always removed
 * first.
 *
 * Typical A* usage:
 *
 *      queue.enqueue(nodeId, fScore);
 *
 * where:
 *
 *      f(n) = g(n) + h(n)
 *
 * ============================================================ */


/* ============================================================
 * PRIORITY QUEUE
 * ============================================================ */

class PriorityQueue {

    /* ------------------------------------------------------------
     * CONSTRUCTOR
     * ------------------------------------------------------------ */

    constructor() {

        /*
         * Heap entries have the form:
         *
         * {
         *     value: ...,
         *     priority: number,
         *     sequence: number
         * }
         *
         * sequence provides deterministic behaviour when two
         * entries have exactly the same priority.
         */

        this.heap = [];

        this.sequence = 0;

    }


    /* ============================================================
     * BASIC INFORMATION
     * ============================================================ */


    /**
     * Number of entries currently stored.
     *
     * @returns {number}
     */
    get size() {

        return this.heap.length;

    }


    /**
     * Returns true when the queue contains no entries.
     *
     * @returns {boolean}
     */
    isEmpty() {

        return this.heap.length === 0;

    }


    /**
     * Removes every entry from the queue.
     */
    clear() {

        this.heap.length = 0;

        this.sequence = 0;

    }


    /* ============================================================
     * INSERT
     * ============================================================ */


    /**
     * Adds an item to the priority queue.
     *
     * Lower numerical priorities are removed first.
     *
     * Example:
     *
     *      queue.enqueue("node-12", 45.2);
     *
     * @param {*} value
     * @param {number} priority
     */
    enqueue(
        value,
        priority
    ) {

        this.#validatePriority(priority);


        const entry = {

            value,

            priority,

            sequence:
                this.sequence++

        };


        this.heap.push(entry);


        this.#bubbleUp(
            this.heap.length - 1
        );

    }


    /**
     * Alias for enqueue().
     *
     * This allows slightly more compact algorithm code:
     *
     *      openSet.push(node, fScore);
     *
     * @param {*} value
     * @param {number} priority
     */
    push(
        value,
        priority
    ) {

        this.enqueue(
            value,
            priority
        );

    }


    /* ============================================================
     * REMOVE MINIMUM
     * ============================================================ */


    /**
     * Removes and returns the entry with the lowest priority.
     *
     * Returned object:
     *
     * {
     *     value: ...,
     *     priority: ...
     * }
     *
     * Returns null when the queue is empty.
     *
     * @returns {{value: *, priority: number}|null}
     */
    dequeue() {

        if (this.isEmpty()) {

            return null;

        }


        const minimum =
            this.heap[0];


        /*
         * Remove the final heap entry.
         */

        const last =
            this.heap.pop();


        /*
         * If the heap still contains entries, move the final
         * element to the root and restore the heap property.
         */

        if (!this.isEmpty()) {

            this.heap[0] =
                last;

            this.#bubbleDown(0);

        }


        return {

            value:
                minimum.value,

            priority:
                minimum.priority

        };

    }


    /**
     * Alias for dequeue().
     *
     * @returns {{value: *, priority: number}|null}
     */
    pop() {

        return this.dequeue();

    }


    /* ============================================================
     * PEEK
     * ============================================================ */


    /**
     * Returns the lowest-priority entry without removing it.
     *
     * @returns {{value: *, priority: number}|null}
     */
    peek() {

        if (this.isEmpty()) {

            return null;

        }


        const minimum =
            this.heap[0];


        return {

            value:
                minimum.value,

            priority:
                minimum.priority

        };

    }


    /**
     * Returns only the value at the front of the queue.
     *
     * @returns {*|null}
     */
    peekValue() {

        const entry =
            this.peek();

        return (
            entry === null
                ? null
                : entry.value
        );

    }


    /**
     * Returns only the lowest priority currently stored.
     *
     * @returns {number|null}
     */
    peekPriority() {

        const entry =
            this.peek();

        return (
            entry === null
                ? null
                : entry.priority
        );

    }


    /* ============================================================
     * SEARCH
     * ============================================================ */


    /**
     * Returns true if the queue contains the supplied value.
     *
     * This is O(n).
     *
     * A* itself should generally use Sets or Maps for fast
     * membership checks rather than relying on this method.
     *
     * @param {*} value
     * @returns {boolean}
     */
    contains(value) {

        return this.heap.some(
            entry =>
                entry.value === value
        );

    }


    /**
     * Returns the priority associated with the first matching
     * value.
     *
     * Returns null if the value is not present.
     *
     * @param {*} value
     * @returns {number|null}
     */
    priorityOf(value) {

        const entry =
            this.heap.find(
                item =>
                    item.value === value
            );


        if (!entry) {

            return null;

        }


        return entry.priority;

    }


    /* ============================================================
     * REMOVE SPECIFIC VALUE
     * ============================================================ */


    /**
     * Removes the first entry whose value matches the supplied
     * value.
     *
     * This operation is O(n) because the heap must first be
     * searched.
     *
     * @param {*} value
     * @returns {boolean}
     */
    remove(value) {

        const index =
            this.heap.findIndex(
                entry =>
                    entry.value === value
            );


        if (index === -1) {

            return false;

        }


        this.#removeAt(index);

        return true;

    }


    /**
     * Removes every entry matching a value.
     *
     * Useful if duplicate queue entries have been inserted.
     *
     * @param {*} value
     * @returns {number}
     */
    removeAll(value) {

        let removed = 0;


        for (
            let index =
                this.heap.length - 1;

            index >= 0;

            index--
        ) {

            if (
                this.heap[index].value
                ===
                value
            ) {

                this.#removeAt(index);

                removed++;

            }

        }


        return removed;

    }


    /* ============================================================
     * PRIORITY UPDATE
     * ============================================================ */


    /**
     * Changes the priority of the first matching value.
     *
     * Returns false if the value does not exist.
     *
     * @param {*} value
     * @param {number} newPriority
     * @returns {boolean}
     */
    updatePriority(
        value,
        newPriority
    ) {

        this.#validatePriority(
            newPriority
        );


        const index =
            this.heap.findIndex(
                entry =>
                    entry.value === value
            );


        if (index === -1) {

            return false;

        }


        const oldPriority =
            this.heap[index].priority;


        this.heap[index].priority =
            newPriority;


        /*
         * Lower priority means the entry may need to move upward.
         *
         * Higher priority means it may need to move downward.
         */

        if (
            newPriority
            <
            oldPriority
        ) {

            this.#bubbleUp(index);

        }
        else if (
            newPriority
            >
            oldPriority
        ) {

            this.#bubbleDown(index);

        }


        return true;

    }


    /**
     * Inserts an item if it does not exist, otherwise updates its
     * priority.
     *
     * @param {*} value
     * @param {number} priority
     */
    set(
        value,
        priority
    ) {

        if (
            !this.updatePriority(
                value,
                priority
            )
        ) {

            this.enqueue(
                value,
                priority
            );

        }

    }


    /* ============================================================
     * ARRAY REPRESENTATION
     * ============================================================ */


    /**
     * Returns a copy of the queue contents ordered by priority.
     *
     * This is intended for debugging and visualisation.
     *
     * It does NOT modify the heap.
     *
     * @returns {Array<{value: *, priority: number}>}
     */
    toArray() {

        return this.heap
            .map(
                entry => ({
                    value:
                        entry.value,

                    priority:
                        entry.priority,

                    sequence:
                        entry.sequence
                })
            )
            .sort(
                (a, b) => {

                    if (
                        a.priority
                        !==
                        b.priority
                    ) {

                        return (
                            a.priority
                            -
                            b.priority
                        );

                    }

                    return (
                        a.sequence
                        -
                        b.sequence
                    );

                }
            )
            .map(
                entry => ({
                    value:
                        entry.value,

                    priority:
                        entry.priority
                })
            );

    }


    /* ============================================================
     * HEAP INTERNALS
     * ============================================================ */


    /**
     * Restores heap ordering by moving an entry upward.
     *
     * @param {number} index
     */
    #bubbleUp(index) {

        let currentIndex =
            index;


        while (
            currentIndex > 0
        ) {

            const parentIndex =
                this.#parentIndex(
                    currentIndex
                );


            if (
                !this.#comesBefore(
                    this.heap[currentIndex],
                    this.heap[parentIndex]
                )
            ) {

                break;

            }


            this.#swap(
                currentIndex,
                parentIndex
            );


            currentIndex =
                parentIndex;

        }

    }


    /**
     * Restores heap ordering by moving an entry downward.
     *
     * @param {number} index
     */
    #bubbleDown(index) {

        let currentIndex =
            index;


        while (true) {

            const leftIndex =
                this.#leftChildIndex(
                    currentIndex
                );

            const rightIndex =
                this.#rightChildIndex(
                    currentIndex
                );


            let smallestIndex =
                currentIndex;


            if (
                leftIndex
                <
                this.heap.length
                &&
                this.#comesBefore(
                    this.heap[leftIndex],
                    this.heap[smallestIndex]
                )
            ) {

                smallestIndex =
                    leftIndex;

            }


            if (
                rightIndex
                <
                this.heap.length
                &&
                this.#comesBefore(
                    this.heap[rightIndex],
                    this.heap[smallestIndex]
                )
            ) {

                smallestIndex =
                    rightIndex;

            }


            if (
                smallestIndex
                ===
                currentIndex
            ) {

                break;

            }


            this.#swap(
                currentIndex,
                smallestIndex
            );


            currentIndex =
                smallestIndex;

        }

    }


    /**
     * Determines whether entry A should appear before entry B.
     *
     * Priority is compared first.
     *
     * sequence is used as a tie breaker.
     *
     * @param {Object} a
     * @param {Object} b
     * @returns {boolean}
     */
    #comesBefore(
        a,
        b
    ) {

        if (
            a.priority
            <
            b.priority
        ) {

            return true;

        }


        if (
            a.priority
            >
            b.priority
        ) {

            return false;

        }


        return (
            a.sequence
            <
            b.sequence
        );

    }


    /**
     * Removes an entry at a particular heap index.
     *
     * @param {number} index
     */
    #removeAt(index) {

        const lastIndex =
            this.heap.length - 1;


        if (
            index < 0
            ||
            index > lastIndex
        ) {

            return;

        }


        /*
         * Removing the final item requires no heap repair.
         */

        if (
            index === lastIndex
        ) {

            this.heap.pop();

            return;

        }


        /*
         * Move the final element into the removed position.
         */

        const replacement =
            this.heap.pop();


        this.heap[index] =
            replacement;


        /*
         * The replacement may need to travel either upward or
         * downward.
         */

        const parentIndex =
            this.#parentIndex(index);


        if (
            index > 0
            &&
            this.#comesBefore(
                this.heap[index],
                this.heap[parentIndex]
            )
        ) {

            this.#bubbleUp(index);

        }
        else {

            this.#bubbleDown(index);

        }

    }


    /* ============================================================
     * INDEX CALCULATIONS
     * ============================================================ */


    /**
     * Returns the parent index.
     *
     * @param {number} index
     * @returns {number}
     */
    #parentIndex(index) {

        return Math.floor(
            (index - 1) / 2
        );

    }


    /**
     * Returns the left child index.
     *
     * @param {number} index
     * @returns {number}
     */
    #leftChildIndex(index) {

        return (
            index * 2
            +
            1
        );

    }


    /**
     * Returns the right child index.
     *
     * @param {number} index
     * @returns {number}
     */
    #rightChildIndex(index) {

        return (
            index * 2
            +
            2
        );

    }


    /**
     * Swaps two heap entries.
     *
     * @param {number} a
     * @param {number} b
     */
    #swap(
        a,
        b
    ) {

        const temporary =
            this.heap[a];


        this.heap[a] =
            this.heap[b];


        this.heap[b] =
            temporary;

    }


    /* ============================================================
     * VALIDATION
     * ============================================================ */


    /**
     * Ensures that a priority is a finite number.
     *
     * @param {number} priority
     */
    #validatePriority(priority) {

        if (
            typeof priority !== "number"
            ||
            !Number.isFinite(priority)
        ) {

            throw new TypeError(
                "Priority must be a finite number."
            );

        }

    }

}


/* ============================================================
 * GLOBAL EXPORT
 *
 * Later:
 *
 *      const openSet = new PriorityQueue();
 *
 *      openSet.enqueue("A", 10);
 *      openSet.enqueue("B", 4);
 *      openSet.enqueue("C", 7);
 *
 *      openSet.dequeue();
 *
 * returns:
 *
 *      {
 *          value: "B",
 *          priority: 4
 *      }
 *
 * ============================================================ */

window.PriorityQueue =
    PriorityQueue;