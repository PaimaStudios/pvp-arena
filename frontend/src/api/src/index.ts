/**
 * Provides types and utilities for working with bulletin board contracts.
 *
 * @packageDocumentation
 */

import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { type Logger } from 'pino';
import type { PVPArenaDerivedState, PVPArenaContract, PVPArenaProviders, DeployedPVPArenaContract, PrivateStates, PVPArenaDerivedMatchState } from './common-types.js';
import {
  type PVPArenaPrivateState,
  Contract,
  createPVPArenaPrivateState,
  ledger,
  pureCircuits,
  witnesses,
  RESULT,
  ITEM,
  ARMOR,
  Hero,
  HeroHack,
  STANCE,
  GAME_STATE,
 // Command,
} from '@midnight-ntwrk/pvp-contract';
import * as utils from './utils/index.js';
import { deployContract, findDeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { map, tap, from, switchMap, shareReplay, merge, Subject, type Observable } from 'rxjs';
import { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';
import { CompiledContract } from '@midnight-ntwrk/compact-js';

/** @internal */
const pvpContractInstance: PVPArenaContract = new Contract(witnesses);

const pvpCompiledContract = CompiledContract.make<Contract<PVPArenaPrivateState>>(
  'PVPArenaContract', Contract<PVPArenaPrivateState>
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets('./compiled/pvp-contract')
);

function heroToHack(hero: Hero): HeroHack {
  return {
    rhs: BigInt(hero.rhs),
    lhs: BigInt(hero.lhs),
    helmet: BigInt(hero.helmet),
    chest: BigInt(hero.chest),
    skirt: BigInt(hero.skirt),
    greaves: BigInt(hero.greaves),
  };
}

function hackToHero(hack: HeroHack): Hero {
  return pureCircuits.hack_to_hero(hack);
}

function randIntBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 0.1));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// only converts bigint, but this is the only problem we have with printing ledger types
export function safeJSONString(obj: object): string {
  if (obj === null) {
    return 'null';
  }
    if (typeof obj == 'bigint') {
        return Number(obj).toString();
    } else if (Array.isArray(obj)) {
        let str = '[';
        let innerFirst = true;
        for (let i = 0; i < obj.length; ++i) {
            if (!innerFirst) {
                str += ', ';
            }
            innerFirst = false;
            str += safeJSONString(obj[i]);
        }
        str += ']';
        return str;
    } else if (typeof obj == 'object') {
        let entries = Object.entries(obj);
        // this allows us to print Map properly
        let len = ('length' in obj ? obj.length : undefined) ?? ('size' in obj ? obj.size : undefined) ?? entries.length;;
        if ('entries' in obj && typeof obj.entries === "function") {
            entries = obj.entries();
        }
        let str = `[${len}]{`;
        let first = true;
        for (let [key, val] of entries) {
            if (!first) {
                str += ', ';
            }
            first = false;
            str += `"${key}": ${safeJSONString(val)}`;
        }
        str += '}';
        return str;
    }
    return JSON.stringify(obj);
}

export function generateRandomHero(): Hero {
  // avoid useless things like double shields, unarmed, etc
  const rightHanded = randIntBetween(0, 1) == 0;
  const mainWeapons = [ITEM.axe, ITEM.bow, ITEM.spear, ITEM.sword];
  const mainWeapon = mainWeapons[randIntBetween(0, 3)];
  const secondaryWeapons = [ITEM.axe, ITEM.shield, ITEM.spear, ITEM.sword];
  const secondaryWeapon = mainWeapon == ITEM.bow ? ITEM.nothing : secondaryWeapons[randIntBetween(0, 3)];
  return {
      lhs: rightHanded ? secondaryWeapon : mainWeapon,
      rhs: rightHanded ? mainWeapon : secondaryWeapon,
      helmet: randIntBetween(0, 2) as ARMOR,
      chest: randIntBetween(0, 2) as ARMOR,
      skirt: randIntBetween(0, 2) as ARMOR,
      greaves: randIntBetween(0, 2) as ARMOR,
  };
}

export type CreateMatchOptions = {
  isPractice: boolean,
  isPublic: boolean,
};

/**
 * An API for a deployed bulletin board.
 */
