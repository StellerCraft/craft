/**
 * Parity test: the frontend and backend contract-address validators must
 * accept and reject exactly the same addresses, with identical error codes.
 */
import { describe, it, expect } from 'vitest';
import { validateContractAddress as frontendValidate } from './contract-validation';
import { validateContractAddress as backendValidate } from '../../../../backend/src/lib/stellar/contract-validation';

const FIXTURES: Record<string, string> = {
    valid: 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR',
    validOther: 'CAAQQDYWDUSCWMRZIBDU4VK4MNVHC6D7Q2GZJG5CVGYLPPWFZTJ5U2RQ',
    empty: '',
    whitespaceOnly: '   ',
    leadingWhitespace: ' CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR',
    tooShort: 'CADQOBYHA4DQOBYHA4DQ',
    tooLong: 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KRA',
    wrongPrefix: 'GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI',
    lowercase: 'cadqobyha4dqobyha4dqobyha4dqobyha4dqobyha4dqobyha4dqp5kr',
    invalidCharset: 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5K1',
    badChecksum: 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KA',
    accountAddressAsContract: 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI',
    wrongVersionByte: 'CEDQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOKO4',
};

describe('contract-validation frontend/backend parity', () => {
    it.each(Object.entries(FIXTURES))('agrees on %s', (_name, address) => {
        expect(frontendValidate(address)).toEqual(backendValidate(address));
    });

    it('accepts the valid fixtures and rejects every other fixture in both copies', () => {
        for (const [name, address] of Object.entries(FIXTURES)) {
            const shouldPass = name.startsWith('valid');
            expect(frontendValidate(address).valid, `frontend ${name}`).toBe(shouldPass);
            expect(backendValidate(address).valid, `backend ${name}`).toBe(shouldPass);
        }
    });
});
