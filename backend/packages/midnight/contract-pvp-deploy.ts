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

// ---------------------------------------------------------------------------
// Env → frontend file mapping
// ---------------------------------------------------------------------------

type EnvMapping = {
  envFile: string;
  addressExport: string;
};

const ENV_MAP: Record<string, EnvMapping> = {
  undeployed: {
    envFile: ".env.undeployed",
    addressExport: "UNDEPLOYED_CONTRACT_ADDRESS",
  },
  preprod: {
    envFile: ".env.testnet",
    addressExport: "PREPROD_CONTRACT_ADDRESS",
  },
  mainnet: {
    envFile: ".env.mainnet",
    addressExport: "MAINNET_CONTRACT_ADDRESS",
  },
};

function getEnvMapping(networkId: string): EnvMapping {
  const mapping = ENV_MAP[networkId];
  if (!mapping) {
    throw new Error(
      `No frontend env mapping for MIDNIGHT_NETWORK_ID="${networkId}". ` +
      `Valid values: ${Object.keys(ENV_MAP).join(", ")}`,
    );
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Update frontend files with the deployed contract address
// ---------------------------------------------------------------------------

async function updateFrontendEnv(contractAddress: string): Promise<void> {
  const networkId = midnightNetworkConfig.id;
  const mapping = getEnvMapping(networkId);

  const here = dirname(fromFileUrl(import.meta.url));
  const root = join(here, "../../..");

  // 1. Update the corresponding .env.* file
  const envPath = join(root, "frontend/src/phaser", mapping.envFile);
  const envContent = await Deno.readTextFile(envPath);

  if (envContent.match(/^VITE_CONTRACT_ADDRESS=/m)) {
    const updatedEnv = envContent.replace(
      /^VITE_CONTRACT_ADDRESS=.*$/m,
      `VITE_CONTRACT_ADDRESS=${contractAddress}`,
    );
    await Deno.writeTextFile(envPath, updatedEnv);
  } else {
    // Append if not present
    await Deno.writeTextFile(envPath, envContent.trimEnd() + `\nVITE_CONTRACT_ADDRESS=${contractAddress}\n`);
  }
  console.log(`Updated ${envPath} with VITE_CONTRACT_ADDRESS=${contractAddress}`);

  // 2. Update contract-addresses.ts (the matching export)
  const addrPath = join(root, "frontend/src/phaser/src/contract-addresses.ts");
  const addrContent = await Deno.readTextFile(addrPath);
  const exportPattern = new RegExp(
    `^export const ${mapping.addressExport} = '.*';$`,
    "m",
  );
  const updatedAddr = addrContent.replace(
    exportPattern,
    `export const ${mapping.addressExport} = '${contractAddress}';`,
  );
  await Deno.writeTextFile(addrPath, updatedAddr);
  console.log(`Updated ${addrPath} with ${mapping.addressExport}=${contractAddress}`);
}

// ---------------------------------------------------------------------------
// CLI: deploy or patch-frontend-env
// ---------------------------------------------------------------------------

const command = Deno.args[0];

if (command === "patch-frontend-env") {
  // Standalone mode: read the already-deployed contract address and patch frontend files.
  // Usage: deno run -A contract-pvp-deploy.ts patch-frontend-env
  const { readMidnightContract } = await import("@paimaexample/midnight-contracts/read-contract");
  const data = readMidnightContract("contract-pvp", {
    baseDir: dirname(fromFileUrl(import.meta.url)),
    networkId: midnightNetworkConfig.id,
  });
  if (!data.contractAddress) {
    console.error("No deployed contract address found for network:", midnightNetworkConfig.id);
    Deno.exit(1);
  }
  console.log(`Patching frontend env for network "${midnightNetworkConfig.id}" with address: ${data.contractAddress}`);
  await updateFrontendEnv(data.contractAddress);
  Deno.exit(0);
} else {
  // Default: deploy the contract
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
}
