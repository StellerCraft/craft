/**
 * Stellar SDK Error Handling Utilities
 *
 * Provides comprehensive error handling for Stellar operations including:
 * - Transaction failures and parsing
 * - Network timeouts and connection failures
 * - Account lookup errors
 * - Operation validation errors
 *
 * Maps low-level Stellar SDK errors to user-friendly messages and guidance.
 */

import type { ErrorTemplate, ErrorGuidance } from '@craft/types';

/**
 * Stellar error codes recognized by the error handler.
 * Maps to common issues encountered when interacting with Stellar.
 */
export type StellarErrorCode =
  | 'TRANSACTION_FAILED'
  | 'TRANSACTION_TIMEOUT'
  | 'ACCOUNT_NOT_FOUND'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_SEQUENCE_NUMBER'
  | 'NETWORK_ERROR'
  | 'CONNECTION_TIMEOUT'
  | 'INVALID_DESTINATION'
  | 'OPERATION_FAILED'
  | 'FEE_BUMP_FAILED'
  | 'MALFORMED_TRANSACTION'
  | 'ENDPOINT_UNREACHABLE'
  | 'RATE_LIMITED'
  | 'UNKNOWN_ERROR';

/**
 * Parsed Stellar error with code and user-friendly information.
 */
export interface ParsedStellarError {
  code: StellarErrorCode;
  title: string;
  message: string;
  retryable: boolean;
  details?: string;
  transactionHash?: string;
  resultCode?: string;
}

/**
 * Error guidance for remediating Stellar errors.
 */
export interface StellarErrorGuidance extends ErrorGuidance {
  template: ErrorTemplate;
  steps: string[];
  links: Array<{ label: string; url: string }>;
}

/**
 * Maps Stellar transaction result codes to user-friendly messages.
 * Based on Stellar transaction result codes defined in stellar-base.
 *
 * @see https://developers.stellar.org/docs/fundamentals-and-concepts/list-of-operations
 */
const TRANSACTION_RESULT_CODES: Record<string, { title: string; message: string; retryable: boolean }> = {
  'txBAD_AUTH': {
    title: 'Authentication Failed',
    message: 'The transaction signatures are invalid or missing required authorization.',
    retryable: false,
  },
  'txBAD_AUTH_EXTRA': {
    title: 'Extra Signatures',
    message: 'The transaction has additional signatures that are not needed.',
    retryable: false,
  },
  'txDUPLICATE': {
    title: 'Duplicate Transaction',
    message: 'This exact transaction has already been submitted to the network.',
    retryable: false,
  },
  'txFAILED': {
    title: 'Transaction Failed',
    message: 'One or more operations in the transaction failed. Check operation results for details.',
    retryable: false,
  },
  'txINTERNAL_ERROR': {
    title: 'Internal Server Error',
    message: 'An internal error occurred while processing the transaction. Please try again.',
    retryable: true,
  },
  'txMASTER_DISABLED': {
    title: 'Master Account Disabled',
    message: 'The master key of this account has been disabled.',
    retryable: false,
  },
  'txMISSING_OPERATION': {
    title: 'No Operations',
    message: 'The transaction must contain at least one operation.',
    retryable: false,
  },
  'txNO_OPERATION': {
    title: 'Missing Operation',
    message: 'The transaction is missing the required operation.',
    retryable: false,
  },
  'txTOO_EARLY': {
    title: 'Transaction Too Early',
    message: 'The transaction submission time is before the minTime condition.',
    retryable: true,
  },
  'txTOO_LATE': {
    title: 'Transaction Too Late',
    message: 'The transaction submission time is after the maxTime condition. Please resubmit.',
    retryable: true,
  },
};

/**
 * Maps operation result codes to user-friendly messages.
 */
