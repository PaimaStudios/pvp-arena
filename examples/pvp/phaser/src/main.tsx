import { NetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import '@midnight-ntwrk/dapp-connector-api';
import './globals';

// TODO: get this properly? it's undefined if i uncomment this
//const networkId = import.meta.env.VITE_NETWORK_ID as NetworkId;
const networkId = NetworkId.TestNet;
// Ensure that the network IDs are set within the Midnight libraries.
setNetworkId(networkId);

console.log(`networkId = ${networkId}`);





// phaser part

import 'phaser';
import RexUIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin'
//import KeyboardPlugin from 'phaser3-';
import { ITEM, RESULT, STANCE, Hero, ARMOR } from '@midnight-ntwrk/pvp-contract';
import RoundRectanglePlugin from 'phaser3-rex-plugins/plugins/roundrectangle-plugin.js';

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
function createHero(arena: Arena, x: number, y: number, hero: Hero, isP2: boolean) {
    // todo: group into container?
    arena.add.image(x, y, 'hero_body').flipX = isP2;
    if (hero.lhs != ITEM.nothing) {
        arena.add.image(x, y, itemSprite(hero.lhs, false)).flipX = isP2;
    }
    if (hero.helmet != ARMOR.nothing) {
        arena.add.image(x, y, armorSprite(hero.helmet, 'helmet')).flipX = isP2;
    }
    if (hero.chest != ARMOR.nothing) {
        arena.add.image(x, y, armorSprite(hero.chest, 'chest')).flipX = isP2;
    }
    if (hero.skirt != ARMOR.nothing) {
        arena.add.image(x, y, armorSprite(hero.skirt, 'skirt')).flipX = isP2;
    }
    if (hero.greaves != ARMOR.nothing) {
        arena.add.image(x, y, armorSprite(hero.greaves, 'greaves')).flipX = isP2;
    }
    arena.add.image(x, y, 'hero_arm_r').flipX = isP2;
    if (hero.rhs != ITEM.nothing) {
        arena.add.image(x, y, itemSprite(hero.rhs, true)).flipX = isP2;
    }
}

function itemSprite(item: ITEM, isRight: boolean): string {
    let str = 'hero_';
    switch (item) {
        case ITEM.axe:
            str += 'axe';
            break;
        case ITEM.sword:
            str += 'sword';
            break;
        case ITEM.bow:
            str += 'bow';
            break;
        case ITEM.shield:
            str += 'shield';
            break;
        case ITEM.spear:
            str += 'spear';
                                
    }
    str += isRight? '_r' : '_l';
    return str;
}

function armorSprite(armor: ARMOR, part: string): string {
    let str = `hero_${part}_`;
    switch (armor) {
        case ARMOR.leather:
            str += 'leather';
            break;
        case ARMOR.metal:
            str += 'metal';
            break;
    }
    return str;
}

class TargetLine {
    target: number | undefined;
    lines: Phaser.GameObjects.Line[];

    constructor(lines: Phaser.GameObjects.Line[]) {
        this.lines = lines;
        this.target = undefined;
    }

    setTarget(target: number | undefined) {
        if (this.target != undefined) {
            this.lines[this.target].visible = false;
        }
        console.log(`toggled set(${JSON.stringify(target)})`);
        if (target != undefined) {
            this.lines[target].visible = true;
        }
        this.target = target;
    }
}

class Arena extends Phaser.Scene
{
    cursors: any;//Phaser.Types.Input.Keyboard.KeyboardPlugin | undefined;
    keys: any;
    targets: TargetLine[][];//((number | undefined)[][]) | undefined;

    constructor() {
        super();
        this.targets = [];
    }

    preload ()
    {
        this.load.setBaseURL('/');

        this.load.image('arena_bg', 'arena_bg.png');
        this.load.image('hero_axe_l', 'hero_axe_l.png');
        this.load.image('hero_sword_l', 'hero_sword_l.png');
        this.load.image('hero_shield_l', 'hero_shield_l.png');
        this.load.image('hero_spear_l', 'hero_spear_l.png');
        this.load.image('hero_bow_l', 'hero_bow_l.png');
        this.load.image('hero_axe_r', 'hero_axe_r.png');
        this.load.image('hero_sword_r', 'hero_sword_r.png');
        this.load.image('hero_shield_r', 'hero_shield_r.png');
        this.load.image('hero_spear_r', 'hero_spear_r.png');
        this.load.image('hero_bow_r', 'hero_bow_r.png');
        this.load.image('hero_body', 'hero_body.png');
        this.load.image('hero_arm_r', 'hero_arm_r.png');
        for (let material of ['leather', 'metal']) {
            for (let part of ['helmet', 'chest', 'skirt', 'greaves']) {
                this.load.image(`hero_${part}_${material}`, `hero_${part}_${material}.png`);
                console.log(`loading hero_${part}_${material}.png`);
            }
        }
    }

    create ()
    {
        this.add.image(480, 360, 'arena_bg').setPosition(240, 180);

        //this.cursors = this?.input?.keyboard?.addCapture('1,2,3,8,9,0,X,C');
        this.keys = this.input?.keyboard?.addKeys({
            n1:  Phaser.Input.Keyboard.KeyCodes.ONE,
            n2:  Phaser.Input.Keyboard.KeyCodes.TWO,
            n3:  Phaser.Input.Keyboard.KeyCodes.THREE,
            q:  Phaser.Input.Keyboard.KeyCodes.Q,
            w:  Phaser.Input.Keyboard.KeyCodes.W,
            e:  Phaser.Input.Keyboard.KeyCodes.E,
            a:  Phaser.Input.Keyboard.KeyCodes.A,
            s:  Phaser.Input.Keyboard.KeyCodes.S,
            d:  Phaser.Input.Keyboard.KeyCodes.D,
            x:  Phaser.Input.Keyboard.KeyCodes.X,
        });

        //this.cursors = this.input?.keyboard?.createCursorKeys();

        let heroes: Hero[][] = [
            [
                { lhs: ITEM.axe, rhs: ITEM.sword, helmet: ARMOR.leather, chest: ARMOR.leather, skirt: ARMOR.nothing, greaves: ARMOR.leather },
                { lhs: ITEM.bow, rhs: ITEM.nothing, helmet: ARMOR.nothing, chest: ARMOR.nothing, skirt: ARMOR.leather, greaves: ARMOR.metal },
                { lhs: ITEM.shield, rhs: ITEM.axe, helmet: ARMOR.metal, chest: ARMOR.metal, skirt: ARMOR.metal, greaves: ARMOR.nothing },
            ], [
                { lhs: ITEM.spear, rhs: ITEM.spear, helmet: ARMOR.leather, chest: ARMOR.metal, skirt: ARMOR.leather, greaves: ARMOR.leather},
                { lhs: ITEM.spear, rhs: ITEM.shield, helmet: ARMOR.metal, chest: ARMOR.metal, skirt: ARMOR.metal, greaves: ARMOR.metal },
                { lhs: ITEM.sword, rhs: ITEM.sword, helmet: ARMOR.nothing, chest: ARMOR.nothing, skirt: ARMOR.nothing, greaves: ARMOR.nothing },
            ]
        ];
        let stances: STANCE[][] = [
            [STANCE.aggressive, STANCE.neutral, STANCE.defensive],
            [STANCE.defensive, STANCE.aggressive, STANCE.neutral]
        ];
        let stanceX = (i: number, team: number) => {
            switch (stances[team][i]) {
                case STANCE.aggressive:
                    return team == 0 ? 23 : -23;
                case STANCE.defensive:
                    return team == 0 ? -23 : 23;
            }
            return 0;
        };

        this.targets = [];
        for (let team = 0; team < 2; ++team) {
            let targets: TargetLine[] = [];
            for (let i = 0; i < 3; ++i) {
                const x = stanceX(i, team) + (team == 0 ? (170 - 5 * i) : (480 - 170 + 5 * i));
                const y = 140 + 55 * i;
                createHero(this, x, y, heroes[team][i], team == 1)
                const lines: Phaser.GameObjects.Line[] = [];
                for (let j = 0; j < 3; ++j) {
                    const x2 = stanceX(j, team == 0 ? 1 : 0) + (team != 0 ? (170 - 5 * j) : (480 - 170 + 5 * j));
                    const y2 = 140 + 55 * j;
                    const line = this.add.line(0, 0, x, y, x2, y2, team == 0 ? 0x3333bb : 0xbb3333, 0.3).setOrigin(0, 0);
                    line.setLineWidth(3);
                    line.visible = false;
                    lines.push(line);
                }
                targets.push(new TargetLine(lines));
            }
            this.targets.push(targets);
        }


        // img.setPosition(240, 180);
        // const text = this.add.text(400, 300, 'Hello World', { fixedWidth: 150, fixedHeight: 36 })
        // text.setOrigin(0.5, 0.5)
    
        // text.setInteractive().on('pointerdown', () => {
        //     const rexUI = (this.scene as any).rexUI as RexUIPlugin;
        //     rexUI.edit(text)
        // })
        const rexUI = (this.scene as any).rexUI as RexUIPlugin;


        // const particles = this.add.particles(0, 0, 'red', {
        //     speed: 100,
        //     scale: { start: 1, end: 0 },
        //     blendMode: 'ADD'
        // });

        // const logo = this.physics.add.image(400, 100, 'logo');

        // logo.setVelocity(100, 200);
        // logo.setBounce(1, 1);
        // logo.setCollideWorldBounds(true);

        // particles.startFollow(logo);
    }

    update() {
        if (this.keys.n1.isDown) {
            //console.log('0 -> 0');
            this.targets[0][0].setTarget(0);
        }
        if (this.keys.n2.isDown) {
            //console.log('0 -> 1');
            this.targets[0][0].setTarget(1);
        }
        if (this.keys.n3.isDown) {
            //console.log('0 -> 2');
            this.targets[0][0].setTarget(2);
        }
        if (this.keys.q.isDown) {
            //console.log('1 -> 0');
            this.targets[0][1].setTarget(0);
        }
        if (this.keys.w.isDown) {
            //console.log('1 -> 1');
            this.targets[0][1].setTarget(1);
        }
        if (this.keys.e.isDown) {
            //console.log('1 -> 2');
            this.targets[0][1].setTarget(2);
        }
        if (this.keys.a.isDown) {
            //console.log('2 -> 0');
            this.targets[0][2].setTarget(0);
        }
        if (this.keys.s.isDown) {
            //console.log('2 -> 1');
            this.targets[0][2].setTarget(1);
        }
        if (this.keys.d.isDown) {
            //console.log('2 -> 2');
            this.targets[0][2].setTarget(2);
        }
        if (this.keys.x.isDown) {
            for (let i = 0; i < 3; ++i) {
                this.targets[0][i].setTarget(undefined);
            }
        }
    }
}


const config = {
    type: Phaser.AUTO,
    width: 480,
    height: 360,
    scene: Arena,
    // physics: {
    //     default: 'arcade',
    //     arcade: {
    //         gravity: { x: 0, y: 200 }
    //     }
    // }
    dom: {
        createContainer: true
    },
	plugins: {
		scene: [
			{
				key: 'rexUI',
				plugin: RexUIPlugin,
				mapping: 'rexUI'
			}
		]
    }
};

export const game = new Phaser.Game(config);