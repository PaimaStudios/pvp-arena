import {
  type MidnightBalancingAdapterConfig,
  type DefaultBatcherInput,
} from "@paimaexample/batcher";
import * as fs from "node:fs";

import { MidnightBalancingAdapterX } from "./base-adapter.ts";
import type { BlockchainHash } from "./adapter.ts";

export type ValidationResult = {
  valid: boolean;
  error?: string;
};

/**
 * Werewolf-specific Midnight Balancing Adapter.
 * Inherits from the official MidnightBalancingAdapter and allows for custom game logic.
 */
export class WerewolfBalancingAdapter extends MidnightBalancingAdapterX {
  constructor(walletSeed: string, config: MidnightBalancingAdapterConfig) {
    super(walletSeed, config);
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
    console.log(`[WerewolfAdapter]   input   : ${JSON.stringify(input)}`);
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

      throw e;
    }
  }
}
