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
import type { GrammarDefinition } from "@paimaexample/concise";
import type { SyncStateUpdateStream } from "@paimaexample/coroutine";
import { PaimaSTM } from "@paimaexample/sm";
import type { BaseStfInput } from "@paimaexample/sm";
import {
  midnightNetworkConfig,
} from "@paimaexample/midnight-contracts/midnight-env";
import { PrimitiveTypeMidnightGeneric, PrimitiveTypeUtxorpcGeneric } from "@paimaexample/sm/builtin";
// import * as PVPContract from "@pvp-arena-backend/midnight-contracts/pvp";
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import * as path from "@std/path";
import { builtinGrammars } from "@paimaexample/sm/grammar";
import { valueToBigInt } from "@midnight-ntwrk/compact-runtime";
import {
  ensureTables,
  processLedgerSnapshot,
  processDelegations,
  getLeaderboard,
  getUserLeaderboardStats,
  resolveUserIdentity,
  getUserAchievements,
} from "./leaderboard-db.ts";
import type { AlignedValue, StateValue } from "@midnight-ntwrk/ledger-v7";

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
  // NOTE This will change if there are changes in the contract pvp.compact
  console.log(data.parsedInput);
  const { payload } = data.parsedInput;
  const game_state = payload["3"][8] as Record<string, number>;

  const game_state_map = {
      0: 'p1_selecting_first_hero', 
      1: 'p2_selecting_first_heroes', 
      2: 'p1_selecting_last_heroes', 
      3: 'p2_selecting_last_hero', 
      4: 'p1_commit', 
      5: 'p2_commit_reveal', 
      6: 'p1_reveal', 
      7: 'p1_win', 
      8: 'p2_win', 
      9: 'tie',
    };

    for (const [key, value] of Object.entries(game_state)) {
      const gameId = key;
      const currentState = game_state_map[value as unknown as keyof typeof game_state_map];
      console.log(`Game ID: ${gameId}, Current State: ${currentState}`);
    }
  

  // Reference of the payload:
  // payload["0"] — state.asArray()[0]
  // IndexVariable[0](internal — compact map bookkeeping, value 600)[1](internal — compact map bookkeeping, value 12)[2]p1_heroes[3]p1_stats[4]p1_cmds
  //
  // payload["1"] — state.asArray()[1]
  // IndexVariable[0]p1_stances[1]p1_dmg_0[2]p1_dmg_1[3]p1_dmg_2[4]p1_commit[5]p2_heroes[6]p2_stats[7]p2_cmds[8]p2_stances[9]p2_dmg_0[10]p2_dmg_1[11]p2_dmg_2[12]p1_alive_0[13]p1_alive_1[14]p1_alive_2
  //
  // payload["2"] — state.asArray()[2]
  // IndexVariable[0]p2_alive_0[1]p2_alive_1[2]p2_alive_2[3]base_damage_cache_p1_0_0[4]base_damage_cache_p1_0_1[5]base_damage_cache_p1_0_2[6]base_damage_cache_p1_1_0[7]base_damage_cache_p1_1_1[8]base_damage_cache_p1_1_2[9]base_damage_cache_p1_2_0[10]base_damage_cache_p1_2_1[11]base_damage_cache_p1_2_2[12]base_damage_cache_p2_0_0[13]base_damage_cache_p2_0_1[14]base_damage_cache_p2_0_2
  //
  // payload["3"] — state.asArray()[3]
  // IndexVariable[0]base_damage_cache_p2_1_0[1]base_damage_cache_p2_1_1[2]base_damage_cache_p2_1_2[3]base_damage_cache_p2_2_0[4]base_damage_cache_p2_2_1[5]base_damage_cache_p2_2_2[6]commit_nonce[7]round[8]game_state[9]p1_public_key[10]p2_public_key[11]public_[12]is_practice[13]last_move_at[14]next_match_id

  // Example payload:
  //   payload: {
  //     "0": [
  //       600,
  //       12,
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {}
  //     ],
  //     "1": [
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 65793,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 65793
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {},
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {},
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 65793,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 65793
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 1,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 1
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 1,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 1
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 1,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 1
  //       }
  //     ],
  //     "2": [
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 1,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 1
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 1,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 1
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 1,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 1
  //       },
  //       {},
  //       {},
  //       {},
  //       {},
  //       {},
  //       {},
  //       {},
  //       {},
  //       {},
  //       {},
  //       {},
  //       {}
  //     ],
  //     "3": [
  //       {},
  //       {},
  //       {},
  //       {},
  //       {},
  //       {},
  //       {},
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": "4611689071735538560854677883043658026309498247298717974496808757207201633797",
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": "9836755165736853202422971897605447363240842702078111720525461522160739902198"
  //       },
  //       {},
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 1
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 0,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 0
  //       },
  //       {
  //         "0x6cd67a122bd571f2acfc37868c15de9a54ed43e2eb101d6b9df178828601026d": 1773155022,
  //         "0x89671c951f59d37a037ce0df57aea1b3f736ff970bac965e2012729ac15b3d37": 1773155022
  //       },
  //       180
  //     ]
  //   }
  // }

  // payload["4"] — state.asArray()[4] (added by delegation feature)
  // IndexVariable[0]delegations
  // NOTE: The exact index depends on the compact compiler output.
  // After running `yarn compact`, verify by inspecting the generated code
  // or by logging the payload. Adjust "4"][0] if needed.

  try {
    if (!dbConn) return;
    dbQueue = dbQueue
      .then(async () => {
        await processLedgerSnapshot(dbConn, payload);
        // Process delegation map — located after TIMESTAMP_MAX_AGE in the ledger
        const delegationsMap = payload["4"]?.[0] as Record<string, string> | undefined;
        if (delegationsMap && typeof delegationsMap === 'object') {
          await processDelegations(dbConn, delegationsMap);
        }
      })
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
