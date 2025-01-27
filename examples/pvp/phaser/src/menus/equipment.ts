import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE, TotalStats } from '@midnight-ntwrk/pvp-contract';
import { Arena, BattleConfig } from '../battle/arena';
import { GAME_WIDTH, GAME_HEIGHT, safeJSONString, gameStateStr, fontStyle } from '../main';
import { addHeroImages } from '../battle/hero';
import { type HeroIndex, Rank, type Team } from '../battle';
import { Button } from './button';
import { MockPVPArenaAPI } from '../battle/mockapi';
import { PVPArenaAPI, PVPArenaDerivedState } from '@midnight-ntwrk/pvp-api';
import { Physics } from 'phaser';

class SelectHeroActor extends Phaser.GameObjects.Container {
    hero: Hero;
    rank: Rank;
    statsDisplay: StatsDisplay | undefined;

    select_circle: Phaser.GameObjects.Image;
    tick: number;

    constructor(scene: EquipmentMenu, rank: Rank) {
        super(scene, rank.x(STANCE.defensive), rank.y());
        this.select_circle = scene.add.image(0, 8, 'select_circle').setAlpha(0);
        if (rank.team != (scene.config.isP1 ? 0 : 1)) {
            this.select_circle.setVisible(false);
        }
        this.add(this.select_circle);
        this.tick = 0;
        scene.add.existing(this);
        this.hero = {
            rhs: ITEM.nothing,
            lhs: ITEM.nothing,
            helmet: ARMOR.nothing,
            chest: ARMOR.nothing,
            skirt: ARMOR.nothing,
            greaves: ARMOR.nothing,
        };
        this.rank = rank;
        this.statsDisplay = undefined;

        this.refresh();
    }

    preUpdate(): void {
        this.select_circle.setPosition(this.x, this.y);
        this.select_circle.angle = this.tick / 5;
        const circleScale = 1 + 0.09 * Math.sin(this.tick / 64);
        this.select_circle.setScale(circleScale, circleScale);
        this.tick += 1;
    }

    refresh() {
        this.removeAll();
        addHeroImages(this, this.hero, this.rank.team == 1);
        if (this.statsDisplay != undefined) {
            this.statsDisplay.updateStats(pureCircuits.calc_stats(this.hero));
        }
    }

    createStatsDisplay(tweens: Phaser.Types.Tweens.TweenBuilderConfig[]) {
        this.statsDisplay = new StatsDisplay(this.scene, this.x + (this.rank.team == 0 ? (-96 + 40) : (96 - 40)), 80 + 90 * this.rank.index);
        this.statsDisplay.updateStats(pureCircuits.calc_stats(this.hero));
        this.statsDisplay.alpha = 0;
        tweens.push({
            targets: this,
            x: this.rank.x(STANCE.neutral),
            duration: 450,
            onStart: () => {
                this.scene.sound.play('move');
                this.refresh();
            },
        });
        tweens.push({
            targets: [this.statsDisplay!, this.select_circle!],
            alpha: 1,
            duration: 450,
        });
    }
}

enum EQUIP_SLOT {
    rhs = 0,
    lhs = 1,
    helmet = 2,
    chest = 3,
    skirt = 4,
    greaves = 5,
}

function equip_slot_max(slot: EQUIP_SLOT): number {
    if (slot == EQUIP_SLOT.rhs || slot == EQUIP_SLOT.lhs) {
        return 6;
    }
    return 3;
}

function equip_slot_name(slot: EQUIP_SLOT): string {
    switch (slot) {
        case EQUIP_SLOT.rhs:
            return 'Right hand';
        case EQUIP_SLOT.lhs:
            return 'Left hand';
        case EQUIP_SLOT.chest:
            return 'Chest';
        case EQUIP_SLOT.helmet:
            return 'Helmet';
        case EQUIP_SLOT.skirt:
            return 'Skirt';
        case EQUIP_SLOT.greaves:
            return 'Greaves';
    }
    return 'ERROR';
}

function item_str(item: ITEM): string {
    switch (item) {
        case ITEM.nothing:
            return '--';
        case ITEM.axe:
            return 'Axe';
        case ITEM.shield:
            return 'Shield';
        case ITEM.bow:
            return 'Bow';
        case ITEM.sword:
            return 'Sword';
        case ITEM.spear:
            return 'Spear';
    }
    return 'ERROR';
}