export interface DeployedPVPArenaAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<PVPArenaDerivedState>;

  /** Optional hook called before each AI-driven circuit invocation with the circuit name. */
  beforeCircuitCall?: (circuitName: string) => void;

  create_new_match: (is_match_public: boolean, is_match_practice?: boolean) => Promise<bigint>;
  p1_select_first_hero: (first_hero: Hero) => Promise<void>;
  p2_select_first_heroes: (first_heroes: Hero[]) => Promise<void>;
  p1_select_last_heroes: (last_heroes: Hero[]) => Promise<void>;
  p2_select_last_hero: (last_p1_hero: Hero) => Promise<void>;
  p1Commit: (commands: bigint[], stances: STANCE[]) => Promise<void>;
  p2Commit: (commands: bigint[], stances: STANCE[]) => Promise<void>;
  p1Reveal: (commands: bigint[], stances: STANCE[]) => Promise<void>;
  joinMatch: (matchId: bigint) => Promise<void>;
  setCurrentMatch: (matchId: bigint) => Promise<void>;
  claimTimeoutWin: () => Promise<void>;
  surrender: () => Promise<void>;
  closeMatch: () => Promise<void>;
  cleanupMatch: () => Promise<void>;
  clearCurrentMatch: () => Promise<void>;
  forceStateRefresh: () => void;
}

/**
 * Provides an implementation of {@link DeployedPVPArenaAPI} by adapting a deployed bulletin board
 * contract.
 *
 * @remarks
 * The `PVPArenaPrivateState` is managed at the DApp level by a private state provider. As such, this
 * private state is shared between all instances of {@link PVPArenaAPI}, and their underlying deployed
 * contracts. The private state defines a `'secretKey'` property that effectively identifies the current
 * user, and is used to determine if the current user is the poster of the message as the observable
 * contract state changes.
 *
 * In the future, Midnight.js will provide a private state provider that supports private state storage
 * keyed by contract address. This will remove the current workaround of sharing private state across
 * the deployed bulletin board contracts, and allows for a unique secret key to be generated for each bulletin
 * board that the user interacts with.
 */
// TODO: Update PVPArenaAPI to use contract level private state storage.
export class PVPArenaAPI implements DeployedPVPArenaAPI {
  /** Optional hook called before each AI-driven circuit invocation with the circuit name.
   *  Set this from the phaser layer: `api.beforeCircuitCall = (name) => BatcherClient.setCircuitName(name)` */
  beforeCircuitCall?: (circuitName: string) => void;

  /** Guard: tracks which (round, state) the AI last submitted a circuit call for.
   *  Prevents re-firing for the same game state on repeated state$ emissions
   *  (e.g. while watchForTxData is still waiting for chain confirmation).
   *  Key is "${round}:${state}" — resets across rounds automatically. */
  private lastAiCalledForKey: string = '';

  /** Cached last ledger state — used by forceStateRefresh to re-derive state$ without waiting for the next block. */
  private lastLedgerState: ReturnType<typeof ledger> | null = null;
  /** Emitting here re-triggers the state$ switchMap with the cached ledger state. */
  private readonly refreshSubject = new Subject<ReturnType<typeof ledger>>();