const OPERATION_RESULT_CODES: Record<string, { title: string; message: string; retryable: boolean }> = {
  'opBAD_AUTH': {
    title: 'Insufficient Permissions',
    message: 'The account does not have permission to perform this operation.',
    retryable: false,
  },
  'opNO_DESTINATION': {
    title: 'Destination Not Found',
    message: 'The destination account does not exist. Consider funding it first.',
    retryable: false,
  },
  'opINSUFFICIENT_BALANCE': {
    title: 'Insufficient Balance',
    message: 'The account does not have enough funds to perform this operation.',
    retryable: false,
  },
  'opMALFORMED': {
    title: 'Malformed Operation',
    message: 'The operation contains invalid or missing parameters.',
    retryable: false,
  },
  'opNOT_SUPPORTED': {
    title: 'Operation Not Supported',
    message: 'This operation is not supported on the current network.',
    retryable: false,
  },
  'opUNDER_FUNDED': {
    title: 'Insufficient Reserve',
    message: 'The account does not maintain the minimum reserve. Add funds to increase reserve.',
    retryable: false,
  },
};

/**
 * Error guidance templates for common Stellar errors.
 */
const ERROR_GUIDANCE_MAP: Record<StellarErrorCode, StellarErrorGuidance> = {
  TRANSACTION_FAILED: {
    template: {
      title: 'Transaction Failed',
      message: 'The transaction was rejected by the Stellar network. Check operation details for the specific error.',
      retryable: false,
    },
    steps: [
      'Review the operation results to identify which operation failed',
      'Verify all account addresses are valid Stellar addresses',
      'Ensure the source account has sufficient balance for all operations plus fees',
      'Check that sequence numbers are correct',
    ],
    links: [
      { label: 'Transaction Failures', url: 'https://developers.stellar.org/docs/learn/concepts/transactions#transaction-failure' },
      { label: 'Operation Results', url: 'https://developers.stellar.org/docs/learn/concepts/operations' },
    ],
  },
  TRANSACTION_TIMEOUT: {
    template: {
      title: 'Transaction Submission Timeout',
      message: 'The submission request timed out. The network may be slow or unreachable.',
      retryable: true,
    },
    steps: [
      'Check your network connection',
      'Verify the Horizon endpoint is accessible',
      'Wait a moment and retry the transaction',
      'If problem persists, try a different Horizon server',
    ],
    links: [
      { label: 'Horizon Servers', url: 'https://developers.stellar.org/docs/learn/concepts/stellar-basics#horizon' },
    ],
  },
  ACCOUNT_NOT_FOUND: {
    template: {
      title: 'Account Not Found',
      message: 'The account does not exist on the Stellar network.',
      retryable: false,
    },
    steps: [
      'Verify the account address is correct and valid',
      'If this is a new account, fund it first using friendbot (testnet) or another method',
      'Wait for the account creation transaction to be confirmed',
    ],
    links: [
      { label: 'Creating a Wallet', url: 'https://developers.stellar.org/docs/learn/concepts/stellar-basics#wallets' },
      { label: 'Friendbot', url: 'https://developers.stellar.org/docs/learn/concepts/test-networks#friendbot' },
    ],
  },
  INSUFFICIENT_BALANCE: {
    template: {
      title: 'Insufficient Balance',
      message: 'The account does not have enough funds to perform the requested operation.',
      retryable: false,
    },
    steps: [
      'Check the current account balance',
      'Calculate the total cost including transaction fee (100 stroops base)',
      'Fund the account with additional lumens if needed',
      'Note that 1 lumen = 1,000,000 stroops',
    ],
    links: [
      { label: 'Fees', url: 'https://developers.stellar.org/docs/learn/concepts/fees-and-payments#transaction-fee' },
      { label: 'Account Reserve', url: 'https://developers.stellar.org/docs/learn/concepts/policies#minimum-account-balance' },
    ],
  },
  INVALID_SEQUENCE_NUMBER: {
    template: {
      title: 'Invalid Sequence Number',
      message: 'The transaction sequence number does not match the account state.',
      retryable: true,
    },
    steps: [
      'Reload the account data from the network',
      'Use the latest sequence number returned by loadAccount()',
      'Retry the transaction with the updated sequence number',
    ],
    links: [
      { label: 'Transactions', url: 'https://developers.stellar.org/docs/learn/concepts/transactions' },
    ],
  },
  NETWORK_ERROR: {
    template: {
      title: 'Network Error',
      message: 'A network error occurred while communicating with the Stellar network.',
      retryable: true,
    },
    steps: [
      'Check your internet connection',
      'Verify the Horizon endpoint is accessible',
      'Wait a moment and retry the operation',
      'Try using a different Horizon server if available',
    ],
    links: [
      { label: 'Horizon Servers', url: 'https://developers.stellar.org/docs/learn/concepts/stellar-basics#horizon' },
    ],
  },
  CONNECTION_TIMEOUT: {
    template: {
      title: 'Connection Timeout',
      message: 'The connection to the Stellar network timed out. The network may be experiencing issues.',
      retryable: true,
    },
    steps: [
      'Check your network connectivity',
      'Increase the timeout duration if available',
      'Retry the request after a short delay',
      'Consider using a different Horizon endpoint',
    ],
    links: [
      { label: 'Horizon Configuration', url: 'https://developers.stellar.org/docs/learn/concepts/stellar-basics#horizon' },
    ],
  },
  INVALID_DESTINATION: {
    template: {
      title: 'Invalid Destination Address',
      message: 'The destination address is not a valid Stellar account address.',
      retryable: false,
    },
    steps: [
      'Verify the destination address is a valid 56-character Stellar address',
      'Check that it starts with the letter G (public key)',
      'Ensure there are no typos or extra spaces',
      'Use a dedicated address validator tool to confirm',
    ],
    links: [
      { label: 'Account IDs', url: 'https://developers.stellar.org/docs/learn/concepts/accounts#account-id' },
    ],
  },
  OPERATION_FAILED: {
    template: {
      title: 'Operation Failed',
      message: 'An operation within the transaction failed to execute.',
      retryable: false,
    },
    steps: [
      'Review the operation result code for details',
      'Verify all operation parameters are valid',
      'Check account balances and permissions',
      'Ensure destination accounts exist',
    ],
    links: [
      { label: 'Operations', url: 'https://developers.stellar.org/docs/learn/concepts/operations' },
    ],
  },
  FEE_BUMP_FAILED: {
    template: {
      title: 'Fee Bump Failed',
      message: 'The fee bump transaction failed. The inner transaction or fee bump parameters are invalid.',
      retryable: false,
    },
    steps: [
      'Verify the inner transaction is valid',
      'Ensure the fee bump account has sufficient balance',
      'Check that the fee is higher than the inner transaction fee',
      'Verify the fee bump account has the correct authorization',
    ],
    links: [
      { label: 'Fee-Bump Transactions', url: 'https://developers.stellar.org/docs/learn/concepts/transactions#fee-bump-transactions' },
    ],
  },
  MALFORMED_TRANSACTION: {
    template: {
      title: 'Malformed Transaction',
      message: 'The transaction is malformed or has invalid parameters.',
      retryable: false,
    },
    steps: [
      'Verify all required transaction fields are present',
      'Check field data types and formats',
      'Ensure the transaction envelope is properly encoded',
      'Validate using the Stellar SDK TransactionBuilder',
    ],
    links: [
      { label: 'Transactions', url: 'https://developers.stellar.org/docs/learn/concepts/transactions' },
      { label: 'Transaction Builder', url: 'https://developers.stellar.org/docs/learn/fundamentals/build-a-transaction' },
    ],
  },
  ENDPOINT_UNREACHABLE: {
    template: {
      title: 'Endpoint Unreachable',
      message: 'The Horizon endpoint is not reachable or is not responding.',
      retryable: true,
    },
    steps: [
      'Verify your internet connection is active',
      'Check the endpoint URL is correct',
      'Try pinging the endpoint to test connectivity',
      'Use an alternative Horizon server',
    ],
    links: [
      { label: 'Horizon Endpoints', url: 'https://developers.stellar.org/docs/learn/concepts/stellar-basics#horizon' },
    ],
  },
  RATE_LIMITED: {
    template: {
      title: 'Rate Limited',
      message: 'Too many requests to the Stellar network. Please wait before retrying.',
      retryable: true,
    },
    steps: [
      'Wait at least 60 seconds before retrying',
      'Implement exponential backoff in your retry logic',
      'Consider batching operations to reduce request volume',
      'For high-volume needs, contact Stellar for SDK rate limits',
    ],
    links: [
      { label: 'Horizon Rate Limits', url: 'https://developers.stellar.org/docs/learn/concepts/stellar-basics#horizon' },
    ],
  },
  UNKNOWN_ERROR: {
    template: {
      title: 'Unknown Error',
      message: 'An unexpected error occurred. Check the error details for more information.',
      retryable: true,
    },
    steps: [
      'Review the full error message and stack trace',
      'Check Stellar status page for known issues',
      'Retry the operation after a delay',
      'Contact support with the error details if problem persists',
    ],
    links: [
      { label: 'Stellar Status', url: 'https://stellar.statuspage.io/' },
      { label: 'Stellar Documentation', url: 'https://developers.stellar.org/docs' },
    ],
  },
};

