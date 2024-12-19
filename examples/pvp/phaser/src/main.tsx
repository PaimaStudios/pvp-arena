import { NetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import '@midnight-ntwrk/dapp-connector-api';
import { ITEM, RESULT, STANCE, Hero, ARMOR } from '@midnight-ntwrk/pvp-contract';
import { type BBoardDerivedState, type DeployedBBoardAPI } from '@midnight-ntwrk/pvp-api';
import './globals';

// TODO: get this properly? it's undefined if i uncomment this
//const networkId = import.meta.env.VITE_NETWORK_ID as NetworkId;
const networkId = NetworkId.TestNet;
// Ensure that the network IDs are set within the Midnight libraries.
setNetworkId(networkId);

console.log(`networkId = ${networkId}`);

const MAX_HP = 300;

const ARENA_WIDTH = 480;
const ARENA_HEIGHT = 360;


// phaser part

import 'phaser';
import RexUIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin'
//import KeyboardPlugin from 'phaser3-';
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

type HeroIndex = 0 | 1 | 2;
type Team = 0 | 1;

class Rank {
    index: HeroIndex;
    team: Team;

    constructor(index: HeroIndex, team: Team) {
        this.index = index;
        this.team = team;
    }

    x(stance: STANCE): number {
        let stanceContribution = 0;
        const stanceWidth = 50;
        switch (stance) {
            case STANCE.aggressive:
                stanceContribution = this.team == 0 ? stanceWidth : -stanceWidth;
                break;
            case STANCE.defensive:
                stanceContribution = this.team == 0 ? -stanceWidth : stanceWidth;
                break;
        }
        return stanceContribution + (this.team == 0 ? (160 - 4 * this.index) : (ARENA_WIDTH - 160 + 4 * this.index));
    }

    y(): number {
        return 140 + 65 * this.index;
    }
}

class HeroActor extends Phaser.GameObjects.Container {
    arena: Arena;
    hero: Hero;
    //body_images: Phaser.GameObjects.Image[];
    hpBar: HpBar;
    rank: Rank;
    target: Rank | undefined;
    targetLine: Phaser.GameObjects.Line;
    dmg: number;
    stance: STANCE;

    constructor(arena: Arena, hero: Hero, rank: Rank) {
        super(arena, rank.x(STANCE.neutral), rank.y());

        this.arena = arena;
        this.hero = hero;
        this.rank = rank;
        this.target = undefined;
        this.dmg = 0;
        this.stance = STANCE.neutral;

        const isP2 = this.rank.team == 1;

        const line = arena.add.line(0, 0, 0, 0, 0, 0, rank.team == 0 ? 0x3333bb : 0xbb3333, 0.3)
            .setOrigin(0, 0)
            .setLineWidth(3)
            .setVisible(false);
        this.targetLine = line;
        this.add(line);

        //this.body_images = [];
        if (hero.lhs == ITEM.bow || hero.rhs == ITEM.bow) {
            this.add(arena.add.image(0, 0, 'hero_quiver').setFlipX(isP2));
        }
        this.add(arena.add.image(0, 0, 'hero_body').setFlipX(isP2));
        if (hero.lhs != ITEM.nothing) {
            this.add(arena.add.image(0, 0, itemSprite(hero.lhs, false)).setFlipX(isP2));
        }
        if (hero.helmet != ARMOR.nothing) {
            this.add(arena.add.image(0, 0, armorSprite(hero.helmet, 'helmet')).setFlipX(isP2));
        }
        if (hero.chest != ARMOR.nothing) {
            this.add(arena.add.image(0, 0, armorSprite(hero.chest, 'chest')).setFlipX(isP2));
        }
        if (hero.skirt != ARMOR.nothing) {
            this.add(arena.add.image(0, 0, armorSprite(hero.skirt, 'skirt')).setFlipX(isP2));
        }
        if (hero.greaves != ARMOR.nothing) {
            this.add(arena.add.image(0, 0, armorSprite(hero.greaves, 'greaves')).setFlipX(isP2));
        }
        this.add(arena.add.image(0, 0, 'hero_arm_r').setFlipX(isP2));
        if (hero.rhs != ITEM.nothing) {
            this.add(arena.add.image(0, 0, itemSprite(hero.rhs, true)).setFlipX(isP2));
        }

        this.hpBar = new HpBar(arena, 0, -31, 40);
        this.add(this.hpBar);

        arena.add.existing(this);
    }

    preUpdate(): void {
    }

    // true = killed
    public attack(dmg: number): boolean {
        this.dmg = Math.min(MAX_HP, this.dmg + dmg);
        if (this.isAlive()) {
            return false;
        }
        this.visible = false;
        return true;
    }

    public isAlive(): boolean {
        return this.dmg < MAX_HP;
    }

    public setStance(stance: STANCE) {
        this.stance = stance;

        const x = this.rank.x(stance);
        const y = this.rank.y();

        this.setPosition(x, y);

        this.updateTargetLine();
    }

    public setTarget(target: Rank | undefined) {
        this.target = target;

        this.updateTargetLine();
    }

    private updateTargetLine() {
        if (this.target != undefined) {
            // TODO: how to know other person's stance?
            const tx = this.target.x(this.arena.getHero(this.target).stance);
            const ty = this.target.y();
            this.targetLine
                .setTo(0, 0, tx - this.x, ty - this.y)
                .setVisible(true);
        } else {
            this.targetLine.setVisible(false);
        }
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

class HpBar extends Phaser.GameObjects.Container {
    // left: Phaser.GameObjects.Image;
    // right: Phaser.GameObjects.Image;
    middle: Phaser.GameObjects.Image;
    //back: Phaser.GameObjects.Image;
    width: number;

    constructor(arena: Arena, x: number, y: number, w: number) {
        super(arena, x, y);

        this.width = w;
        this.add(arena.add.image(-w / 2, 0, 'hp_bar_back').setOrigin(0, 0.5).setScale(w, 1));
        this.middle = arena.add.image(-w  / 2, 0, 'hp_bar_middle').setOrigin(0, 0.5);
        this.add(this.middle);
        this.add(arena.add.image(-w / 2 - 1, 0, 'hp_bar_side'));
        this.add(arena.add.image(w / 2 + 1, 0, 'hp_bar_side').setFlipX(true));
        this.setHp(1.0);

        //arena.add.existing(this);
    }

    // from 0.0 to 1.0
    setHp(hp: number) {
        this.middle.setScale(hp * this.width, 1);
    }
}

class Arena extends Phaser.Scene
{
    cursors: any;//Phaser.Types.Input.Keyboard.KeyboardPlugin | undefined;
    keys: any;
    heroes: HeroActor[][];

    constructor() {
        super();
        this.heroes = [];
    }

    preload ()
    {
        this.load.setBaseURL('/');

        this.load.image('arena_bg', 'arena_bg.png');

        this.load.image('hero_quiver', 'hero_quiver.png');
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

        this.load.image('hp_bar_back', 'hp_bar_back.png');
        this.load.image('hp_bar_side', 'hp_bar_side.png');
        this.load.image('hp_bar_middle', 'hp_bar_middle.png');

        this.load.image('skull', 'skull.png');
    }

    create ()
    {
        this.add.image(ARENA_WIDTH, ARENA_HEIGHT, 'arena_bg').setPosition(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);

        //this.cursors = this?.input?.keyboard?.addCapture('1,2,3,8,9,0,X,C');
        this.keys = this.input?.keyboard?.addKeys({
            n1: Phaser.Input.Keyboard.KeyCodes.ONE,
            n2: Phaser.Input.Keyboard.KeyCodes.TWO,
            n3: Phaser.Input.Keyboard.KeyCodes.THREE,
            n4: Phaser.Input.Keyboard.KeyCodes.FOUR,
            q:  Phaser.Input.Keyboard.KeyCodes.Q,
            w:  Phaser.Input.Keyboard.KeyCodes.W,
            e:  Phaser.Input.Keyboard.KeyCodes.E,
            r:  Phaser.Input.Keyboard.KeyCodes.R,
            a:  Phaser.Input.Keyboard.KeyCodes.A,
            s:  Phaser.Input.Keyboard.KeyCodes.S,
            d:  Phaser.Input.Keyboard.KeyCodes.D,
            x:  Phaser.Input.Keyboard.KeyCodes.X,
            f:  Phaser.Input.Keyboard.KeyCodes.F,
        });
        let toggleStance = (stance: STANCE) => {
            if (stance == STANCE.neutral) {
                return STANCE.aggressive;
            } else if (stance == STANCE.aggressive) {
                return STANCE.defensive;
            }
            return STANCE.neutral;
        };
        this.input?.keyboard?.on('keydown-FOUR', () => {
            const hero = this.heroes[0][0];
            hero.setStance(toggleStance(hero.stance));
        });
        this.input?.keyboard?.on('keydown-R', () => {
            const hero = this.heroes[0][1];
            hero.setStance(toggleStance(hero.stance));
        });
        this.input?.keyboard?.on('keydown-F', () => {
            const hero = this.heroes[0][2];
            hero.setStance(toggleStance(hero.stance));
        });
        //p2
        this.input?.keyboard?.on('keydown-FIVE', () => {
            const hero = this.heroes[1][0];
            hero.setStance(toggleStance(hero.stance));
        });
        this.input?.keyboard?.on('keydown-T', () => {
            const hero = this.heroes[1][1];
            hero.setStance(toggleStance(hero.stance));
        });
        this.input?.keyboard?.on('keydown-G', () => {
            const hero = this.heroes[1][2];
            hero.setStance(toggleStance(hero.stance));
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

        for (let team = 0; team < 2; ++team) {
            let hero_actors = [];
            for (let i = 0; i < 3; ++i) {
                const rank = new Rank(i as HeroIndex, team as Team);
                // TODO: how to do these loops so typescript knows that team/i are 0-1 and 0-2?
                hero_actors.push(new HeroActor(this, heroes[team][i], rank));
            }
            this.heroes.push(hero_actors);
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
            this.heroes[0][0].setTarget(new Rank(0, 1));
        }
        if (this.keys.n2.isDown) {
            this.heroes[0][0].setTarget(new Rank(1, 1));
        }
        if (this.keys.n3.isDown) {
            this.heroes[0][0].setTarget(new Rank(2, 1));
        }
        if (this.keys.q.isDown) {
            this.heroes[0][1].setTarget(new Rank(0, 1));
        }
        if (this.keys.w.isDown) {
            this.heroes[0][1].setTarget(new Rank(1, 1));
        }
        if (this.keys.e.isDown) {
            this.heroes[0][1].setTarget(new Rank(2, 1));
        }
        if (this.keys.a.isDown) {
            this.heroes[0][2].setTarget(new Rank(0, 1));
        }
        if (this.keys.s.isDown) {
            this.heroes[0][2].setTarget(new Rank(1, 1));
        }
        if (this.keys.d.isDown) {
            this.heroes[0][2].setTarget(new Rank(2, 1));
        }
        if (this.keys.x.isDown) {
            for (let i = 0; i < 3; ++i) {
                this.heroes[0][i].setTarget(undefined);
            }
        }
    }

    getHero(rank: Rank): HeroActor {
        return this.heroes[rank.team][rank.index];
    }

    getAliveHeroes(team: Team): HeroActor[] {
        return this.heroes[team].filter((h) => h.isAlive());
    }
}


const config = {
    type: Phaser.AUTO,
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
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