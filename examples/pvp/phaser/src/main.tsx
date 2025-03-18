import { NetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import '@midnight-ntwrk/dapp-connector-api';
import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE } from '@midnight-ntwrk/pvp-contract';
import { type PVPArenaDerivedState, type DeployedPVPArenaAPI } from '@midnight-ntwrk/pvp-api';
import './globals';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { LedgerState } from '@midnight-ntwrk/ledger';
import { BrowserDeploymentManager } from './wallet';
import * as pino from 'pino';

// TODO: get this properly? it's undefined if i uncomment this
//const networkId = import.meta.env.VITE_NETWORK_ID as NetworkId;
//const networkId = NetworkId.TestNet;
export const networkId = getNetworkId();

function getNetworkId(): NetworkId {
    switch (import.meta.env.MODE) {
        case 'undeployed':
            return NetworkId.Undeployed;
        case 'testnet':
            return NetworkId.TestNet;
        default:
            console.error('Unknown Vite MODE, defaulting to undeployed');
            return NetworkId.Undeployed;
    }
}
// Ensure that the network IDs are set within the Midnight libraries.
setNetworkId(networkId);
export const logger = pino.pino({
    level: import.meta.env.VITE_LOGGING_LEVEL as string,
});
console.log(`networkId = ${networkId}`);

console.log(`VITE: [\n${JSON.stringify(import.meta.env)}\n]`);
// phaser part

import 'phaser';
import RexUIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin'
import BBCodeTextPlugin from 'phaser3-rex-plugins/plugins/bbcodetext-plugin.js';
//import KeyboardPlugin from 'phaser3-';
import RoundRectanglePlugin from 'phaser3-rex-plugins/plugins/roundrectangle-plugin.js';
import { extend } from 'fp-ts/lib/pipeable';
import { Subscriber, Observable } from 'rxjs';

import { MainMenu } from './menus/main';
import { BattleConfig } from './battle/arena';

const COLOR_MAIN = 0x4e342e;
const COLOR_LIGHT = 0x7b5e57;
const COLOR_DARK = 0x260e04;

var createButton = function (scene: any, text: any) {
    return scene.rexUI.add.label({
        width: 100,
        height: 40,
        background: scene.rexUI.add.roundRectangle(0, 0, 0, 0, 20, COLOR_LIGHT),
        text: scene.add.text(0, 0, text, {
            fontSize: 18
        }),
        space: {
            left: 10,
            right: 10,
        }
    });
}

export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 360;

export function fontStyle(fontSize: number, extra?: Phaser.Types.GameObjects.Text.TextStyle): Phaser.Types.GameObjects.Text.TextStyle {
    // this font is really small for some reason, so double it
    return {
        ...extra,
        fontSize: fontSize * 2,
        fontFamily: 'yana',
        color: '#f5f5ed'//'white'
    };
}

// only converts bigint, but this is the only problem we have with printing ledger types
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

export function rootObject(obj: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform): Phaser.GameObjects.Components.Transform {
    while (obj.parentContainer != undefined) {
        obj = obj.parentContainer;
    }
    return obj;
}

export enum MatchState {
    Initializing,
    WaitingOnPlayer,
    WaitingOnOpponent,
    SubmittingMove,
    WaitingOtherPlayerReveal,
    RevealingMove,
    CombatResolving,
    GameOverP1Win,
    GameOverP2Win,
    GameOverTie,
}

export function gameStateStr(state: GAME_STATE): string {
    switch (state) {
        case GAME_STATE.p1_selecting_first_hero:
            return 'p1_selecting_first_hero';
        case GAME_STATE.p2_selecting_first_heroes:
            return 'p2_selecting_first_heroes';
        case GAME_STATE.p1_selecting_last_heroes:
            return 'p1_selecting_last_heroes';
        case GAME_STATE.p2_selecting_last_hero:
            return 'p2_selecting_last_hero';
        case GAME_STATE.p1_commit:
            return 'p1_commit';
        case GAME_STATE.p2_commit_reveal:
            return 'p2_commit_reveal';
        case GAME_STATE.p1_reveal:
            return 'p1_reveal';
        case GAME_STATE.p1_win:
            return 'p1_win';
        case GAME_STATE.p1_win:
            return 'p2_win';
        case GAME_STATE.tie:
            return 'tie';
    }
    return '???';
}

function scaleToWindow(): number {
    return Math.floor(Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT));
}

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  scene: [MainMenu],
  render: {
    pixelArt: true,
  },
  zoom: scaleToWindow(),
  // physics: {
  //     default: 'arcade',
  //     arcade: {
  //         gravity: { x: 0, y: 200 }
  //     }
  // }
  dom: {
    createContainer: true,
  },
  plugins: {
    scene: [
      {
        key: "rexUI",
        plugin: RexUIPlugin,
        mapping: "rexUI",
      },
    ],
    global: [
      {
        key: "rexBBCodeTextPlugin",
        plugin: BBCodeTextPlugin,
        start: true,
      },
    ],
  },
};

export const game = new Phaser.Game(config);