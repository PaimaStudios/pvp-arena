import {
  init,
  start,
  type StartConfigApiRouter,
  type StartConfigGameStateTransitions,
} from "@paimaexample/runtime";
import { main, suspend } from "effection";
import {
  toSyncProtocolWithNetwork,
  withEffectstreamStaticConfig,
} from "@paimaexample/config";
import {
  ConfigBuilder,
  ConfigNetworkType,
  ConfigSyncProtocolType,
} from "@paimaexample/config";
import { Type } from "@sinclair/typebox";
import type { GrammarDefinition } from "@paimaexample/concise";
import type { SyncStateUpdateStream } from "@paimaexample/coroutine";
import { PaimaSTM } from "@paimaexample/sm";
import type { BaseStfInput } from "@paimaexample/sm";
import {
  midnightNetworkConfig,
} from "@paimaexample/midnight-contracts/midnight-env";
import { PrimitiveTypeMidnightGeneric, PrimitiveTypeUtxorpcGeneric } from "@paimaexample/sm/builtin";
import * as PVPContract from "@pvp-arena-backend/midnight-contracts/pvp";
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import * as path from "@std/path";
import { builtinGrammars } from "@paimaexample/sm/grammar";

const grammar = {
  midnightContractState: builtinGrammars.midnightGeneric,
} as const satisfies GrammarDefinition;


const counterAddress = readMidnightContract(
  "contract-pvp",
  { 
    baseDir: path.resolve(import.meta.dirname!, "..", "midnight"),
    networkId: midnightNetworkConfig.id,
  },
).contractAddress;

if (!counterAddress) {
  throw new Error("Counter address not found");
} else {
  console.log("Counter address found:", counterAddress);
}

export const localhostConfig = new ConfigBuilder()
  .setNamespace(
    (builder) => builder.setSecurityNamespace("pvp-arena"),
  )
  .buildNetworks((builder) =>
    builder
      .addNetwork({
        name: "ntp",
        type: ConfigNetworkType.NTP,
        startTime: new Date().getTime(),
        blockTimeMS: 1000,
      })
      .addNetwork({
        name: "midnight",
        type: ConfigNetworkType.MIDNIGHT,
        networkId: midnightNetworkConfig.id,
        nodeUrl: midnightNetworkConfig.node,
      })
  )
  .buildDeployments((builder) => builder).buildSyncProtocols((builder) =>
    builder
      .addMain(
        (networks) => networks.ntp,
        (network, deployments) => ({
          name: "mainNtp",
          type: ConfigSyncProtocolType.NTP_MAIN,
          chainUri: "",
          startBlockHeight: 1,
          pollingInterval: 1000,
        }),
      )
      .addParallel(
        (networks) => (networks as any).midnight,
        (network, deployments) => ({
          name: "parallelMidnight",
          type: ConfigSyncProtocolType.MIDNIGHT_PARALLEL,
          startBlockHeight: 1,
          pollingInterval: 1000,
          delayMs: 18000,
          indexer: midnightNetworkConfig.indexer,
          indexerWs: midnightNetworkConfig.indexerWS,
        }),
      )
  )
  .buildPrimitives((builder) =>
    builder
      .addPrimitive(
        (syncProtocols) => (syncProtocols as any).parallelMidnight,
        (network, deployments, syncProtocol) => ({
          name: "MidnightContractState",
          type: PrimitiveTypeMidnightGeneric,
          startBlockHeight: 1,
          contractAddress: counterAddress,
          stateMachinePrefix: "midnightContractState",
          contract: { ledger: PVPContract.ledger },
          networkId: midnightNetworkConfig.id,
        }),
      )
  )
  .build();

const stm = new PaimaSTM<typeof grammar, {}>(grammar);
stm.addStateTransition("midnightContractState", function* (data) {
  console.log("--------------------------------");
  console.log("State Transition Function");
  console.log("Input Data:", data.parsedInput);
  console.log("--------------------------------");

  return;
});

const gameStateTransitions: StartConfigGameStateTransitions = function* (
  _blockHeight: number,
  input: BaseStfInput,
): SyncStateUpdateStream<void> {
  yield* stm.processInput(input);
};

export const apiRouter: StartConfigApiRouter = async function (
  server: any, // fastify.FastifyInstance,
  dbConn: any, // Pool,
): Promise<void> {
  server.get("/fetch-primitive-accounting", async () => {
    const result = await dbConn.query(
      `SELECT * FROM effectstream.primitive_accounting`,
    );
    return result.rows;
  });
};

main(function* () {
  yield* init();
  console.log("Starting EffectStream Node");

  yield* withEffectstreamStaticConfig(localhostConfig, function* () {
    yield* start({
      appName: "minimal-client",
      appVersion: "1.0.0",
      syncInfo: toSyncProtocolWithNetwork(localhostConfig),
      gameStateTransitions,
      migrations: undefined,
      apiRouter,
      grammar,
    });
  });

  yield* suspend();
});
