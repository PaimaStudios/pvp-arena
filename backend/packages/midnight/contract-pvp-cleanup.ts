#!/usr/bin/env -S deno run -A --unstable-detect-cjs
/**
 * Clean up a finished PVP Arena match.
 *
 * Calls the `cleanup_match(matchId)` circuit on the deployed contract,
 * removing all ledger entries for a finished match.
 *
 * The caller must be the contract owner (using MIDNIGHT_BACKEND_SECRET)
 * or a participant in the match.
 *
 * Usage:
 *   MIDNIGHT_NETWORK_ID=undeployed \
 *   MIDNIGHT_STORAGE_PASSWORD="YourPasswordMy1!" \
 *   MIDNIGHT_BACKEND_SECRET="<hex-or-string>" \
 *   MIDNIGHT_CLEAN_SEED="<seed>" \
 *   deno run -A --unstable-detect-cjs contract-pvp-cleanup.ts <match_id>
 *
 * Arguments:
 *   match_id  The match ID (bigint or hex) to clean up
 */

import { Buffer } from "node:buffer";
import * as path from "@std/path";

import { setNetworkId } from "npm:@midnight-ntwrk/midnight-js-network-id@4.0.2";
import { findDeployedContract } from "npm:@midnight-ntwrk/midnight-js-contracts@4.0.2";
import { CompiledContract, type Contract as ContractType } from "npm:@midnight-ntwrk/compact-js@2.5.0";
import type { PrivateStateId, MidnightProviders, UnboundTransaction } from "npm:@midnight-ntwrk/midnight-js-types@4.0.2";
import type {
  CoinPublicKey,
  EncPublicKey,
  FinalizedTransaction,
  TransactionId,
} from "npm:@midnight-ntwrk/ledger-v8@8.0.3";
import { httpClientProofProvider } from "npm:@midnight-ntwrk/midnight-js-http-client-proof-provider@4.0.2";
import { indexerPublicDataProvider } from "npm:@midnight-ntwrk/midnight-js-indexer-public-data-provider@4.0.2";
import { levelPrivateStateProvider } from "npm:@midnight-ntwrk/midnight-js-level-private-state-provider@4.0.2";
import { NodeZkConfigProvider } from "npm:@midnight-ntwrk/midnight-js-node-zk-config-provider@4.0.2";

import { midnightNetworkConfig } from "jsr:@paimaexample/midnight-contracts/midnight-env";
import {
  buildWalletFacade,
  syncAndWaitForFunds,
  registerNightForDust,
  waitForDustFunds,
} from "jsr:@paimaexample/midnight-contracts";
import {
  Contract,
  createPVPArenaPrivateState,
  type PVPArenaPrivateState,
} from "./contract-pvp/src/index.ts";

// ============================================================================
// Constants
// ============================================================================

const TTL_DURATION_MS = 60 * 60 * 1000;

function createTtl(): Date {
  return new Date(Date.now() + TTL_DURATION_MS);
}

// ============================================================================
// Parse arguments
// ============================================================================

const matchIdArg = Deno.args[0];
if (!matchIdArg) {
  console.error("Usage: contract-pvp-cleanup.ts <match_id>");
  console.error("  match_id: The match ID (bigint or 0x-prefixed hex) to clean up");
  Deno.exit(1);
}

/**
 * The ledger parser emits match IDs as 0x-prefixed hex of raw little-endian
 * bytes (via alignedValueToHex). To pass them to a Compact circuit as a Field,
 * we must interpret those bytes as a little-endian bigint — the same conversion
 * that compact-runtime's valueToBigInt performs.
 */
function hexLeToFieldBigInt(hex: string): bigint {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  // Parse pairs of hex chars as LE bytes
  let result = 0n;
  for (let i = 0; i < raw.length; i += 2) {
    const byte = BigInt(parseInt(raw.slice(i, i + 2), 16));
    result |= byte << BigInt((i / 2) * 8);
  }
  return result;
}

const matchId = matchIdArg.startsWith("0x")
  ? hexLeToFieldBigInt(matchIdArg)
  : BigInt(matchIdArg);
console.log(`Match ID to clean up: ${matchId}`);

// ============================================================================
// Secret key for the owner
// ============================================================================

function getBackendSecret(): Uint8Array {
  const raw = Deno.env.get("MIDNIGHT_BACKEND_SECRET")!;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return new Uint8Array(Buffer.from(raw, "hex"));
  }
  const bytes = new TextEncoder().encode(raw);
  const key = new Uint8Array(32);
  key.set(bytes.slice(0, 32));
  return key;
}

// ============================================================================
// Load deployed contract address
// ============================================================================

function loadContractAddress(): string {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const networkId = midnightNetworkConfig.id;
  const filePath = path.join(here, `contract-pvp.${networkId}.json`);
  const data = JSON.parse(Deno.readTextFileSync(filePath));
  if (!data.contractAddress) {
    throw new Error(`No contractAddress found in ${filePath}`);
  }
  return data.contractAddress;
}

// ============================================================================
// Witnesses — override player_secret_key to use MIDNIGHT_BACKEND_SECRET
// ============================================================================

const backendSecret = getBackendSecret();

