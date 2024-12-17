/**
 * Provides types and utilities for working with bulletin board contracts.
 *
 * @packageDocumentation
 */

import { type ContractAddress, convert_bigint_to_Uint8Array } from '@midnight-ntwrk/compact-runtime';
import { type Logger } from 'pino';
import type { BBoardDerivedState, BBoardContract, BBoardProviders, DeployedBBoardContract } from './common-types.js';
import {
  type BBoardPrivateState,
  Contract,
  createBBoardPrivateState,
  ledger,
  pureCircuits,
  witnesses,
  RESULT,
  ITEM,
  ARMOR,
  Hero,
 // Command,
} from '@midnight-ntwrk/pvp-contract';
import * as utils from './utils/index.js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, tap, from, type Observable } from 'rxjs';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';

/** @internal */
const pvpContractInstance: BBoardContract = new Contract(witnesses);

/**
 * An API for a deployed bulletin board.
 */
export interface DeployedBBoardAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<BBoardDerivedState>;

  reg_p2: () => Promise<void>;
  p1Command: (commands: bigint[]) => Promise<RESULT>;
  p2Command: (commands: bigint[]) => Promise<RESULT>;
}

/**
 * Provides an implementation of {@link DeployedBBoardAPI} by adapting a deployed bulletin board
 * contract.
 *
 * @remarks
 * The `BBoardPrivateState` is managed at the DApp level by a private state provider. As such, this
 * private state is shared between all instances of {@link BBoardAPI}, and their underlying deployed
 * contracts. The private state defines a `'secretKey'` property that effectively identifies the current
 * user, and is used to determine if the current user is the poster of the message as the observable
 * contract state changes.
 *
 * In the future, Midnight.js will provide a private state provider that supports private state storage
 * keyed by contract address. This will remove the current workaround of sharing private state across
 * the deployed bulletin board contracts, and allows for a unique secret key to be generated for each bulletin
 * board that the user interacts with.
 */
