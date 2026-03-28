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
