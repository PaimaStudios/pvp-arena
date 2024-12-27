import { NetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import '@midnight-ntwrk/dapp-connector-api';
import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits } from '@midnight-ntwrk/pvp-contract';
import { type BBoardDerivedState, type DeployedBBoardAPI, BBoardAPI } from '@midnight-ntwrk/pvp-api';
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



// phaser part

import 'phaser';
import RexUIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin'
//import KeyboardPlugin from 'phaser3-';
import RoundRectanglePlugin from 'phaser3-rex-plugins/plugins/roundrectangle-plugin.js';
import { extend } from 'fp-ts/lib/pipeable';

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
        // don't care if positive or negative since we're just looking for random
        this.ySpeed = spd * Math.sin(dir) - spd2 * Math.sin(dir2);
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
            this.arena.add.image(this.x, this.y, `blood_puddle${Phaser.Math.Between(3, 6)}`).setAlpha(0.5).setDepth(-1);
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
    let str = '{';
    let first = true;
    for (let [key, val] of Object.entries(obj)) {
        if (!first) {
            str += ', ';
        }
        first = false;
        str += `"${key}": `;
        if (typeof val == 'bigint') {
            str += Number(val).toString();
        } else {
            str += JSON.stringify(val);
        }
    }
    str += '}';
    return str;
}

class HeroActor extends Phaser.GameObjects.Container {
    arena: Arena;
    hero: Hero;
    //body_images: Phaser.GameObjects.Image[];
    hpBar: HpBar;
    rank: Rank;
    target: Rank | undefined;
    targetLine: Phaser.GameObjects.Line;
    uiDmg: number;
    realDmg: number;
    stance: STANCE;
    nextStance: STANCE;
    arrow: Phaser.GameObjects.Image;

    constructor(arena: Arena, hero: Hero, rank: Rank) {
        console.log(`Hero created: ${rank.team}|${rank.index} => ${safeJSONString(pureCircuits.calc_stats(hero))}`);
        super(arena, rank.x(STANCE.neutral), rank.y());

        this.arena = arena;
        this.hero = hero;
        this.rank = rank;
        this.target = undefined;
        this.uiDmg = 0;
        this.realDmg = 0;
        this.stance = STANCE.neutral;
        this.nextStance = this.stance;

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

        this.arrow = arena.add.image(0, 0, 'arrow_move').setVisible(false);
        this.add(this.arrow);

        arena.add.existing(this);
    }

    preUpdate(): void {
    }

    // true = killed
    public attack(attacker: HeroActor, dmg: number): boolean {
        const n = 1 + (dmg * (2 + Math.random())) / 9000;
        console.log(`attack(${hpDiv(dmg)}) -> ${n}`);
        for (let i = 0; i < n; ++i) {
            // TODO: this feels weird/ugly/hacky - maybe the constructor shouldn't add itself
            this.arena.add.existing(new BloodDrop(this.arena, this.x, this.y, Phaser.Math.Angle.Between(attacker.rank.x(attacker.stance), attacker.rank.y(), this.rank.x(this.stance), this.rank.y())));
        }

        this.arena.add.existing(new DamageText(this.arena,  (this.x + attacker.x) / 2, (this.y + attacker.y) / 2 - 24, dmg));

        this.uiDmg = Math.min(MAX_HP, this.uiDmg + dmg);
        this.hpBar.setHp(1 - (this.uiDmg / MAX_HP));
        if (this.isAlive()) {
            return false;
        }
        this.visible = false;
        return true;
    }

    public isAlive(): boolean {
        // TODO: UI or real dmg?
        return this.uiDmg < MAX_HP;
    }

    public toggleNextStance() {
        if (this.nextStance == STANCE.neutral) {
            this.nextStance = this.stance == STANCE.defensive ? STANCE.defensive : STANCE.aggressive;
        } else if (this.nextStance == STANCE.aggressive) {
            this.nextStance = this.stance == STANCE.aggressive ? STANCE.neutral : STANCE.defensive;
        } else {
            this.nextStance = STANCE.neutral;
        }
        if (this.nextStance == this.stance) {
            this.arrow.visible = false;
        } else {
            const pointsLeft = this.nextStance == STANCE.defensive || (this.stance == STANCE.aggressive && this.nextStance == STANCE.neutral);
            this.arrow.visible = true;
            this.arrow.setPosition(pointsLeft ? -32 : 32, 0);
            this.arrow.setFlipX(pointsLeft);
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
        this.add.image(ARENA_WIDTH, ARENA_HEIGHT, 'arena_bg').setPosition(ARENA_WIDTH / 2, ARENA_HEIGHT / 2).setDepth(-2);
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
                        const arena = new Arena(api, false);
                        this.scene.add('Arena', arena);
                        this.scene.start('Arena');
                    });
                }
            }
        });
        // create an off-chain testing world for testing graphical stuff without having to wait a long time
        this.input?.keyboard?.on('keydown-T', () => {
            this.scene.add('Arena', new Arena(undefined, true));
            this.scene.start('Arena');
        });
    }
}

