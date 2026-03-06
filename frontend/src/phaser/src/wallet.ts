import { CreateMatchOptions, type DeployedPVPArenaAPI, PVPArenaAPI, PVPArenaCircuitKeys, type PVPArenaProviders } from '@midnight-ntwrk/pvp-api';
import { UNDEPLOYED_CONTRACT_ADDRESS } from './contract-addresses';
import { CompactTypeBytes, transientCommit, type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
  concatMap,
  filter,
  firstValueFrom,
  interval,
  map,
  of,
  take,
  tap,
  throwError,
  timeout,
  catchError,
} from 'rxjs';
import { pipe as fnPipe } from 'fp-ts/function';
import { type Logger } from 'pino';
// import {
//   type DAppConnectorAPI,
//   type DAppConnectorWalletAPI,
//   type ServiceUriConfig,
// } from '@midnight-ntwrk/dapp-connector-api';
import type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { type FinalizedTxData, SucceedEntirely, UnboundTransaction, ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types';
import { CoinPublicKey, EncPublicKey, type ShieldedCoinInfo, Transaction, type TransactionId, UnprovenTransaction } from '@midnight-ntwrk/ledger-v7';
import { Transaction as ZswapTransaction } from '@midnight-ntwrk/zswap';
import semver from 'semver';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
//import { initializeProviders as initializeBatcherModeProviders } from './batcher-providers';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import * as ledgerv7 from '@midnight-ntwrk/ledger-v7';
import { FinalizedTransaction } from '@midnight-ntwrk/ledger-v7';
import { BatcherClient } from './batcher-client';
// import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
export class BrowserDeploymentManager {
  #initializedProviders: Promise<PVPArenaProviders> | undefined;

  /**
   * Initializes a new {@link BrowserDeployedBoardManager} instance.
   *
   * @param logger The `pino` logger to for logging.
   */
  constructor(private readonly logger: Logger) {
  }

  async create(): Promise<PVPArenaAPI> {
    console.log('getting providers');
    const providers = await this.getProviders();
    console.log('trying to create');
    return PVPArenaAPI.deploy(providers, this.logger).then((api) => {
      console.log('got create api');
      return api;
    });
  }
  async join(contractAddress: ContractAddress): Promise<PVPArenaAPI> {
    console.log('getting providers');
    if (!contractAddress) {
      console.log('no contract address provided, using default');
      contractAddress = UNDEPLOYED_CONTRACT_ADDRESS;
    }
    const providers = await this.getProviders();
    console.log('trying to join');
    // TODO: do we need error handling?
    return PVPArenaAPI.join(providers, contractAddress, this.logger)
      .then((api) => { console.log('got join api'); return api; });
  }

  private getProviders(): Promise<PVPArenaProviders> {
    // We use a cached `Promise` to hold the providers. This will:
    //
    // 1. Cache and re-use the providers (including the configured connector API), and
    // 2. Act as a synchronization point if multiple contract deploys or joins run concurrently.
    //    Concurrent calls to `getProviders()` will receive, and ultimately await, the same
    //    `Promise`.
    return (
      this.#initializedProviders ??
      (/*this.#initializedProviders = import.meta.env.VITE_BATCHER_MODE_ENABLED
        ? initializeBatcherModeProviders(this.logger)
        :*/ initializeProviders(this.logger))
    );
  }
}

/** @internal */
const toHex = (data: Uint8Array): string =>
  Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (hex: string): Uint8Array => {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const match = cleanHex.match(/.{1,2}/g);
  return new Uint8Array(match ? match.map((byte) => parseInt(byte, 16)) : []);
};

// import { fromHex, toHex } from "@midnight-ntwrk/compact-runtime";
// import type { WalletProvider } from "@midnight-ntwrk/midnight-js-types";

// Default batcher URL. In browser environments, this should be overridden via the constructor if different.
const DEFAULT_BATCHER_URL = "http://localhost:3334";

/** Sentinel message thrown by balanceTx when the delegation hook intercepts the transaction. */
export const DELEGATED_SENTINEL = "Delegated balancing flow handed off to batcher";

/**
 * Sentinel txId returned by the mock submitTx in delegated mode.
 * publicDataProvider.watchForTxData intercepts this and returns a mock
 * FinalizedTxData immediately, allowing callTx to resolve and expose
 * txData.private.result (the circuit return value) without blocking.
 */
const DELEGATED_TX_SENTINEL = 'delegated-to-batcher';

type DelegatedTxStage = "unproven" | "unbound" | "finalized";


const initializeProviders = async (logger: Logger): Promise<PVPArenaProviders> => {
  const wallet = await connectToWallet(logger, getNetworkId());
  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } = await wallet.getShieldedAddresses();

  const walletConfig = await wallet.getConfiguration();
  console.log(`[wallet] wallet indexerUri=${walletConfig.indexerUri} indexerWsUri=${walletConfig.indexerWsUri}`);

  // The Lace wallet's configured indexer may point to testnet/preview rather than the
  // local chain.  When VITE_BATCHER_MODE_INDEXER_HTTP_URL is set (i.e. in the
  // undeployed / local-dev build), use those URLs so that the circuit simulation
  // queries the SAME chain the batcher submits to.
  const indexerUri: string =
    (import.meta.env.VITE_BATCHER_MODE_INDEXER_HTTP_URL as string) || walletConfig.indexerUri;
  const indexerWsUri: string =
    (import.meta.env.VITE_BATCHER_MODE_INDEXER_WS_URL as string) || walletConfig.indexerWsUri;
  console.log(`[wallet] Using indexer: ${indexerUri} (${indexerUri === walletConfig.indexerUri ? 'from wallet' : 'from env override'})`);
  console.log(`[wallet] Using indexer WS: ${indexerWsUri}`);

  // Stores the tx hash returned by the batcher for the most recently submitted tx.
  // balanceTx sets this; watchForTxData reads and clears it to resolve the real
  // indexer confirmation, guaranteeing the contract state is updated before the
  // next circuit simulation runs.
  let pendingTxHash: string | null = null;

  /**
   * Queries the Midnight v3 indexer for a transaction by its hash and returns
   * the first ZK identifier (spend commitment). This identifier is the correct
   * argument for publicDataProvider.watchForTxData(), which uses
   * { identifier } rather than { hash } in its GraphQL query.
   */
  const getTxIdentifierByHash = async (txHash: string): Promise<string | null> => {
    const query = `
      query GetTxByHash($hash: String!) {
        transactions(offset: { hash: $hash }) {
          ... on RegularTransaction {
            identifiers
          }
        }
      }
    `;
    // The batcher already confirmed the tx is in the indexer (wait-receipt), so
    // it should be found on the first or second attempt.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const response = await fetch(indexerUri, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { hash: txHash } }),
        });
        const body = await response.json();
        const txs: any[] = body?.data?.transactions ?? [];
        if (txs.length > 0 && Array.isArray(txs[0].identifiers) && txs[0].identifiers.length > 0) {
          const id = txs[0].identifiers[0] as string;
          console.log(`[wallet:getTxIdentifierByHash] txHash=${txHash} → identifier=${id} (attempt ${attempt})`);
          return id;
        }
      } catch (e) {
        console.warn(`[wallet:getTxIdentifierByHash] attempt ${attempt} error:`, e);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    console.warn(`[wallet:getTxIdentifierByHash] Could not resolve identifier for txHash=${txHash} after 10 attempts`);
    return null;
  };

  const detectTxStage = (serializedTx: string): DelegatedTxStage => {
    // Transaction headers are ASCII:
    // midnight:transaction[v9](signature[v1],<proof-marker>,<binding-marker>):
    // We parse only the prefix to map to the batcher's expected txStage.
    const prefixHex = serializedTx.slice(0, 600).padEnd(600, "0");
    const prefixBytes = fromHex(prefixHex);
    const header = new TextDecoder().decode(prefixBytes);

    const markerMatch = header.match(
      /midnight:transaction\[v\d+\]\(signature\[v\d+\],([^,]+),([^)]+)\):/,
    );

    if (!markerMatch) {
      throw new Error(
        `[BatcherClient] Could not parse transaction header markers from: ${
          header.slice(0, 120)
        }`,
      );
    }

    const proofMarker = markerMatch[1];
    const bindingMarker = markerMatch[2];

    if (proofMarker.includes("proof-preimage")) return "unproven";
    if (bindingMarker.includes("embedded-fr")) return "unbound";
    if (bindingMarker.includes("pedersen-schnorr")) return "finalized";

    throw new Error(
      `[BatcherClient] Unknown tx markers proof=${proofMarker} binding=${bindingMarker}`,
    );
  }


  const walletProvider = {
      getCoinPublicKey(): CoinPublicKey {
        return shieldedCoinPublicKey;
      },
      getEncryptionPublicKey(): EncPublicKey {
        return shieldedEncryptionPublicKey;
      },
      // balanceTx(tx: UnbalancedTransaction, newCoins: ShieldedCoinInfo[]): Promise<BalancedTransaction> {
      //   return wallet
      //     .balanceTransaction(
      //       ZswapTransaction.deserialize(tx.serialize(getNetworkId()), getNetworkId()),
      //       newCoins
      //     )
      //     .then((tx) => wallet.proveTransaction(tx))
      //     .then((zswapTx) => Transaction.deserialize(zswapTx.serialize(getNetworkId()), getNetworkId()))
      //     .then(createBalancedTx);
      // },

      
      async balanceTx(
        tx: UnboundTransaction,
      ): Promise<FinalizedTransaction> {
        const txHash = await BatcherClient.delegatedBalanceHook(tx);
        // Store the batcher-confirmed tx hash so watchForTxData can resolve the
        // real indexer identifier and wait for genuine chain confirmation.
        pendingTxHash = txHash;
        console.log(`[wallet:balanceTx] batcher confirmed txHash=${txHash}`);
        // tx is already proven (UnboundTransaction — result of proofProvider.proveTx).
        // The batcher handles real balancing + submission. Our submitTx mock ignores
        // this return value entirely, so just cast through to satisfy the type.
        return tx as unknown as FinalizedTransaction;
      },
    };


  const zkConfigProvider: ZKConfigProvider<PVPArenaCircuitKeys> = new FetchZkConfigProvider(window.location.origin, fetch.bind(window));
  const BASE_URL_PROOF_SERVER = `http://127.0.0.1:6300`;

  // Build the real indexer provider and wrap watchForTxData so that the
  // delegated-batcher sentinel resolves immediately with a mock FinalizedTxData.
  // This lets callTx complete and expose txData.private.result (the circuit
  // return value computed locally) without waiting for the batcher's on-chain tx.
  const basePublicDataProvider = indexerPublicDataProvider(indexerUri, indexerWsUri);
  const publicDataProvider = {
    ...basePublicDataProvider,
    queryZSwapAndContractState: async (contractAddress: any, config?: any) => {
      console.log(`[wallet:queryZSwapAndContractState] contractAddress=${contractAddress}`);

      // When no config is provided, the base implementation sets offset=null which the
      // indexer interprets as the deploy/initial state rather than the latest state.
      // Query the latest block height first (contractAction without offset = latest),
      // then pass it explicitly so the circuit simulation always sees the current state.
      let resolvedConfig = config;
      if (!resolvedConfig) {
        try {
          const heightQuery = `
            query GetLatestBlockHeight($address: HexEncoded!) {
              contractAction(address: $address) {
                transaction {
                  block {
                    height
                  }
                }
              }
            }
          `;
          const response = await fetch(indexerUri, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: heightQuery, variables: { address: contractAddress } }),
          });
          const body = await response.json();
          const height = body?.data?.contractAction?.transaction?.block?.height;
          if (height != null) {
            console.log(`[wallet:queryZSwapAndContractState] Resolved latest blockHeight=${height}`);
            resolvedConfig = { type: 'blockHeight', blockHeight: height };
          } else {
            console.warn(`[wallet:queryZSwapAndContractState] Could not resolve latest block height — falling back to null offset`);
          }
        } catch (e) {
          console.warn(`[wallet:queryZSwapAndContractState] Failed to fetch latest block height:`, e);
        }
      }

      const result = await basePublicDataProvider.queryZSwapAndContractState(contractAddress, resolvedConfig);
      if (!result) {
        console.error(`[wallet:queryZSwapAndContractState] RETURNED NULL for contractAddress=${contractAddress}`);
      } else {
        const [, contractState] = result;
        const stateKeys = contractState ? Object.keys(contractState).join(', ') : 'null';
        console.log(`[wallet:queryZSwapAndContractState] OK — contractState keys: ${stateKeys}`);
      }
      return result;
    },
    watchForTxData: async (txId: TransactionId): Promise<FinalizedTxData> => {
      if ((txId as unknown as string) !== DELEGATED_TX_SENTINEL) {
        return basePublicDataProvider.watchForTxData(txId);
      }

      // Intercepted sentinel: use the stored tx hash to get the real indexer
      // identifier, then call the real watchForTxData. This guarantees that
      // callTx only resolves AFTER the tx is confirmed in the indexer AND the
      // contract state is updated — preventing the "expected a cell, received null"
      // race condition in the next circuit simulation call.
      const txHash = pendingTxHash;
      pendingTxHash = null;

      if (txHash) {
        console.log(`[wallet] watchForTxData: intercepted sentinel, resolving identifier for txHash=${txHash}...`);
        const identifier = await getTxIdentifierByHash(txHash);
        if (identifier) {
          console.log(`[wallet] watchForTxData: waiting for real indexer confirmation via identifier=${identifier}`);
          return basePublicDataProvider.watchForTxData(identifier as unknown as TransactionId);
        }
        console.warn('[wallet] watchForTxData: could not resolve identifier, falling back to mock');
      } else {
        console.warn('[wallet] watchForTxData: no pendingTxHash — returning mock FinalizedTxData immediately');
      }

      // Fallback: return mock immediately (should only happen if batcher returned no hash)
      return Promise.resolve({
        tx: null as any,
        status: SucceedEntirely,
        txId,
        identifiers: [],
        txHash: DELEGATED_TX_SENTINEL as any,
        blockHash: DELEGATED_TX_SENTINEL,
        blockHeight: 0,
        blockTimestamp: Date.now(),
        blockAuthor: null,
        indexerId: 0,
        protocolVersion: 0,
        fees: { paidFees: '0', estimatedFees: '0' },
        segmentStatusMap: undefined,
        unshielded: { created: [], spent: [] },
      } as FinalizedTxData);
    },
  };

  return {
    privateStateProvider: levelPrivateStateProvider<string>({
      privateStateStoreName: 'pvp-private-state',
      walletProvider,
    }),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(BASE_URL_PROOF_SERVER, zkConfigProvider),
    publicDataProvider,
    walletProvider,
    midnightProvider: {
      // Return the sentinel so watchForTxData can intercept it and resolve
      // immediately, giving callTx access to txData.private.result.
      // The actual transaction is submitted asynchronously by the batcher.
      async submitTx(_tx: ledgerv7.FinalizedTransaction): Promise<TransactionId> {
        return DELEGATED_TX_SENTINEL as unknown as TransactionId;
      },
    },
  };
};

