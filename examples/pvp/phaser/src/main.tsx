import { NetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import '@midnight-ntwrk/dapp-connector-api';
import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE } from '@midnight-ntwrk/pvp-contract';
import { type BBoardDerivedState, type DeployedBBoardAPI } from '@midnight-ntwrk/pvp-api';
import './globals';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { LedgerState } from '@midnight-ntwrk/ledger';
import { BrowserDeploymentManager } from './wallet';
import * as pino from 'pino';

// TODO: get this properly? it's undefined if i uncomment this
const networkId = import.meta.env.VITE_NETWORK_ID as NetworkId;
//const networkId = NetworkId.TestNet;
// Ensure that the network IDs are set within the Midnight libraries.
setNetworkId(networkId);
export const logger = pino.pino({
    level: import.meta.env.VITE_LOGGING_LEVEL as string,
});
console.log(`networkId = ${networkId}`);

const MAX_HP = 300000;
const HP_DIV = 1000;

const ARENA_WIDTH = 480;
const ARENA_HEIGHT = 360;

const MOCK_DELAY = 500;

class MockBBoardAPI implements DeployedBBoardAPI {
    readonly deployedContractAddress: ContractAddress;
    readonly state$: Observable<BBoardDerivedState>;
    subscriber: Subscriber<BBoardDerivedState> | undefined;
    mockState: BBoardDerivedState;


    constructor() {
        this.deployedContractAddress = 'mocked address, do not use';
        this.state$ = new Observable<BBoardDerivedState>((subscriber) => {
            this.subscriber = subscriber;
        });
        const p1Heroes: Hero[] = [
            { lhs: ITEM.axe, rhs: ITEM.sword, helmet: ARMOR.leather, chest: ARMOR.leather, skirt: ARMOR.nothing, greaves: ARMOR.leather },
            { lhs: ITEM.bow, rhs: ITEM.nothing, helmet: ARMOR.nothing, chest: ARMOR.nothing, skirt: ARMOR.leather, greaves: ARMOR.metal },
            { lhs: ITEM.shield, rhs: ITEM.axe, helmet: ARMOR.metal, chest: ARMOR.metal, skirt: ARMOR.metal, greaves: ARMOR.nothing },
        ];
        const p2Heroes: Hero[] = [
            { lhs: ITEM.spear, rhs: ITEM.spear, helmet: ARMOR.leather, chest: ARMOR.metal, skirt: ARMOR.leather, greaves: ARMOR.leather},
            { lhs: ITEM.spear, rhs: ITEM.shield, helmet: ARMOR.metal, chest: ARMOR.metal, skirt: ARMOR.metal, greaves: ARMOR.metal },
            { lhs: ITEM.sword, rhs: ITEM.sword, helmet: ARMOR.nothing, chest: ARMOR.nothing, skirt: ARMOR.nothing, greaves: ARMOR.nothing },
        ];
        this.mockState = {
            instance: BigInt(0),
            round: BigInt(0),
            state: GAME_STATE.p1_commit,
            p1Heroes,
            p1Cmds: [BigInt(0), BigInt(0), BigInt(0)],
            p1Dmg: [BigInt(0), BigInt(0), BigInt(0)],
            p1Stances: [STANCE.neutral, STANCE.neutral, STANCE.neutral],
            isP1: true,
            p2Heroes,
            p2Cmds: [BigInt(0), BigInt(0), BigInt(0)],
            p2Dmg: [BigInt(0), BigInt(0), BigInt(0)],
            p2Stances: [STANCE.neutral, STANCE.neutral, STANCE.neutral],
        };
        setTimeout(() => {
            this.subscriber?.next(this.mockState);
        }, MOCK_DELAY);
    }
  
    async reg_p2(): Promise<void> {
        // does nothing
    }

    async p1Commit(commands: bigint[], stances: STANCE[]): Promise<void> {
        console.log(`p1Commit(${safeJSONString(commands)}, ${JSON.stringify(stances)})`);
        setTimeout(() => {
            this.mockState = {
                ...this.mockState,
                p1Cmds: commands,
                p1Stances: stances,
                state: GAME_STATE.p2_commit,
            };
            this.subscriber?.next(this.mockState);
            // mock p2 commit
            setTimeout(() => {
                // just randomly attack/move
                // TODO: take death into account
                this.mockState = {
                    ...this.mockState,
                    p2Cmds: this.mockState.p2Cmds!.map((cmd, i) => {
                        if (this.mockState.p2Dmg[i] < MAX_HP) {
                            const availableTargets = [0, 1, 2].filter((j) => this.mockState.p1Dmg[j] < MAX_HP);
                            const ret = BigInt(availableTargets[Phaser.Math.Between(0, availableTargets.length - 1)]);
                            console.log(`availableTargets(${i}) = ${availableTargets} -> ${ret}`);
                            return ret;
                        }
                        // arbitrary but causes breaking errors early since dead units should never have their commands read
                        return BigInt(1000000);
                    }),
                    p2Stances: this.mockState.p2Stances.map((stance, i) => {
                        if (this.mockState.p2Dmg[i] < MAX_HP) {
                            switch (stance) {
                                case STANCE.defensive:
                                    return Phaser.Math.Between(0, 1) as STANCE;
                                case STANCE.aggressive:
                                    return Phaser.Math.Between(1, 2) as STANCE;
                                case STANCE.neutral:
                                    return Phaser.Math.Between(0, 2) as STANCE;
                            }
                        }
                        return stance;
                    }),
                    state: GAME_STATE.p1_reveal,
                };
                this.subscriber?.next(this.mockState);
            }, MOCK_DELAY);
        }, MOCK_DELAY);
    }