function armor_str(armor: ARMOR): string {
    switch (armor) {
        case ARMOR.nothing:
            return '--';
        case ARMOR.leather:
            return 'Leather';
        case ARMOR.metal:
            return 'Metal';
    }
    return 'ERROR';
}

class StatsDisplay extends Phaser.GameObjects.Container {
    // crushDmg: Phaser.GameObjects.Text;
    // pierceDmg: Phaser.GameObjects.Text;
    // crushDef: Phaser.GameObjects.Text;
    // pierceDef: Phaser.GameObjects.Text;
    // dexBonus: Phaser.GameObjects.Text;
    // weight: Phaser.GameObjects.Text;
    descriptions: Phaser.GameObjects.Text;
    valuesText: Phaser.GameObjects.Text;
    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y);
        this.add(scene.add.nineslice(0, 0, 'stone_button', undefined, 80, 84, 8, 8, 8, 8));
        // this.crushDmg = scene.add.text(8, 8, '', style).setOrigin(0.5, 0.65);
        // this.add(this.crushDmg);
        // this.pierceDmg = scene.add.text(8, 20, '', style).setOrigin(0.5, 0.65);
        // this.add(this.pierceDmg);
        // this.crushDef = scene.add.text(8, 32, '', style).setOrigin(0.5, 0.65);
        // this.add(this.crushDef);
        // this.pierceDef = scene.add.text(8, 44, '', style).setOrigin(0.5, 0.65);
        // this.add(this.pierceDef);
        // this.dexBonus = scene.add.text(8, 56, '', style).setOrigin(0.5, 0.65);
        // this.add(this.dexBonus);
        // this.weight = scene.add.text(8, 68, '', style).setOrigin(0.5, 0.65);
        // this.add(this.weight);
        this.descriptions = scene.add.text(8 - 40, -42, 'CRUSH DMG:\nPIERCE DMG:\nCRUSH DEF:\nPIERCE DEF:\nDEX BONUS:\nWEIGHT:', fontStyle(6, {align: 'left'}));
        this.add(this.descriptions);
        this.valuesText = scene.add.text(68 - 40, -42, '', fontStyle(6, {align: 'right'}));
        this.add(this.valuesText);
        console.log(`creating stats display (${x}, ${y})`);
        scene.add.existing(this);
    }

    updateStats(stats: TotalStats) {
        // this.crushDmg.setText (`CRUSH DMG:  ${stats.crush_dmg}`);
        // this.pierceDmg.setText(`PIERCE DMG: ${stats.pierce_dmg}`);
        // this.crushDef.setText (`CRUSH DEF:  ${stats.crush_def}`);
        // this.pierceDef.setText(`PIERCE DEF: ${stats.pierce_def}`);
        // this.dexBonus.setText (`DEX BONUS:  ${stats.dex_bonus}`);
        // this.weight.setText   (`WEIGHT:     ${stats.weight}`);
        this.valuesText.setText (`${stats.crush_dmg}\n${stats.pierce_dmg}\n${stats.crush_def}\n${stats.pierce_def}\n${stats.dex_bonus}\n${stats.weight}`);
    }
}

class EquipmentSelector extends Phaser.GameObjects.Container {
    hero: SelectHeroActor;

    constructor(scene: EquipmentMenu, hero: SelectHeroActor) {
        super(scene, GAME_WIDTH / 2, GAME_HEIGHT * 0.4/* + hero.rank.index * 32*/);
        this.hero = hero;
        this.add(scene.add.nineslice(0, 48, 'stone_button', undefined, 128, 128, 8, 8, 8, 8));
        this.add(new SlotSelector(scene, EQUIP_SLOT.rhs, hero));
        this.add(new SlotSelector(scene, EQUIP_SLOT.lhs, hero));
        this.add(new SlotSelector(scene, EQUIP_SLOT.helmet, hero));
        this.add(new SlotSelector(scene, EQUIP_SLOT.chest, hero));
        this.add(new SlotSelector(scene, EQUIP_SLOT.skirt, hero));
        this.add(new SlotSelector(scene, EQUIP_SLOT.greaves, hero));

        this.add(new Button(scene, 0, 18 * 6, 64, 16, 'Confirm', 10, () => scene.next()));

        this.alpha = 0;

        scene.add.existing(this);

        this.createOpeningTweens();
    }