  /** @internal */
  private constructor(
    public readonly deployedContract: DeployedPVPArenaContract,
    private readonly providers: PVPArenaProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    const contractStatePipe = providers.publicDataProvider.contractStateObservable(this.deployedContractAddress, { type: 'latest' }).pipe(
      map((contractState) => ledger(contractState.data.state)),
      tap((ledgerState) => {
        this.lastLedgerState = ledgerState;
        logger?.trace({ ledgerStateChanged: { ledgerState: { ...ledgerState } } });
      }),
    );
    this.state$ = merge(contractStatePipe, this.refreshSubject).pipe(
      // Re-read private state on every ledger emission so that setCurrentMatch()
      // and other private state writes are reflected immediately in state$.
      switchMap((ledgerState) =>
        from(
          providers.privateStateProvider.get('pvpPrivateState').then(
            (ps) => {
              if (ps == null) console.warn('[state$] privateStateProvider returned null');
              return ps;
            },
            (err) => {
              console.error('[state$ src2] privateStateProvider REJECTED:', err);
              throw err;
            }
          ) as Promise<PVPArenaPrivateState>
        ).pipe(
          // ...and combine them to produce the required derived state.
          map((privateState) => {
        // Normalize secretKey back to Uint8Array in case IndexedDB deserialized it
        // as a plain Array or numeric-keyed Object.
        const rawSk = (privateState as any)?.secretKey;
        const secretKey: Uint8Array = rawSk instanceof Uint8Array
          ? rawSk
          : rawSk != null
            ? new Uint8Array(Object.values(rawSk as Record<string, number>))
            : new Uint8Array(32); // should never happen — will produce wrong key, logged above

        const localPublicKey = pureCircuits.derive_public_key(secretKey);

        // safe wrapper: logs which field/matchId caused a lookup failure
        const safeLookup = <T>(field: string, fn: () => T, fallback: T): T => {
          try {
            return fn();
          } catch (e) {
            console.error(`[parseMatchState] lookup failed — field="${field}"`, e);
            return fallback;
          }
        };

        const parseMatchState = (matchId: bigint): PVPArenaDerivedMatchState => {
          const isP1 = ledgerState.p1_public_key.lookup(matchId) === localPublicKey;
          const isP2 = ledgerState.p2_public_key.member(matchId) && (ledgerState.p2_public_key.lookup(matchId) === localPublicKey);

          const round     = safeLookup('round',      () => ledgerState.round.lookup(matchId),       0n);
          const state     = safeLookup('game_state', () => ledgerState.game_state.lookup(matchId),  0 as any);
          const p1Heroes  = safeLookup('p1_heroes',  () => ledgerState.p1_heroes.lookup(matchId).filter((h: any) => h.is_some).map((h: any) => h.value), []);
          const p2Heroes  = safeLookup('p2_heroes',  () => ledgerState.p2_heroes.lookup(matchId).filter((h: any) => h.is_some).map((h: any) => h.value), []);
          const p1Stances = safeLookup('p1_stances', () => ledgerState.p1_stances.lookup(matchId), []);
          const p2Stances = safeLookup('p2_stances', () => ledgerState.p2_stances.lookup(matchId), []);
          const p1Dmg     = [
            safeLookup('p1_dmg_0', () => ledgerState.p1_dmg_0.lookup(matchId), 0n),
            safeLookup('p1_dmg_1', () => ledgerState.p1_dmg_1.lookup(matchId), 0n),
            safeLookup('p1_dmg_2', () => ledgerState.p1_dmg_2.lookup(matchId), 0n),
          ];
          const p2Dmg     = [
            safeLookup('p2_dmg_0', () => ledgerState.p2_dmg_0.lookup(matchId), 0n),
            safeLookup('p2_dmg_1', () => ledgerState.p2_dmg_1.lookup(matchId), 0n),
            safeLookup('p2_dmg_2', () => ledgerState.p2_dmg_2.lookup(matchId), 0n),
          ];
          const p1Alive   = [
            safeLookup('p1_alive_0', () => ledgerState.p1_alive_0.lookup(matchId), true),
            safeLookup('p1_alive_1', () => ledgerState.p1_alive_1.lookup(matchId), true),
            safeLookup('p1_alive_2', () => ledgerState.p1_alive_2.lookup(matchId), true),
          ];
          const p2Alive   = [
            safeLookup('p2_alive_0', () => ledgerState.p2_alive_0.lookup(matchId), true),
            safeLookup('p2_alive_1', () => ledgerState.p2_alive_1.lookup(matchId), true),
            safeLookup('p2_alive_2', () => ledgerState.p2_alive_2.lookup(matchId), true),
          ];
          const p1Cmds    = ledgerState.p1_cmds.member(matchId) && ledgerState.p1_cmds.lookup(matchId).is_some
            ? ledgerState.p1_cmds.lookup(matchId).value : undefined;
          const p2Cmds    = ledgerState.p2_cmds.member(matchId) && ledgerState.p2_cmds.lookup(matchId).is_some
            ? ledgerState.p2_cmds.lookup(matchId).value : undefined;
          const nonce     = ledgerState.commit_nonce.member(matchId) ? ledgerState.commit_nonce.lookup(matchId) : undefined;
          const commit    = ledgerState.p1_commit.member(matchId)    ? ledgerState.p1_commit.lookup(matchId)    : undefined;
          const isPublic  = safeLookup('public_',    () => ledgerState.public_.lookup(matchId),     false);
          const isPractice = safeLookup('is_practice', () => ledgerState.is_practice.lookup(matchId), false);
          const p1PubKey  = safeLookup('p1_public_key', () => ledgerState.p1_public_key.lookup(matchId), 0n);
          const p2PubKey  = ledgerState.p2_public_key.member(matchId) ? ledgerState.p2_public_key.lookup(matchId) : undefined;
          const lastMoveAt = safeLookup('last_move_at', () => ledgerState.last_move_at.lookup(matchId), 0n);


          return {
            round, state, p1Heroes, p2Heroes, p1Stances, p2Stances,
            p1Dmg, p2Dmg, p1Alive, p2Alive,
            p1Cmds, p2Cmds, nonce, commit,
            isPublic, isPractice, isP1, isP2, p1PubKey, p2PubKey,
            lastMoveAt,
            secretKey: privateState.secretKey,
          };
        };

        const matchStates = new Map(ledgerState.game_state);

        // Guard: currentMatchId may be stale (e.g. local chain restarted, contract
        // redeployed, or this is a first-time boot with no matches yet). Calling
        // parseMatchState on a matchId that isn't in the ledger causes lookup() to
        // return undefined/null, which then throws when chained with .filter()/.map(),
        // silently erroring state$ and leaving the boot screen stuck forever.
        const hasCurrentMatch = privateState.currentMatchId !== null && matchStates.has(privateState.currentMatchId);
        const currentMatch = hasCurrentMatch
          ? parseMatchState(privateState.currentMatchId!)
          : null;

        // in practice mode we locally run everything in the mockapi but ran on-chain
        const aiKey = currentMatch ? `${currentMatch.round}:${currentMatch.state}` : '';
        if (currentMatch?.isPractice === true && aiKey !== this.lastAiCalledForKey) {
          // Guard: only fire the AI circuit once per (round, state) pair.
          // Uses round+state so that the same state number in round 2 correctly
          // fires again (lastAiCalledForKey from round 1 won't match round 2's key).
          const runAi = (circuitName: string, call: () => Promise<unknown>) => {
            this.lastAiCalledForKey = aiKey;
            console.log(`[AI] round=${currentMatch.round} state=${currentMatch.state} → calling ${circuitName}`);
            this.beforeCircuitCall?.(circuitName);
            call().catch((e) => {
              // Delegation sentinel errors are expected (batcher took over the tx).
              // For real failures (circuit assertion, stale indexer state, etc.) reset
              // the key so the AI retries on the next state$ emission.
              const isDelegationSentinel = (err: unknown): boolean => {
                if (!(err instanceof Error)) return false;
                if (err.message.includes('Delegated balancing flow handed off to batcher')) return true;
                return err.cause instanceof Error ? isDelegationSentinel(err.cause) : false;
              };
              if (!isDelegationSentinel(e)) {
                console.warn(`[AI] ${circuitName} failed, resetting key for retry:`, e);
                this.lastAiCalledForKey = '';
              }
            });
          };

          switch (currentMatch.state) {
            case GAME_STATE.p2_selecting_first_heroes:
              runAi('p2_select_first_heroes', () =>
                this.p2_select_first_heroes([generateRandomHero(), generateRandomHero()])
              );
              break;
            case GAME_STATE.p2_selecting_last_hero:
              runAi('p2_select_last_hero', () =>
                this.p2_select_last_hero(generateRandomHero())
              );
              break;
            case GAME_STATE.p2_commit_reveal: {
              const commands = [0, 1, 2].map((i) => {
                if (currentMatch.p2Alive[i]) {
                    const availableTargets = [0, 1, 2].filter((j) => currentMatch.p1Alive[j]);
                    return BigInt(availableTargets[randIntBetween(0, availableTargets.length - 1)]);
                }
                // this should never be read anyway
                return BigInt(3);
              });
              const stances = currentMatch.p2Stances.map((stance, i) => {
                if (currentMatch.p2Alive[i]) {
                    switch (stance) {
                        case STANCE.defensive:
                            return randIntBetween(0, 1) as STANCE;
                        case STANCE.aggressive:
                            return randIntBetween(1, 2) as STANCE;
                        case STANCE.neutral:
                            return randIntBetween(0, 2) as STANCE;
                    }
                }
                return stance;
              });
              runAi('p2_commit_commands', () => this.p2Commit(commands, stances));
              break;
            }
          }
        }

        return {
          currentMatch,
          myMatches: new Map(matchStates.keys().filter((id) => ledgerState.p1_public_key.lookup(id) == localPublicKey || (ledgerState.p2_public_key.member(id) && ledgerState.p2_public_key.lookup(id) == localPublicKey)).map((id) => [id, parseMatchState(id)])),
          openMatches: new Map(matchStates.keys().filter((id) => ledgerState.p1_public_key.lookup(id) != localPublicKey && (!ledgerState.p2_public_key.member(id) || ledgerState.p2_public_key.lookup(id) === ledgerState.p1_public_key.lookup(id))).map((id) => [id, parseMatchState(id)])),
          currentMatchId: hasCurrentMatch ? privateState.currentMatchId! : null,
          localPublicKey,
        };
          }) // map(privateState)
        )   // from(...).pipe(...)
      ),    // switchMap
      shareReplay(1)  // replay last state to new subscribers (e.g. EquipmentMenu subscribing after state was already set)
    );      // contractStateObservable.pipe(...)
  }

