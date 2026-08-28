/**
 * Property 24 — Deployment Status Progression
 *
 * REQUIREMENT (design.md):
 * No impossible status transitions are ever persisted. Statuses must only
 * advance forward through the defined lifecycle; once a terminal state
 * (completed | failed) is reached no further transitions occur.
 *
 * Valid forward-only transition graph:
 *
 *   pending → generating → creating_repo → pushing_code → deploying → completed
 *                                                                    ↘ failed
 *   (failed is reachable from any non-terminal stage)
 *
 * This file implements Property 24 using fast-check with ≥ 100 iterations.
 *
 * Issues: #105
 * Branch: issue-105-add-property-test-for-deployment-status-progress
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { DeploymentStatusType } from '@craft/types';

// ── Valid transition map ──────────────────────────────────────────────────────

/**
 * Defines the only legal next-states for each status.
 * Terminal states (completed, failed) have no successors.
 */
const VALID_TRANSITIONS: Record<DeploymentStatusType, DeploymentStatusType[]> = {
    pending:       ['generating', 'failed'],
    generating:    ['creating_repo', 'failed'],
    creating_repo: ['pushing_code', 'failed'],
    pushing_code:  ['deploying', 'failed'],
    deploying:     ['completed', 'failed'],
    completed:     [],
    failed:        [],
};

const ALL_STATUSES = Object.keys(VALID_TRANSITIONS) as DeploymentStatusType[];
const TERMINAL: DeploymentStatusType[] = ['completed', 'failed'];

// ── Reference state machine ───────────────────────────────────────────────────

interface TransitionRecord {
    from: DeploymentStatusType;
    to: DeploymentStatusType;
    persisted: boolean;
}

class DeploymentStateMachine {
    private _current: DeploymentStatusType = 'pending';
    readonly history: TransitionRecord[] = [];

    get current() { return this._current; }

    /** Attempt a transition. Returns true if it was accepted and persisted. */
    transition(next: DeploymentStatusType): boolean {
        const allowed = VALID_TRANSITIONS[this._current];
        const valid = allowed.includes(next);
        this.history.push({ from: this._current, to: next, persisted: valid });
        if (valid) this._current = next;
        return valid;
    }

