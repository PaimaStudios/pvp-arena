/*
 * This file defines the shape of the bulletin board's private state,
 * as well as the single witness function that accesses it.
 */

import { Ledger, STANCE } from './managed/pvp/contract/index.cjs';
import { WitnessContext } from '@midnight-ntwrk/compact-runtime';

// this is god-awfully hacky but I can't figure out how to access the witnesses in another way
// without making a lot of changes to contract management code since the examples only have
// static witnesses
// export interface DynamicWitnesses {
//   moves: () => bigint[];
//   stances: () => STANCE[];
//   dbg: () => string;
// }

export abstract class DynamicWitnesses {
  public abstract moves(): bigint[];
  public abstract stances(): STANCE[];
  public abstract dbg(): string;
}



/* **********************************************************************
 * The only hidden state needed by the bulletin board contract is
 * the user's secret key.  Some of the library code and
 * compiler-generated code is parameterized by the type of our
 * private state, so we define a type for it and a function to
 * make an object of that type.
 */

export type BBoardPrivateState = {
  readonly secretKey: Uint8Array;
  //dynamicWitnesses: DynamicWitnesses;
  moves: bigint[];
  stances: STANCE[];
};

export const createBBoardPrivateState = (secretKey: Uint8Array, dynamicWitnesses: DynamicWitnesses) => {
  console.log(`  -- createBBoardPrivateState: ${JSON.stringify(dynamicWitnesses)} | ${dynamicWitnesses.dbg()}`);
  return {
    secretKey,
    //dynamicWitnesses,
    moves: [],
    stances: [],
  };
};

/* **********************************************************************
 * The witnesses object for the bulletin board contract is an object
 * with a field for each witness function, mapping the name of the function
 * to its implementation.
 *
 * The implementation of each function always takes as its first argument
 * a value of type WitnessContext<L, PS>, where L is the ledger object type
 * that corresponds to the ledger declaration in the Compact code, and PS
 *  is the private state type, like BBoardPrivateState defined above.
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
 * the declared return value.  In this case, that's a BBoardPrivateState
 * and a Uint8Array (because the contract declared a return value of Bytes[32],
 * and that's a Uint8Array in TypeScript).
 *
 * The player_sk witness does not need the ledger or contractAddress
 * from the WitnessContext, so it uses the parameter notation that puts
 * only the binding for the privateState in scope.
 */
export const witnesses = {
  player_secret_key: ({ privateState }: WitnessContext<Ledger, BBoardPrivateState>): [BBoardPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],

  player_moves: ({ privateState }: WitnessContext<Ledger, BBoardPrivateState>): [BBoardPrivateState, bigint[]] => {
    //console.log(`let's try JSON:  ; ${JSON.stringify(privateState.dynamicWitnesses)}`);
    //console.log(`player_moves() impl called - has it been initialized? [2] ${privateState.dynamicWitnesses.dbg()}`);
    return [
      privateState,
      privateState.moves,
      //privateState.dynamicWitnesses.moves(),
    ]
  },

  player_stances: ({ privateState }: WitnessContext<Ledger, BBoardPrivateState>): [BBoardPrivateState, STANCE[]] => [
    privateState,
    privateState.stances,
    //privateState.dynamicWitnesses.stances(),
  ]
};
