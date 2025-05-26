/*
 * This file defines the shape of the bulletin board's private state,
 * as well as the single witness function that accesses it.
 */

import { Ledger, STANCE } from './managed/pvp/contract/index.cjs';
import { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/* **********************************************************************
 * The only hidden state needed by the bulletin board contract is
 * the user's secret key.  Some of the library code and
 * compiler-generated code is parameterized by the type of our
 * private state, so we define a type for it and a function to
 * make an object of that type.
 */

export type PVPArenaPrivateState = {
  readonly secretKey: Uint8Array;
  commands: bigint[];
  stances: STANCE[];
};

export const createPVPArenaPrivateState = (secretKey: Uint8Array) => ({
  // EXERCISE 1b: INITIALIZE THE OBJECT OF TYPE PVPArenaPrivateState
  secretKey, // EXERCISE ANSWER
  commands: [],
  stances: []
});

/* **********************************************************************
 * The witnesses object for the bulletin board contract is an object
 * with a field for each witness function, mapping the name of the function
 * to its implementation.
 *
 * The implementation of each function always takes as its first argument
 * a value of type WitnessContext<L, PS>, where L is the ledger object type
 * that corresponds to the ledger declaration in the Compact code, and PS
 *  is the private state type, like PVPArenaPrivateState defined above.
 *
 * A WitnessContext has three
 * fields:
 *  - ledger: T
 *  - privateState: PS
 *  - contractAddress: string
 *
 * The other arguments (after the first) to each witness function
 * correspond to the ones declared in Compact for the witness function.
 * The function's return value is a tuple of the new private state and
 * the declared return value.  In this case, that's a PVPArenaPrivateState
 * and a Uint8Array (because the contract declared a return value of Bytes[32],
 * and that's a Uint8Array in TypeScript).
 *
 * The player_sk witness does not need the ledger or contractAddress
 * from the WitnessContext, so it uses the parameter notation that puts
 * only the binding for the privateState in scope.
 */
export const witnesses = {
  player_secret_key: ({ privateState }: WitnessContext<Ledger, PVPArenaPrivateState>): [PVPArenaPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],

  player_commands: ({ privateState }: WitnessContext<Ledger, PVPArenaPrivateState>): [PVPArenaPrivateState, bigint[]] => [
    privateState,
    privateState.commands,
  ],

  player_stances: ({ privateState }: WitnessContext<Ledger, PVPArenaPrivateState>): [PVPArenaPrivateState, STANCE[]] => [
    privateState,
    privateState.stances,
  ],
};