/**
 * Parse a Stellar SDK error or Horizon response error into a structured error object.
 *
 * @param error - The error to parse (can be Error, string, or object)
 * @param transactionHash - Optional transaction hash for context
 * @returns Parsed error with code and user-friendly information
 *
 * @example
 * ```typescript
 * try {
 *   await submitTransaction(transaction);
 * } catch (error) {
 *   const parsed = parseStellarError(error);
 *   console.log(parsed.title); // "Transaction Failed"
 *   console.log(parsed.message); // User-friendly message
 * }
 * ```
 */
export function parseStellarError(
  error: unknown,
  transactionHash?: string
): ParsedStellarError {
  let errorCode: StellarErrorCode = 'UNKNOWN_ERROR';
  let details: string | undefined;
  let resultCode: string | undefined;
  let title = 'Unknown Error';
  let message = 'An unexpected error occurred.';
  let retryable = true;

  // Parse different error types
  if (error instanceof Error) {
    const errorMessage = error.message || '';
    details = errorMessage;

    // Try to extract result code from message (e.g., "txFAILED: ...")
    const resultCodeMatch = errorMessage.match(/^([a-zA-Z_]+)(?:\s|:|$)/);
    if (resultCodeMatch && TRANSACTION_RESULT_CODES[resultCodeMatch[1]]) {
      resultCode = resultCodeMatch[1];
    }

    // Check for network/timeout errors
    if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('ECONNRESET')
    ) {
      errorCode = 'CONNECTION_TIMEOUT';
    }
    // Check for connection/network errors
    else if (
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('EHOSTUNREACH') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('Network Error') ||
      errorMessage.includes('Failed to fetch')
    ) {
      errorCode = 'NETWORK_ERROR';
    }
    // Check for account not found
    else if (
      errorMessage.includes('Account not found') ||
      errorMessage.includes('404')
    ) {
      errorCode = 'ACCOUNT_NOT_FOUND';
    }
    // Check for invalid destination
    else if (
      errorMessage.includes('Invalid destination') ||
      errorMessage.includes('Destination is invalid')
    ) {
      errorCode = 'INVALID_DESTINATION';
    }
    // Check for insufficient balance
    else if (
      errorMessage.includes('Insufficient balance') ||
      errorMessage.includes('UNDER_FUNDED')
    ) {
      errorCode = 'INSUFFICIENT_BALANCE';
    }
    // Check for sequence number issues
    else if (
      errorMessage.includes('Bad sequence number') ||
      errorMessage.includes('sequence') ||
      errorMessage.includes('txBAD_SEQ')
    ) {
      errorCode = 'INVALID_SEQUENCE_NUMBER';
    }
    // Check for transaction-related errors
    else if (errorMessage.includes('Transaction') || errorMessage.includes('tx') || resultCode) {
      errorCode = 'TRANSACTION_FAILED';
    }
  }
  // Handle Horizon API error responses
  else if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>;

    // Check for Horizon error structure
    if (errObj.status === 404 || errObj.type?.includes('not_found')) {
      errorCode = 'ACCOUNT_NOT_FOUND';
    } else if (errObj.status === 429 || errObj.type?.includes('rate_limit')) {
      errorCode = 'RATE_LIMITED';
    } else if (errObj.status === 503 || errObj.status === 502) {
      errorCode = 'ENDPOINT_UNREACHABLE';
    } else if (errObj.status === 400 || errObj.type?.includes('invalid')) {
      errorCode = 'MALFORMED_TRANSACTION';
    }

    // Extract result code if available
    if (typeof errObj.result_code === 'string') {
      resultCode = errObj.result_code;
    } else if (typeof errObj.resultCode === 'string') {
      resultCode = errObj.resultCode;
    }

    // Try to get error title from transaction result codes
    if (resultCode && TRANSACTION_RESULT_CODES[resultCode]) {
      const mapping = TRANSACTION_RESULT_CODES[resultCode];
      title = mapping.title;
      message = mapping.message;
      retryable = mapping.retryable;
      errorCode = 'TRANSACTION_FAILED';
    }

    // Extract additional details
    if (typeof errObj.message === 'string') {
      details = errObj.message;
    } else if (typeof errObj.detail === 'string') {
      details = errObj.detail;
    }
  }
  // Handle string errors
  else if (typeof error === 'string') {
    details = error;

    if (error.includes('timeout')) {
      errorCode = 'CONNECTION_TIMEOUT';
    } else if (error.includes('Network') || error.includes('ENOTFOUND')) {
      errorCode = 'NETWORK_ERROR';
    }
  }

  // Get standard error info from guidance map if not already set
  if (resultCode && TRANSACTION_RESULT_CODES[resultCode]) {
    const mapping = TRANSACTION_RESULT_CODES[resultCode];
    title = mapping.title;
    message = mapping.message;
    retryable = mapping.retryable;
    errorCode = 'TRANSACTION_FAILED';
  } else if (errorCode !== 'TRANSACTION_FAILED' && !resultCode) {
    const guidance = ERROR_GUIDANCE_MAP[errorCode];
    if (guidance) {
      title = guidance.template.title;
      message = guidance.template.message;
      retryable = guidance.template.retryable;
    }
  }

  return {
    code: errorCode,
    title,
    message,
    retryable,
    details,
    transactionHash,
    resultCode,
  };
}

