import { SorobanRpc, Contract, TransactionBuilder, Networks, BASE_FEE, xdr } from 'stellar-sdk';
import { config } from './config';

const SOROBAN_RPC_URLS = {
    mainnet: 'https://soroban-mainnet.stellar.org',
    testnet: 'https://soroban-testnet.stellar.org',
} as const;

function getSorobanRpcUrl(): string {
    return (
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
        SOROBAN_RPC_URLS[config.stellar.network]
    );
}

function getNetworkPassphrase(): string {
    return config.stellar.network === 'mainnet'
        ? Networks.PUBLIC
        : Networks.TESTNET;
}

/**
 * Creates a Soroban RPC server instance for the configured network.
 */
export function createSorobanClient(): SorobanRpc.Server {
    return new SorobanRpc.Server(getSorobanRpcUrl(), { allowHttp: false });
}

export const sorobanClient = createSorobanClient();

/**
 * Simulates a contract invocation without submitting to the network.
 *
 * @param contractId - The contract address (C...)
 * @param method - The contract method name
 * @param args - XDR-encoded method arguments
 * @param sourcePublicKey - The source account public key
 */
export async function simulateContractCall(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey: string
): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    const account = await sorobanClient.getAccount(sourcePublicKey);
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: getNetworkPassphrase(),
    })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

    return sorobanClient.simulateTransaction(tx);
}

/**
 * Prepares and submits a contract invocation transaction.
 * Caller is responsible for signing the prepared transaction before submission.
 *
 * @param contractId - The contract address (C...)
 * @param method - The contract method name
 * @param args - XDR-encoded method arguments
 * @param sourcePublicKey - The source account public key
 * @returns The prepared (unsigned) transaction ready for signing
 */
export async function prepareContractCall(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey: string
): Promise<ReturnType<typeof TransactionBuilder.prototype.build>> {
    const account = await sorobanClient.getAccount(sourcePublicKey);
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: getNetworkPassphrase(),
    })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

    return sorobanClient.prepareTransaction(tx);
}

/**
 * Sends a signed transaction to the Soroban RPC and polls for the result.
 *
 * @param signedTxXdr - The signed transaction in XDR format
 */
export async function sendSorobanTransaction(
    signedTxXdr: string
): Promise<SorobanRpc.Api.GetTransactionResponse> {
    const tx = TransactionBuilder.fromXDR(signedTxXdr, getNetworkPassphrase());
    const sendResult = await sorobanClient.sendTransaction(tx);

    if (sendResult.status === 'ERROR') {
        throw new Error(`Transaction submission failed: ${sendResult.errorResult?.toXDR('base64')}`);
    }

    // Poll for transaction result
    let getResult = await sorobanClient.getTransaction(sendResult.hash);
    const deadline = Date.now() + 30_000;

    while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
        if (Date.now() > deadline) {
            throw new Error(`Transaction ${sendResult.hash} not found after 30s`);
        }
        await new Promise((r) => setTimeout(r, 1000));
        getResult = await sorobanClient.getTransaction(sendResult.hash);
    }

    return getResult;
}
