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
import { valueToBigInt } from "@midnight-ntwrk/compact-runtime";
import {
  ensureTables,
  processLedgerSnapshot,
  getLeaderboard,
  getUserLeaderboardStats,
  resolveUserIdentity,
  getUserAchievements,
} from "./leaderboard-db.ts";
import { AlignedValue, StateValue } from "@midnight-ntwrk/ledger-v7";

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
          contract: {
            ledger: (state: StateValue) => {

              function decodeCell(av: AlignedValue): number | bigint | string {
                const atom = av.alignment[0];
                
                // Fallback for option/complex alignment
                if (atom?.tag !== 'atom') return alignedValueToHex(av);
              
                switch (atom.value.tag) {
                  case 'field':
                    // Guaranteed valid Fr — safe to use valueToBigInt
                    return valueToBigInt(av.value);
              
                  case 'bytes': {
                    // Raw LE bytes, possibly split across multiple 31-byte chunks.
                    // valueToBigInt will throw here — decode manually instead.
                    let result = 0n;
                    let shift = 0n;
                    for (const chunk of av.value) {
                      for (let i = 0; i < chunk.length; i++) {
                        result |= BigInt(chunk[i]) << shift;
                        shift += 8n;
                      }
                    }
                    return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : result;
                  }
              
                  case 'compress':
                    // Opaque cryptographic hash — no meaningful numeric value
                    return alignedValueToHex(av);
                }
              }
              
              // Convert an AlignedValue (raw field-aligned bytes) to a hex string for use as an object key
              function alignedValueToHex(av: AlignedValue): string {
                return "0x" + av.value
                  .map((chunk: Uint8Array) =>
                    Array.from(chunk).map((b) => b.toString(16).padStart(2, "0")).join("")
                  )
                  .join("");
              }

              function parseStateValue(sv: StateValue): any {
                const t = sv.type();

                if (t === "null") return null;
                if (t === "cell") return decodeCell(sv.asCell());   // returns AlignedValue — or wrap with alignedValueToHex() if you want a string
                if (t === "array") return sv.asArray()!.map(parseStateValue);

                if (t === "map") {
                  const m = sv.asMap()!;
                  return Object.fromEntries(
                    m.keys().map((k) => [
                      alignedValueToHex(k),          // ← AlignedValue → hex string key
                      parseStateValue(m.get(k)!)     // ← StateValue value, recurse normally
                    ])
                  );
                }

                if (t === "boundedMerkleTree") return sv.asBoundedMerkleTree()!.toString(true);

                throw new Error(`Unhandled StateValue type: "${t}"`);
              }

              return parseStateValue(state);
            }
          },
          networkId: midnightNetworkConfig.id,
        }),
      )
  )
  .build();

// Shared DB connection — set by apiRouter before any blocks are processed
let dbConn: any = null;

// Sequential queue: each DB write waits for the previous to finish,
// preventing concurrent writes across consecutive blocks.
let dbQueue = Promise.resolve();

const stm = new PaimaSTM<typeof grammar, {}>(grammar);
stm.addStateTransition("midnightContractState", function* (data) {
  console.log(data.parsedInput);
  try {
    if (!dbConn) return;
    const ledger = data.parsedInput as unknown as PVPContract.Ledger;
    dbQueue = dbQueue
      .then(() => processLedgerSnapshot(dbConn, ledger))
      .catch((err) => {
        console.error("[leaderboard] processLedgerSnapshot failed:", err);
      });
  } catch (err) {
    console.error("[leaderboard] processLedgerSnapshot failed:", err);
  }
});

const gameStateTransitions: StartConfigGameStateTransitions = function* (
  _blockHeight: number,
  input: BaseStfInput,
): SyncStateUpdateStream<void> {
  yield* stm.processInput(input);
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const apiRouter: StartConfigApiRouter = async function (
  server: any,
  db: any,
): Promise<void> {
  dbConn = db;
  await ensureTables(db);

  // --- existing primitive accounting endpoint ---
  server.get("/fetch-primitive-accounting", async () => {
    const result = await db.query(`SELECT * FROM effectstream.primitive_accounting`);
    return result.rows;
  });

  // --- GET /metrics ---
  server.get("/metrics", async () => {
    return {
      name: "PVP Arena",
      description: "Blockchain turn-based battle game on the Midnight Network.",
      achievements: [],
      channels: [
        {
          id: "leaderboard",
          name: "Wins",
          description: "Total match wins per player.",
          scoreUnit: "Wins",
          sortOrder: "DESC",
        },
      ],
    };
  });

  // --- GET /metrics/leaderboard ---
  server.get("/metrics/leaderboard", async (request: any) => {
    const { startDate, endDate, limit, offset } = request.query ?? {};
    return getLeaderboard(db, {
      startDate,
      endDate,
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
    });
  });

  // --- GET /metrics/users/:address ---
  server.get("/metrics/users/:address", async (request: any) => {
    const { address } = request.params;
    const { channel, startDate, endDate } = request.query ?? {};

    const now = new Date();
    const resolvedEnd = endDate ?? now.toISOString();
    const resolvedStart = startDate ?? new Date(now.getTime() - ONE_YEAR_MS).toISOString();

    const identity = await resolveUserIdentity(db, address);
    const achievements = await getUserAchievements(db, address);

    const response: Record<string, any> = { identity, achievements };

    if (!channel) return response;

    const channels: Record<string, any> = {};
    const channelList: string[] = Array.isArray(channel) ? channel : [channel];

    for (const ch of channelList) {
      if (ch === "leaderboard") {
        const stats = await getUserLeaderboardStats(db, address, resolvedStart, resolvedEnd);
        channels["leaderboard"] = {
          startDate: resolvedStart,
          endDate: resolvedEnd,
          stats: stats ?? { score: 0, rank: 0, matchesPlayed: 0 },
        };
      }
    }

    response.channels = channels;
    return response;
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
