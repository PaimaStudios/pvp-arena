import {
  OrchestratorConfig,
  start,
} from "@paimaexample/orchestrator";
import { ComponentNames } from "@paimaexample/log";
import { Value } from "@sinclair/typebox/value";

// Mainnet: no local Midnight services (node/indexer/proof-server).
// Only EffectStream DB + Batcher are launched locally.
const config = Value.Parse(OrchestratorConfig, {
  packageName: "@paimaexample",
logs: "stdout",
  processes: {
    [ComponentNames.EFFECTSTREAM_PGLITE]: true,
    [ComponentNames.COLLECTOR]: false,
    [ComponentNames.TMUX]: false,
    [ComponentNames.TUI]: false,
  },

  processesToLaunch: [
    // {
    //   name: "batcher",
    //   args: ["task", "-f", "@pvp-arena-backend/batcher", "start"],
    //   env: {
    //     MIDNIGHT_NETWORK_ID: "mainnet",
    //   },
    //   waitToExit: false,
    //   type: "system-dependency",
    //   link: "http://localhost:3334",
    //   stopProcessAtPort: [3334],
    // },
  ],
});

await start(config);