  /**
   * Gets the address of the current deployed contract.
   */
  readonly deployedContractAddress: ContractAddress;

  /**
   * Gets an observable stream of state changes based on the current public (ledger),
   * and private state data.
   */
  readonly state$: Observable<PVPArenaDerivedState>;

  /**
   * Retries a circuit call when the SDK's local ledger-state cache hasn't yet been
   * updated after a preceding transaction (race condition between the indexer's
   * WebSocket push and the circuit-simulation's local cache read).
   * Only retries on "expected a cell, received null" — all other errors propagate
   * immediately.
   */
  // TODO WE NEED TO REMOVE THIS.
  // THIS WAS A WORKAROUND THAT NEVER WORKED.
  private async retryOnStaleState<T>(name: string, fn: () => Promise<T>, maxRetries = 6): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('expected a cell, received null')) {
          lastErr = e;
          const delayMs = Math.round(2000 * Math.pow(1.5, attempt));
          console.warn(`[api:${name}] Stale ledger cache (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms…`);
          await new Promise<void>(r => setTimeout(r, delayMs));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  /**
   * Create a new match as player 1
   *
   * @param is_match_public If the match should be tracked in the public lobby system
   */
  async create_new_match(is_match_public: boolean, is_match_practice: boolean = false): Promise<bigint> {
    const match_nonce = utils.randomBytes(32);
    console.log(`[api:create_new_match] calling circuit (public=${is_match_public}, practice=${is_match_practice})`);
    const wallClockSec = BigInt(Math.floor(Date.now() / 1000));
    const chainTimestamp = this.providers.getChainTimestamp ? await this.providers.getChainTimestamp() : null;
    const now = chainTimestamp ?? wallClockSec;
    const txData = await this.deployedContract.callTx.create_new_match(match_nonce, is_match_public, is_match_practice, now);

    this.logger?.trace({
      transactionAdded: {
        circuit: 'create_new_match',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });

    const matchId = txData.private.result;
    console.log(`[api:create_new_match] done — matchId=${matchId} txHash=${txData.public.txHash} blockHeight=${txData.public.blockHeight}`);
    return matchId;
  }

  /**
   * Select the first hero for Player 1
   *
   * @param first_hero Player 1's first hero
   *
   * @remarks
   * This method can fail if called more than once or if validation fails
   */
  async p1_select_first_hero(first_hero: Hero): Promise<void> {
    console.log(`[p1_select_first_hero] called with hero=${JSON.stringify(first_hero)}`);
    // log private state before calling circuit
    const dbState = await this.providers.privateStateProvider.get('pvpPrivateState') as any;
    if (dbState) {
      const sk = dbState.secretKey;
      console.log(`[p1_select_first_hero] privateState from DB — currentMatchId=${dbState.currentMatchId} type=${typeof dbState.currentMatchId} | secretKey instanceof=${sk instanceof Uint8Array} type=${typeof sk} null=${sk == null}`);
    } else {
      console.error(`[p1_select_first_hero] NO private state in DB — this will definitely fail`);
    }

    const txData = await this.retryOnStaleState('p1_select_first_hero', async () => {
      const wallClockSec = BigInt(Math.floor(Date.now() / 1000));
      const chainTimestamp = this.providers.getChainTimestamp ? await this.providers.getChainTimestamp() : null;
      const now = chainTimestamp ?? wallClockSec;
      return this.deployedContract.callTx.p1_select_first_hero(heroToHack(first_hero), now);
    });

    this.logger?.trace({
      transactionAdded: {
        circuit: 'p1_select_first_hero',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Select the remaining 2 heroes for Player 1
   *
   * @param last_heroes Player 1's last two heroes
   *
   * @remarks
   * This method can fail if called more than once or if validation fails
   */
    async p1_select_last_heroes(last_heroes: Hero[]): Promise<void> {
      //this.logger?.info(`postingMessage: ${message}`);
  
      const txData = await this.retryOnStaleState('p1_select_last_heroes', async () => {
        const wallClockSec = BigInt(Math.floor(Date.now() / 1000));
        const chainTimestamp = this.providers.getChainTimestamp ? await this.providers.getChainTimestamp() : null;
        const now = chainTimestamp ?? wallClockSec;
        return this.deployedContract.callTx.p1_select_last_heroes(last_heroes.map(heroToHack), now);
      });

      this.logger?.trace({
        transactionAdded: {
          circuit: 'p1_select_last_heroes',
          txHash: txData.public.txHash,
          blockHeight: txData.public.blockHeight,
        },
      });
    }
  /**
   * Joins the contract as Player 2 and selects your first two heroes to fight.
   *
   * @param first_heroes First 2 Player 2 heroes.
   *
   * @remarks
   * This method can fail if called more than once
   */
  async p2_select_first_heroes(first_heroes: Hero[]): Promise<void> {
    //this.logger?.info(`postingMessage: ${message}`);

    const txData = await this.retryOnStaleState('p2_select_first_heroes', async () => {
      const wallClockSec = BigInt(Math.floor(Date.now() / 1000));
      const chainTimestamp = this.providers.getChainTimestamp ? await this.providers.getChainTimestamp() : null;
      const now = chainTimestamp ?? wallClockSec;
      return this.deployedContract.callTx.p2_select_first_heroes(first_heroes.map(heroToHack), now);
    });

    this.logger?.trace({
      transactionAdded: {
        circuit: 'p2_select_first_heroes',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Selects Player 2's last hero and advances the game to combat rounds.
   *
   * @param last_hero Player 2's last hero.
   *
   * @remarks
   * This method can fail if called more than once
   */
    async p2_select_last_hero(last_hero: Hero): Promise<void> {
      //this.logger?.info(`postingMessage: ${message}`);
  
      const txData = await this.retryOnStaleState('p2_select_last_hero', async () => {
        const wallClockSec = BigInt(Math.floor(Date.now() / 1000));
        const chainTimestamp = this.providers.getChainTimestamp ? await this.providers.getChainTimestamp() : null;
        const now = chainTimestamp ?? wallClockSec;
        return this.deployedContract.callTx.p2_select_last_hero(heroToHack(last_hero), now);
      });

      this.logger?.trace({
        transactionAdded: {
          circuit: 'p2_select_last_hero',
          txHash: txData.public.txHash,
          blockHeight: txData.public.blockHeight,
        },
      });
    }

  async p1Commit(commands: bigint[], stances: STANCE[]): Promise<void> {
    this.logger?.info(`api.p1Commit(${safeJSONString(commands)}, ${safeJSONString(stances)})`);

    //console.log(`commands: ${commands.map((c) => c.attack.toString()).join(',')}`);
    //const txData = await this.deployedContract.callTx.p1_command([commands[0].attack, commands[1].attack, commands[2].attack]);
    console.log('[p1Commit] submitting circuit call');
    var txData;
    try {
      const state = await PVPArenaAPI.getPrivateState(this.providers.privateStateProvider);
      state!.commands = commands;
      state!.stances = stances;
      await this.providers.privateStateProvider.set('pvpPrivateState', state);
      const nonce = utils.randomBytes(32);
      const wallClockSec = BigInt(Math.floor(Date.now() / 1000));
      const chainTimestamp = this.providers.getChainTimestamp ? await this.providers.getChainTimestamp() : null;
      const now = chainTimestamp ?? wallClockSec;
      console.log(`[p1Commit] wallClockSec=${wallClockSec} chainTimestamp=${chainTimestamp} using now=${now}`);
      txData = await this.deployedContract.callTx.p1_commit_commands(nonce, now);
    } catch (err) {
      console.warn(`[p1Commit] failed: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      throw err;
    }
    console.log('[p1Commit] done');
    this.logger?.trace({
      transactionAdded: {
        circuit: 'p1_commit',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  async p2Commit(commands: bigint[], stances: STANCE[]): Promise<void> {
    this.logger?.info(`api.p2Commit(${safeJSONString(commands)}, ${safeJSONString(stances)})`);

    console.log('[p2Commit] submitting circuit call');
    var txData;
    try {
      const state = await PVPArenaAPI.getPrivateState(this.providers.privateStateProvider);
      state!.commands = commands;
      state!.stances = stances;
      await this.providers.privateStateProvider.set('pvpPrivateState', state);
      const wallClockSec = BigInt(Math.floor(Date.now() / 1000));
      const chainTimestamp = this.providers.getChainTimestamp ? await this.providers.getChainTimestamp() : null;
      const now = chainTimestamp ?? wallClockSec;
      console.log(`[p2Commit] wallClockSec=${wallClockSec} chainTimestamp=${chainTimestamp} using now=${now}`);
      txData = await this.deployedContract.callTx.p2_commit_commands(now);
    } catch (err) {
      console.warn(`[p2Commit] failed: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      throw err;
    }
    console.log('[p2Commit] done');
    //const txData = await this.deployedContract.callTx.p2_command([commands[0].attack, commands[1].attack, commands[2].attack]);

    this.logger?.trace({
      transactionAdded: {
        circuit: 'p2_commit',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  async p1Reveal(commands: bigint[], stances: STANCE[]): Promise<void> {
    this.logger?.info(`api.p1Reveal(${safeJSONString(commands)}, ${safeJSONString(stances)})`);

    var txData;
    try {
      const state = await PVPArenaAPI.getPrivateState(this.providers.privateStateProvider);
      state!.commands = commands;
      state!.stances = stances;
      await this.providers.privateStateProvider.set('pvpPrivateState', state);
      //await sleep(1000);
      const wallClockSec = BigInt(Math.floor(Date.now() / 1000));
      const chainTimestamp = this.providers.getChainTimestamp ? await this.providers.getChainTimestamp() : null;
      const now = chainTimestamp ?? wallClockSec;
      console.log(`[p1Reveal] wallClockSec=${wallClockSec} chainTimestamp=${chainTimestamp} using now=${now}`);
      txData = await this.deployedContract.callTx.p1_reveal_commands(now);
    } catch (err) {
      console.warn(`[p1Reveal] failed: ${err instanceof Error ? err.message : JSON.stringify(err)}`);
      throw err;
    }

    this.logger?.trace({
      transactionAdded: {
        circuit: 'p1_reveal_commands',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  async joinMatch(matchId: bigint): Promise<void> {
    console.log(`[api:joinMatch] called with matchId=${matchId}`);
    await this.setCurrentMatch(matchId);
    const wallClockSec = BigInt(Math.floor(Date.now() / 1000));
    const chainTimestamp = this.providers.getChainTimestamp ? await this.providers.getChainTimestamp() : null;
    const now = chainTimestamp ?? wallClockSec;
    await this.deployedContract.callTx.join_match(now);
    console.log(`[api:joinMatch] done`);
  }

  async setCurrentMatch(matchId: bigint): Promise<void> {
      console.log(`[setCurrentMatch] called with matchId=${matchId} type=${typeof matchId}`);
      const state = await PVPArenaAPI.getPrivateState(this.providers.privateStateProvider);
      console.log(`[setCurrentMatch] state before: currentMatchId=${state?.currentMatchId} type=${typeof state?.currentMatchId}`);
      state!.currentMatchId = matchId;
      await this.providers.privateStateProvider.set('pvpPrivateState', state);
      // verify the write round-trips correctly
      const verify = await this.providers.privateStateProvider.get('pvpPrivateState') as any;
      console.log(`[setCurrentMatch] verify after set: currentMatchId=${verify?.currentMatchId} type=${typeof verify?.currentMatchId} | secretKey instanceof=${verify?.secretKey instanceof Uint8Array}`);
      this.forceStateRefresh();
  }

  async claimTimeoutWin(): Promise<void> {
    console.log('[api:claimTimeoutWin] submitting circuit call');
    await this.deployedContract.callTx.claim_timeout_win();
    console.log('[api:claimTimeoutWin] done');
  }

  async surrender(): Promise<void> {
    console.log('[api:surrender] submitting circuit call');
    await this.deployedContract.callTx.surrender();
    console.log('[api:surrender] done');
  }

  async closeMatch(): Promise<void> {
    console.log('[api:closeMatch] submitting circuit call');
    await this.deployedContract.callTx.close_match();
    console.log('[api:closeMatch] done');
  }

  async cleanupMatch(): Promise<void> {
    console.log('[api:cleanupMatch] submitting circuit call');
    await this.deployedContract.callTx.cleanup_match();
    console.log('[api:cleanupMatch] done');
  }

  async clearCurrentMatch(): Promise<void> {
    const state = await PVPArenaAPI.getPrivateState(this.providers.privateStateProvider);
    if (state) {
      state.currentMatchId = null;
      await this.providers.privateStateProvider.set('pvpPrivateState', state);
      console.log('[api:clearCurrentMatch] currentMatchId cleared');
      this.forceStateRefresh();
    }
  }

  forceStateRefresh(): void {
    if (this.lastLedgerState !== null) {
      console.log('[api:forceStateRefresh] re-deriving state$ with cached ledger state');
      this.refreshSubject.next(this.lastLedgerState);
    } else {
      console.warn('[api:forceStateRefresh] no cached ledger state yet, skipping');
    }
  }

  /**
   * Deploys a new bulletin board contract to the network.
   *
   * @param providers The bulletin board providers.
   * @param logger An optional 'pino' logger to use for logging.
   * @returns A `Promise` that resolves with a {@link PVPArenaAPI} instance that manages the newly deployed
   * {@link DeployedPVPArenaContract}; or rejects with a deployment error.
   */
  static async deploy(providers: PVPArenaProviders, logger?: Logger): Promise<PVPArenaAPI> {
    logger?.info('deployContract');

    const deployedPVPArenaContract: FoundContract<PVPArenaContract> = await deployContract(providers, {
      privateStateId: 'pvpPrivateState',
      compiledContract: pvpCompiledContract,
      initialPrivateState: await PVPArenaAPI.getPrivateState(providers.privateStateProvider),
      //args: [],
    });
    logger?.trace({
      contractDeployed: {
        finalizedDeployTxData: deployedPVPArenaContract.deployTxData.public,
      },
    });

    return new PVPArenaAPI(deployedPVPArenaContract, providers, logger);
  }

  /**
   * Finds an already deployed bulletin board contract on the network, and joins it.
   *
   * @param providers The bulletin board providers.
   * @param contractAddress The contract address of the deployed bulletin board contract to search for and join.
   * @param logger An optional 'pino' logger to use for logging.
   * @returns A `Promise` that resolves with a {@link PVPArenaAPI} instance that manages the joined
   * {@link DeployedPVPArenaContract}; or rejects with an error.
   */
  static async join(providers: PVPArenaProviders, contractAddress: ContractAddress, logger?: Logger): Promise<PVPArenaAPI> {
    logger?.info({
      joinContract: {
        contractAddress,
      },
    });

    console.log('pvpCompiledContract', pvpCompiledContract);
    console.log('contractAddress', contractAddress);
    const deployedPVPArenaContract = await findDeployedContract(providers, {
      contractAddress,
      compiledContract: pvpCompiledContract,
      privateStateId: 'pvpPrivateState',
      initialPrivateState: await PVPArenaAPI.getPrivateState(providers.privateStateProvider),
    });

    logger?.trace({
      contractJoined: {
        finalizedDeployTxData: deployedPVPArenaContract.deployTxData.public,
      },
    });

    return new PVPArenaAPI(deployedPVPArenaContract, providers, logger);
  }

  static async getPrivateState(
    privateStateProvider: PrivateStateProvider
  ): Promise<PVPArenaPrivateState> {
    const existingPrivateState =
      await privateStateProvider.get("pvpPrivateState");

    if (existingPrivateState) {
      const sk = (existingPrivateState as any).secretKey;
      const mid = (existingPrivateState as any).currentMatchId;
      console.log(`[getPrivateState] found existing state — secretKey type=${typeof sk} instanceof=${sk instanceof Uint8Array} null=${sk == null} | currentMatchId=${mid} type=${typeof mid}`);
      return existingPrivateState;
    } else {
      console.log('[getPrivateState] no existing state — creating fresh state');
      let newPrivateState = createPVPArenaPrivateState(utils.randomBytes(32));

      // this is done anyway on the first contract deploy/join, but we need to
      // initialize it before that to be able to have the public key for the
      // lobby menu available before that.
      privateStateProvider.set("pvpPrivateState", newPrivateState);

      return newPrivateState;
    }
  }
}


/**
 * A namespace that represents the exports from the `'utils'` sub-package.
 *
 * @public
 */
export * as utils from './utils/index.js';

export * from './common-types.js';