/** @internal */
const connectToWallet = async (logger: Logger, networkId: string): Promise<ConnectedAPI> => {
  const COMPATIBLE_CONNECTOR_API_VERSION = '>=1.0.0';
  const midnight = (window as any).midnight;

  if (!midnight) {
    throw new Error("Midnight Lace wallet not found. Extension installed?");
  }

  const wallets = Object.entries(midnight).filter(([_, api]: [string, any]) => 
    api.apiVersion && semver.satisfies(api.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION)
  ) as [string, any][];

  if (wallets.length === 0) {
    throw new Error("No compatible Midnight wallet found.");
  }

  console.log(`wallet count = ${wallets.length}`);

  // for (const wallet of wallets) {
  //   console.log(`wallet found: ${wallet}`);
  // }

  const [name, api] = wallets[0];
  logger.debug(`Connecting to wallet: ${name} (version ${api.apiVersion})`);

  // // KEY: Hardcoded Password Provider
  // const passwordProvider = async () => "PAIMA_STORAGE_PASSWORD";

  // const apiWithPassword: any = { ...api };
  // if (typeof apiWithPassword.connect !== 'function') {
  //   apiWithPassword.connect = api.connect;
  // }
  // apiWithPassword.privateStoragePasswordProvider = passwordProvider;

  // return await apiWithPassword.connect(networkId);

  return api.connect(networkId);
};