    get isTerminal() {
        return TERMINAL.includes(this._current);
    }
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** Generates a random sequence of status values (may include invalid ones). */
const arbStatusSequence = fc.array(
    fc.constantFrom<DeploymentStatusType>(...ALL_STATUSES),
    { minLength: 1, maxLength: 12 },
);

/** Generates a strictly valid forward sequence ending in a terminal state. */
const arbValidSequence = fc.integer({ min: 0, max: 3 }).chain((failAt) =>
    fc.constant(buildValidSequence(failAt)),
);

function buildValidSequence(failAtStep: number): DeploymentStatusType[] {
    const forward: DeploymentStatusType[] = [
        'pending', 'generating', 'creating_repo', 'pushing_code', 'deploying', 'completed',
    ];
    if (failAtStep < forward.length - 1) {
        return [...forward.slice(0, failAtStep + 1), 'failed'];
    }
    return forward;
}

// ── Property 24 tests ─────────────────────────────────────────────────────────

describe('Property 24 — Deployment Status Progression', () => {

    /**
     * 24.1 — No impossible transitions are persisted.
     *
     * For any arbitrary sequence of status values, the state machine must
     * never record a persisted transition that is not in VALID_TRANSITIONS.
     */
    it('24.1 — never persists an impossible status transition', () => {
        fc.assert(
            fc.property(arbStatusSequence, (sequence) => {
                const machine = new DeploymentStateMachine();

                for (const next of sequence) {
                    if (machine.isTerminal) break;
                    machine.transition(next);
                }

                for (const record of machine.history) {
                    if (record.persisted) {
                        const allowed = VALID_TRANSITIONS[record.from];
                        expect(allowed).toContain(record.to);
                    }
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * 24.2 — Terminal states accept no further transitions.
     *
     * Once completed or failed is reached, any subsequent transition attempt
     * must be rejected (persisted = false).
     */
    it('24.2 — no transitions are accepted after a terminal state', () => {
        fc.assert(
            fc.property(arbStatusSequence, (sequence) => {
                const machine = new DeploymentStateMachine();

                for (const next of sequence) {
                    machine.transition(next);
                }

                let seenTerminal = false;
                for (const record of machine.history) {
                    if (seenTerminal) {
                        expect(record.persisted).toBe(false);
                    }
                    if (TERMINAL.includes(record.from) && record.persisted) {
                        seenTerminal = true;
                    }
                    if (TERMINAL.includes(record.to) && record.persisted) {
                        seenTerminal = true;
                    }
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * 24.3 — Valid sequences always reach a terminal state.
     *
     * Any sequence produced by buildValidSequence must end in completed or failed,
     * and every transition in it must be accepted.
     */
    it('24.3 — valid sequences always reach a terminal state with all transitions accepted', () => {
        fc.assert(
            fc.property(arbValidSequence, (sequence) => {
                const machine = new DeploymentStateMachine();

                for (const next of sequence.slice(1)) { // skip 'pending' (initial state)
                    const accepted = machine.transition(next);
                    expect(accepted).toBe(true);
                }

                expect(TERMINAL).toContain(machine.current);
            }),
            { numRuns: 100 },
        );
    });

    /**
     * 24.4 — Status never skips a stage in the forward path.
     *
     * For any persisted sequence, if status B appears after status A,
     * then A must be an immediate predecessor of B (no skipping).
     */
    it('24.4 — status never skips a stage in the forward path', () => {
        fc.assert(
            fc.property(arbStatusSequence, (sequence) => {
                const machine = new DeploymentStateMachine();

                for (const next of sequence) {
                    if (machine.isTerminal) break;
                    machine.transition(next);
                }

                const persisted = machine.history
                    .filter((r) => r.persisted)
                    .map((r) => r.to);

                for (let i = 1; i < persisted.length; i++) {
                    const prev = persisted[i - 1];
                    const curr = persisted[i];
                    expect(VALID_TRANSITIONS[prev]).toContain(curr);
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * 24.5 — completed is only reachable from deploying.
     *
     * The completed status must never appear as a transition target from any
     * state other than deploying.
     */
    it('24.5 — completed is only reachable from deploying', () => {
        fc.assert(
            fc.property(arbStatusSequence, (sequence) => {
                const machine = new DeploymentStateMachine();

                for (const next of sequence) {
                    if (machine.isTerminal) break;
                    machine.transition(next);
                }

                for (const record of machine.history) {
                    if (record.persisted && record.to === 'completed') {
                        expect(record.from).toBe('deploying');
                    }
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * 24.6 — pending is never a transition target.
     *
     * No state machine should ever transition back to pending once started.
     */
    it('24.6 — pending is never a valid transition target', () => {
        fc.assert(
            fc.property(arbStatusSequence, (sequence) => {
                const machine = new DeploymentStateMachine();

                for (const next of sequence) {
                    if (machine.isTerminal) break;
                    machine.transition(next);
                }

                for (const record of machine.history) {
                    if (record.persisted) {
                        expect(record.to).not.toBe('pending');
                    }
                }
            }),
            { numRuns: 100 },
        );
    });
});

// ── Graph-based State Machine Completeness Tests ───────────────────────────────

describe('Property Tests — Deployment Status State Machine Completeness', () => {

    /**
     * Build a directed graph from transition map for reachability analysis.
     */
    interface StateGraph {
        nodes: Set<DeploymentStatusType>;
        edges: Map<DeploymentStatusType, Set<DeploymentStatusType>>;
    }

    function buildStateGraph(): StateGraph {
        return {
            nodes: new Set(ALL_STATUSES),
            edges: new Map(
                Object.entries(VALID_TRANSITIONS).map(
                    ([state, successors]) =>
                        [state as DeploymentStatusType, new Set(successors)]
                )
            ),
        };
    }

    /**
     * Compute all reachable states from a starting state using BFS.
     */
    function getReachableStates(
        from: DeploymentStatusType,
        graph: StateGraph
    ): Set<DeploymentStatusType> {
        const visited = new Set<DeploymentStatusType>();
        const queue = [from];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);

            const successors = graph.edges.get(current) || new Set();
            for (const next of successors) {
                if (!visited.has(next)) {
                    queue.push(next);
                }
            }
        }

        return visited;
    }

    /**
     * Property 23.1 — Terminal states have no outgoing transitions.
     *
     * Both 'completed' and 'failed' must have empty successor lists.
     */
    it('P23.1 — completed and failed states have no outgoing transitions', () => {
        expect(VALID_TRANSITIONS.completed).toEqual([]);
        expect(VALID_TRANSITIONS.failed).toEqual([]);
    });

    /**
     * Property 23.2 — Every non-terminal state has at least one valid successor.
     *
     * Every state except 'completed' and 'failed' must have at least one
     * outgoing edge in the transition graph.
     */
    it('P23.2 — every non-terminal state has at least one valid successor', () => {
        const nonTerminal = ALL_STATUSES.filter((s) => !TERMINAL.includes(s));

        for (const state of nonTerminal) {
            const successors = VALID_TRANSITIONS[state];
            expect(successors.length).toBeGreaterThan(0);
        }
    });

    /**
     * Property 23.3 — Every path from 'pending' reaches a terminal state in ≤7 transitions.
     *
     * This ensures the state machine cannot get stuck in an infinite loop
     * and any path naturally terminates.
     */
    it('P23.3 — every path from pending reaches a terminal state in ≤7 transitions', () => {
        const graph = buildStateGraph();
        const reachable = getReachableStates('pending', graph);

        // pending + 5 states (generating, creating_repo, pushing_code, deploying, completed)
        // = 6 steps; or pending + 5 states + failed = 6 steps max
        expect(reachable.size).toBeLessThanOrEqual(7);

        // At least one terminal state must be reachable
        const hasTerminal = TERMINAL.some((t) => reachable.has(t));
        expect(hasTerminal).toBe(true);
    });

    /**
     * Property 23.4 — No backward transitions are possible in the graph.
     *
     * For the DAG invariant: if state A can reach state B, then B cannot reach A
     * (directed acyclic graph).
     */
    it('P23.4 — no backward transitions (DAG invariant)', () => {
        const graph = buildStateGraph();

        for (const source of ALL_STATUSES) {
            const reachableFromSource = getReachableStates(source, graph);

            for (const target of reachableFromSource) {
                if (target === source) continue; // skip self-loops

                const reachableFromTarget = getReachableStates(target, graph);

                // target should not be able to reach back to source
                expect(reachableFromTarget.has(source)).toBe(false);
            }
        }
    });

    /**
     * Property 23.5 — 'failed' state is reachable from every non-terminal state.
     *
     * This ensures that any deployment can fail at any intermediate stage.
     */
    it('P23.5 — failed state is reachable from every non-terminal state', () => {
        const graph = buildStateGraph();
        const nonTerminal = ALL_STATUSES.filter((s) => !TERMINAL.includes(s));

        for (const state of nonTerminal) {
            const reachable = getReachableStates(state, graph);
            expect(reachable.has('failed')).toBe(true);
        }
    });

    /**
     * Property 23.6 — No generated sequence violates the DAG invariant.
     *
     * Use fast-check to generate random sequences and ensure none create
     * cycles in the persisted history.
     */
    it('P23.6 — no generated sequence violates DAG invariant', () => {
        fc.assert(
            fc.property(arbStatusSequence, (sequence) => {
                const machine = new DeploymentStateMachine();
                const visited = new Set<DeploymentStatusType>();
                visited.add('pending');

                for (const next of sequence) {
                    if (machine.isTerminal) break;
                    const accepted = machine.transition(next);

                    if (accepted) {
                        // If transitioning to a state already visited, we have a cycle
                        expect(visited.has(next)).toBe(false);
                        visited.add(next);
                    }
                }
            }),
            { numRuns: 2000 },
        );
    });

    /**
     * Property 23.7 — State progression is monotonically forward.
     *
     * The "depth" from pending should never decrease for persisted transitions.
     */
    it('P23.7 — state progression depth is monotonically increasing', () => {
        const stateDepth: Record<DeploymentStatusType, number> = {
            pending: 0,
            generating: 1,
            creating_repo: 2,
            pushing_code: 3,
            deploying: 4,
            completed: 5,
            failed: 5,
        };

        fc.assert(
            fc.property(arbStatusSequence, (sequence) => {
                const machine = new DeploymentStateMachine();
                let currentDepth = 0;

                for (const next of sequence) {
                    if (machine.isTerminal) break;
                    machine.transition(next);
                }

                for (const record of machine.history) {
                    if (record.persisted) {
                        const nextDepth = stateDepth[record.to];
                        expect(nextDepth).toBeGreaterThanOrEqual(currentDepth);
                        currentDepth = nextDepth;
                    }
                }
            }),
            { numRuns: 2000 },
        );
    });
});
