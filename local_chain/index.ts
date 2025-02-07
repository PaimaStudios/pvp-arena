import type { Wallet } from "@midnight-ntwrk/wallet-api";
import { type Resource, WalletBuilder } from "@midnight-ntwrk/wallet";
import { nativeToken, NetworkId } from "@midnight-ntwrk/zswap";
import Rx from "rxjs";
import { exit } from "process";

export const GENESIS_MINT_WALLET_SEED =
  "0000000000000000000000000000000000000000000000000000000000000042";

const wallet = await WalletBuilder.buildFromSeed(
  "http://127.0.0.1:8088/api/v1/graphql",
  "ws://127.0.0.1:8088/api/v1/graphql/ws",
  "http://127.0.0.1:6300",
  "http://127.0.0.1:9944",
  GENESIS_MINT_WALLET_SEED,
  NetworkId.Undeployed
);

const waitForFunds = (wallet: Wallet) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.tap((state) => {
        const scanned = state.syncProgress?.synced ?? 0n;
        const total = state.syncProgress?.total.toString() ?? "unknown number";

        console.log(`Scanned ${scanned}, total: ${total}`);
      }),
      Rx.filter((state) => {
        // Let's allow progress only if wallet is close enough
        const synced = state.syncProgress?.synced ?? 0n;
        const total = state.syncProgress?.total ?? 1_000n;
        return total - synced < 100n;
      }),
      Rx.map((s) => s.balances[nativeToken()] ?? 0n),
      Rx.filter((balance) => balance > 0n)
    )
  );

wallet.start();

const state = await Rx.firstValueFrom(wallet.state());
let balance = state.balances[nativeToken()];
if (balance === undefined || balance === 0n) {
  console.log("Waiting for wallet to sync up");
  balance = await waitForFunds(wallet);
  console.log("balance", balance);
}

console.log("Sending funds");

const receiverAddress = "fddfe3614e32638acb2182348ab34ee311e3b494febbed32fbcd761d52c7205d|0300ca1150651275c81725976e13812f4ec69b083874596bf511e0710151e135d8b2860496b60c76459d4c7c1f54f7d59043a7eb61c25b20ec83";

const transferRecipe = await wallet.transferTransaction([
  {
    amount: 10000000000n,
    receiverAddress:
      receiverAddress,
    type: nativeToken(),
  },
]);

const transaction = await wallet.proveTransaction(transferRecipe);
console.log("Proved transaction");

await wallet.submitTransaction(transaction);
console.log("Submitted transaction");

exit(0);
