import {
  type BatcherConfig,
  FileStorage,
  MidnightAdapter,
} from "@paimaexample/batcher";
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import * as path from "@std/path";
import { MidnightBalancingAdapter } from "./adapters/midnight-balancing-adapter.ts";
// import { MidnightBalancingAdapter } from "@paimaexample/batcher";
const batchIntervalMs = 1000;
const port = Number(Deno.env.get("BATCHER_PORT") ?? "3334");

// Try to load contract data (needed for the standard midnight adapter).
// May fail if the contract hasn't been deployed yet (no address JSON file).
let midnightContractData: ReturnType<typeof readMidnightContract> | null = null;
try {
  midnightContractData = readMidnightContract(
    "contract-pvp",
    { 
      baseDir: path.resolve(import.meta.dirname!, "..", "midnight"),
      networkId: midnightNetworkConfig.id,
    },
  );
} catch (e) {
  console.warn(
    `⚠️  Could not load contract address file: ${(e as Error).message}`,
  );
  console.warn(
    "   The standard midnight adapter will be disabled. " +
      "The midnight_balancing adapter (for delegated tx) will still work.",
  );
  throw e;
}


// Resolve zkConfigPath for the balancing adapter independently of the address file.
// The balancing adapter only needs the ZK keys/ZKIR, not the contract address.
const zkConfigPath = midnightContractData?.zkConfigPath ??
  path.resolve(
    import.meta.dirname!,
    "..", "midnight","contract-pvp", "src", "managed"
  );

// const midnightAdapter = new MidnightAdapter(
//     midnightContractData.contractAddress,
//     midnightNetworkConfig.walletSeed!,
//     {
//       indexer: midnightNetworkConfig.indexer,
//       indexerWS: midnightNetworkConfig.indexerWS,
//       node: midnightNetworkConfig.node,
//       proofServer: midnightNetworkConfig.proofServer,
//       zkConfigPath: midnightContractData.zkConfigPath,
//       privateStateStoreName: "pvp-private-state",
//       privateStateId: "pvpPrivateState",
//       contractJoinTimeoutSeconds: 300,
//       walletFundingTimeoutSeconds: 300,
//       walletNetworkId: midnightNetworkConfig.id,
//     },
//     new Contract(witnesses),
//     witnesses,
//     midnightContractData.contractInfo,
//     "parallelMidnight",
//   );

// The balancing adapter handles delegated transactions from BatcherClient.
const midnightBalancingAdapter = new MidnightBalancingAdapter(
    midnightNetworkConfig.walletSeed!,
    {
      indexer: midnightNetworkConfig.indexer,
      indexerWS: midnightNetworkConfig.indexerWS,
      node: midnightNetworkConfig.node,
      proofServer: midnightNetworkConfig.proofServer,
      walletNetworkId: midnightNetworkConfig.id,
      addShieldedPadding: true,
      shieldedPaddingTokenID: "3d7652dc9391818656b1de6e7df0c49ae2a8938b185e5a1483c21a7b48a2a086",
      maxBatchSize: 2,
    },
  );

export const config: BatcherConfig = {
  pollingIntervalMs: batchIntervalMs,
  adapters: {
    // ...({ midnight: midnightAdapter }),
    ...({ midnight_balancing: midnightBalancingAdapter }),
  },
  defaultTarget: "midnight_balancing",
  namespace: "",
  batchingCriteria: {
    // ...({ midnight: { criteriaType: "time", timeWindowMs: batchIntervalMs } }),
    ...({ midnight_balancing: { criteriaType: "time", timeWindowMs: batchIntervalMs } }),
  },
  confirmationLevel: "wait-effectstream-processed", // Connector expectation
  enableHttpServer: true,
  enableEventSystem: true,
  port,
};

export const storage = new FileStorage("./batcher-data");