// const createWalletAndMidnightProvider = (
//   connectedAPI: ConnectedAPI,
//   coinPublicKey: CoinPublicKey,
//   encryptionPublicKey: EncPublicKey
// ): WalletProvider & MidnightProvider => {
//   return {
//     getCoinPublicKey(): CoinPublicKey {
//       return coinPublicKey;
//     },
//     getEncryptionPublicKey(): EncPublicKey {
//       return encryptionPublicKey;
//     },
//     async balanceTx(
//       tx: UnprovenTransaction,
//       _newCoins?: ShieldedCoinInfo[],
//       _ttl?: Date
//     ): Promise<BalancedProvingRecipe> {
//       console.log(" erc20.ts: balanceTx called", { tx, _newCoins, _ttl });

//       try {
//         const hexTx = toHex(tx.serialize());
//         console.log(" erc20.ts: Sending UNPROVEN transaction to balanceUnsealedTransaction", { hexTx });

//         const result = await connectedAPI.balanceUnsealedTransaction(hexTx);
//         console.log(" erc20.ts: received result from balanceUnsealedTransaction", result);

//         const balancedTx = LedgerV6Transaction.deserialize(
//           'signature' as const,
//           'pre-proof' as const,
//           'pre-binding' as const,
//           fromHex(result.tx)
//         ) as UnprovenTransaction;

