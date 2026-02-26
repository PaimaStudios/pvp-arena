import {
  type BatcherConfig,
  FileStorage,
  MidnightAdapter,
} from "@paimaexample/batcher";
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import { Contract, witnesses } from "@pvp-arena-backend/midnight-contracts/pvp";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import { WerewolfBalancingAdapter } from "./adapters/werewolf-balancing-adapter.ts";
import * as path from "@std/path";

const batchIntervalMs = 1000;
const port = Number(Deno.env.get("BATCHER_PORT") ?? "3334");

// Try to load contract data (needed for the standard midnight adapter).
// May fail if the contract hasn't been deployed yet (no address JSON file).
let midnightContractData: ReturnType<typeof readMidnightContract> | null = null;
try {
  midnightContractData = readMidnightContract(
    "contract-pvp",
    { networkId: midnightNetworkConfig.id },
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

const midnightAdapter = new MidnightAdapter(
    midnightContractData.contractAddress,
    midnightNetworkConfig.walletSeed!,
    {
      indexer: midnightNetworkConfig.indexer,
      indexerWS: midnightNetworkConfig.indexerWS,
      node: midnightNetworkConfig.node,
      proofServer: midnightNetworkConfig.proofServer,
      zkConfigPath: midnightContractData.zkConfigPath,
      privateStateStoreName: "counter-private-state",
      privateStateId: "counterPrivateState",
      contractJoinTimeoutSeconds: 300,
      walletFundingTimeoutSeconds: 300,
      walletNetworkId: midnightNetworkConfig.id,
    },
    new Contract(witnesses),
    witnesses,
    midnightContractData.contractInfo,
    "parallelMidnight",
  );

// The balancing adapter handles delegated transactions from BatcherClient.
const midnightBalancingAdapter = new WerewolfBalancingAdapter(
    midnightNetworkConfig.walletSeed!,
    {
      indexer: midnightNetworkConfig.indexer,
      indexerWS: midnightNetworkConfig.indexerWS,
      node: midnightNetworkConfig.node,
      proofServer: midnightNetworkConfig.proofServer,
      zkConfigPath,
      walletNetworkId: midnightNetworkConfig.id,
    },
  );

export const config: BatcherConfig = {
  pollingIntervalMs: batchIntervalMs,
  adapters: {
    // paimaL2,
    ...(midnightAdapter ? { midnight: midnightAdapter } : {}),
    ...(midnightBalancingAdapter
      ? { midnight_balancing: midnightBalancingAdapter }
      : {}),
  },
  defaultTarget: midnightAdapter ? "midnight" : "midnight_balancing",
  namespace: "",
  batchingCriteria: {
    ...(midnightAdapter
      ? { midnight: { criteriaType: "time", timeWindowMs: batchIntervalMs } }
      : {}),
    ...(midnightBalancingAdapter
      ? {
        midnight_balancing: {
          criteriaType: "time",
          timeWindowMs: batchIntervalMs,
        },
      }
      : {}),
  },
  confirmationLevel: "wait-effectstream-processed", // Connector expectation
  enableHttpServer: true,
  enableEventSystem: true,
  port,
};

export const storage = new FileStorage("./batcher-data");
