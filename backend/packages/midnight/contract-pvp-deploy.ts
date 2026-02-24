import { deployMidnightContract, type DeployConfig } from "@paimaexample/midnight-contracts";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import {
  Contract,
  createPVPArenaPrivateState,
  type PVPArenaPrivateState,
  witnesses,
} from "./contract-pvp/src/index.ts";

const config: DeployConfig = {
  contractName: "contract-pvp",
  contractFileName: "contract-pvp.json",
  contractClass: Contract,
  witnesses: witnesses,
  privateStateId: "pvpPrivateState",
  initialPrivateState: createPVPArenaPrivateState(
    crypto.getRandomValues(new Uint8Array(32)),
  ) as PVPArenaPrivateState,
  privateStateStoreName: "pvp-private-state",
};


console.log("Deploying contract with network config:", midnightNetworkConfig);

deployMidnightContract(config, midnightNetworkConfig)
  .then(() => {
    console.log("Deployment successful");
    Deno.exit(0);
  })
  .catch((e) => {
    console.error("Unhandled error:", e);
    Deno.exit(1);
  });
