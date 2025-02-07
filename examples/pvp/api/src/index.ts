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

/**
 * An API for a deployed bulletin board.
 */
export interface DeployedPVPArenaAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<PVPArenaDerivedState>;

  p1_select_first_heroes: (first_p1_heroes: Hero[]) => Promise<void>
  p2_select_heroes: (all_p2_heroes: Hero[]) => Promise<void>
  p1_select_last_hero: (last_p1_hero: Hero) => Promise<void>
  p1Commit: (commands: bigint[], stances: STANCE[]) => Promise<void>;
  p2Commit: (commands: bigint[], stances: STANCE[]) => Promise<void>;
  p1Reveal: () => Promise<void>;
  p2Reveal: () => Promise<void>;
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
        const localSig = pureCircuits.calc_sig(
          privateState.secretKey,
          ledgerState.instance,
        );

        const isP1 = ledgerState.p1Sig === localSig;

        return {
          instance: ledgerState.instance,
          round: ledgerState.round,
          state: ledgerState.gameState,
          p1Heroes: ledgerState.p1Heroes.filter((h) => h.is_some).map((h) => h.value),
          p1Cmds: ledgerState.p1Cmds.is_some ? ledgerState.p1Cmds.value : undefined,
          p1Dmg: [ledgerState.p1Dmg0, ledgerState.p1Dmg1, ledgerState.p1Dmg2],
          p1Stances: ledgerState.p1Stances,
          isP1,
          p2Heroes: ledgerState.p2Heroes.filter((h) => h.is_some).map((h) => h.value),
          p2Cmds: ledgerState.p2Cmds.is_some ? ledgerState.p2Cmds.value : undefined,
          p2Dmg: [ledgerState.p2Dmg0, ledgerState.p2Dmg1, ledgerState.p2Dmg2],
          p2Stances: ledgerState.p2Stances,
        };
      },
    );
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
   * Select the remaining hero for Player 1
   *
   * @param all_p2_heroes All 3 Player 2 heroes.
   *
   * @remarks
   * This method can fail if called more than once or if validation fails
   */
  async p1_select_first_heroes(first_p1_heroes: Hero[]): Promise<void> {
    //this.logger?.info(`postingMessage: ${message}`);

    const txData = await this.deployedContract.callTx.p1_select_first_heroes(first_p1_heroes.map(heroToHack));

    this.logger?.trace({
      transactionAdded: {
        circuit: 'p1_select_first_heroes',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }
  /**
   * Joins the contract as Player 2 and selects all your heroes to fight.
   *
   * @param all_p2_heroes All 3 Player 2 heroes.
   *
   * @remarks
   * This method can fail if called more than once
   */
  async p2_select_heroes(all_p2_heroes: Hero[]): Promise<void> {
    //this.logger?.info(`postingMessage: ${message}`);

    const txData = await this.deployedContract.callTx.p2_select_heroes(all_p2_heroes.map(heroToHack));

    this.logger?.trace({
      transactionAdded: {
        circuit: 'p2_select_heroes',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Select the remaining hero for Player 1
   *
   * @param all_p2_heroes All 3 Player 2 heroes.
   *
   * @remarks
   * This method can fail if called more than once or if validation fails
   */
  async p1_select_last_hero(last_p1_hero: Hero): Promise<void> {
    //this.logger?.info(`postingMessage: ${message}`);

    const txData = await this.deployedContract.callTx.p1_select_last_hero(heroToHack(last_p1_hero));

    this.logger?.trace({
      transactionAdded: {
        circuit: 'p1_select_last_hero',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  async p1Commit(commands: bigint[], stances: STANCE[]): Promise<void> {
    this.logger?.info('p1Command');

    //console.log(`commands: ${commands.map((c) => c.attack.toString()).join(',')}`);
    //const txData = await this.deployedContract.callTx.p1_command([commands[0].attack, commands[1].attack, commands[2].attack]);
    console.log('before[1]');
    var txData;
    try {
      const state = await PVPArenaAPI.getPrivateState(this.providers);
      state!.commands = commands;
      state!.stances = stances;
      this.providers.privateStateProvider.set('pvpPrivateState', state);
      txData = await this.deployedContract.callTx.p1_commit_commands();
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
    this.logger?.info('p2Command');

    console.log('before[2]');
    var txData;
    try {
      const state = await PVPArenaAPI.getPrivateState(this.providers);
      state!.commands = commands;
      state!.stances = stances;
      this.providers.privateStateProvider.set('pvpPrivateState', state);
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

  async p1Reveal(): Promise<void> {
    this.logger?.info('p1Reveal');

    var txData;
    try {
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

  async p2Reveal(): Promise<void> {
    this.logger?.info('p2Reveal');

    var txData;
    try {
      txData = await this.deployedContract.callTx.p2_reveal_commands();
    } catch (err) {
      console.log(`p2Reveal failed: ${JSON.stringify(err)}`);
      throw err;
    }

    this.logger?.trace({
      transactionAdded: {
        circuit: 'p2_reveal_commands',
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
  static async deploy(providers: PVPArenaProviders, logger?: Logger): Promise<PVPArenaAPI> {
    logger?.info('deployContract');

    // EXERCISE 5: FILL IN THE CORRECT ARGUMENTS TO deployContract
    const deployedPVPArenaContract = await deployContract(providers, {
      // EXERCISE ANSWER
      privateStateKey: 'pvpPrivateState', // EXERCISE ANSWER
      contract: pvpContractInstance,
      initialPrivateState: await PVPArenaAPI.getPrivateState(providers), // EXERCISE ANSWER
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

    const deployedPVPArenaContract = await findDeployedContract(providers, {
      contractAddress,
      contract: pvpContractInstance,
      privateStateKey: 'pvpPrivateState',
      initialPrivateState: await PVPArenaAPI.getPrivateState(providers),
    });

    logger?.trace({
      contractJoined: {
        finalizedDeployTxData: deployedPVPArenaContract.deployTxData.public,
      },
    });

    return new PVPArenaAPI(deployedPVPArenaContract, providers, logger);
  }

  private static async getPrivateState(providers: PVPArenaProviders): Promise<PVPArenaPrivateState> {
    const existingPrivateState = await providers.privateStateProvider.get('pvpPrivateState');
    // hacky convert bytes[32] to bigint
    const randSrc = utils.randomBytes(32);
    // let randBigInt = BigInt(0);
    // let scalar = BigInt(1);
    // for (let i = 0; i < 32; ++i) {
    //   randBigInt += BigInt(randSrc[i]) * scalar;
    //   scalar *= BigInt(256);
    // }
    return existingPrivateState ?? createPVPArenaPrivateState(randSrc);
  }
}

/**
 * A namespace that represents the exports from the `'utils'` sub-package.
 *
 * @public
 */
export * as utils from './utils/index.js';

export * from './common-types.js';
