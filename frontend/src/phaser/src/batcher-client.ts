import { fromHex, toHex } from "@midnight-ntwrk/compact-runtime";
import type { UnboundTransaction, WalletProvider } from "@midnight-ntwrk/midnight-js-types";

// Default batcher URL. In browser environments, this should be overridden via the constructor if different.
const DEFAULT_BATCHER_URL = "http://localhost:3334";

/** Sentinel message thrown by balanceTx when the delegation hook intercepts the transaction. */
export const DELEGATED_SENTINEL = "Delegated balancing flow handed off to batcher";

type DelegatedTxStage = "unproven" | "unbound" | "finalized";

/**
 * BatcherClient provides a wrapper for the moderator to invoke administrative
 * actions on the Werewolf contract via a delegated batcher.
 *
 * Instead of creating its own wallet and contract join (which causes WASM
 * StateValue dual-instantiation issues in browser/Vite environments), it
 * leverages the __delegatedBalanceHook mechanism already built into the
 * createWalletAndMidnightProvider provider from contract.ts.
 *
 * The Midnight Compact Runtime evaluates the circuit and builds the unproven
 * transaction locally. The provider now attempts wallet balancing first with
 * `payFees: false`, and only falls back to `__delegatedBalanceHook` if wallet
 * balancing fails. In delegated fallback mode, we intercept the transaction and
 * send it to the batcher, which then completes balancing/finalizing/submitting.
 */
export class BatcherClient {

  /**
   * @param contract - The Lace-joined Werewolf contract instance (with callTx methods)
   * @param provider - The wallet+midnight provider object returned by createWalletAndMidnightProvider.
   *                   This must be the SAME object reference used by the contract's providers,
   *                   as we set __delegatedBalanceHook on it to intercept balanceTx.
   * @param batcherUrl - URL of the batcher's /send-input endpoint (default: http://localhost:3334)
   */

  /**
   * Returns true if the error originated from our delegation hook sentinel.
   */
  private isDelegationError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    // Check the full error chain — the SDK may wrap the sentinel in another error
    let current: Error | undefined = error;
    while (current) {
      if (current.message.includes(DELEGATED_SENTINEL)) return true;
      current = current.cause instanceof Error ? current.cause : undefined;
    }
    return false;
  }

  /**
   * Detect serialized ledger stage to avoid txStage mismatch errors in the batcher.
   */
  public static detectTxStage(serializedTx: string): DelegatedTxStage {
    // Transaction headers are ASCII:
    // midnight:transaction[v9](signature[v1],<proof-marker>,<binding-marker>):
    // We parse only the prefix to map to the batcher's expected txStage.
    const prefixHex = serializedTx.slice(0, 600).padEnd(600, "0");
    const prefixBytes = fromHex(prefixHex);
    const header = new TextDecoder().decode(prefixBytes);

    const markerMatch = header.match(
      /midnight:transaction\[v\d+\]\(signature\[v\d+\],([^,]+),([^)]+)\):/,
    );

    if (!markerMatch) {
      throw new Error(
        `[BatcherClient] Could not parse transaction header markers from: ${
          header.slice(0, 120)
        }`,
      );
    }

    const proofMarker = markerMatch[1];
    const bindingMarker = markerMatch[2];

    if (proofMarker.includes("proof-preimage")) return "unproven";
    if (bindingMarker.includes("embedded-fr")) return "unbound";
    if (bindingMarker.includes("pedersen-schnorr")) return "finalized";

    throw new Error(
      `[BatcherClient] Unknown tx markers proof=${proofMarker} binding=${bindingMarker}`,
    );
  }

  static circuitName = "";
  public static setCircuitName(circuitName: string) {
    this.circuitName = circuitName;
  }

  public static async delegatedBalanceHook(
    tx: UnboundTransaction,
    // _newCoins?: any,
    // _ttl?: Date,
  ): Promise<void> {
    let serializedTx = toHex(tx.serialize());

    // Attempt to bind the transaction if the method exists
    if (typeof tx.bind === "function") {
      try {
        serializedTx = toHex(tx.bind().serialize());
      } catch (e) {
        // console.warn(`[BatcherClient] Failed to bind ${circuitName} tx`, e);
      }
    }

    const txStage = this.detectTxStage(serializedTx);

    // Post to batcher immediately
    if (!this.circuitName) {
      console.error("Circuit name not set");
    }
    await this.postToBatcher(serializedTx, this.circuitName, txStage);
    BatcherClient.setCircuitName('');

    // Throw sentinel to safely abort the rest of the Midnight SDK pipeline
    throw new Error(DELEGATED_SENTINEL);
  };

  private static async postToBatcher(
    serializedTx: string,
    circuitId: string,
    txStage: DelegatedTxStage = "finalized",
  ): Promise<void> {
    console.log(
      `🔍 [BatcherClient] Posting to Batcher at ${DEFAULT_BATCHER_URL}/send-input...`,
    );
    const body = {
      data: {
        target: "midnight_balancing",
        address: "moderator_trusted_node", // Mock address
        addressType: 0,
        input: JSON.stringify({
          tx: serializedTx,
          txStage: txStage,
          circuitId: circuitId,
        }),
        timestamp: Date.now(),
      },
      confirmationLevel: "wait-receipt",
    };

    try {
      const response = await fetch(`${DEFAULT_BATCHER_URL}/send-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `❌ [BatcherClient] Batcher rejected transaction (HTTP ${response.status}):`,
          text,
        );
        throw new Error(`Batcher rejected transaction: ${text}`);
      }

      const result = await response.json();
      if (!result.success) {
        console.error(`❌ [BatcherClient] Batcher failed:`, result.message);
        throw new Error(`Batcher failed: ${result.message}`);
      }

      console.log(
        `✅ [BatcherClient] ${circuitId} submitted successfully via batcher!`,
      );
    } catch (e) {
      console.error(`❌ [BatcherClient] Network error calling batcher:`, e);
      throw e;
    }
  }

}