//         return {
//           type: TRANSACTION_TO_PROVE,
//           transaction: balancedTx,
//         };
//       } catch (error) {
//         console.error(" erc20.ts: balanceUnsealedTransaction failed", error);
//         if (error instanceof Error) {
//            console.error(" erc20.ts: error message", error.message);
//            console.error(" erc20.ts: error stack", error.stack);
//         }
//         throw error;
//       }
//     },
//     async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
//       console.log(" erc20.ts: submitTx called", { tx });

//       try {
//         const hexTx = toHex(tx.serialize());
//         console.log(" erc20.ts: Submitting final balanced transaction to submitTransaction", { hexTx });

//         // Compute transaction ID (hash) locally from the serialized transaction
//         const txId = LedgerV6Transaction.deserialize(
//           'signature' as const,
//           'proof' as const,
//           'binding' as const,
//           fromHex(hexTx)
//         ).transactionHash();

//         console.log(" erc20.ts: Computed transaction ID:", txId);

//         await connectedAPI.submitTransaction(hexTx);
//         console.log(" erc20.ts: transaction submitted successfully");

//         return txId as unknown as TransactionId;
//       } catch (error) {
//         console.error(" erc20.ts: submitTransaction failed", error);
//         if (error instanceof Error) {
//            console.error(" erc20.ts: error message", error.message);
//         }
//         throw error;
//       }
//     },
//   };
// };