// TODO: Update BBoardAPI to use contract level private state storage.
export class BBoardAPI implements DeployedBBoardAPI {
  /** @internal */
  private constructor(
    public readonly deployedContract: DeployedBBoardContract,
    providers: BBoardProviders,
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
        from(providers.privateStateProvider.get('pvpPrivateState') as Promise<BBoardPrivateState>),
      ],
      // ...and combine them to produce the required derived state.
      (ledgerState, privateState) => {
        const localSig = pureCircuits.calc_sig(
          privateState.secretKey,
          ledgerState.instance,
        );

        const isP1 = ledgerState.p1Sig === localSig;
        const state = (ledgerState.p1Cmds.is_some && isP1) || (ledgerState.p2Cmds.is_some && !isP1) ? RESULT.waiting  : RESULT.continue;

        return {
          state,
          instance: ledgerState.instance,
          p1Heroes: ledgerState.p1Heroes,
          p1Cmds: ledgerState.p1Cmds.is_some ? ledgerState.p1Cmds.value : undefined,
          p1Dmg: [ledgerState.p1Dmg0, ledgerState.p1Dmg1, ledgerState.p1Dmg2],
          p1Stances: ledgerState.p1Stances,
          isP1,
          p2Heroes: ledgerState.p2Heroes,
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
  readonly state$: Observable<BBoardDerivedState>;

  /**
   * Attempts to post a given message to the bulletin board.
   *
   * @param message The message to post.
   *
   * @remarks
   * This method can fail during local circuit execution if the bulletin board is currently occupied.
   */
  async reg_p2(): Promise<void> {
    //this.logger?.info(`postingMessage: ${message}`);

    const txData = await this.deployedContract.callTx.reg_p2();

    this.logger?.trace({
      transactionAdded: {
        circuit: 'reg_p2',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  async p1Command(commands: bigint[]): Promise<RESULT> {
    this.logger?.info('p1Command');

    //console.log(`commands: ${commands.map((c) => c.attack.toString()).join(',')}`);
    //const txData = await this.deployedContract.callTx.p1_command([commands[0].attack, commands[1].attack, commands[2].attack]);
    console.log('before[1]');
    var txData;
    try {
      txData = await this.deployedContract.callTx.p1_command(commands);
    } catch (err) {
      console.log(`p1Cmd failed: ${JSON.stringify(err)}`);
      throw err;
    }
    console.log('after[1]');
    this.logger?.trace({
      transactionAdded: {
        circuit: 'p1_command',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });

    return txData.private.result;
  }

  async p2Command(commands: bigint[]): Promise<RESULT> {
    this.logger?.info('p2Command');

    console.log('before[2]');
    var txData;
    try {
      txData = await this.deployedContract.callTx.p2_command(commands);
    } catch (err) {
      console.log(`p2Cmd failed: ${JSON.stringify(err)}`);
      throw err;
    }
    console.log('after[2]');
    //const txData = await this.deployedContract.callTx.p2_command([commands[0].attack, commands[1].attack, commands[2].attack]);

    this.logger?.trace({
      transactionAdded: {
        circuit: 'p2_command',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });

    return txData.private.result;
  }

  /**
   * Deploys a new bulletin board contract to the network.
   *
   * @param providers The bulletin board providers.
   * @param logger An optional 'pino' logger to use for logging.
   * @returns A `Promise` that resolves with a {@link BBoardAPI} instance that manages the newly deployed
   * {@link DeployedBBoardContract}; or rejects with a deployment error.
   */
  static async deploy(providers: BBoardProviders, logger?: Logger): Promise<BBoardAPI> {
    logger?.info('deployContract');

    // EXERCISE 5: FILL IN THE CORRECT ARGUMENTS TO deployContract
    const deployedBBoardContract = await deployContract(providers, {
      // EXERCISE ANSWER
      privateStateKey: 'pvpPrivateState', // EXERCISE ANSWER
      contract: pvpContractInstance,
      initialPrivateState: await BBoardAPI.getPrivateState(providers), // EXERCISE ANSWER
      args: [            [
        { lhs: ITEM.axe, rhs: ITEM.sword, helmet: ARMOR.leather, chest: ARMOR.leather, skirt: ARMOR.nothing, greaves: ARMOR.leather },
        { lhs: ITEM.bow, rhs: ITEM.nothing, helmet: ARMOR.nothing, chest: ARMOR.nothing, skirt: ARMOR.leather, greaves: ARMOR.metal },
        { lhs: ITEM.shield, rhs: ITEM.axe, helmet: ARMOR.metal, chest: ARMOR.metal, skirt: ARMOR.metal, greaves: ARMOR.nothing },
    ], [
        { lhs: ITEM.spear, rhs: ITEM.spear, helmet: ARMOR.leather, chest: ARMOR.metal, skirt: ARMOR.leather, greaves: ARMOR.leather},
        { lhs: ITEM.spear, rhs: ITEM.shield, helmet: ARMOR.metal, chest: ARMOR.metal, skirt: ARMOR.metal, greaves: ARMOR.metal },
        { lhs: ITEM.sword, rhs: ITEM.sword, helmet: ARMOR.nothing, chest: ARMOR.nothing, skirt: ARMOR.nothing, greaves: ARMOR.nothing },
    ]],
    });

    logger?.trace({
      contractDeployed: {
        finalizedDeployTxData: deployedBBoardContract.deployTxData.public,
      },
    });

    return new BBoardAPI(deployedBBoardContract, providers, logger);
  }

  /**
   * Finds an already deployed bulletin board contract on the network, and joins it.
   *
   * @param providers The bulletin board providers.
   * @param contractAddress The contract address of the deployed bulletin board contract to search for and join.
   * @param logger An optional 'pino' logger to use for logging.
   * @returns A `Promise` that resolves with a {@link BBoardAPI} instance that manages the joined
   * {@link DeployedBBoardContract}; or rejects with an error.
   */
  static async join(providers: BBoardProviders, contractAddress: ContractAddress, logger?: Logger): Promise<BBoardAPI> {
    logger?.info({
      joinContract: {
        contractAddress,
      },
    });

    const deployedBBoardContract = await findDeployedContract(providers, {
      contractAddress,
      contract: pvpContractInstance,
      privateStateKey: 'pvpPrivateState',
      initialPrivateState: await BBoardAPI.getPrivateState(providers),
    });

    logger?.trace({
      contractJoined: {
        finalizedDeployTxData: deployedBBoardContract.deployTxData.public,
      },
    });

    return new BBoardAPI(deployedBBoardContract, providers, logger);
  }

  private static async getPrivateState(providers: BBoardProviders): Promise<BBoardPrivateState> {
    const existingPrivateState = await providers.privateStateProvider.get('pvpPrivateState');
    // hacky convert bytes[32] to bigint
    const randSrc = utils.randomBytes(32);
    // let randBigInt = BigInt(0);
    // let scalar = BigInt(1);
    // for (let i = 0; i < 32; ++i) {
    //   randBigInt += BigInt(randSrc[i]) * scalar;
    //   scalar *= BigInt(256);
    // }
    return existingPrivateState ?? createBBoardPrivateState(randSrc);
  }
}

/**
 * A namespace that represents the exports from the `'utils'` sub-package.
 *
 * @public
 */
export * as utils from './utils/index.js';

export * from './common-types.js';
