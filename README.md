# PVP Arena

## How to build

First make sure you have [`compactc`](https://docs.midnight.network/relnotes/compact) set up and the `COMPACT_HOME` env var set to the unzipped `compactc` directory.

Then, in this order, run

From `examples/pvp/compact`:
```
yarn install
npm run contract
npm run build
```

From `examples/pvp/api`:
```
yarn install
npm run build
```

From `examples/pvp/phaser`:
```
yarn install
npm run build-batcher
npm run preview
```

You must also have the node/batcher set up in accordance with the readme [here](https://github.com/PaimaStudios/midnight-batcher).

Then open `http://localhost:4173/` in your browser.