    async p2Commit(commands: bigint[], stances: STANCE[]): Promise<void> {
        // should never be called (TODO: let you have a p2 testing environment too?)
        throw new Error("do not call this");
    }

    async p1Reveal(): Promise<void> {
        setTimeout(() => {
            this.mockState = {
                ...this.mockState,
                state: GAME_STATE.p2_reveal,
            };
            this.subscriber?.next(this.mockState);
            // mock p2 reveal
            setTimeout(() => {
                console.log(`MockState: ${safeJSONString(this.mockState)}`);
                let p1Dmg = this.mockState.p1Dmg;
                let p2Dmg = this.mockState.p2Dmg;
                for (let i = 0; i < 3; ++i) {
                    if (this.mockState.p1Dmg[i] < MAX_HP) {
                        const p1Cmd = Number(this.mockState.p1Cmds![i]);
                        p2Dmg[p1Cmd] = BigInt(Math.min(MAX_HP, Number(p2Dmg[p1Cmd] + pureCircuits.calc_item_dmg_against(
                            pureCircuits.calc_stats(this.mockState.p1Heroes[i]),
                            this.mockState.p1Stances[i],
                            pureCircuits.calc_stats(this.mockState.p2Heroes[p1Cmd]),
                            this.mockState.p2Stances[p1Cmd],
                        ))));
                    }
                    if (this.mockState.p2Dmg[i] < MAX_HP) {
                        const p2Cmd = Number(this.mockState.p2Cmds![i]);
                        p1Dmg[p2Cmd] = BigInt(Math.min(MAX_HP, Number(p1Dmg[p2Cmd] + pureCircuits.calc_item_dmg_against(
                            pureCircuits.calc_stats(this.mockState.p2Heroes[i]),
                            this.mockState.p2Stances[i],
                            pureCircuits.calc_stats(this.mockState.p1Heroes[p2Cmd]),
                            this.mockState.p1Stances[p2Cmd],
                        ))));
                    }
                }
                const p1Dead = p1Dmg.every((hp) => hp >= BigInt(MAX_HP));
                const p2Dead = p2Dmg.every((hp) => hp >= BigInt(MAX_HP));
                this.mockState = {
                    ...this.mockState,
                    state: p1Dead ? (p2Dead ? GAME_STATE.tie : GAME_STATE.p2_win) : (p2Dead ? GAME_STATE.p1_win : GAME_STATE.p1_commit),
                    round: this.mockState.round + BigInt(1),
                    p1Dmg,
                    p2Dmg,
                };
                this.subscriber?.next(this.mockState);
            }, 2000);
        }, MOCK_DELAY);
    }

    async p2Reveal(): Promise<void> {
        // should never be called (TODO: let you have a p2 testing environment too?)
        throw new Error("do not call this");
    }
}

// phaser part

import 'phaser';
import RexUIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin'
//import KeyboardPlugin from 'phaser3-';
import RoundRectanglePlugin from 'phaser3-rex-plugins/plugins/roundrectangle-plugin.js';
import { extend } from 'fp-ts/lib/pipeable';
import { Subscriber, Observable } from 'rxjs';

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

function hpDiv(dmg: number): number {
    return Math.floor((dmg / HP_DIV));
}

class DamageText extends Phaser.GameObjects.Text {
    xSpeed: number;
    ySpeed: number;
    lifetime: number;
    constructor(arena: Arena, x: number, y: number, dmg: number) {
        super(arena, x, y, hpDiv(dmg).toString(), {fontSize: 12, color: 'white'});
        this.xSpeed = Math.random() * 0.1 - 0.05;
        this.ySpeed = -0.95;
        this.lifetime = 2;
    }

    preUpdate() {
        this.x += this.xSpeed;
        this.y += this.ySpeed;
        this.lifetime -= 0.025;

        if (this.lifetime <= 0) {
            this.destroy();
        } else if (this.lifetime < 1) {
            this.alpha = this.lifetime;
        }
    }
}

class BloodDrop extends Phaser.GameObjects.Sprite {
    arena: Arena;
    xPrev: number;
    yPrev: number;
    // moving in 3d space so use our own super-basic physics
    xSpeed: number;
    ySpeed: number;
    zSpeed: number;
    z: number;
    constructor(arena: Arena, x: number, y: number, dir2: number) {
        super(arena, x, y, `blood_drop${Phaser.Math.Between(0, 3)}`);
        this.arena = arena;
        this.xPrev = x;
        this.yPrev = y;
        const dir = Phaser.Math.Angle.Random();
        const spd = 0.2 + Math.random() * 0.4;
        const spd2 = 0.3 + Math.random() * 0.8;
        // probably fine but might need to look at Phaser.Math.SinCosTableGenerator
        this.xSpeed = spd * Math.cos(dir) + spd2 * Math.cos(dir2);
        this.ySpeed = spd * Math.sin(dir) + spd2 * Math.sin(dir2);
        this.zSpeed = - (Math.random() * 0.9 + 0.3);
        this.z = -10;
        this.setAlpha(0.5);
    }

