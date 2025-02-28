/**
 * Bulletin board common types and abstractions.
 *
 * @module
 */

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { Hero, RESULT, STANCE, GAME_STATE, PVPArenaPrivateState, Contract, Witnesses } from '@midnight-ntwrk/pvp-contract';

/**
 * The private states consumed throughout the application.
 *
 * @remarks
 * {@link PrivateStates} can be thought of as a type that describes a schema for all
 * private states for all contracts used in the application. Each key represents
 * the type of private state consumed by a particular type of contract.
 * The key is used by the deployed contract when interacting with a private state provider,
 * and the type (i.e., `typeof PrivateStates[K]`) represents the type of private state
 * expected to be returned.
 *
 * Since there is only one contract type for the bulletin board example, we only define a
 * single key/type in the schema.
 *
 * @public
 */
export type PrivateStates = {
  /**
   * Key used to provide the private state for {@link PVPArenaContract} deployments.
   */
  readonly pvpPrivateState: PVPArenaPrivateState;
};

/**
 * Represents a bulletin board contract and its private state.
 *
 * @public
 */
export type PVPArenaContract = Contract<PVPArenaPrivateState, Witnesses<PVPArenaPrivateState>>;

/**
 * The keys of the circuits exported from {@link PVPArenaContract}.
 *
 * @public
 */
export type PVPArenaCircuitKeys = Exclude<keyof PVPArenaContract['impureCircuits'], number | symbol>;

/**
 * The providers required by {@link PVPArenaContract}.
 *
 * @public
 */
export type PVPArenaProviders = MidnightProviders<PVPArenaCircuitKeys, PrivateStates>;

/**
 * A {@link PVPArenaContract} that has been deployed to the network.
 *
 * @public
 */
export type DeployedPVPArenaContract = FoundContract<PVPArenaPrivateState, PVPArenaContract>;

/**
 * A type that represents the derived combination of public (or ledger), and private state.
 */
export type PVPArenaDerivedState = {
  readonly p1Heroes: Hero[];
  readonly p1Cmds: bigint[] | undefined;
  readonly p1Dmg: bigint[];
  readonly p1Stances: STANCE[];
  readonly isP1: boolean;
  readonly p2Heroes: Hero[];
  readonly p2Cmds: bigint[] | undefined;
  readonly p2Dmg: bigint[];
  readonly p2Stances: STANCE[];
  readonly round: bigint;
  readonly state: GAME_STATE;
  // readonly p2Dmg0: bigint;
  // readonly p2Dmg1: bigint;
  // readonly p2Dmg2: bigint;
};
