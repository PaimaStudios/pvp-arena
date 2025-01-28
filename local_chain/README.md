# How to use

1. Switch Lace to the undeployed setting (settings -> midnight network).
1. docker compose up
2. Replace the contents of the receiverAddress variable in index.ts with your wallet's address.
3. npm install
4. npm run fund-wallet
5. Wait for Lace to receive the funds
6. Build the phaser package with `npm run build-undeployed`