    preUpdate() {
        this.x += this.xSpeed;
        this.y += this.ySpeed + this.zSpeed;
        this.z += this.zSpeed;

        this.zSpeed += 0.05;

        this.rotation = Phaser.Math.Angle.Between(this.xPrev, this.yPrev, this.x, this.y);
        this.xPrev = this.x;
        this.yPrev = this.y;

        if (this.z >= 0) {
            this.arena.add.image(this.x, this.y, `blood_puddle${Phaser.Math.Between(3, 6)}`).setAlpha(0.5).setDepth(-2);
            this.destroy();
        }
    }
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
        return 140 + 68 * this.index;
    }
}

// only converts bigint, but this is the only problem we have with printing ledger types
function safeJSONString(obj: object): string {
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

class HeroActor extends Phaser.GameObjects.Container {
    arena: Arena;
    hero: Hero;
    //body_images: Phaser.GameObjects.Image[];
    hpBar: HpBar;
    rank: Rank;
    target: Rank | undefined;
    targetLine: Phaser.GameObjects.Line;
    preTurnDmg: number;
    uiDmg: number;
    realDmg: number;
    stance: STANCE;
    nextStance: STANCE;
    right_arrow: Phaser.GameObjects.Image;
    left_arrow: Phaser.GameObjects.Image;
    select_circle: Phaser.GameObjects.Image;
    tick: number;

    constructor(arena: Arena, hero: Hero, rank: Rank) {
        console.log(`Hero created: ${rank.team}|${rank.index} => ${safeJSONString(pureCircuits.calc_stats(hero))}`);
        super(arena, rank.x(STANCE.neutral), rank.y());

        this.arena = arena;
        this.hero = hero;
        this.rank = rank;
        this.target = undefined;
        this.preTurnDmg = 0;
        this.uiDmg = 0;
        this.realDmg = 0;
        this.stance = STANCE.neutral;
        this.nextStance = this.stance;
        this.tick = 0;

        const isP2 = this.rank.team == 1;

        const line = arena.add.line(0, 0, 0, 0, 0, 0, rank.team == 0 ? 0x3333bb : 0xbb3333, 0.3)
            .setOrigin(0, 0)
            .setLineWidth(3)
            .setVisible(false);
        this.targetLine = line;
        this.add(line);

        this.left_arrow = arena.add.image(-32, 0, 'arrow_move').setVisible(false).setFlipX(true);
        this.add(this.left_arrow);
        this.right_arrow = arena.add.image(32, 0, 'arrow_move').setVisible(false);
        this.add(this.right_arrow);

        // depth doesn't seem to matter here - it's overridden by Container's I think so it's based on add() order
        this.select_circle = arena.add.image(0, 8, 'select_circle').setVisible(false).setDepth(-1);
        this.add(this.select_circle);

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

        this.setSize(32, 48);
        arena.input.enableDebug(this);
        this.on('pointerup', () => {
            if (this.arena.matchState == MatchState.WaitingOnPlayer) {
                if ((this.arena.isP1 ? 0 : 1) == this.rank.team) {
                    if (this.select_circle.visible) {
                        this.deselect();
                    } else {
                        for (const hero of this.arena.getAllAliveUnits()) {
                            hero.deselect();
                        }
                        this.select();
                    }
                } else if (arena.selected != undefined) {
                    arena.selected.setTarget(this.rank);
                }
            }
        });
        this.left_arrow.on('pointerup', () => {
            const leftStance = this.stance == STANCE.neutral ? STANCE.defensive : STANCE.neutral;
            this.nextStance = this.nextStance == leftStance ? this.stance : leftStance;
            this.updateNextStanceArrow();
        });
        this.right_arrow.on('pointerup', () => {
            const rightStance = this.stance == STANCE.neutral ? STANCE.aggressive : STANCE.neutral;
            this.nextStance = this.nextStance == rightStance ? this.stance : rightStance;
            this.updateNextStanceArrow();
        });
    }

    preUpdate(): void {
        this.select_circle.angle = this.tick / 5;
        const circleScale = 1 + 0.09 * Math.sin(this.tick / 64);
        this.select_circle.setScale(circleScale, circleScale);
        const arrowScale = 0.65 + 0.09 * Math.sin(this.tick / 48 + 1);
        if (this.left_arrow.alpha != 1) {
            this.left_arrow.setScale(arrowScale, arrowScale);
        }
        if (this.right_arrow.alpha != 1) {
            this.right_arrow.setScale(arrowScale, arrowScale);
        }
        this.tick += 1;
    }

    // true = killed
    public attack(attacker: HeroActor, dmg: number): boolean {
        const n = 1 + (dmg * (2 + Math.random())) / 100000;
        console.log(`attack(${hpDiv(dmg)}) -> ${n}`);
        for (let i = 0; i < n; ++i) {
            // TODO: this feels weird/ugly/hacky - maybe the constructor shouldn't add itself
            this.arena.add.existing(new BloodDrop(this.arena, this.x, this.y, Phaser.Math.Angle.Between(attacker.rank.x(attacker.stance), attacker.rank.y(), this.rank.x(this.stance), this.rank.y())));
        }

        this.arena.add.existing(new DamageText(this.arena,  (this.x + attacker.x) / 2, (this.y + attacker.y) / 2 - 24, dmg));

        this.uiDmg = Math.min(MAX_HP, this.uiDmg + dmg);
        this.updateHpBar();
        if (this.isAlive()) {
            return false;
        }
        return true;
    }

    public onTurnEnd() {
        if (this.uiDmg != this.realDmg) {
            console.error(`uiDmg[${this.rank.team}][${this.rank.index}] out of sync. Real: ${this.realDmg} Ui: ${this.uiDmg}`);
            this.uiDmg = this.uiDmg;
            this.updateHpBar();
        }
        this.arena.tweens.add(this.hpBar.tweenDamage(() => {
            this.preTurnDmg = this.realDmg;
            this.updateHpBar();
            if (!this.isAlive()) {
                this.arena.tweens.add({
                    targets: this,
                    alpha: 0,
                    duration: 150,
                    onComplete: () => {
                            this.visible = false;
                            this.arena.add.image(this.x, this.y, 'skull').setFlipX(this.rank.team == 1).setDepth(-1);
                    }
                });
            }
        }));
    }

    private updateHpBar() {
        this.hpBar.setHp(1 - Math.min(1, this.uiDmg / MAX_HP), (this.uiDmg - this.preTurnDmg) / MAX_HP);
    }

    public isAlive(): boolean {
        console.log(`isAlive(${this.rank.team}, ${this.rank.index}) => ${this.preTurnDmg < MAX_HP} | ${this.preTurnDmg, this.uiDmg, this.realDmg}`);
        return this.preTurnDmg < MAX_HP;
    }

    public toggleNextStance() {
        if (this.nextStance == STANCE.neutral) {
            this.nextStance = this.stance == STANCE.defensive ? STANCE.defensive : STANCE.aggressive;
        } else if (this.nextStance == STANCE.aggressive) {
            this.nextStance = this.stance == STANCE.aggressive ? STANCE.neutral : STANCE.defensive;
        } else {
            this.nextStance = STANCE.neutral;
        }
        this.updateNextStanceArrow();
    }

    private updateNextStanceArrow() {
        if (this.stance == STANCE.defensive) {
            this.left_arrow.visible = false;
        } else {
            this.left_arrow.visible = true;
            const leftStance = this.stance == STANCE.neutral ? STANCE.defensive : STANCE.neutral;
            if (this.nextStance == leftStance) {
                this.left_arrow.setAlpha(1).setScale(1, 1);
            } else {
                this.left_arrow.setAlpha(0.75).setScale(0.5, 0.5);
            }
        }
        if (this.stance == STANCE.aggressive) {
            this.right_arrow.visible = false;
        } else {
            this.right_arrow.visible = true;
            const rightStance = this.stance == STANCE.neutral ? STANCE.aggressive : STANCE.neutral;
            if (this.nextStance == rightStance) {
                this.right_arrow.setAlpha(1).setScale(1, 1);
            } else {
                this.right_arrow.setAlpha(0.75).setScale(0.5, 0.5);
            }
        }
    }

    public setTarget(target: Rank | undefined) {
        this.target = target;

        this.updateTargetLine();
    }

    public updateTargetLine() {
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

    public select() {
        this.select_circle.visible = true;
        this.arena.selected = this;

        if (this.stance != STANCE.defensive) {
            this.left_arrow.setInteractive({useHandCursor: true});
            this.left_arrow.visible = true;
        }
        if (this.stance != STANCE.aggressive) {
            this.right_arrow.setInteractive({useHandCursor: true});
            this.right_arrow.visible = true;
        }

        this.updateNextStanceArrow();
        for (const enemy of this.arena.getAliveHeroes(this.arena.opponentTeam())) {
            enemy.setInteractive({useHandCursor: true});
        }
    }

    public deselect() {
        this.select_circle.visible = false;
        this.arena.selected = undefined;

        // // TODO: hacky
        if (this.left_arrow.alpha != 1) {
            this.left_arrow.visible = false;
        }
        if (this.right_arrow.alpha != 1) {
            this.right_arrow.visible = false;
        }
        //this.left_arrow.visible = false;
        this.left_arrow.disableInteractive(true);
        //this.right_arrow.visible = false;
        this.right_arrow.disableInteractive(true);
        for (const enemy of this.arena.getAliveHeroes(this.arena.opponentTeam())) {
            enemy.disableInteractive();
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
    turnDmg: Phaser.GameObjects.Image;
    //back: Phaser.GameObjects.Image;
    width: number;

    constructor(arena: Arena, x: number, y: number, w: number) {
        super(arena, x, y);

        this.width = w;
        this.add(arena.add.image(-w / 2, 0, 'hp_bar_back').setOrigin(0, 0.5).setScale(w, 1));
        this.middle = arena.add.image(-w  / 2, 0, 'hp_bar_middle').setOrigin(0, 0.5);
        this.add(this.middle);
        this.turnDmg = arena.add.image(-w  / 2, 0, 'hp_bar_middle').setOrigin(0, 0.5).setAlpha(0.5);
        this.add(this.turnDmg);
        this.add(arena.add.image(-w / 2 - 1, 0, 'hp_bar_side'));
        this.add(arena.add.image(w / 2 + 1, 0, 'hp_bar_side').setFlipX(true));
        this.setHp(1, 0);

        //arena.add.existing(this);
    }

    // from 0.0 to 1.0
    setHp(hp: number, lostHp: number) {
        console.log(`setHp(${hp}, ${lostHp})`);
        this.middle.setScale(hp * this.width, 1);
        this.turnDmg
            .setScale(lostHp * this.width, 1)
            .setX((-this.width / 2) + ((hp) * this.width));
    }

    tweenDamage(onComplete: () => void | undefined): Phaser.Types.Tweens.TweenBuilderConfig {
        return {
            targets: this.turnDmg,
            scaleX: 0,
            duration: 450,
            onComplete,
        };
    }
}

class MainMenu extends Phaser.Scene {
    deployProvider: BrowserDeploymentManager;
    waiting: boolean;
    text: Phaser.GameObjects.Text | undefined;

    constructor() {
        super('MainMenu');
        this.deployProvider = new BrowserDeploymentManager(logger);
        this.waiting = false;
    }

    preload ()
    {
        this.load.setBaseURL('/');

        this.load.image('arena_bg', 'arena_bg.png');
    }

    create ()
    {
        this.add.image(ARENA_WIDTH, ARENA_HEIGHT, 'arena_bg').setPosition(ARENA_WIDTH / 2, ARENA_HEIGHT / 2).setDepth(-3);
        this.add.text(ARENA_WIDTH / 2 + 2, ARENA_HEIGHT / 4 + 2, 'PVP ARENA', {fontSize: 64, color: 'black'}).setOrigin(0.5, 0.5);
        this.add.text(ARENA_WIDTH / 2, ARENA_HEIGHT / 4, 'PVP ARENA', {fontSize: 64, color: 'white'}).setOrigin(0.5, 0.5);
        this.text = this.add.text(ARENA_WIDTH / 2, ARENA_HEIGHT * 0.65, 'Press J to join, C to create', {fontSize: 12, color: 'white'}).setOrigin(0.5, 0.5);
        this.input?.keyboard?.on('keydown-C', () => {
            if (!this.waiting) {
                this.text?.setText('Creating match, please wait...');
                this.waiting = true;
                this.deployProvider.create().then((api) => {
                    console.log('====================\napi done from creating\n===============');
                    console.log(`contract address: ${api.deployedContractAddress}`);
                    navigator.clipboard.writeText(api.deployedContractAddress);
                    this.scene.remove('Arena');
                    const arena = new Arena(api, true);
                    this.scene.add('Arena', arena);
                    this.scene.start('Arena');
                });
            }
        });
        this.input?.keyboard?.on('keydown-J', () => {
            if (!this.waiting) {
                const contractAddress = window.prompt('Enter contract address to join')
                if (contractAddress != null) {
                    this.text?.setText('Joining match, please wait...');
                    this.waiting = true;
                    this.deployProvider.join(contractAddress).then((api) => {
                        console.log('=====================\napi done from joining\n======================');
                        this.scene.remove('Arena');
                        const arena = new Arena(api, false);
                        this.scene.add('Arena', arena);
                        this.scene.start('Arena');
                    });
                }
            }
        });
        // create an off-chain testing world for testing graphical stuff without having to wait a long time
        this.input?.keyboard?.on('keydown-T', () => {
            this.scene.remove('Arena');
            this.scene.add('Arena', new Arena(new MockBBoardAPI(), true));
            this.scene.start('Arena');
        });
    }
}

enum MatchState {
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

function gameStateStr(state: GAME_STATE): string {
    switch (state) {
        case GAME_STATE.p1_commit:
            return 'p1_commit';
        case GAME_STATE.p2_commit:
            return 'p2_commit';
        case GAME_STATE.p1_reveal:
            return 'p1_reveal';
        case GAME_STATE.p2_reveal:
            return 'p2_reveal';
        case GAME_STATE.p1_win:
            return 'p1_win';
        case GAME_STATE.p1_win:
            return 'p2_win';
        case GAME_STATE.tie:
            return 'tie';
    }
    return '???';
}

class Arena extends Phaser.Scene
{
    heroes: HeroActor[][];
    selected: HeroActor | undefined;
    // this is undefined in testing battles (offline) only, will always be defined in real battles (on-chain)
    api: DeployedBBoardAPI;
    isP1: boolean;
    onChainState: GAME_STATE;
    matchState: MatchState;
    matchStateText: Phaser.GameObjects.Text | undefined;
    round: number;

    constructor(api: DeployedBBoardAPI, isP1: boolean) {
        super('Arena');
        this.heroes = [];
        this.selected = undefined;
        this.api = api;
        this.isP1 = isP1;
        this.onChainState = GAME_STATE.p1_commit;
        this.matchState = MatchState.Initializing;
        this.round = 0;

        if (api != undefined) {
            const subscription = api.state$.subscribe((state) => this.onStateChange(state));
        }
    }

    playerTeam(): Team {
        return this.isP1 ? 0 : 1;
    }

    opponentTeam(): Team {
        return this.isP1 ? 1 : 0;
    }

    setMatchState(state: MatchState) {
        this.matchState = state;
        switch (state) {
            case MatchState.Initializing:
                this.matchStateText?.setText('Initializing...');
                break;
            case MatchState.WaitingOnPlayer:
                this.matchStateText?.setText('Make your move');
                for (const hero of this.getAliveHeroes(this.playerTeam())) {
                    hero.setInteractive({useHandCursor: true});
                }
                break;
            case MatchState.WaitingOnOpponent:
                this.matchStateText?.setText('Waiting on opponent (submit)...');
                break;
            case MatchState.SubmittingMove:
                this.matchStateText?.setText('Submitting move...');
                this.selected?.deselect();
                this.selected = undefined;
                for (const hero of this.getAliveHeroes(this.playerTeam())) {
                    hero.disableInteractive();
                }
                break;
            case MatchState.RevealingMove:
                this.matchStateText?.setText('Revealing move...');
                break;
            case MatchState.WaitingOtherPlayerReveal:
                this.matchStateText?.setText('Waiting on opponent (reveal)...');
                break;
            case MatchState.CombatResolving:
                this.matchStateText?.setText('Battle!');
                break;
            case MatchState.GameOverP1Win:
                this.matchStateText?.setText(this.isP1 ? 'You won! - Press Space to return to menu' : 'Opponent won! - Press Space to return to menu');
                break;
            case MatchState.GameOverP2Win:
                this.matchStateText?.setText(!this.isP1 ? 'You won! - Press Space to return to menu' : 'Opponent won! - Press Space to return to menu');
                break;
            case MatchState.GameOverTie:
                this.matchStateText?.setText('Battle tied! - Press Space to return to menu');
                break;
        }
    }

    onStateChange(state: BBoardDerivedState) {
        console.log(`new state: ${safeJSONString(state)}`);
        console.log(`NOW: ${gameStateStr(state.state)}`);

        // create heroes initially
        if (this.heroes.length == 0) {
            for (let team = 0; team < 2; ++team) {
                let hero_actors = [];
                for (let i = 0; i < 3; ++i) {
                    const rank = new Rank(i as HeroIndex, team as Team);
                    // TODO: how to do these loops so typescript knows that team/i are 0-1 and 0-2?
                    hero_actors.push(new HeroActor(this, team == 0 ? state.p1Heroes[i] : state.p2Heroes[i], rank));
                }
                this.heroes.push(hero_actors);
            }
        }

        // update commands/stances/damages
        if (state.p1Cmds != undefined && state.p2Cmds != undefined) {
            const newTargets = [
                state.p1Cmds.map(Number),
                state.p2Cmds.map(Number)
            ];
            for (let team = 0; team < 2; ++team) {
                const heroes = team == 0 ? state.p1Heroes : state.p2Heroes;
                const dmgs = team == 0 ? state.p1Dmg : state.p2Dmg;
                const stances = team == 0 ? state.p1Stances : state.p2Stances;
                for (let i = 0; i < 3; ++i) {
                    const hero = this.heroes[team][i];
                    // update damage now, but no graphical effect shown
                    hero.realDmg = Number(dmgs[i]);
                    hero.nextStance = stances[i];
                    hero.target = new Rank(newTargets[team][i] as HeroIndex, team == 0 ? 1 : 0);
                }
            }
        }
        
        // TODO: it's weird we have both this and the combat animations to control MatchState
        // we should consolidate this
        this.onChainState = state.state;

        if (this.round < state.round) {
            this.runCombatAnims();
            this.round = Number(state.round);
        } else {
            this.runStateChange();
        }
    }

    runStateChange() {
        switch (this.onChainState) {
            case GAME_STATE.p1_commit:
                this.setMatchState(this.isP1 ? MatchState.WaitingOnPlayer : MatchState.WaitingOnOpponent);
                break;
            case GAME_STATE.p2_commit:
                this.setMatchState(this.isP1 ? MatchState.WaitingOnOpponent : MatchState.WaitingOnPlayer);
                break;
            case GAME_STATE.p1_reveal:
                if (this.isP1) {
                    console.log('revealing move (as p1)');
                    this.setMatchState(MatchState.RevealingMove);
                    // TODO: what happens if player cancels or closes window?
                    this.api!.p1Reveal().then(() => {
                        // ??? (probably nothing - resolved by onStateChange)
                    });
                } else {
                    this.setMatchState(MatchState.WaitingOtherPlayerReveal);
                }
                break;
            case GAME_STATE.p2_reveal:
                if (this.isP1) {
                    this.setMatchState(MatchState.WaitingOtherPlayerReveal);
                } else {
                    console.log('revealing move (as p2)');
                    this.setMatchState(MatchState.RevealingMove);
                    // TODO: what happens if player cancels or closes window?
                    this.api!.p2Reveal().then(() => {
                        // ??? (probably nothing - resolved by onStateChange)
                    });
                }
                break;
            case GAME_STATE.p1_win:
                this.setMatchState(MatchState.GameOverP1Win);
                break;
            case GAME_STATE.p2_win:
                this.setMatchState(MatchState.GameOverP2Win);
                break;
            case GAME_STATE.tie:
                this.setMatchState(MatchState.GameOverTie);
                break;
        }
    }

    runCombatAnims() {
        this.setMatchState(MatchState.CombatResolving);
        const tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
        // stance change tweens
        const aliveUnits = this.getAllAliveUnits();
        for (const hero of aliveUnits) {
            tweens.push({
                targets: hero,
                delay: 150,
                duration: 350,
                ease: 'Linear',
                x: hero.rank.x(hero.nextStance),
                onStart: () => {
                    // TODO: put in function
                    hero.left_arrow.visible = false;
                    hero.right_arrow.visible = false;
                },
                onComplete: () => {
                    hero.stance = hero.nextStance;
                    // TODO: smarter way
                    for (const h of this.getAllAliveUnits()) {
                        h.updateTargetLine();
                    }
                },
            });
        }
        tweens.push({
            targets: null,
            duration: 3000,
        });

        // attack tweens
        for (const hero of aliveUnits) {
            // can't use hero.x / enemy.x etc since those aren't where they'll be after they move to their new stance
            const heroX = hero.rank.x(hero.nextStance);
            const heroY = hero.rank.y(); // technically the same right now but could be different in the future
            const enemy = this.heroes[hero.target!.team][hero.target!.index];
            const enemyX = enemy.rank.x(enemy.nextStance);
            const enemyY = enemy.rank.y();
            // get rid of line/prepare delay
            tweens.push({
                targets: hero,
                duration: 150,
                onComplete: () => {
                    // get rid of line before attack
                    hero.setTarget(undefined);
                },
            });
            // move to enemy
            const dist = (new Phaser.Math.Vector2(heroX, heroY)).distance(new Phaser.Math.Vector2(enemyX, enemyY));
            tweens.push({
                targets: hero,
                ease: 'Quad.easeInOut',
                x: hero.target!.x(this.getHero(hero.target!).nextStance),
                y: hero.target!.y(),
                duration: 40 + dist * 2,
                onComplete: () => {
                    console.log(`half of tween [${hero.rank.team}][${hero.rank.index}]`);
                    // do graphical part of hp change (TODO: this should prob be in Hero)
                    // TODO: this is ALL damage done the entire turn to enemy so only
                    // the first attack will appear to change it. need to fix this, can't rely on just this
                    const stance_strs = ['def', 'neu', 'atk'];
                    for (let hero_stance = 0; hero_stance < 3; ++hero_stance) {
                        for (let enemy_stance = 0; enemy_stance < 3; ++enemy_stance) {
                            const dmg = pureCircuits.calc_item_dmg_against(pureCircuits.calc_stats(hero.hero), hero_stance as STANCE, pureCircuits.calc_stats(enemy.hero), enemy_stance as STANCE);
                            console.log(`dmg [${stance_strs[hero_stance]}] -> [${stance_strs[enemy_stance]}] = ${hpDiv(Number(dmg))}`);
                        }
                    }
                    const dmg = pureCircuits.calc_item_dmg_against(pureCircuits.calc_stats(hero.hero), hero.nextStance, pureCircuits.calc_stats(enemy.hero), enemy.nextStance);
                    if (enemy.attack(hero, Number(dmg))) {
                        // TODO: death anim? or this is resolved after?
                    }
                },
                persist: false,
            });
            // enemy knockback
            const angle = Phaser.Math.Angle.Between(heroX, heroY, enemyX, enemyY);
            tweens.push({
                targets: enemy,
                x: enemyX + Math.cos(angle) * 16,
                y: enemyY + Math.sin(angle) * 16,
                alpha: 0.4,
                duration: 50,
            });
            tweens.push({
                targets: enemy,
                x: enemyX,
                y: enemyY,
                alpha: 1,
                duration: 80,
            });
            // move back
            tweens.push({
                targets: hero,
                ease: 'Quad.easeInOut',
                x: hero.rank.x(hero.nextStance),
                y: hero.y,
                duration: 60 + dist * 3,
                onComplete: (tween) => {
                    console.log(`tween.targets = ${JSON.stringify(tween.targets)}`);
                    console.log(`completed tween [${hero.rank.team}][${hero.rank.index}]`);
                },
                persist: false,
            });
        }
        tweens.push({
            targets: null,
            onComplete: () => {
                // const deadUnits = aliveUnits.filter((h) => !h.isAlive());
                // this.tweens.add({
                //     targets: deadUnits,
                //     alpha: 0,
                //     onComplete: (_tween: Phaser.Tweens.Tween, targets: HeroActor[]) => {
                //         for (let target of targets) {
                //             target.visible = false;
                //             this.add.image(target.x, target.y, 'skull').setFlipX(target.rank.team == 1).setDepth(-1);
                //         }
                //     },
                // });
                this.getAllAliveUnits().forEach((h) => h.onTurnEnd());

                this.runStateChange();
            }
        });
        this.tweens.chain({
            // this doesn't seem to do anything (always overridden?) but if you pass null it errors
            targets: this.heroes[0],
            tweens,
        });
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

        this.load.image('arrow_move', 'arrow_move.png');
        this.load.image('select_circle', 'select_circle.png');

        this.load.image('skull', 'skull.png');
        this.load.image('blood_drop0', 'blood_drop0.png');
        this.load.image('blood_drop1', 'blood_drop1.png');
        this.load.image('blood_drop2', 'blood_drop2.png');
        this.load.image('blood_drop3', 'blood_drop3.png');
        this.load.image('blood_puddle0', 'blood_puddle0.png');
        this.load.image('blood_puddle1', 'blood_puddle1.png');
        this.load.image('blood_puddle2', 'blood_puddle2.png');
        this.load.image('blood_puddle3', 'blood_puddle3.png');
        this.load.image('blood_puddle4', 'blood_puddle4.png');
        this.load.image('blood_puddle5', 'blood_puddle5.png');
        this.load.image('blood_puddle6', 'blood_puddle6.png');
    }

    create ()
    {
        this.add.image(ARENA_WIDTH, ARENA_HEIGHT, 'arena_bg').setPosition(ARENA_WIDTH / 2, ARENA_HEIGHT / 2).setDepth(-3);

        this.matchStateText = this.add.text(ARENA_WIDTH / 2, ARENA_HEIGHT * 0.9, '', {fontSize: 12, color: 'white'}).setOrigin(0.5, 0.5);

        this.input?.keyboard?.on('keydown-ONE', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][0];
                const enemy = this.heroes[this.opponentTeam()][0]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-TWO', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][0];
                const enemy = this.heroes[this.opponentTeam()][1]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-THREE', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][0];
                const enemy = this.heroes[this.opponentTeam()][2]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-Q', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][1];
                const enemy = this.heroes[this.opponentTeam()][0]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-W', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][1];
                const enemy = this.heroes[this.opponentTeam()][1]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-E', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][1];
                const enemy = this.heroes[this.opponentTeam()][2]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-A', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][2];
                const enemy = this.heroes[this.opponentTeam()][0]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-S', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][2];
                const enemy = this.heroes[this.opponentTeam()][1]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-D', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][2];
                const enemy = this.heroes[this.opponentTeam()][2]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-FOUR', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][0];
                if (hero.isAlive()) {
                    hero.toggleNextStance();
                }
            }
        });
        this.input?.keyboard?.on('keydown-R', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][1];
                if (hero.isAlive()) {
                    hero.toggleNextStance();
                }
            }
        });
        this.input?.keyboard?.on('keydown-F', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][2];
                if (hero.isAlive()) {
                    hero.toggleNextStance();
                }
            }
        });
        this.input?.keyboard?.on('keydown-Z', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const stances = this.heroes[this.playerTeam()].map((hero) => hero.nextStance);
                const moves = this.heroes[this.playerTeam()].filter((hero) => hero.isAlive() && hero.target != undefined && hero.target.team == this.opponentTeam()).map((hero) => BigInt(hero.target!.index));
                if (moves.length == this.getAliveHeroes(this.playerTeam()).length) {
                    this.setMatchState(MatchState.SubmittingMove);
                    // still must send moves for dead units to make sure indexing works, so pad with 0's
                    const paddedMoves = this.heroes[this.playerTeam()].map((hero) => BigInt(hero.isAlive() ? hero.target!.index : 0));
                    if (this.isP1) {
                        console.log('submitting move (as p1)');
                        this.api.p1Commit(paddedMoves, stances).then(() => {
                            // ???
                        });
                    } else {
                        console.log('submitting move (as p2)');
                        this.api.p2Commit(paddedMoves, stances).then(() => {
                            // ???
                        });
                    }
                } else {
                    console.log(`invalid move: |${moves.length} < ${this.getAliveHeroes(this.playerTeam()).length}| ${JSON.stringify(this.heroes[this.playerTeam()].map((hero) => hero.target))}`);
                }
            }
        });
        this.input?.keyboard?.on('keydown-SPACE', () => {
            if (this.matchState == MatchState.GameOverP1Win || this.matchState == MatchState.GameOverP2Win || this.matchState == MatchState.GameOverTie) {
                this.scene.start('MainMenu');
            }
        });
        const rexUI = (this.scene as any).rexUI as RexUIPlugin;

        this.setMatchState(MatchState.Initializing);
    }

    update() {
    }

    getHero(rank: Rank): HeroActor {
        return this.heroes[rank.team][rank.index];
    }

    getAliveHeroes(team: Team): HeroActor[] {
        return this.heroes[team].filter((h) => h.isAlive());
    }

    getAllAliveUnits(): HeroActor[] {
        return this.heroes.flat(1).filter((h) => h.isAlive())
    }
}


const config = {
    type: Phaser.AUTO,
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    scene: [MainMenu],
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