    private createOpeningTweens() {
        const tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
        this.hero.createStatsDisplay(tweens);
        tweens.push({
            targets: this,
            alpha: 1,
            duration: 100,
        });
        this.scene.tweens.chain({
            targets: this.hero,
            tweens
        });
    }
}
class SlotSelector extends Phaser.GameObjects.Container {
    index: number;
    slot: EQUIP_SLOT;
    hero: SelectHeroActor;
    text: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene, slot: EQUIP_SLOT, hero: SelectHeroActor) {
        super(scene, 0, (slot as number) * 18);

        this.index = 0;
        this.slot = slot;
        this.hero = hero;

        const left = this.scene.add.image(-48, 0, 'equip_select_arrow').setFlipX(true);
        left.setInteractive({ useHandCursor: true });
        left.on('pointerup', () => {
            scene.sound.play('select');
            this.shift(-1);
        });
        left.on('pointerover', () => left.setTexture('equip_select_arrow_over'));
        left.on('pointerout', () => left.setTexture('equip_select_arrow'));
        this.add(left);
        const right = this.scene.add.image(48, 0, 'equip_select_arrow');
        right.setInteractive({ useHandCursor: true });
        right.on('pointerup', () => {
            scene.sound.play('select');
            this.shift(1);
        });
        right.on('pointerover', () => right.setTexture('equip_select_arrow_over'));
        right.on('pointerout', () => right.setTexture('equip_select_arrow'));
        this.add(right);

        const text = this.scene.add.text(0, 0, '', fontStyle(6)).setOrigin(0.5, 0.65);
        this.text = text;
        this.add(text);

        // to refresh
        this.shift(0);

        scene.add.existing(this);
    }

    shift(cycle: number) {
        const max = equip_slot_max(this.slot);
        this.index = (this.index + max + cycle) % max;
        switch (this.slot) {
            case EQUIP_SLOT.lhs:
                this.hero.hero.lhs = this.index as ITEM;
                this.text.setText(`${equip_slot_name(this.slot)}: ${item_str(this.hero.hero.lhs)}`);
                break;
            case EQUIP_SLOT.rhs:
                this.hero.hero.rhs = this.index as ITEM;
                this.text.setText(`${equip_slot_name(this.slot)}: ${item_str(this.hero.hero.rhs)}`);
                break;
            case EQUIP_SLOT.helmet:
                this.hero.hero.helmet = this.index as ARMOR;
                this.text.setText(`${equip_slot_name(this.slot)}: ${armor_str(this.hero.hero.helmet)}`);
                break;
            case EQUIP_SLOT.chest:
                this.hero.hero.chest = this.index as ARMOR;
                this.text.setText(`${equip_slot_name(this.slot)}: ${armor_str(this.hero.hero.chest)}`);
                break;
            case EQUIP_SLOT.skirt:
                this.hero.hero.skirt = this.index as ARMOR;
                this.text.setText(`${equip_slot_name(this.slot)}: ${armor_str(this.hero.hero.skirt)}`);
                break;
            case EQUIP_SLOT.greaves:
                this.hero.hero.greaves = this.index as ARMOR;
                this.text.setText(`${equip_slot_name(this.slot)}: ${armor_str(this.hero.hero.greaves)}`);
                break;
        }
        this.hero.refresh();
    }
}

enum SetupState {
    SelectingPlayerHeroes,
    WaitingOnOpponent,
    Submitting,
}

export class EquipmentMenu extends Phaser.Scene {
    config: BattleConfig;
    heroes: SelectHeroActor[][];
    setupState: SetupState;
    selecting: number;
    selector: EquipmentSelector | undefined;
    setupStateText: Phaser.GameObjects.Text | undefined;

    constructor(config: BattleConfig) {
        super('EquipmentMenu');
        this.config = config;
        this.heroes = [];
        this.selecting = 0;
        this.setupState = config.isP1 ? SetupState.SelectingPlayerHeroes : SetupState.WaitingOnOpponent;
        const subscription = config.api.state$.subscribe((state) => this.onStateChange(state));
    }

