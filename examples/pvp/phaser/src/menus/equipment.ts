import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE, TotalStats } from '@midnight-ntwrk/pvp-contract';
import { Arena, BattleConfig } from '../battle/arena';
import { GAME_WIDTH, GAME_HEIGHT, safeJSONString, gameStateStr, fontStyle } from '../main';
import { addHeroImages, createHeroAnims, generateRandomHero, HeroAnimationController } from '../battle/hero';
import { type HeroIndex, Rank, type Team } from '../battle';
import { Button } from './button';
import { MockPVPArenaAPI } from '../battle/mockapi';
import { PVPArenaAPI, PVPArenaDerivedState } from '@midnight-ntwrk/pvp-api';
import { Physics } from 'phaser';
import { eq } from 'fp-ts';
import { makeTooltip, TooltipId } from './tooltip';
import { Observable } from 'rxjs/internal/Observable';
import { Subscription } from 'rxjs';

class SelectHeroActor extends Phaser.GameObjects.Container {
    hero: Hero;
    rank: Rank;
    statsDisplay: StatsDisplay | undefined;

    select_circle: Phaser.GameObjects.Image;
    tick: number;

    anims: HeroAnimationController | undefined;

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
        if (this.anims != undefined) {
            this.anims.destroy();
        }
        this.removeAll(true);
        //addHeroImages(this, this.hero, this.rank.team == 1);
        this.anims = new HeroAnimationController(this.scene, 0, 0, this.hero, this.rank.team == 1);
        this.add(this.anims);
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
                this.anims?.run();
            },
            onComplete: () => {
                this.anims?.idle();
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

function equip_slot_index(hero: Hero, slot: EQUIP_SLOT): number {
    switch (slot) {
        case EQUIP_SLOT.rhs:
            return hero.rhs;
        case EQUIP_SLOT.lhs:
            return hero.lhs;
        case EQUIP_SLOT.chest:
            return hero.chest;
        case EQUIP_SLOT.helmet:
            return hero.helmet;
        case EQUIP_SLOT.skirt:
            return hero.skirt;
        case EQUIP_SLOT.greaves:
            return hero.greaves;
    }
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
    descriptions: Phaser.GameObjects.Text;
    valuesText: Phaser.GameObjects.Text;
    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y);
        this.add(scene.add.nineslice(0, 0, 'stone_button', undefined, 80, 84, 8, 8, 8, 8));
        this.descriptions = scene.add.text(8 - 40, -42, 'CRUSH DMG:\nPIERCE DMG:\nCRUSH DEF:\nPIERCE DEF:\nDEX BONUS:\nWEIGHT:', fontStyle(6, {align: 'left'}));
        this.add(this.descriptions);
        this.valuesText = scene.add.text(68 - 40, -42, '', fontStyle(6, {align: 'right'}));
        this.add(this.valuesText);
        console.log(`creating stats display (${x}, ${y})`);
        scene.add.existing(this);
    }

    updateStats(stats: TotalStats) {
        this.valuesText.setText (`${stats.crush_dmg}\n${stats.pierce_dmg}\n${stats.crush_def}\n${stats.pierce_def}\n${stats.dex_bonus}\n${stats.weight}`);
    }
}

class EquipmentSelector extends Phaser.GameObjects.Container {
    hero: SelectHeroActor;
    slots: Map<EQUIP_SLOT, SlotSelector>;

    constructor(scene: EquipmentMenu, hero: SelectHeroActor) {
        super(scene, GAME_WIDTH / 2, GAME_HEIGHT * 0.4/* + hero.rank.index * 32*/);
        this.hero = hero;
        this.add(scene.add.nineslice(0, 48, 'stone_button', undefined, 128, 128, 8, 8, 8, 8));

        this.slots = new Map();
        this.slots.set(EQUIP_SLOT.rhs, new SlotSelector(scene, EQUIP_SLOT.rhs, this, hero));
        this.slots.set(EQUIP_SLOT.lhs, new SlotSelector(scene, EQUIP_SLOT.lhs, this, hero));
        this.slots.set(EQUIP_SLOT.helmet, new SlotSelector(scene, EQUIP_SLOT.helmet, this, hero));
        this.slots.set(EQUIP_SLOT.chest, new SlotSelector(scene, EQUIP_SLOT.chest, this, hero));
        this.slots.set(EQUIP_SLOT.skirt, new SlotSelector(scene, EQUIP_SLOT.skirt, this, hero));
        this.slots.set(EQUIP_SLOT.greaves, new SlotSelector(scene, EQUIP_SLOT.greaves, this, hero));
        this.slots.values().forEach((slot) => this.add(slot));

        this.add(new Button(scene, 0, -12, 16, 16, '', 10, () => {
            this.hero.hero = generateRandomHero();
            this.hero.refresh();
            this.slots.values().forEach((slot) => slot.refresh());
        }, 'Randomize'));
        this.add(scene.add.image(0, -12, 'dice').setAlpha(0.75));

        this.add(new Button(scene, 0, 18 * 6, 64, 16, 'Confirm', 10, () => scene.next()));

        this.alpha = 0;

        scene.add.existing(this);

        this.createOpeningTweens();
    }

