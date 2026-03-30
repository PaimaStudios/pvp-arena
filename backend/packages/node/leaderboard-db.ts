import type { Ledger } from "@pvp-arena-backend/midnight-contracts/pvp";
import { UnshieldedAddress, MidnightBech32m } from "@midnight-ntwrk/wallet-sdk-address-format";
import { Buffer } from "node:buffer";

/**
 * Converts a decimal unshielded address (as returned by the leaderboard API)
 * to the human-readable mn_addr_... Bech32m format.
 */
function decimalToUnshieldedAddress(decimal: string, networkId: string = 'testnet'): string {
  // Pad the BigInt to exactly 32 bytes (big-endian)
  const hex = BigInt(decimal).toString(16).padStart(64, '0');
  const bytes = Buffer.from(hex, 'hex');
  const addr = new UnshieldedAddress(bytes);
  return MidnightBech32m.encode(networkId, addr).asString();
}

const TERMINAL_STATES = new Set([
  7, // GAME_STATE.p1_win
  8, // GAME_STATE.p2_win
  9, // GAME_STATE.tie
]);

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export async function ensureTables(db: any): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS pvp_matches (
      match_id        TEXT PRIMARY KEY,
      player1         TEXT NOT NULL,
      player2         TEXT,
      game_state      INTEGER NOT NULL,
      is_practice     BOOLEAN NOT NULL DEFAULT FALSE,
      has_ledger_data BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Migration: add has_ledger_data column if it doesn't exist
  await db.query(`
    ALTER TABLE pvp_matches ADD COLUMN IF NOT EXISTS has_ledger_data BOOLEAN NOT NULL DEFAULT TRUE
  `).catch(() => { /* column already exists or table just created */ });
  await db.query(`
    CREATE TABLE IF NOT EXISTS pvp_results (
      match_id    TEXT PRIMARY KEY,
      winner      TEXT NOT NULL,
      loser       TEXT,
      result_type TEXT NOT NULL,
      ended_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS pvp_delegations (
      from_address    TEXT PRIMARY KEY,
      to_address      TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

// ---------------------------------------------------------------------------
// State machine: process one full ledger snapshot
// ---------------------------------------------------------------------------

interface LedgerMatch {
  matchId: string;
  state: number;
  player1: string;
  player2: string | null;
  isPractice: boolean;
}

function decimalToUnshieldedAddressSafe(decimal: string, networkId: string = 'testnet'): string {
  try {
    if (!decimal || decimal === "0") return "unknown";
    return decimalToUnshieldedAddress(decimal, networkId);
  } catch (e) {
    return decimal;
  }
}

export async function processLedgerSnapshot(db: any, payload: any): Promise<void> {
  const game_state = payload["3"][6] as Record<string, number>;
  const p1_public_key = payload["3"][7] as Record<string, string>;
  const p2_public_key = payload["3"][8] as Record<string, string>;
  const is_practice = payload["3"][10] as Record<string, boolean | number>;

  // Build in-memory map of everything currently on-chain
  const onChain = new Map<string, LedgerMatch>();

  for (const [matchId, state] of Object.entries(game_state)) {
    const p1Key = p1_public_key[matchId] ? decimalToUnshieldedAddressSafe(p1_public_key[matchId]) : "unknown";
    const p2Key = p2_public_key[matchId] ? decimalToUnshieldedAddressSafe(p2_public_key[matchId]) : null;
    const isPractice = Boolean(is_practice[matchId]);

    onChain.set(matchId, {
      matchId,
      state: state as unknown as number,
      player1: p1Key,
      player2: p2Key,
      isPractice,
    });
  }

  if (onChain.size === 0) return;

  // --- Step 1: fetch what we already know ---
  const allMatchIds = Array.from(onChain.keys());
  const { rows: knownRows } = await db.query(
    `SELECT match_id, game_state FROM pvp_matches WHERE match_id = ANY($1)`,
    [allMatchIds],
  ) as { rows: Array<{ match_id: string; game_state: number }> };
  const known = new Map<string, number>(knownRows.map((r: any) => [r.match_id, Number(r.game_state)]));

  // --- Step 2: diff ---
  const toUpsert: LedgerMatch[] = [];
  const toResult: Array<{ matchId: string; winner: string; loser: string | null; resultType: string }> = [];

  for (const match of onChain.values()) {
    const prevState = known.get(match.matchId); // undefined = new match
    const isNewOrChanged = prevState === undefined || prevState !== match.state;

    if (isNewOrChanged) {
      toUpsert.push(match);

      const prevTerminal = prevState !== undefined && TERMINAL_STATES.has(prevState);
      const nowTerminal = TERMINAL_STATES.has(match.state);

      if (nowTerminal && !prevTerminal) {
        const { winner, loser, resultType } = resolveResult(match);
        toResult.push({ matchId: match.matchId, winner, loser, resultType });
      }
    }
  }

  // --- Step 3: batch upsert changed/new matches ---
  if (toUpsert.length > 0) {
    const placeholders = toUpsert.map((_, i) => {
      const base = i * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    }).join(", ");

    const values = toUpsert.flatMap((m) => [
      m.matchId,
      m.player1,
      m.player2,
      m.state,
      m.isPractice,
    ]);

    await db.query(
      `INSERT INTO pvp_matches (match_id, player1, player2, game_state, is_practice)
       VALUES ${placeholders}
       ON CONFLICT (match_id) DO UPDATE
         SET player1    = EXCLUDED.player1,
             player2    = COALESCE(EXCLUDED.player2, pvp_matches.player2),
             game_state = EXCLUDED.game_state,
             updated_at = now()`,
      values,
    );
  }

  // --- Step 4: batch insert new results (idempotent) ---
  if (toResult.length > 0) {
    const now = new Date().toISOString();
    const placeholders = toResult.map((_, i) => {
      const base = i * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    }).join(", ");

    const values = toResult.flatMap((r) => [
      r.matchId,
      r.winner,
      r.loser,
      r.resultType,
      now,
    ]);

    await db.query(
      `INSERT INTO pvp_results (match_id, winner, loser, result_type, ended_at)
       VALUES ${placeholders}
       ON CONFLICT (match_id) DO UPDATE
         SET winner = EXCLUDED.winner,
             loser  = EXCLUDED.loser`,
      values,
    );
  }
}

// ---------------------------------------------------------------------------
// Delegation processing
// ---------------------------------------------------------------------------

export async function processDelegations(
  db: any,
  delegationsMap: Record<string, string>,
): Promise<void> {
  if (Object.keys(delegationsMap).length === 0) return;

  // Compare with existing DB entries
  const entries = Object.entries(delegationsMap).map(([rawFromAddr, rawToAddr]) => ({
    fromAddr: decimalToUnshieldedAddressSafe(rawFromAddr),
    toAddr: decimalToUnshieldedAddressSafe(String(rawToAddr)),
  }));

  const fromKeys = entries.map((e) => e.fromAddr);
  const { rows: existing } = await db.query(
    `SELECT from_address, to_address FROM pvp_delegations WHERE from_address = ANY($1)`,
    [fromKeys],
  ) as { rows: Array<{ from_address: string; to_address: string }> };
  const existingMap = new Map(existing.map((r: any) => [r.from_address, r.to_address]));

  // Find new or changed delegations
  const toUpsert = entries.filter((e) => existingMap.get(e.fromAddr) !== e.toAddr);

  if (toUpsert.length > 0) {
    const placeholders = toUpsert
      .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
      .join(", ");
    const values = toUpsert.flatMap((u) => [u.fromAddr, u.toAddr]);
    await db.query(
      `INSERT INTO pvp_delegations (from_address, to_address)
       VALUES ${placeholders}
       ON CONFLICT (from_address) DO UPDATE
         SET to_address = EXCLUDED.to_address,
             updated_at = now()`,
      values,
    );
    console.log(`[leaderboard] Upserted ${toUpsert.length} delegation(s)`);
  }
}

function resolveResult(
  match: LedgerMatch,
): { winner: string; loser: string | null; resultType: string } {
  if (match.state === 7 /* p1_win */) {
    return { winner: match.player1, loser: match.player2, resultType: "p1_win" };
  }
  if (match.state === 8 /* p2_win */) {
    return {
      winner: match.player2 ?? "unknown",
      loser: match.player1,
      resultType: "p2_win",
    };
  }
  // tie (9)
  return { winner: match.player1, loser: null, resultType: "tie" };
}

// ---------------------------------------------------------------------------
// API queries
// ---------------------------------------------------------------------------

export interface LeaderboardParams {
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  score: number;
}

export interface LeaderboardResult {
  channel: string;
  startDate: string;
  endDate: string;
  totalPlayers: number;
  totalScore: number;
  entries: LeaderboardEntry[];
}

export async function getLeaderboard(
  db: any,
  params: LeaderboardParams,
): Promise<LeaderboardResult> {
  const now = new Date();
  const endDate = params.endDate ?? now.toISOString();
  const startDate = params.startDate ?? new Date(now.getTime() - ONE_YEAR_MS).toISOString();
  const limit = Math.min(params.limit ?? 50, 1000);
  const offset = params.offset ?? 0;

  const { rows } = await db.query(
    `SELECT
       COALESCE(d.to_address, r.winner)                 AS address,
       COUNT(*)::int                                    AS score,
       RANK() OVER (ORDER BY COUNT(*) DESC)::int        AS rank
     FROM pvp_results r
     JOIN pvp_matches m ON r.match_id = m.match_id
     LEFT JOIN pvp_delegations d ON r.winner = d.from_address
     WHERE r.result_type <> 'tie'
       AND m.is_practice = FALSE
       AND r.ended_at >= $1
       AND r.ended_at <= $2
     GROUP BY COALESCE(d.to_address, r.winner)
     ORDER BY score DESC
     LIMIT $3 OFFSET $4`,
    [startDate, endDate, limit, offset],
  ) as { rows: Array<{ address: string; score: number; rank: number }> };

  const entries: LeaderboardEntry[] = rows.map((r: any) => ({
    rank: Number(r.rank),
    address: r.address.startsWith('mn_addr_') ? r.address : decimalToUnshieldedAddressSafe(r.address),
    score: Number(r.score),
  }));

  const totalScore = entries.reduce((sum, e) => sum + e.score, 0);

  return {
    channel: "leaderboard",
    startDate,
    endDate,
    totalPlayers: entries.length,
    totalScore,
    entries,
  };
}

export interface UserChannelStats {
  score: number;
  rank: number;
  matchesPlayed: number;
}

export async function getUserLeaderboardStats(
  db: any,
  address: string,
  startDate: string,
  endDate: string,
): Promise<UserChannelStats | null> {
  // Resolve the queried address through delegations:
  // - If it's a wallet_address, find all game_addresses that delegate to it
  // - Also include the address itself (in case it's a game address with no delegation)
  const { rows } = await db.query(
    `WITH delegated_keys AS (
       SELECT from_address FROM pvp_delegations WHERE to_address = $3
       UNION ALL
       SELECT $3
     ),
     ranked AS (
       SELECT
         COALESCE(d.to_address, r.winner)              AS address,
         COUNT(*)::int                                 AS score,
         RANK() OVER (ORDER BY COUNT(*) DESC)::int     AS rank
       FROM pvp_results r
       JOIN pvp_matches m ON r.match_id = m.match_id
       LEFT JOIN pvp_delegations d ON r.winner = d.from_address
       WHERE r.result_type <> 'tie'
         AND m.is_practice = FALSE
         AND r.ended_at >= $1
         AND r.ended_at <= $2
       GROUP BY COALESCE(d.to_address, r.winner)
     )
     SELECT
       r.score,
       r.rank,
       (SELECT COUNT(*)::int FROM pvp_results pr
        JOIN pvp_matches pm ON pr.match_id = pm.match_id
        WHERE (pr.winner IN (SELECT from_address FROM delegated_keys)
            OR pr.loser IN (SELECT from_address FROM delegated_keys))
          AND pm.is_practice = FALSE
          AND pr.ended_at >= $1 AND pr.ended_at <= $2) AS matches_played
     FROM ranked r
     WHERE r.address = $3`,
    [startDate, endDate, address],
  ) as { rows: Array<{ score: number; rank: number; matches_played: number }> };

  if (rows.length === 0) return null;

  return {
    score: Number(rows[0].score),
    rank: Number(rows[0].rank),
    matchesPlayed: Number(rows[0].matches_played),
  };
}

export interface UserIdentity {
  address: string;
  delegatedFrom: string[];
  displayName?: string;
}

export async function resolveUserIdentity(
  db: any,
  address: string,
): Promise<UserIdentity> {
  // Check if this address has delegated ownership to another
  const { rows: asDelegator } = await db.query(
    `SELECT to_address FROM pvp_delegations WHERE from_address = $1`,
    [address],
  ) as { rows: Array<{ to_address: string }> };

  // Check if this address is one that others delegate to
  const { rows: asDelegatee } = await db.query(
    `SELECT from_address FROM pvp_delegations WHERE to_address = $1`,
    [address],
  ) as { rows: Array<{ from_address: string }> };

  return {
    address: asDelegator.length > 0 ? asDelegator[0].to_address : address,
    delegatedFrom: asDelegatee.map((r: any) => r.from_address),
  };
}

export async function getUserAchievements(
  _db: any,
  _address: string,
): Promise<string[]> {
  // Achievements not yet implemented
  return [];
}
