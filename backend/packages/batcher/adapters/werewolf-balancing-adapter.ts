import {
  type MidnightBalancingAdapterConfig,
  type DefaultBatcherInput,
} from "@paimaexample/batcher";
import * as fs from "node:fs";

import { MidnightBalancingAdapterX, DustSyncTimeoutError } from "./base-adapter.ts";
import type { BlockchainHash, BlockchainTransactionReceipt } from "./adapter.ts";

const DROPPED_HASH_PREFIX = "DROPPED:invalid-proof:";

/** Returns true if the error (or any cause in its chain) is a TransactionInvalidError. */
function isTransactionInvalidError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if ((e as { _tag?: string })._tag === "TransactionInvalidError") return true;
  if (e.message.includes("TransactionInvalidError")) return true;
  return e.cause instanceof Error ? isTransactionInvalidError(e.cause) : false;
}

export type ValidationResult = {
  valid: boolean;
  error?: string;
};

/**
 * Werewolf-specific Midnight Balancing Adapter.
 * Inherits from the official MidnightBalancingAdapter and allows for custom game logic.
 */
export class WerewolfBalancingAdapter extends MidnightBalancingAdapterX {
  private isResyncing = false;

  constructor(walletSeed: string, config: MidnightBalancingAdapterConfig) {
    super(walletSeed, config);
  }

  override isReady(): boolean {
    return super.isReady() && !this.isResyncing;
  }