    activateSlot(slot: EQUIP_SLOT) {
        this.slots.get(slot)?.setVisible(true);
    }

    deactivateSlot(slot: EQUIP_SLOT) {
        this.slots.get(slot)?.setVisible(false);
    }

    private createOpeningTweens() {
        const tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
        this.hero.createStatsDisplay(tweens);
        tweens.push({
            targets: this,
            alpha: 1,
            duration: 100,
            onComplete: () => {
                makeTooltip(
                    this.scene,
                    GAME_WIDTH / 2,
                    300,
                    [TooltipId.EquipExplain1, TooltipId.EquipExplain2, TooltipId.EquipExplain3, TooltipId.EquipExplain4],
                    { width: 320, clickHighlights: [new Phaser.Math.Vector2(48 + GAME_WIDTH / 2, GAME_HEIGHT * 0.4)] },
                );
            },
        });
        this.scene.tweens.chain({
            targets: this.hero,
            tweens
        });
    }
}
class SlotSelector extends Phaser.GameObjects.Container {
    slot: EQUIP_SLOT;
    hero: SelectHeroActor;
    text: Phaser.GameObjects.Text;
    equip: EquipmentSelector;

    constructor(scene: Phaser.Scene, slot: EQUIP_SLOT, equip: EquipmentSelector, hero: SelectHeroActor) {
        super(scene, 0, (slot as number) * 18);

        this.slot = slot;
        this.equip = equip;
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

    // shifts hero's stats and updates visual elements
    public shift(cycle: number) {
        const max = equip_slot_max(this.slot);
        const index = (equip_slot_index(this.hero.hero, this.slot) + max + cycle) % max;
        switch (this.slot) {
            case EQUIP_SLOT.lhs:
                this.hero.hero.lhs = index as ITEM;
                // disallow bow / non-unarmed
                if (this.hero.hero.lhs == ITEM.bow || this.hero.hero.rhs == ITEM.bow) {
                    this.hero.hero.rhs = ITEM.nothing;
                    this.equip.slots.get(EQUIP_SLOT.rhs)?.refresh();
                }
                // disallow double shields
                if (this.hero.hero.lhs == ITEM.shield && this.hero.hero.rhs == ITEM.shield) {
                    this.hero.hero.rhs = ITEM.nothing;
                    this.equip.slots.get(EQUIP_SLOT.rhs)?.refresh();
                }
                break;
            case EQUIP_SLOT.rhs:
                this.hero.hero.rhs = index as ITEM;
                // disallow bow / non-unarmed
                if (this.hero.hero.rhs == ITEM.bow || this.hero.hero.lhs == ITEM.bow) {
                    this.hero.hero.lhs = ITEM.nothing;
                    this.equip.slots.get(EQUIP_SLOT.lhs)?.refresh();
                }
                // disallow double shields
                if (this.hero.hero.lhs == ITEM.shield && this.hero.hero.rhs == ITEM.shield) {
                    this.hero.hero.lhs = ITEM.nothing;
                    this.equip.slots.get(EQUIP_SLOT.lhs)?.refresh();
                }
                break;
            case EQUIP_SLOT.helmet:
                this.hero.hero.helmet = index as ARMOR;
                break;
            case EQUIP_SLOT.chest:
                this.hero.hero.chest = index as ARMOR;
                break;
            case EQUIP_SLOT.skirt:
                this.hero.hero.skirt = index as ARMOR;
                break;
            case EQUIP_SLOT.greaves:
                this.hero.hero.greaves = index as ARMOR;
                break;
        }
        this.refresh();
        this.hero.refresh();
    }

    // refreshes the text / hero (stats) based on current hero's stats
    public refresh() {
        switch (this.slot) {
            case EQUIP_SLOT.lhs:
                this.text.setText(`${equip_slot_name(this.slot)}: ${item_str(this.hero.hero.lhs)}`);
                break;
            case EQUIP_SLOT.rhs:
                this.text.setText(`${equip_slot_name(this.slot)}: ${item_str(this.hero.hero.rhs)}`);
                break;
            case EQUIP_SLOT.helmet:
                this.text.setText(`${equip_slot_name(this.slot)}: ${armor_str(this.hero.hero.helmet)}`);
                break;
            case EQUIP_SLOT.chest:
                this.text.setText(`${equip_slot_name(this.slot)}: ${armor_str(this.hero.hero.chest)}`);
                break;
            case EQUIP_SLOT.skirt:
                this.text.setText(`${equip_slot_name(this.slot)}: ${armor_str(this.hero.hero.skirt)}`);
                break;
            case EQUIP_SLOT.greaves:
                this.text.setText(`${equip_slot_name(this.slot)}: ${armor_str(this.hero.hero.greaves)}`);
                break;
        }
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
    subscription: Subscription | undefined;

    constructor(config: BattleConfig) {
        super('EquipmentMenu');
        this.config = config;
        this.heroes = [];
        this.selecting = 0;
        this.setupState = config.isP1 ? SetupState.SelectingPlayerHeroes : SetupState.WaitingOnOpponent;
    }

    preDestroy() {
        this.subscription?.unsubscribe();
    }

    onStateChange(state: PVPArenaDerivedState) {
        console.log(`new state: ${safeJSONString(state)}`);
        console.log(`NOW: ${gameStateStr(state.state)}`);

        // when joining this.selecting could be out of date
        switch (state.state) {
            case GAME_STATE.p1_selecting_first_hero:
                this.selecting = 0;
                break;
            case GAME_STATE.p1_selecting_last_heroes:
                this.selecting = this.config.isP1 ? 1 : 2;
                break;
            case GAME_STATE.p2_selecting_first_heroes:
                this.selecting = this.config.isP1 ? 1 : 0;
                break;
            case GAME_STATE.p2_selecting_last_hero:
                this.selecting = 2;
                break;
        }

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
            case GAME_STATE.p1_selecting_first_hero:
            case GAME_STATE.p1_selecting_last_heroes:
                if (this.config.isP1 && this.selector == undefined) {
                    this.selector = new EquipmentSelector(this, this.heroes[0][this.selecting]);
                }
                this.setSetupState(this.config.isP1 ? SetupState.SelectingPlayerHeroes : SetupState.WaitingOnOpponent);
                break;
            case GAME_STATE.p2_selecting_first_heroes:
            case GAME_STATE.p2_selecting_last_hero:
                if (!this.config.isP1 && this.selector == undefined) {
                    this.selector = new EquipmentSelector(this, this.heroes[1][this.selecting]);
                }
                this.setSetupState(this.config.isP1 ? SetupState.WaitingOnOpponent : SetupState.SelectingPlayerHeroes);
                break;
            case GAME_STATE.p1_commit:
                // game started
                console.log(`================skipping equip screen=============`);
                // This causes black screens when uncommented. TODO: investigate. Issue: https://github.com/PaimaStudios/pvp-arena/issues/22
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
        this.load.image('dice', 'dice.png');
        this.load.image('select_circle', 'select_circle.png');

        this.load.audio('select', 'select.wav');
        this.load.audio('move', 'move.wav');
    }

    create() {
        createHeroAnims(this);

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

        this.subscription = this.config.api.state$.subscribe((state) => this.onStateChange(state));
    }

    // advances to next step
    next() {
        this.tweens.add({
            targets: this.heroes[this.config.isP1 ? 0 : 1][this.selecting].select_circle,
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
                    this.config.api.p1_select_first_hero(this.heroes[0][0].hero);
                    this.setSetupState(SetupState.Submitting);
                    break;
                case 1:
                    this.selector = new EquipmentSelector(this, this.heroes[0][2]);
                    break;
                case 2:
                    this.config.api.p1_select_last_heroes([this.heroes[0][1].hero, this.heroes[0][2].hero]);
                    this.setSetupState(SetupState.Submitting);
                    break;
            }
        } else {
            switch (this.selecting) {
                case 0:
                    this.selector = new EquipmentSelector(this, this.heroes[1][1]);
                    break;
                case 1:
                    this.config.api.p2_select_first_heroes([this.heroes[1][0].hero, this.heroes[1][1].hero]);
                    this.setSetupState(SetupState.Submitting);
                    break;
                case 2:
                    this.config.api.p2_select_last_hero(this.heroes[1][2].hero);
                    this.setSetupState(SetupState.Submitting);
                    break;
            }
        }
        this.selecting += 1;
    }
}