    onStateChange(state: PVPArenaDerivedState) {
        console.log(`new state: ${safeJSONString(state)}`);
        console.log(`NOW: ${gameStateStr(state.state)}`);

        // update heroes
        let tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
        for (let team = 0; team < 2; ++team) {
            const newHeroes = team == 0 ? state.p1Heroes : state.p2Heroes;
            for (let i = 0; i < newHeroes.length; ++i) {
                const heroActor = this.heroes[team][i];
                
                if (heroActor.statsDisplay == undefined) {
                    heroActor.hero = newHeroes[i];
                    heroActor.createStatsDisplay(tweens);
                }
            }
        }
        tweens.push({
            targets: null,
            onComplete: () => {
                this.runStateChange(state);
            },
        });
        this.tweens.chain({
            // this doesn't seem to do anything (always overridden?) but if you pass null it errors
            targets: this.heroes[0][0],
            tweens,
        });
    }

    runStateChange(state: PVPArenaDerivedState) {
        console.log(`running state change: ${state.state}`);
        switch (state.state) {
            case GAME_STATE.p1_selecting_first_heroes:
            case GAME_STATE.p1_selecting_last_hero:
                if (this.config.isP1 && this.selector == undefined) {
                    this.selector = new EquipmentSelector(this, this.heroes[0][this.selecting]);
                }
                this.setSetupState(this.config.isP1 ? SetupState.SelectingPlayerHeroes : SetupState.WaitingOnOpponent);
                break;
            case GAME_STATE.p2_selecting_heroes:
                if (!this.config.isP1 && this.selector == undefined) {
                    this.selector = new EquipmentSelector(this, this.heroes[0][this.selecting]);
                }
                this.setSetupState(this.config.isP1 ? SetupState.WaitingOnOpponent : SetupState.SelectingPlayerHeroes);
                break;
            case GAME_STATE.p1_commit:
                // game started
                //this.scene.remove('Arena');
                this.scene.add('Arena', new Arena(this.config, state));
                this.scene.start('Arena');
                break;
            default:
                console.error(`invalid equipment state: ${gameStateStr(state.state)}`);
                break;
        }
    }

    setSetupState(state: SetupState) {
        this.setupState = state;
        switch (state) {
            case SetupState.SelectingPlayerHeroes:
                this.setupStateText?.setText('Select your heroes');
                break;
            case SetupState.WaitingOnOpponent:
                this.setupStateText?.setText('Waiting on opponent\'s selection...');
                break;
            case SetupState.Submitting:
                this.setupStateText?.setText('Submitting selection...');
                break;
        }
    }

    preload() {
        this.load.setBaseURL('/');

        this.load.image('arena_bg', 'arena_bg.png');
        this.load.image('equip_select_arrow', 'equip_select_arrow.png');
        this.load.image('equip_select_arrow_over', 'equip_select_arrow_over.png');
        this.load.image('select_circle', 'select_circle.png');

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

        this.load.audio('select', 'select.wav');
        this.load.audio('move', 'move.wav');
    }

    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);
        this.add.text(GAME_WIDTH / 2 + 2, GAME_HEIGHT / 5, 'EQUIPMENT SELECT', fontStyle(24)).setOrigin(0.5, 0.65);
        this.setupStateText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.9, '', fontStyle(12)).setOrigin(0.5, 0.65);

        for (let team = 0; team < 2; ++team) {
            let heroes = [];
            for (let index = 0; index < 3; ++index) {
                const hero = new SelectHeroActor(this, new Rank(index as HeroIndex, team as Team));
                heroes.push(hero);
            }
            this.heroes.push(heroes);
        }
    }

    // advances to next step
    next() {
        this.tweens.add({
            targets: this.heroes[0][this.selecting].select_circle,
            alpha: 0,
            duration: 450,
        });
        
        if (this.selector != undefined) {
            this.selector.destroy();
            this.selector = undefined;
        }
        if (this.config.isP1) {
            switch (this.selecting) {
                case 0:
                    this.selector = new EquipmentSelector(this, this.heroes[0][1]);
                    break;
                case 1:
                    this.config.api.p1_select_first_heroes([this.heroes[0][0].hero, this.heroes[0][1].hero]);
                    this.setSetupState(SetupState.Submitting);
                    break;
                case 2:
                    this.config.api.p1_select_last_hero(this.heroes[0][2].hero);
                    this.setSetupState(SetupState.Submitting);
                    break;
            }
        } else {
            if (this.selecting == 2) {
                this.config.api.p2_select_heroes(this.heroes[1].map((h) => h.hero));
                this.setSetupState(SetupState.Submitting);
            } else {
                this.selector = new EquipmentSelector(this, this.heroes[0][this.selecting + 1]);
            }
        }
        this.selecting += 1;
    }
}