# PVP Arena

## Pre-requisites

### Enable yarn package manager
- Enable corepack:
`corepack enable`
- Install a supported yarn version
`corepack install --global yarn@4.1.0`
- Enable yarn as a package manager
`corepack use yarn@4.1.0`

### Enable turbo
- Check if `turbo` is installed
`turbo --version`
- If not installed, install it globally:
`npm install turbo --global`

### Download compact (v0.21.0)
- Download from this URL: https://docs.midnight.network/relnotes/compact
- Add the compact folder to the PATH:
`export COMPACT_HOME=/path/to/compactc-macos/`
`export PATH=$PATH:$COMPACT_HOME`

## How to build

In this order, run

From `examples/pvp/contract`:
```
yarn install
yarn run compact
yarn run build
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
