import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SOROBAN_RPC_URLS } from './config';

describe('Soroban RPC client', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe('createSorobanClient', () => {
        it('uses testnet URL by default', async () => {
            vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'testnet');
            vi.stubEnv('NEXT_PUBLIC_SOROBAN_RPC_URL', '');

            const MockServer = vi.fn();
            vi.doMock('stellar-sdk', async (importOriginal) => {
                const actual = await importOriginal<typeof import('stellar-sdk')>();
                return { ...actual, SorobanRpc: { ...actual.SorobanRpc, Server: MockServer } };
            });

            const { createSorobanClient } = await import('./soroban');
            createSorobanClient();

            expect(MockServer).toHaveBeenCalledWith(
                SOROBAN_RPC_URLS.testnet,
                expect.any(Object)
            );
        });

        it('uses mainnet URL when network is mainnet', async () => {
            vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'mainnet');
            vi.stubEnv('NEXT_PUBLIC_SOROBAN_RPC_URL', '');

            const MockServer = vi.fn();
            vi.doMock('stellar-sdk', async (importOriginal) => {
                const actual = await importOriginal<typeof import('stellar-sdk')>();
                return { ...actual, SorobanRpc: { ...actual.SorobanRpc, Server: MockServer } };
            });

            const { createSorobanClient } = await import('./soroban');
            createSorobanClient();

            expect(MockServer).toHaveBeenCalledWith(
                SOROBAN_RPC_URLS.mainnet,
                expect.any(Object)
            );
        });

        it('prefers NEXT_PUBLIC_SOROBAN_RPC_URL env override', async () => {
            vi.stubEnv('NEXT_PUBLIC_SOROBAN_RPC_URL', 'https://custom-rpc.example.com');

            const MockServer = vi.fn();
            vi.doMock('stellar-sdk', async (importOriginal) => {
                const actual = await importOriginal<typeof import('stellar-sdk')>();
                return { ...actual, SorobanRpc: { ...actual.SorobanRpc, Server: MockServer } };
            });

            const { createSorobanClient } = await import('./soroban');
            createSorobanClient();

            expect(MockServer).toHaveBeenCalledWith(
                'https://custom-rpc.example.com',
                expect.any(Object)
            );
        });
    });

    describe('simulateContractCall', () => {
        it('returns simulation response', async () => {
            const { Account, xdr } = await import('stellar-sdk');
            const TEST_PUBKEY = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
            const mockSimulateResult = { result: { retval: 'ok' } };
            const fakeAccount = new Account(TEST_PUBKEY, '1');
            const mockGetAccount = vi.fn().mockResolvedValue(fakeAccount);
            const mockSimulate = vi.fn().mockResolvedValue(mockSimulateResult);
            const MockServer = vi.fn().mockImplementation(() => ({
                getAccount: mockGetAccount,
                simulateTransaction: mockSimulate,
            }));

            vi.doMock('stellar-sdk', async (importOriginal) => {
                const actual = await importOriginal<typeof import('stellar-sdk')>();
                return { ...actual, SorobanRpc: { ...actual.SorobanRpc, Server: MockServer } };
            });

            const { simulateContractCall } = await import('./soroban');

            const result = await simulateContractCall(
                'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
                'transfer',
                [] as xdr.ScVal[],
                TEST_PUBKEY
            );

            expect(mockGetAccount).toHaveBeenCalled();
            expect(mockSimulate).toHaveBeenCalled();
            expect(result).toEqual(mockSimulateResult);
        });
    });

    describe('sendSorobanTransaction', () => {
        it('throws when sendTransaction returns ERROR status', async () => {
            const mockSend = vi.fn().mockResolvedValue({
                status: 'ERROR',
                errorResult: { toXDR: () => 'base64error' },
            });
            const MockServer = vi.fn().mockImplementation(() => ({
                sendTransaction: mockSend,
            }));

            vi.doMock('stellar-sdk', async (importOriginal) => {
                const actual = await importOriginal<typeof import('stellar-sdk')>();
                return {
                    ...actual,
                    SorobanRpc: { ...actual.SorobanRpc, Server: MockServer },
                    TransactionBuilder: {
                        ...actual.TransactionBuilder,
                        fromXDR: vi.fn().mockReturnValue({}),
                    },
                };
            });

            const { sendSorobanTransaction } = await import('./soroban');

            await expect(sendSorobanTransaction('xdr-payload')).rejects.toThrow(
                'Transaction submission failed'
            );
        });

        it('polls until transaction is found', async () => {
            const { SorobanRpc: ActualRpc } = await import('stellar-sdk');
            const mockSend = vi.fn().mockResolvedValue({ status: 'PENDING', hash: 'abc123' });
            const mockGetTx = vi
                .fn()
                .mockResolvedValueOnce({ status: ActualRpc.Api.GetTransactionStatus.NOT_FOUND })
                .mockResolvedValueOnce({ status: ActualRpc.Api.GetTransactionStatus.SUCCESS, returnValue: 'ok' });

            const MockServer = vi.fn().mockImplementation(() => ({
                sendTransaction: mockSend,
                getTransaction: mockGetTx,
            }));

            vi.doMock('stellar-sdk', async (importOriginal) => {
                const actual = await importOriginal<typeof import('stellar-sdk')>();
                return {
                    ...actual,
                    SorobanRpc: { ...actual.SorobanRpc, Server: MockServer },
                    TransactionBuilder: {
                        ...actual.TransactionBuilder,
                        fromXDR: vi.fn().mockReturnValue({}),
                    },
                };
            });

            const { sendSorobanTransaction } = await import('./soroban');
            const result = await sendSorobanTransaction('xdr-payload');

            expect(mockGetTx).toHaveBeenCalledTimes(2);
            expect(result).toMatchObject({ status: ActualRpc.Api.GetTransactionStatus.SUCCESS });
        });
    });

    describe('deriveContractAddress', () => {
        it('requires network passphrase parameter', async () => {
            const { Keypair, Networks } = await import('stellar-sdk');
            const { deriveContractAddress } = await import('./soroban');

            const deployer = Keypair.random().publicKey();
            const salt = '0000000000000000000000000000000000000000000000000000000000000001';
            const wasmHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

            const addr = deriveContractAddress(deployer, salt, wasmHash, Networks.PUBLIC);
            expect(typeof addr).toBe('string');
            expect(addr.startsWith('C')).toBe(true);
        });

        it('produces different addresses for testnet and mainnet with same params', async () => {
            const { Keypair, Networks } = await import('stellar-sdk');
            const { deriveContractAddress } = await import('./soroban');

            const deployer = Keypair.random().publicKey();
            const salt = '0000000000000000000000000000000000000000000000000000000000000001';
            const wasmHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

            const mainnetAddr = deriveContractAddress(deployer, salt, wasmHash, Networks.PUBLIC);
            const testnetAddr = deriveContractAddress(deployer, salt, wasmHash, Networks.TESTNET);

            expect(mainnetAddr).not.toBe(testnetAddr);
            expect(mainnetAddr.startsWith('C')).toBe(true);
            expect(testnetAddr.startsWith('C')).toBe(true);
        });
    });

    describe('verifyContractAddress', () => {
        it('verifies a contract address on the correct network', async () => {
            const { Keypair, Networks } = await import('stellar-sdk');
            const { deriveContractAddress, verifyContractAddress } = await import('./soroban');

            const deployer = Keypair.random().publicKey();
            const salt = '0000000000000000000000000000000000000000000000000000000000000002';
            const wasmHash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

            const derived = deriveContractAddress(deployer, salt, wasmHash, Networks.PUBLIC);
            const isValid = verifyContractAddress(deployer, salt, wasmHash, derived, Networks.PUBLIC);

            expect(isValid).toBe(true);
        });

        it('rejects a contract address verified against the wrong network', async () => {
            const { Keypair, Networks } = await import('stellar-sdk');
            const { deriveContractAddress, verifyContractAddress } = await import('./soroban');

            const deployer = Keypair.random().publicKey();
            const salt = '0000000000000000000000000000000000000000000000000000000000000003';
            const wasmHash = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

            const mainnetAddr = deriveContractAddress(deployer, salt, wasmHash, Networks.PUBLIC);
            const isValidOnTestnet = verifyContractAddress(deployer, salt, wasmHash, mainnetAddr, Networks.TESTNET);

            expect(isValidOnTestnet).toBe(false);
        });
    });
});
