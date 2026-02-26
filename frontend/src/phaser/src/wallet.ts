import { CreateMatchOptions, type DeployedPVPArenaAPI, PVPArenaAPI, PVPArenaCircuitKeys, type PVPArenaProviders } from '@midnight-ntwrk/pvp-api';
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
import { UnboundTransaction, ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types';
import { CoinPublicKey, EncPublicKey, type ShieldedCoinInfo, Transaction, type TransactionId, UnprovenTransaction } from '@midnight-ntwrk/ledger-v7';
import { Transaction as ZswapTransaction } from '@midnight-ntwrk/zswap';
import semver from 'semver';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
//import { initializeProviders as initializeBatcherModeProviders } from './batcher-providers';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import * as ledgerv7 from '@midnight-ntwrk/ledger-v7';
import { FinalizedTransaction } from '@midnight-ntwrk/ledger-v7';
import { BatcherClient } from './batcher-client';
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
      contractAddress = '3d3c7fc9c6196d80cb4fffba4e0176099560e038b98f403b2ffc4584fd6b235e';
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

type DelegatedTxStage = "unproven" | "unbound" | "finalized";


const initializeProviders = async (logger: Logger): Promise<PVPArenaProviders> => {
  const wallet = await connectToWallet(logger, getNetworkId());
  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } = await wallet.getShieldedAddresses();

  const walletConfig = await wallet.getConfiguration();

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
        await BatcherClient.delegatedBalanceHook(tx);
        throw new Error(DELEGATED_SENTINEL);

        // This is not working on lace.
        // const serializedTx = toHex(tx.serialize());
        // const balancedTx1: { tx: string } = await wallet.balanceUnsealedTransaction(serializedTx);
        // const balancedTx: FinalizedTransaction = Transaction.deserialize(
        //   'signature',
        //   'proof',
        //   'binding',
        //   fromHex(balancedTx1.tx)
        // );
        // return balancedTx;        
      },
    };


  const zkConfigProvider: ZKConfigProvider<PVPArenaCircuitKeys> = new FetchZkConfigProvider(window.location.origin, fetch.bind(window));
  const BASE_URL_PROOF_SERVER = `http://127.0.0.1:6300`;
  
  return {
    // privateStateProvider: levelPrivateStateProvider({
    //   privateStateStoreName: 'pvp-private-state',
    // }),
    privateStateProvider: levelPrivateStateProvider<string>({
      privateStateStoreName: 'pvp-private-state',
      walletProvider,
    }),
    zkConfigProvider,
    //zkConfigProider: new NodeZkConfigProvider<'increment'>(contractConfig.zkConfigPath),
    proofProvider: httpClientProofProvider(BASE_URL_PROOF_SERVER, zkConfigProvider),
    publicDataProvider: indexerPublicDataProvider(walletConfig.indexerUri, walletConfig.indexerWsUri),
    walletProvider,
    midnightProvider: {
      async submitTx(tx: ledgerv7.FinalizedTransaction): Promise<TransactionId> {
        logger.debug(" wallet.tx: submitTx called", { tx });

        try {
          const hexTx = toHex(tx.serialize());
          console.log(" wallet.ts: Submitting final balanced transaction to submitTransaction", { hexTx });

          // Compute transaction ID (hash) locally from the serialized transaction
          const txId = ledgerv7.Transaction.deserialize(
            'signature' as const,
            'proof' as const,
            'binding' as const,
            fromHex(hexTx)
          ).transactionHash();

          console.log(" wallet.ts: Computed transaction ID:", txId);

          await wallet.submitTransaction(hexTx);
          console.log(" wallet.ts: transaction submitted successfully");

          return txId as unknown as TransactionId;
        } catch (error) {
          console.error(" wallet.ts: submitTransaction failed", error);
          if (error instanceof Error) {
            console.error(" wallet.ts: error message", error.message);
          }
          throw error;
        }
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
