import { NetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import '@midnight-ntwrk/dapp-connector-api';
import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE } from '@midnight-ntwrk/pvp-contract';
import { type PVPArenaDerivedState, type DeployedPVPArenaAPI, PVPArenaAPI } from '@midnight-ntwrk/pvp-api';
import './globals';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { LedgerState } from '@midnight-ntwrk/ledger-v7';
import { BrowserDeploymentManager } from './wallet';
import * as pino from 'pino';

// TODO: get this properly? it's undefined if i uncomment this
//const networkId = import.meta.env.VITE_NETWORK_ID as NetworkId;
//const networkId = NetworkId.TestNet;
export const networkId = getNetworkId();

function getNetworkId(): NetworkId {
    // switch (import.meta.env.MODE) {
    //     case 'undeployed':
    //         return NetworkId.Undeployed;
    //     case 'testnet':
    //         return NetworkId.TestNet;
    //     case 'preview':
    //         return ;
    //     default:
    //         console.error(`Unknown Vite MODE ${import.meta.env.MODE}, defaulting to undeployed`);
    //         return NetworkId.Undeployed;
    // }
    return "undeployed";
    // return import.meta.env.MODE;
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
import { Button } from './menus/button';
import { closeTooltip, isTooltipOpen, makeTooltip, TooltipId } from './menus/tooltip';
import { ContractLoader } from './menus/boot';

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

export function makeCopyAddressButton(scene: Phaser.Scene, x: number, y: number, address: ContractAddress): Button {
    const button = new Button(scene, x, y, 24, 24, '', 10, () => {
        navigator.clipboard.writeText(address);
    }, 'Copy contract address');
    button.add(scene.add.image(0, 0, 'clipboard').setAlpha(0.75));
    return button;
}

export function makeExitMatchButton(scene: Phaser.Scene, x: number, y: number): Button {
    return new Button(scene, x, y, 24, 24, '<', 10, () => {
        if (isTooltipOpen(TooltipId.ExitInProgressMatch) || makeTooltip(scene, GAME_WIDTH / 2, GAME_HEIGHT / 4, TooltipId.ExitInProgressMatch) == undefined) {
            closeTooltip(TooltipId.ExitInProgressMatch);
            scene.scene.start('MainMenu');
            scene.scene.remove('Arena');
        }
    }, 'Exit to main menu');
}

export function makeGuideButton(scene: Phaser.Scene, x: number, y: number): Button {
    return new Button(scene, x, y, 24, 24, '?', 10, () => {
        let overlay = document.getElementById('pvp-guide-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            return;
        }
        overlay = document.createElement('div');
        overlay.id = 'pvp-guide-overlay';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.82)',
            'display:flex', 'align-items:center', 'justify-content:center', 'z-index:9999',
        ].join(';');

        const box = document.createElement('div');
        box.style.cssText = [
            'position:relative', 'width:620px', 'height:500px',
            'border:2px solid #3a3a20', 'border-radius:4px', 'overflow:hidden',
        ].join(';');

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = [
            'position:absolute', 'top:6px', 'right:8px',
            'background:#1a1a0e', 'border:1px solid #aabb44', 'border-radius:3px',
            'color:#f5f5ed', 'font-family:monospace', 'font-size:14px',
            'width:24px', 'height:24px', 'cursor:pointer', 'z-index:1',
            'line-height:1', 'padding:0',
        ].join(';');
        closeBtn.onclick = () => { overlay!.style.display = 'none'; };

        const iframe = document.createElement('iframe');
        iframe.src = '/guide.html';
        iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';

        box.appendChild(closeBtn);
        box.appendChild(iframe);
        overlay.appendChild(box);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay!.style.display = 'none';
        });
        document.body.appendChild(overlay);
    }, 'Player guide');
}

export function makeAddressLabel(scene: Phaser.Scene, localPublicKey: bigint | null): void {
    if (localPublicKey == null) return;
    const keyStr = `My Address ${localPublicKey.toString(16).padStart(16, '0').slice(0, 8)}…`;
    scene.add.text(8, GAME_HEIGHT - 8, keyStr, fontStyle(7, { color: '#999988' })).setOrigin(0, 1);
}

export function makeMatchInfoLabel(scene: Phaser.Scene, matchId: bigint, opponentLine: string): void {
    const matchIdStr = matchId.toString();
    const matchIdShort = matchIdStr.slice(0, 6);
    const matchLabel = scene.add.text(8, 4, `Match #${matchIdShort}…`, fontStyle(7, { color: '#aabbaa' }))
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
    matchLabel.on('pointerover', () => matchLabel.setStyle({ color: '#ddeedd' }));
    matchLabel.on('pointerout', () => matchLabel.setStyle({ color: '#aabbaa' }));
    matchLabel.on('pointerdown', () => {
        navigator.clipboard.writeText(matchIdStr).then(() => {
            const prev = matchLabel.text;
            matchLabel.setText('Copied!');
            scene.time.delayedCall(1200, () => matchLabel.setText(prev));
        });
    });
    scene.add.text(8, 16, opponentLine, fontStyle(7, { color: '#aaaacc' })).setOrigin(0, 0);
}

export function makeSoundToggleButton(scene: Phaser.Scene, x: number, y: number): Button {
    const on = scene.add.image(0, 0, 'sound_on').setAlpha(0.75).setVisible(!isMuted());
    const off = scene.add.image(0, 0, 'sound_off').setAlpha(0.75).setVisible(isMuted());
    const button = new Button(scene, x, y, 24, 24, '', 10, () => {
        if (isMuted()) {
            on.visible = true;
            off.visible = false;      
        } else {
            on.visible = false;
            off.visible = true;
        }
        localStorage.setItem('muted', isMuted() ? 'false' : 'true');
    }, 'Toggle sound / mute');
    button
        .add(on)
        .add(off);
    return button;
}

export const isMuted = () => localStorage.getItem('muted') == 'true';

/// play a sound but only if not muted
export function playSound(scene: Phaser.Scene, key: string) {
    if (!isMuted()) {
        scene.sound.play(key);
    }
}

export function rootObject(obj: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform): Phaser.GameObjects.Components.Transform {
    while (obj.parentContainer != undefined) {
        obj = obj.parentContainer;
    }
    return obj;
}

export type ContractJoinInfo = {
    config: BattleConfig;
    state: PVPArenaDerivedState;
}

// export async function joinContract(deployProvider: BrowserDeploymentManager, contractAddress: ContractAddress): Promise<ContractJoinInfo> {
//     return deployProvider.join(contractAddress).then((api) => new Promise((resolve, reject) => {
//         const subscription = api.state$.subscribe((state) => {
//             subscription.unsubscribe();
//             if (state.isP1 || state.isP2 || state.p2PubKey == undefined) {
//                 resolve({
//                     config: {
//                         isP1: state.isP1,
//                         api,
//                     },
//                     state,
//                 });
//             } else {
//                 reject(new Error('User authentication failed - pub key does not match P1 or P2'));
//             }
//         });
//     }));
// }

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
  scene: [ContractLoader],
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