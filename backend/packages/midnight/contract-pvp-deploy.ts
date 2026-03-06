import { deployMidnightContract, type DeployConfig } from "@paimaexample/midnight-contracts";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import {
  Contract,
  createPVPArenaPrivateState,
  type PVPArenaPrivateState,
  witnesses,
} from "./contract-pvp/src/index.ts";
import { fromFileUrl, dirname, join } from "@std/path";

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

async function updateFrontendEnv(contractAddress: string): Promise<void> {
  const here = dirname(fromFileUrl(import.meta.url));
  const root = join(here, "../../..");

  // Update .env.undeployed
  const envPath = join(root, "frontend/src/phaser/.env.undeployed");
  const envContent = await Deno.readTextFile(envPath);
  const updatedEnv = envContent.replace(
    /^VITE_CONTRACT_ADDRESS=.*$/m,
    `VITE_CONTRACT_ADDRESS=${contractAddress}`,
  );
  await Deno.writeTextFile(envPath, updatedEnv);
  console.log(`Updated ${envPath} with VITE_CONTRACT_ADDRESS=${contractAddress}`);

  // Update contract-addresses.ts
  const addrPath = join(root, "frontend/src/phaser/src/contract-addresses.ts");
  const addrContent = await Deno.readTextFile(addrPath);
  const updatedAddr = addrContent.replace(
    /^export const UNDEPLOYED_CONTRACT_ADDRESS = '.*';$/m,
    `export const UNDEPLOYED_CONTRACT_ADDRESS = '${contractAddress}';`,
  );
  await Deno.writeTextFile(addrPath, updatedAddr);
  console.log(`Updated ${addrPath} with UNDEPLOYED_CONTRACT_ADDRESS=${contractAddress}`);
}

console.log("Deploying contract with network config:", midnightNetworkConfig);

deployMidnightContract(config, midnightNetworkConfig)
  .then(async (contractAddress) => {
    console.log("Deployment successful");
    if (contractAddress) {
      await updateFrontendEnv(contractAddress);
    }
    Deno.exit(0);
  })
  .catch((e) => {
    console.error("Unhandled error:", e);
    Deno.exit(1);
  });