enum MatchState {
    Initializing,
    WaitingOnPlayer,
    WaitingOnOpponent,
    SubmittingMove,
    CombatResolving,
}

class Arena extends Phaser.Scene
{
    cursors: any;//Phaser.Types.Input.Keyboard.KeyboardPlugin | undefined;
    keys: any;
    heroes: HeroActor[][];
    // this is undefined in testing battles (offline) only, will always be defined in real battles (on-chain)
    api: BBoardAPI | undefined;
    isP1: boolean;
    matchState: MatchState;
    matchStateText: Phaser.GameObjects.Text | undefined;
    round: number;

    constructor(api: BBoardAPI | undefined, isP1: boolean) {
        super('Arena');
        this.heroes = [];
        this.api = api;
        this.isP1 = isP1;
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
                break;
            case MatchState.WaitingOnOpponent:
                this.matchStateText?.setText('Waiting on opponent...');
                break;
            case MatchState.SubmittingMove:
                this.matchStateText?.setText('Submitting move...');
                break;
            case MatchState.CombatResolving:
                this.matchStateText?.setText('Battle!');
                break;
        }
    }

    onStateChange(state: BBoardDerivedState) {
        //console.log(`new state: ${JSON.stringify(state)}`);
        console.log('new state');

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

        if (state.p1Cmds != undefined && state.p2Cmds != undefined) {
            const newTargets = [
                state.p1Cmds.map(Number),
                state.p1Cmds.map(Number)
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
        switch (state.state) {
            case RESULT.continue:
                this.setMatchState(MatchState.WaitingOnPlayer);
                break;
            case RESULT.waiting:
                this.setMatchState(MatchState.WaitingOnOpponent);
                break;
                // TODO: match end logic
        }

        if (this.round < state.round) {
            this.runCombatAnims();
            this.round = Number(state.round);
        }
    }

    runCombatAnims() {
        this.setMatchState(MatchState.CombatResolving);
        const tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
        // stance change tweens
        for (let team = 0; team < 2; ++team) {
            for (let i = 0; i < 3; ++i) {
                const hero = this.heroes[team][i];
                tweens.push({
                    targets: hero,
                    delay: 150,
                    duration: 350,
                    ease: 'Linear',
                    x: hero.rank.x(hero.nextStance),
                    onStart: () => {
                        hero.arrow.visible = false;
                    },
                    onComplete: () => {
                        hero.stance = hero.nextStance;
                        //hero
                        hero.updateTargetLine();
                    },
                });
            }
        }
        tweens.push({
            targets: null,
            duration: 3000,
        });

        // attack tweens
        for (let team = 0; team < 2; ++team) {
            for (let i = 0; i < 3; ++i) {
                const hero = this.heroes[team][i];
                const enemy = this.heroes[hero.target!.team][hero.target!.index];
                tweens.push({
                    targets: hero,
                    duration: 150,
                    onComplete: () => {
                        // get rid of line before attack
                        hero.setTarget(undefined);
                    },
                });
                const dist = (new Phaser.Math.Vector2(hero.rank.x(hero.nextStance), hero.y)).distance(new Phaser.Math.Vector2(enemy.rank.x(enemy.nextStance), enemy.y));
                tweens.push({
                    targets: hero,
                    ease: 'Quad.easeInOut',
                    x: hero.target!.x(this.getHero(hero.target!).nextStance),
                    y: hero.target!.y(),
                    duration: 40 + dist * 2,
                    onComplete: () => {
                        console.log(`half of tween [${team}][${i}]`);
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
                tweens.push({
                    targets: hero,
                    ease: 'Quad.easeInOut',
                    x: hero.rank.x(hero.nextStance),
                    y: hero.y,
                    duration: 60 + dist * 3,
                    onComplete: (tween) => {
                        console.log(`tween.targets = ${JSON.stringify(tween.targets)}`);
                        console.log(`completed tween [${team}][${i}]`);
                    },
                    persist: false,
                });
            }
        }
        tweens.push({
            targets: null,
            onComplete: () => {
                this.setMatchState(MatchState.WaitingOnPlayer);
            }
        });
        this.tweens.chain({
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
        this.add.image(ARENA_WIDTH, ARENA_HEIGHT, 'arena_bg').setPosition(ARENA_WIDTH / 2, ARENA_HEIGHT / 2).setDepth(-2);

        this.matchStateText = this.add.text(ARENA_WIDTH / 2, ARENA_HEIGHT * 0.9, 'Initializing...', {fontSize: 12, color: 'white'}).setOrigin(0.5, 0.5);

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
        this.input?.keyboard?.on('keydown-FOUR', () => {
            const hero = this.heroes[this.playerTeam()][0];
            hero.toggleNextStance();
        });
        this.input?.keyboard?.on('keydown-R', () => {
            const hero = this.heroes[this.playerTeam()][1];
            hero.toggleNextStance();
        });
        this.input?.keyboard?.on('keydown-F', () => {
            const hero = this.heroes[this.playerTeam()][2];
            hero.toggleNextStance();
        });
        this.input?.keyboard?.on('keydown-Z', () => {
            //const stances = this.heroes[this.playerTeam()].map((hero) => hero.stance);
            const moves = this.heroes[this.playerTeam()].filter((hero) => hero.target != undefined && hero.target.team == this.opponentTeam()).map((hero) => BigInt(hero.target!.index));
            // TODO: need to check vs number of alive heroes
            if (moves.length == 3) {
                if (this.api != undefined) {
                    this.setMatchState(MatchState.SubmittingMove);
                    if (this.isP1) {
                        console.log('submitting move (as p1)');
                        this.api.p1Command(moves).then((result) => {
                            // ???
                        });
                    } else {
                        console.log('submitting move (as p2)');
                        this.api.p2Command(moves).then((result) => {
                            // ???
                        });
                    }
                } else {
                    // mock response
                    this.setMatchState(MatchState.SubmittingMove);
                    // mock delay for response
                    this.time.delayedCall(1000, () => {
                        // randomize opponent moves
                        for (let enemy of this.heroes[this.opponentTeam()]) {
                            switch (enemy.stance) {
                                case STANCE.defensive:
                                    enemy.nextStance = Phaser.Math.Between(0, 1) as STANCE;
                                    break;
                                case STANCE.neutral:
                                    enemy.nextStance = Phaser.Math.Between(0, 2) as STANCE;
                                    break;
                                case STANCE.aggressive:
                                    enemy.nextStance = Phaser.Math.Between(1, 2) as STANCE;
                                    break;
                            }
                            // don't update arrow yet
                            enemy.target = new Rank(Math.floor(2.9 * Math.random()) as HeroIndex, this.playerTeam());
                        }
                        this.runCombatAnims();
                    });
                }
            } else {
                console.log(`invalid move: ${JSON.stringify(this.heroes[this.playerTeam()].map((hero) => hero.target))}`);
            }
        });

        if (this.api == undefined) {
            let mockHeroes: Hero[][] = [
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
            for (let team = 0; team < 2; ++team) {
                let hero_actors = [];
                for (let i = 0; i < 3; ++i) {
                    const rank = new Rank(i as HeroIndex, team as Team);
                    // TODO: how to do these loops so typescript knows that team/i are 0-1 and 0-2?
                    hero_actors.push(new HeroActor(this, mockHeroes[team][i], rank));
                }
                this.heroes.push(hero_actors);
            }
            this.setMatchState(MatchState.WaitingOnPlayer);
        }
        const rexUI = (this.scene as any).rexUI as RexUIPlugin;
    }

    update() {
        if (this.keys.n1.isDown) {
            this.heroes[this.playerTeam()][0].setTarget(new Rank(0, this.opponentTeam()));
        }
        if (this.keys.n2.isDown) {
            this.heroes[this.playerTeam()][0].setTarget(new Rank(1, this.opponentTeam()));
        }
        if (this.keys.n3.isDown) {
            this.heroes[this.playerTeam()][0].setTarget(new Rank(2, this.opponentTeam()));
        }
        if (this.keys.q.isDown) {
            this.heroes[this.playerTeam()][1].setTarget(new Rank(0, this.opponentTeam()));
        }
        if (this.keys.w.isDown) {
            this.heroes[this.playerTeam()][1].setTarget(new Rank(1, this.opponentTeam()));
        }
        if (this.keys.e.isDown) {
            this.heroes[this.playerTeam()][1].setTarget(new Rank(2, this.opponentTeam()));
        }
        if (this.keys.a.isDown) {
            this.heroes[this.playerTeam()][2].setTarget(new Rank(0, this.opponentTeam()));
        }
        if (this.keys.s.isDown) {
            this.heroes[this.playerTeam()][2].setTarget(new Rank(1, this.opponentTeam()));
        }
        if (this.keys.d.isDown) {
            this.heroes[this.playerTeam()][2].setTarget(new Rank(2, this.opponentTeam()));
        }
        if (this.keys.x.isDown) {
            for (let i = 0; i < 3; ++i) {
                this.heroes[this.playerTeam()][i].setTarget(undefined);
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