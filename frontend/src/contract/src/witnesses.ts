/*
 * This file defines the shape of the bulletin board's private state,
 * as well as the single witness function that accesses it.
 */

import { Ledger, STANCE } from './managed/pvp/contract/index.js';
import { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/* **********************************************************************
 * The only hidden state needed by the bulletin board contract is
 * the user's secret key.  Some of the library code and
 * compiler-generated code is parameterized by the type of our
 * private state, so we define a type for it and a function to
 * make an object of that type.
 */

export type PVPArenaPrivateState = {
  // this is your actual identity and is persistent
  readonly secretKey: Uint8Array;

  // these are per match
  currentMatchId: bigint | null;
  commands: bigint[];
  stances: STANCE[];
};

export const createPVPArenaPrivateState = (secretKey: Uint8Array) => ({
  secretKey,
  currentMatchId: null,
  commands: [],
  stances: []
});

// ── Normalization helpers ──────────────────────────────────────────────────
// IndexedDB/levelDB serialization can round-trip Uint8Array as a plain
// numeric-keyed object {0:95, 1:222, ...} or as a plain array [95,222,...].
// BigInt can come back as a string if an older serializer was used.

const normalizeUint8Array = (raw: unknown, fieldName: string): Uint8Array | null => {
  if (raw instanceof Uint8Array) {
    console.log(`[witness:normalize] ${fieldName}: already Uint8Array length=${raw.length}`);
    return raw;
  }
  if (raw == null) {
    console.error(`[witness:normalize] ${fieldName}: IS NULL — circuit will throw`);
    return null;
  }
  const vals: number[] = Array.isArray(raw)
    ? (raw as number[])
    : Object.values(raw as Record<string, number>);
  const normalized = new Uint8Array(vals);
  console.log(`[witness:normalize] ${fieldName}: converted ${Array.isArray(raw) ? 'array' : 'plain-object'}[${vals.length}] → Uint8Array[${normalized.length}]`);
  return normalized;
};

const normalizeBigInt = (raw: unknown, fieldName: string): bigint | null => {
  if (raw === null || raw === undefined) {
    console.error(`[witness:normalize] ${fieldName}: IS NULL — circuit will throw "expected a cell, received null"`);
    return null;
  }
  if (typeof raw === 'bigint') {
    console.log(`[witness:normalize] ${fieldName}: already bigint=${raw}`);
    return raw;
  }
  const normalized = BigInt(raw as any);
  console.log(`[witness:normalize] ${fieldName}: converted ${typeof raw}(${raw}) → bigint=${normalized}`);
  return normalized;
};

/* **********************************************************************
 * Witnesses
 */
export const witnesses = {
  player_secret_key: ({ privateState }: WitnessContext<Ledger, PVPArenaPrivateState>): [PVPArenaPrivateState, Uint8Array] => {
    const raw = privateState.secretKey as unknown;
    console.log(`[witness:player_secret_key] raw: type=${typeof raw} instanceof=${raw instanceof Uint8Array} null=${raw == null}`);
    const sk = normalizeUint8Array(raw, 'secretKey');
    if (sk == null || sk.length !== 32) {
      console.error(`[witness:player_secret_key] CRITICAL: sk=${sk == null ? 'null' : `length ${sk.length} (need 32)`}`);
    }
    return [privateState, sk as Uint8Array];
  },

  current_match_id: ({ privateState }: WitnessContext<Ledger, PVPArenaPrivateState>): [PVPArenaPrivateState, bigint] => {
    const raw = privateState.currentMatchId as unknown;
    console.log(`[witness:current_match_id] raw: type=${typeof raw} value=${raw}`);
    const matchId = normalizeBigInt(raw, 'currentMatchId');
    if (matchId === null) {
      console.error(`[witness:current_match_id] CRITICAL: null matchId → "expected a cell, received null"`);
    }
    return [privateState, matchId as bigint];
  },

  player_commands: ({ privateState }: WitnessContext<Ledger, PVPArenaPrivateState>): [PVPArenaPrivateState, bigint[]] => {
    const raw = privateState.commands as unknown;
    console.log(`[witness:player_commands] raw: isArray=${Array.isArray(raw)} length=${(raw as any)?.length}`);
    const commands: bigint[] = Array.isArray(raw)
      ? (raw as any[]).map((c: any, i: number) => {
          if (typeof c === 'bigint') return c;
          const n = BigInt(c);
          console.log(`[witness:player_commands] cmd[${i}]: ${typeof c}(${c}) → bigint=${n}`);
          return n;
        })
      : (() => { console.error(`[witness:player_commands] CRITICAL: not an array: ${typeof raw}`); return []; })();
    return [privateState, commands];
  },

  player_stances: ({ privateState }: WitnessContext<Ledger, PVPArenaPrivateState>): [PVPArenaPrivateState, STANCE[]] => {
    const raw = privateState.stances as unknown;
    console.log(`[witness:player_stances] raw: isArray=${Array.isArray(raw)} length=${(raw as any)?.length}`);
    const stances: STANCE[] = Array.isArray(raw)
      ? (raw as any[]).map((s: any) => Number(s) as STANCE)
      : (() => { console.error(`[witness:player_stances] CRITICAL: not an array: ${typeof raw}`); return []; })();
    return [privateState, stances];
  },
};