/**
 * Get comprehensive error guidance for remediating a Stellar error.
 *
 * @param errorCode - The error code to get guidance for
 * @returns Error guidance with remediation steps and documentation links
 *
 * @example
 * ```typescript
 * const parsed = parseStellarError(error);
 * const guidance = getErrorGuidance(parsed.code);
 * console.log(guidance.steps);
 * ```
 */
export function getErrorGuidance(errorCode: StellarErrorCode): StellarErrorGuidance {
  return (
    ERROR_GUIDANCE_MAP[errorCode] || ERROR_GUIDANCE_MAP['UNKNOWN_ERROR']
  );
}

/**
 * Check if an error is retryable based on its type.
 *
 * @param error - The error to check
 * @returns Whether the error represents a retryable condition
 *
 * @example
 * ```typescript
 * if (isRetryableError(error)) {
 *   // Implement exponential backoff and retry
 * }
 * ```
 */
export function isRetryableError(error: unknown): boolean {
  const parsed = parseStellarError(error);
  return parsed.retryable;
}

/**
 * Format error for user display with guidance.
 *
 * @param error - The error to format
 * @param verbose - Whether to include full guidance
 * @returns Formatted error string suitable for display
 *
 * @example
 * ```typescript
 * try {
 *   await submitTransaction(tx);
 * } catch (error) {
 *   console.error(formatError(error, true));
 * }
 * ```
 */
export function formatError(error: unknown, verbose = false): string {
  const parsed = parseStellarError(error);
  let formatted = `${parsed.title}\n${parsed.message}`;

  if (verbose) {
    const guidance = getErrorGuidance(parsed.code);
    formatted += '\n\nWhat you can do:\n';
    guidance.steps.forEach((step, idx) => {
      formatted += `${idx + 1}. ${step}\n`;
    });

    if (guidance.links.length > 0) {
      formatted += '\nLearn more:\n';
      guidance.links.forEach((link) => {
        formatted += `- ${link.label}: ${link.url}\n`;
      });
    }
  }

  if (parsed.details) {
    formatted += `\n\nDetails: ${parsed.details}`;
  }

  return formatted;
}
