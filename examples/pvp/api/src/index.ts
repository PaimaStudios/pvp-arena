/**
 * Provides types and utilities for working with bulletin board contracts.
 *
 * @packageDocumentation
 */

import { type ContractAddress, convert_bigint_to_Uint8Array } from '@midnight-ntwrk/compact-runtime';
import { type Logger } from 'pino';
import type { PVPArenaDerivedState, PVPArenaContract, PVPArenaProviders, DeployedPVPArenaContract } from './common-types.js';
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
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, tap, from, type Observable } from 'rxjs';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

/** @internal */
const pvpContractInstance: PVPArenaContract = new Contract(witnesses);

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

export function safeJSONString(obj: object): string {
  // hacky but just doing it manually since otherwise: 'string' can't be used to index type '{}'
  // let newObj = {}
  // for (let [key, val] of Object.entries(obj)) {
  //     if (typeof val == 'bigint') {
  //         newObj[key] = Number(val);
  //     } else {
  //         newObj[key] = val;
  //     }
  // }
  // return JSON.stringify(newObj);
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
      let str = '{';
      let first = true;
      for (let [key, val] of Object.entries(obj)) {
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

/**
 * An API for a deployed bulletin board.
 */
export interface DeployedPVPArenaAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<PVPArenaDerivedState>;

  p1_select_first_hero: (first_hero: Hero) => Promise<void>
  p2_select_first_heroes: (first_heroes: Hero[]) => Promise<void>
  p1_select_last_heroes: (last_heroes: Hero[]) => Promise<void>
  p2_select_last_hero: (last_p1_hero: Hero) => Promise<void>
  p1Commit: (commands: bigint[], stances: STANCE[]) => Promise<void>;
  p2Commit: (commands: bigint[], stances: STANCE[]) => Promise<void>;
  p1Reveal: (commands: bigint[], stances: STANCE[]) => Promise<void>;
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
  /** @internal */
  private constructor(
    public readonly deployedContract: DeployedPVPArenaContract,
    private readonly providers: PVPArenaProviders,
    private readonly isPractice: boolean,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    this.state$ = combineLatest(
      [
        // Combine public (ledger) state with...
        providers.publicDataProvider.contractStateObservable(this.deployedContractAddress, { type: 'latest' }).pipe(
          map((contractState) => ledger(contractState.data)),
          tap((ledgerState) =>
            logger?.trace({
              ledgerStateChanged: {
                ledgerState: {
                  ...ledgerState,
                  // state: ledgerState.state === STATE.occupied ? 'occupied' : 'vacant',
                  // poster: toHex(ledgerState.poster),
                },
              },
            }),
          ),
        ),
        // ...private state...
        //    since the private state of the bulletin board application never changes, we can query the
        //    private state once and always use the same value with `combineLatest`. In applications
        //    where the private state is expected to change, we would need to make this an `Observable`.
        from(providers.privateStateProvider.get('pvpPrivateState') as Promise<PVPArenaPrivateState>),
      ],
      // ...and combine them to produce the required derived state.
      (ledgerState, privateState) => {
        const localPublicKey = pureCircuits.derive_public_key(privateState.secretKey);

        const isP1 = ledgerState.p1PublicKey === localPublicKey;
        const isP2 = ledgerState.p2PublicKey.is_some && (ledgerState.p2PublicKey.value === localPublicKey);

        return {
          round: ledgerState.round,
          state: ledgerState.gameState,
          p1Heroes: ledgerState.p1Heroes.filter((h) => h.is_some).map((h) => h.value),
          p1Cmds: ledgerState.p1Cmds.is_some ? ledgerState.p1Cmds.value : undefined,
          p1Dmg: [ledgerState.p1Dmg0, ledgerState.p1Dmg1, ledgerState.p1Dmg2],
          p1Alive: [ledgerState.p1Alive0, ledgerState.p1Alive1, ledgerState.p1Alive2],
          p1Stances: ledgerState.p1Stances,
          isP1,
          isP2,
          p1PubKey: ledgerState.p1PublicKey,
          p2Heroes: ledgerState.p2Heroes.filter((h) => h.is_some).map((h) => h.value),
          p2Cmds: ledgerState.p2Cmds.is_some ? ledgerState.p2Cmds.value : undefined,
          p2Dmg: [ledgerState.p2Dmg0, ledgerState.p2Dmg1, ledgerState.p2Dmg2],
          p2Alive: [ledgerState.p2Alive0, ledgerState.p2Alive1, ledgerState.p2Alive2],
          p2Stances: ledgerState.p2Stances,
          p2PubKey: ledgerState.p2PublicKey.is_some ? ledgerState.p2PublicKey.value : undefined,
          secretKey: privateState.secretKey,
          nonce: ledgerState.commitNonce,
          commit: ledgerState.p1Commit,
        };
      },
    );

    // in practice mode we locally run everything in the mockapi but ran on-chain
    if (isPractice) {
      this.state$.subscribe((state) => {
        // nothing is awaited since not async + doesn't matter as it's always the last thing called
        // also, this won't be called again until the execution is completed and state changes on the network
        switch (state.state) {
          case GAME_STATE.p2_selecting_first_heroes:
            this.p2_select_first_heroes([generateRandomHero(), generateRandomHero()]);
            break;
          case GAME_STATE.p2_selecting_last_hero:
            this.p2_select_last_hero(generateRandomHero());
            break;
          case GAME_STATE.p2_commit_reveal:
            const commands = [0, 1, 2].map((i) => {
              if (state.p2Alive[i]) {
                  const availableTargets = [0, 1, 2].filter((j) => state.p1Alive[j]);
                  return BigInt(availableTargets[randIntBetween(0, availableTargets.length - 1)]);
              }
              // this should never be read anyway
              return BigInt(3);
            });
            const stances = state.p2Stances.map((stance, i) => {
              if (state.p2Alive[i]) {
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
            this.p2Commit(commands, stances);
          break;
        }
      });
    }
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
   * Select the first hero for Player 1
   *
   * @param first_hero Player 1's first hero
   *
   * @remarks
   * This method can fail if called more than once or if validation fails
   */
  async p1_select_first_hero(first_hero: Hero): Promise<void> {
    //this.logger?.info(`postingMessage: ${message}`);

    const txData = await this.deployedContract.callTx.p1_select_first_hero(heroToHack(first_hero));

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
  
      const txData = await this.deployedContract.callTx.p1_select_last_heroes(last_heroes.map(heroToHack));
  
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

    const txData = await this.deployedContract.callTx.p2_select_first_heroes(first_heroes.map(heroToHack));

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
  
      const txData = await this.deployedContract.callTx.p2_select_last_hero(heroToHack(last_hero));
  
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
    console.log('before[1]');
    var txData;
    try {
      const state = await PVPArenaAPI.getPrivateState(this.providers.privateStateProvider);
      state!.commands = commands;
      state!.stances = stances;
      await this.providers.privateStateProvider.set('pvpPrivateState', state);
      const nonce = utils.randomBytes(32);
      //await sleep(1000);
      txData = await this.deployedContract.callTx.p1_commit_commands(nonce);
    } catch (err) {
      console.log(`p1Cmd failed: ${JSON.stringify(err)}`);
      throw err;
    }
    console.log('after[1]');
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

    console.log('before[2]');
    var txData;
    try {
      const state = await PVPArenaAPI.getPrivateState(this.providers.privateStateProvider);
      state!.commands = commands;
      state!.stances = stances;
      await this.providers.privateStateProvider.set('pvpPrivateState', state);
      //await sleep(1000);
      txData = await this.deployedContract.callTx.p2_commit_commands();
    } catch (err) {
      console.log(`p2Cmd failed: ${JSON.stringify(err)}`);
      throw err;
    }
    console.log('after[2]');
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
      txData = await this.deployedContract.callTx.p1_reveal_commands();
    } catch (err) {
      console.log(`p1Reveal failed: ${JSON.stringify(err)}`);
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

  /**
   * Deploys a new bulletin board contract to the network.
   *
   * @param providers The bulletin board providers.
   * @param logger An optional 'pino' logger to use for logging.
   * @returns A `Promise` that resolves with a {@link PVPArenaAPI} instance that manages the newly deployed
   * {@link DeployedPVPArenaContract}; or rejects with a deployment error.
   */
  static async deploy(providers: PVPArenaProviders, isPractice: boolean, logger?: Logger): Promise<PVPArenaAPI> {
    logger?.info('deployContract');

    // EXERCISE 5: FILL IN THE CORRECT ARGUMENTS TO deployContract
    const deployedPVPArenaContract = await deployContract(providers, {
      // EXERCISE ANSWER
      privateStateKey: 'pvpPrivateState', // EXERCISE ANSWER
      contract: pvpContractInstance,
      initialPrivateState: await PVPArenaAPI.getPrivateState(providers.privateStateProvider), // EXERCISE ANSWER
      //args: [],
    });
    logger?.trace({
      contractDeployed: {
        finalizedDeployTxData: deployedPVPArenaContract.deployTxData.public,
      },
    });

    return new PVPArenaAPI(deployedPVPArenaContract, providers, isPractice, logger);
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

    const deployedPVPArenaContract = await findDeployedContract(providers, {
      contractAddress,
      contract: pvpContractInstance,
      privateStateKey: 'pvpPrivateState',
      initialPrivateState: await PVPArenaAPI.getPrivateState(providers.privateStateProvider),
    });

    logger?.trace({
      contractJoined: {
        finalizedDeployTxData: deployedPVPArenaContract.deployTxData.public,
      },
    });

    return new PVPArenaAPI(deployedPVPArenaContract, providers, false, logger);
  }

  static async getPrivateState(
    privateStateProvider: PrivateStateProvider
  ): Promise<PVPArenaPrivateState> {
    const existingPrivateState =
      await privateStateProvider.get("pvpPrivateState");

    if (existingPrivateState) {
      return existingPrivateState;
    } else {
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
