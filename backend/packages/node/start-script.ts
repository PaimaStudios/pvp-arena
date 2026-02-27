import {
  OrchestratorConfig,
  start,
} from "@paimaexample/orchestrator";
import { ComponentNames } from "@paimaexample/log";
import { Value } from "@sinclair/typebox/value";
import { launchMidnight } from "@paimaexample/orchestrator/start-midnight";


const config = Value.Parse(OrchestratorConfig, {
  packageName: "@paimaexample",
  logs: "stdout",
  processes: {
    // Launch Dev DB & Collector
    [ComponentNames.EFFECTSTREAM_PGLITE]: true,
    [ComponentNames.COLLECTOR]: false,
    [ComponentNames.TMUX]: false,
    [ComponentNames.TUI]: false,
  },

  // Launch my processes
  processesToLaunch: [
    ...launchMidnight("@pvp-arena-backend/midnight-contracts").map(p => {
      p.logsStartDisabled = false;
      p.disableStderr = false;
      p.logs = 'raw';
      return p;
    }),
    {
      name: "batcher",
      args: ["task", "-f", "@pvp-arena-backend/batcher", "start"],
      waitToExit: false,
      type: "system-dependency",
      link: "http://localhost:3334",
      stopProcessAtPort: [3334],
      dependsOn: [ComponentNames.MIDNIGHT_CONTRACT],
    },
  ],
  // Launch the Batcher with our PaimaL2 Contract
  // batcher: {
  //   batchIntervalMs: 100,
  //   paimaL2Address: contractAddressesEvmMain()["chain31337"][
  //     "PaimaL2ContractModule#MyPaimaL2Contract"
  //   ],
  //   paimaSyncProtocolName: "parallelEvmRPC_fast",
  //   batcherPrivateKey:`
  //     "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  //   chainName: "hardhat",
  // },
});

await start(config);