  private async resyncWallet(): Promise<void> {
    if (this.isResyncing) return;
    this.isResyncing = true;

    const time = new Date().toISOString();
    console.warn(`\n[WerewolfAdapter] ── WALLET RESYNC STARTED ────────────────`);
    console.warn(`[WerewolfAdapter]   time : ${time}`);
    console.warn(`[WerewolfAdapter]   isReady() will return false until resync completes`);
    console.warn(`[WerewolfAdapter] ───────────────────────────────────────────\n`);
    this.appendSubmitLog(`[${time}] WALLET RESYNC started — queue paused\n`);

    try {
      await this.ensureFunds();
      const doneTime = new Date().toISOString();
      console.log(`\n[WerewolfAdapter] ── WALLET RESYNC COMPLETE ───────────────`);
      console.log(`[WerewolfAdapter]   time : ${doneTime}`);
      console.log(`[WerewolfAdapter]   Queue will resume on next poll`);
      console.log(`[WerewolfAdapter] ───────────────────────────────────────────\n`);
      this.appendSubmitLog(`[${doneTime}] WALLET RESYNC complete — queue resumed\n\n`);
    } catch (e) {
      const errTime = new Date().toISOString();
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`\n[WerewolfAdapter] ── WALLET RESYNC FAILED ─────────────────`);
      console.error(`[WerewolfAdapter]   time  : ${errTime}`);
      console.error(`[WerewolfAdapter]   error : ${errMsg}`);
      console.error(`[WerewolfAdapter]   Will retry on next submit attempt`);
      console.error(`[WerewolfAdapter] ───────────────────────────────────────────\n`);
      this.appendSubmitLog(`[${errTime}] WALLET RESYNC failed — error=${errMsg}\n\n`);
    } finally {
      this.isResyncing = false;
    }
  }

  /**
   * Custom validation for werewolf-related inputs.
   * This can be extended later with specific circuit argument checks.
   */
  private appendIntentLog(entry: string): void {
    try {
      fs.appendFileSync("intent-logs.txt", entry);
    } catch (e) {
      console.warn("Failed to write intent log:", e);
    }
  }

  override validateInput(input: DefaultBatcherInput): ValidationResult {
    const time = new Date().toISOString();

    console.log(`\n[WerewolfAdapter] ── VALIDATE-INPUT ────────────────────────`);
    console.log(`[WerewolfAdapter]   time    : ${time}`);
    console.log(`[WerewolfAdapter]   target  : ${input.target ?? 'unknown'}`);
    console.log(`[WerewolfAdapter]   input   : ${JSON.stringify(input).slice(0, 100)}...`);
    console.log(`[WerewolfAdapter] ───────────────────────────────────────────`);
    this.appendIntentLog(`[${time}] VALIDATE-INPUT | target=${input.target ?? 'unknown'} input=${JSON.stringify(input)}\n`);

    // 1. Basic hex/JSON validation from base class
    const basicValidation = super.validateInput(input);
    if (!basicValidation.valid) {
      const errEntry = `[${new Date().toISOString()}] VALIDATE-INPUT invalid | error=${basicValidation.error}\n\n`;
      console.warn(`[WerewolfAdapter]   invalid : ${basicValidation.error}`);
      this.appendIntentLog(errEntry);
      return basicValidation;
    }

    // 2. Custom Werewolf logic (can be added here)
    // For now, it just passes through.

    this.appendIntentLog(`[${new Date().toISOString()}] VALIDATE-INPUT ok\n\n`);
    return { valid: true };
  }

  private appendSubmitLog(entry: string): void {
    try {
      fs.appendFileSync("submit-logs.txt", entry);
    } catch (e) {
      console.warn("Failed to write submit log:", e);
    }
  }

  override async submitBatch(
    ...args: Parameters<MidnightBalancingAdapterX['submitBatch']>
  ): Promise<BlockchainHash> {
    const [batchData] = args;
    const circuit = this.currentCircuitId ?? 'unknown';
    const stage = batchData.txStage;
    const startMs = Date.now();
    const startTime = new Date().toISOString();

    const preEntry = `[${startTime}] PRE-SUBMIT | circuit=${circuit} stage=${stage}\n`;
    console.log(`\n[WerewolfAdapter] ── PRE-SUBMIT ──────────────────────────`);
    console.log(`[WerewolfAdapter]   circuit : ${circuit}`);
    console.log(`[WerewolfAdapter]   stage   : ${stage}`);
    console.log(`[WerewolfAdapter]   time    : ${startTime}`);
    console.log(`[WerewolfAdapter] ───────────────────────────────────────────`);
    this.appendSubmitLog(preEntry);

    try {
      const hash = await super.submitBatch(...args);
      const elapsedMs = Date.now() - startMs;

      const postEntry = `[${new Date().toISOString()}] POST-SUBMIT success | circuit=${circuit} stage=${stage} hash=${hash} elapsed=${elapsedMs}ms\n\n`;
      console.log(`\n[WerewolfAdapter] ── POST-SUBMIT (success) ────────────────`);
      console.log(`[WerewolfAdapter]   circuit : ${circuit}`);
      console.log(`[WerewolfAdapter]   stage   : ${stage}`);
      console.log(`[WerewolfAdapter]   hash    : ${hash}`);
      console.log(`[WerewolfAdapter]   elapsed : ${elapsedMs}ms`);
      console.log(`[WerewolfAdapter] ───────────────────────────────────────────\n`);
      this.appendSubmitLog(postEntry);

      return hash;
    } catch (e) {
      const elapsedMs = Date.now() - startMs;
      const errMsg = e instanceof Error ? e.message : String(e);

      const postEntry = `[${new Date().toISOString()}] POST-SUBMIT failed | circuit=${circuit} stage=${stage} elapsed=${elapsedMs}ms error=${errMsg}\n\n`;
      console.error(`\n[WerewolfAdapter] ── POST-SUBMIT (failed) ─────────────────`);
      console.error(`[WerewolfAdapter]   circuit : ${circuit}`);
      console.error(`[WerewolfAdapter]   stage   : ${stage}`);
      console.error(`[WerewolfAdapter]   elapsed : ${elapsedMs}ms`);
      console.error(`[WerewolfAdapter]   error   :`, e);
      console.error(`[WerewolfAdapter] ────────────────────────────────────────────\n`);
      this.appendSubmitLog(postEntry);

      // TransactionInvalidError = node rejected the proof (e.g. ReadMismatch — stale tx
      // built against an old ledger state). The tx can never succeed; drop it from the
      // queue by returning a sentinel hash and resolving waitForTransactionReceipt immediately.
      if (isTransactionInvalidError(e)) {
        const droppedHash = `${DROPPED_HASH_PREFIX}${Date.now()}`;
        const dropEntry = `[${new Date().toISOString()}] DROPPED invalid-proof tx | circuit=${circuit} stage=${stage} droppedHash=${droppedHash} reason=${errMsg}\n\n`;
        console.error(`\n[WerewolfAdapter] ── TX DROPPED (invalid proof) ────────────`);
        console.error(`[WerewolfAdapter]   circuit     : ${circuit}`);
        console.error(`[WerewolfAdapter]   stage       : ${stage}`);
        console.error(`[WerewolfAdapter]   reason      : ReadMismatch / stale proof`);
        console.error(`[WerewolfAdapter]   action      : Removed from queue`);
        console.error(`[WerewolfAdapter] ────────────────────────────────────────────\n`);
        this.appendSubmitLog(dropEntry);
        return droppedHash;
      }

      // Dust sync timeout means the wallet is out of sync with the indexer.
      // Pause the queue (isReady → false) and trigger a background resync.
      if (e instanceof DustSyncTimeoutError) {
        this.resyncWallet(); // fire-and-forget — isResyncing flag gates isReady()
      }

      throw e;
    }
  }

  override async waitForTransactionReceipt(
    hash: BlockchainHash,
    timeout?: number,
  ): Promise<BlockchainTransactionReceipt> {
    if (hash.startsWith(DROPPED_HASH_PREFIX)) {
      console.log(`[WerewolfAdapter] waitForTransactionReceipt: resolving immediately for dropped tx ${hash}`);
      return { hash, blockNumber: 0n, status: 0 };
    }
    return super.waitForTransactionReceipt(hash, timeout);
  }
}
