import { describe, it, expect } from 'vitest';
import {
    VALID_STATE_TRANSITIONS,
    assertValidTransition,
    assertInvalidTransition,
    getInvalidTransitions,
    assertTerminalState,
    assertNonTerminalState,
    assertAllStatesReachable,
    assertNoCycles,
} from './mutation-testing.helpers';
import type { DeploymentStatusType } from '@craft/types';

const ALL_STATES: DeploymentStatusType[] = [
    'pending',
    'generating',
    'validating',
    'signing',
    'creating_repo',
    'pushing_code',
    'deploying',
    'verifying_contract',
    'completed',
    'failed',
];

describe('assertValidTransition', () => {
    it('does not throw for a valid transition', () => {
        expect(() => assertValidTransition('pending', 'generating')).not.toThrow();
    });

    it('does not throw for pending → failed', () => {
        expect(() => assertValidTransition('pending', 'failed')).not.toThrow();
    });

    it('throws for an invalid transition', () => {
        expect(() => assertValidTransition('completed', 'pending')).toThrow();
    });

    it('throws for a self-loop on terminal state', () => {
        expect(() => assertValidTransition('completed', 'completed')).toThrow();
    });

    it('throws when fromState has no allowed transitions (empty array)', () => {
        expect(() => assertValidTransition('failed', 'pending')).toThrow();
    });
});

describe('assertInvalidTransition', () => {
    it('does not throw for an invalid transition', () => {
        expect(() => assertInvalidTransition('completed', 'pending')).not.toThrow();
    });

    it('throws for a valid transition', () => {
        expect(() => assertInvalidTransition('pending', 'generating')).toThrow();
    });

    it('does not throw when both states are terminal', () => {
        expect(() => assertInvalidTransition('completed', 'failed')).not.toThrow();
    });
});

describe('getInvalidTransitions', () => {
    it('returns all states for a terminal state', () => {
        const invalid = getInvalidTransitions('completed');
        expect(invalid).toEqual(ALL_STATES);
    });

    it('excludes valid transitions from the result', () => {
        const invalid = getInvalidTransitions('pending');
        expect(invalid).not.toContain('generating');
        expect(invalid).not.toContain('failed');
        expect(invalid).toContain('validating');
        expect(invalid).toContain('completed');
    });

    it('returns empty array for a state that transitions to all others (boundary)', () => {
        // pending only transitions to generating and failed, so invalid should have 8 states
        const invalid = getInvalidTransitions('pending');
        expect(invalid).toHaveLength(8);
    });
});

describe('assertTerminalState', () => {
    it('does not throw for terminal state "completed"', () => {
        expect(() => assertTerminalState('completed')).not.toThrow();
    });

    it('does not throw for terminal state "failed"', () => {
        expect(() => assertTerminalState('failed')).not.toThrow();
    });

    it('throws for a non-terminal state', () => {
        expect(() => assertTerminalState('pending')).toThrow();
    });

    it('throws for deploying (has transitions)', () => {
        expect(() => assertTerminalState('deploying')).toThrow();
    });
});

describe('assertNonTerminalState', () => {
    it('does not throw for a non-terminal state', () => {
        expect(() => assertNonTerminalState('pending')).not.toThrow();
    });

    it('does not throw for deploying', () => {
        expect(() => assertNonTerminalState('deploying')).not.toThrow();
    });

    it('throws for terminal state "completed"', () => {
        expect(() => assertNonTerminalState('completed')).toThrow();
    });

    it('throws for terminal state "failed"', () => {
        expect(() => assertNonTerminalState('failed')).toThrow();
    });
});

describe('assertAllStatesReachable', () => {
    it('does not throw — all states reachable from pending', () => {
        expect(() => assertAllStatesReachable()).not.toThrow();
    });
});

describe('assertNoCycles', () => {
    it('does not throw — the deployment DAG has no cycles', () => {
        expect(() => assertNoCycles()).not.toThrow();
    });
});

describe('VALID_STATE_TRANSITIONS', () => {
    it('has exactly 10 states', () => {
        expect(Object.keys(VALID_STATE_TRANSITIONS)).toHaveLength(10);
    });

    it('every state in the map is a DeploymentStatusType', () => {
        for (const state of Object.keys(VALID_STATE_TRANSITIONS)) {
            expect(ALL_STATES).toContain(state);
        }
    });

    it('terminal states have empty transition arrays', () => {
        expect(VALID_STATE_TRANSITIONS.completed).toEqual([]);
        expect(VALID_STATE_TRANSITIONS.failed).toEqual([]);
    });

    it('pending transitions include generating and failed', () => {
        expect(VALID_STATE_TRANSITIONS.pending).toContain('generating');
        expect(VALID_STATE_TRANSITIONS.pending).toContain('failed');
    });
});