const witnesses = {
  player_secret_key: ({ privateState }: { privateState: PVPArenaPrivateState }): [PVPArenaPrivateState, Uint8Array] => [
    privateState,
    backendSecret,
  ],
  current_match_id: ({ privateState }: { privateState: PVPArenaPrivateState }): [PVPArenaPrivateState, bigint] => [
    privateState,
    privateState.currentMatchId!,
  ],
  player_commands: ({ privateState }: { privateState: PVPArenaPrivateState }): [PVPArenaPrivateState, bigint[]] => [
    privateState,
    privateState.commands,
  ],
  player_stances: ({ privateState }: { privateState: PVPArenaPrivateState }): [PVPArenaPrivateState, any[]] => [
    privateState,
    privateState.stances,
  ],
};

// ============================================================================
// Main
// ============================================================================

const networkId = midnightNetworkConfig.id as import("npm:@midnight-ntwrk/wallet-sdk-abstractions@2.0.0").NetworkId.NetworkId;
setNetworkId(networkId);

const contractAddress = loadContractAddress();
console.log(`Network: ${networkId}`);
console.log(`Contract: ${contractAddress}`);

const NETWORK = {
  indexer: midnightNetworkConfig.indexer,
  indexerWS: midnightNetworkConfig.indexerWS,
  node: midnightNetworkConfig.node,
  proofServer: midnightNetworkConfig.proofServer,
};

// Check proof server
try {
  const resp = await fetch(`${NETWORK.proofServer}/health`);
  const data = await resp.json();
  if (data.status !== "ok") throw new Error("unhealthy");
  console.log("Proof server: OK");
} catch {
  console.error(`Proof server not running at ${NETWORK.proofServer}`);
  Deno.exit(1);
}

// Build wallet
console.log("\n--- Building wallet ---");
const walletSeed = Deno.env.get("MIDNIGHT_CLEAN_SEED")!;
const walletResult = await buildWalletFacade(NETWORK as any, walletSeed, networkId);
console.log(`Unshielded address: ${walletResult.unshieldedAddress}`);

console.log("Syncing wallet...");
const balances = await syncAndWaitForFunds(walletResult.wallet, {
  waitNonZero: false,
  timeoutMs: 300_000,
} as any);
console.log(`Shielded: ${balances.shieldedBalance}, Unshielded: ${balances.unshieldedBalance}, Dust: ${balances.dustBalance}`);

if (balances.dustBalance === 0n && balances.unshieldedBalance > 0n) {
  console.log("Registering NIGHT for dust...");
  await registerNightForDust(walletResult);
  const dust = await waitForDustFunds(walletResult.wallet, { waitNonZero: true, timeoutMs: 300_000 });
  console.log(`Dust balance after registration: ${dust}`);
}

// Set up providers
const here = path.dirname(path.fromFileUrl(import.meta.url));
const managedDir = path.resolve(path.join(here, "contract-pvp/src/managed"));
const zkConfigPath = path.resolve(path.join(managedDir, "pvp"));
const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);

const walletAndMidnightProvider = {
  getCoinPublicKey(): CoinPublicKey {
    return walletResult.zswapSecretKeys.coinPublicKey;
  },
  getEncryptionPublicKey(): EncPublicKey {
    return walletResult.zswapSecretKeys.encryptionPublicKey;
  },
  async balanceTx(tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction> {
    const bound = tx.bind();
    const recipe = await walletResult.wallet.balanceFinalizedTransaction(bound, {
      shieldedSecretKeys: walletResult.zswapSecretKeys,
      dustSecretKey: walletResult.dustSecretKey,
    }, { ttl: ttl ?? createTtl() });
    const signed = await walletResult.wallet.signRecipe(recipe, (payload: Uint8Array) =>
      walletResult.unshieldedKeystore.signData(payload),
    );
    return walletResult.wallet.finalizeRecipe(signed);
  },
  submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
    return walletResult.wallet.submitTransaction(tx);
  },
};

const providers: MidnightProviders = {
  privateStateProvider: levelPrivateStateProvider({
    midnightDbName: "midnight-level-db-pvp-cleanup",
    privateStateStoreName: "pvp-private-state-cleanup",
    signingKeyStoreName: "pvp-signing-keys-cleanup",
    privateStoragePasswordProvider: async () => Deno.env.get("MIDNIGHT_STORAGE_PASSWORD") ?? "YourPasswordMy1!",
    accountId: Buffer.from(walletResult.zswapSecretKeys.coinPublicKey).toString("hex"),
  }),
  publicDataProvider: indexerPublicDataProvider(NETWORK.indexer, NETWORK.indexerWS),
  zkConfigProvider,
  proofProvider: httpClientProofProvider(NETWORK.proofServer, zkConfigProvider),
  walletProvider: walletAndMidnightProvider,
  midnightProvider: walletAndMidnightProvider,
};

// Find deployed contract
console.log("\n--- Finding deployed contract ---");

const pvpCompiledContract = CompiledContract.make("contract-pvp", Contract as any).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets(managedDir),
);

const initialPrivateState = createPVPArenaPrivateState(backendSecret) as ContractType.PrivateState<any>;

const foundContract = await findDeployedContract(providers, {
  contractAddress,
  compiledContract: pvpCompiledContract as any,
  privateStateId: "pvpPrivateState" as PrivateStateId,
  initialPrivateState,
});

console.log(`Contract found. Calling cleanup_match(${matchId})...`);

// Call cleanup_match
try {
  await (foundContract.callTx as any).cleanup_match(matchId);
  console.log(`cleanup_match(${matchId}) succeeded — match ledger entries removed.`);
} catch (err) {
  console.error("cleanup_match() failed:", err instanceof Error ? err.message : err);
  Deno.exit(1);
}

// Cleanup
await walletResult.wallet.stop();
console.log("Done.");
Deno.exit(0);