// const connectToWallet = (logger: Logger): Promise<{ wallet: DAppConnectorWalletAPI; uris: ServiceUriConfig }> => {
//   const COMPATIBLE_CONNECTOR_API_VERSION = '1.x';

//   return firstValueFrom(
//     fnPipe(
//       interval(100),
//       map(() => window.midnight?.mnLace),
//       tap((connectorAPI) => {
//         logger.info(connectorAPI, 'Check for wallet connector API');
//       }),
//       filter((connectorAPI): connectorAPI is DAppConnectorAPI => !!connectorAPI),
//       concatMap((connectorAPI) =>
//         semver.satisfies(connectorAPI.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION)
//           ? of(connectorAPI)
//           : throwError(() => {
//               logger.error(
//                 {
//                   expected: COMPATIBLE_CONNECTOR_API_VERSION,
//                   actual: connectorAPI.apiVersion,
//                 },
//                 'Incompatible version of wallet connector API',
//               );

//               return new Error(
//                 `Incompatible version of Midnight Lace wallet found. Require '${COMPATIBLE_CONNECTOR_API_VERSION}', got '${connectorAPI.apiVersion}'.`,
//               );
//             }),
//       ),
//       tap((connectorAPI) => {
//         logger.info(connectorAPI, 'Compatible wallet connector API found. Connecting.');
//       }),
//       take(1),
//       timeout({
//         first: 1_000,
//         with: () =>
//           throwError(() => {
//             logger.error('Could not find wallet connector API');

//             return new Error('Could not find Midnight Lace wallet. Extension installed?');
//           }),
//       }),
//       concatMap(async (connectorAPI) => {
//         const isEnabled = await connectorAPI.isEnabled();

//         logger.info(isEnabled, 'Wallet connector API enabled status');

//         return connectorAPI;
//       }),
//       timeout({
//         first: 5_000,
//         with: () =>
//           throwError(() => {
//             logger.error('Wallet connector API has failed to respond');

//             return new Error('Midnight Lace wallet has failed to respond. Extension enabled?');
//           }),
//       }),
//       concatMap(async (connectorAPI) => ({ walletConnectorAPI: await connectorAPI.enable(), connectorAPI })),
//       catchError((error, apis) =>
//         error
//           ? throwError(() => {
//               logger.error('Unable to enable connector API');
//               return new Error('Application is not authorized');
//             })
//           : apis,
//       ),
//       concatMap(async ({ walletConnectorAPI, connectorAPI }) => {
//         const uris = await connectorAPI.serviceUriConfig();

//         logger.info('Connected to wallet connector API and retrieved service configuration');

//         return { wallet: walletConnectorAPI, uris };
//       }),
//     ),
//   );
// };
