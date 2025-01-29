import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE } from '@midnight-ntwrk/pvp-contract';
import { safeJSONString, MatchState, fontStyle } from '../main';
import { Arena } from './arena';
import { MAX_HP, Rank, BloodDrop, DamageText, hpDiv } from '.';

export class HeroActor extends Phaser.GameObjects.Container {
    arena: Arena;
    hero: Hero;
    //body_images: Phaser.GameObjects.Image[];
    hpBar: HpBar;
    rank: Rank;
    target: Rank | undefined;
    targetLine: Phaser.GameObjects.Image;
    targetDmgEstimage: Phaser.GameObjects.Text;
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

        const line = arena.add.image(0, 0, 'arrow_attack')
            .setVisible(false);
        this.targetLine = line;
        this.add(line);
        this.targetDmgEstimage = arena.add.text(0, 0, '', fontStyle(10)).setVisible(false).setOrigin(0.5, 0.5);
        this.add(this.targetDmgEstimage);

        this.left_arrow = arena.add.image(-32, 0, 'arrow_move').setVisible(false).setFlipX(true);
        this.add(this.left_arrow);
        this.right_arrow = arena.add.image(32, 0, 'arrow_move').setVisible(false);
        this.add(this.right_arrow);

        // depth doesn't seem to matter here - it's overridden by Container's I think so it's based on add() order
        this.select_circle = arena.add.image(0, 8, 'select_circle').setVisible(false).setDepth(-1);
        this.add(this.select_circle);

        addHeroImages(this, hero, isP2);

        this.hpBar = new HpBar(arena, 0, -31, 40);
        this.add(this.hpBar);

        arena.add.existing(this);

        this.setSize(32, 48);
        arena.input.enableDebug(this);
        this.on('pointerup', () => {
            if (this.arena.matchState == MatchState.WaitingOnPlayer) {
                arena.sound.play('select');
                if ((this.arena.config.isP1 ? 0 : 1) == this.rank.team) {
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
            arena.sound.play('select');
            const leftStance = this.stance == STANCE.neutral ? STANCE.defensive : STANCE.neutral;
            this.nextStance = this.nextStance == leftStance ? this.stance : leftStance;
            this.updateNextStanceArrow();
        });
        this.right_arrow.on('pointerup', () => {
            arena.sound.play('select');
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
        this.arena.sound.play('damage');
        const n = 1 + (dmg * (2 + Math.random())) / 100000;
        console.log(`attack(${hpDiv(dmg)}) -> ${n}`);
        for (let i = 0; i < n; ++i) {
            // TODO: this feels weird/ugly/hacky - maybe the constructor shouldn't add itself
            this.arena.add.existing(new BloodDrop(this.arena, this.x, this.y, Phaser.Math.Angle.Between(attacker.rank.x(attacker.stance), attacker.rank.y(), this.rank.x(this.stance), this.rank.y())));
        }

        this.arena.add.existing(new DamageText(this.arena, (this.x + attacker.x) / 2, (this.y + attacker.y) / 2 - 24, dmg));

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
                            this.arena.sound.play('death');
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
        // also update the damage estimate
        this.updateTargetLine();
    }

    public setTarget(target: Rank | undefined) {
        const targetStr = target == undefined ? 'undefined' : `${target?.team}:${target?.index}`;
        console.log(`${this.rank.team}:${this.rank.index} . setTargget (${targetStr})`);
        this.target = target;

        this.updateTargetLine();

        if (this.arena.getAliveHeroes(this.arena.playerTeam()).every((h) => h.targetLine.visible)) {
            this.arena.enableSubmitButton();
        }
    }

    public updateTargetLine() {
        if (this.target != undefined) {
            // TODO: how to know other person's stance?
            const enemy = this.arena.getHero(this.target);
            const tx = this.target.x(enemy.stance);
            const ty = this.target.y();
            const angle = Phaser.Math.Angle.Between(this.x, this.y, tx, ty);
            const distFromHero = 16;
            this.targetLine
                .setPosition(Math.cos(angle) * distFromHero, 24 + Math.sin(angle) * distFromHero)
                .setRotation(angle)
                .setVisible(true);
            const enemyClosestStance = enemy.stance == STANCE.defensive ? STANCE.neutral : STANCE.aggressive;
            const enemyFurthestStance = enemy.stance == STANCE.aggressive ? STANCE.neutral : STANCE.defensive;
            const lowestDmg = Number(pureCircuits.calc_item_dmg_against(pureCircuits.calc_stats(this.hero), this.nextStance, pureCircuits.calc_stats(enemy.hero), enemyFurthestStance));
            const highestDmg = Number(pureCircuits.calc_item_dmg_against(pureCircuits.calc_stats(this.hero), this.nextStance, pureCircuits.calc_stats(enemy.hero), enemyClosestStance));
            this.targetDmgEstimage
                .setPosition(Math.cos(angle) * distFromHero * 3, 24 + Math.sin(angle) * distFromHero * 3)
                .setRotation(angle)
                .setFlipX(tx < this.x)
                .setFlipY(tx < this.x)
                .setText(lowestDmg == highestDmg ? lowestDmg.toString() : `${hpDiv(lowestDmg)} - ${hpDiv(highestDmg)}`)
                .setVisible(true);
        } else {
            this.targetLine.setVisible(false);
            this.targetDmgEstimage.setVisible(false);
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

export function generateRandomHero(): Hero {
    // we want at least one weapon, so make one of lhs or rhs start at 1 instead of 0
    const preferRhs = Phaser.Math.Between(0, 1);
    const rhs = Phaser.Math.Between(preferRhs, 5) as ITEM;
    const lhs = Phaser.Math.Between(preferRhs == 0 ? 1 : 0, 5) as ITEM;
    return {
        lhs: rhs == ITEM.bow ? ITEM.nothing : lhs,
        rhs: (lhs == ITEM.bow && rhs != ITEM.bow) ? ITEM.nothing : rhs,
        helmet: Phaser.Math.Between(0, 2) as ARMOR,
        chest: Phaser.Math.Between(0, 2) as ARMOR,
        skirt: Phaser.Math.Between(0, 2) as ARMOR,
        greaves: Phaser.Math.Between(0, 2) as ARMOR,
    };
}

export function addHeroImages(container: Phaser.GameObjects.Container, hero: Hero, isP2: boolean) {
    console.log(`addHeroImages(${safeJSONString(hero)});`);
    if (hero.lhs == ITEM.bow || hero.rhs == ITEM.bow) {
        container.add(container.scene.add.image(0, 0, 'hero_quiver').setFlipX(isP2));
    }
    container.add(container.scene.add.image(0, 0, 'hero_body').setFlipX(isP2));
    // swap hands if sprite is swapped too
    const lhs = isP2 ? hero.rhs : hero.lhs;
    const rhs = isP2 ? hero.lhs : hero.rhs;
    if (lhs != ITEM.nothing) {
        container.add(container.scene.add.image(0, 0, itemSprite(lhs, false)).setFlipX(isP2));
    }
    if (hero.helmet != ARMOR.nothing) {
        container.add(container.scene.add.image(0, 0, armorSprite(hero.helmet, 'helmet')).setFlipX(isP2));
    }
    if (hero.chest != ARMOR.nothing) {
        container.add(container.scene.add.image(0, 0, armorSprite(hero.chest, 'chest')).setFlipX(isP2));
    }
    if (hero.skirt != ARMOR.nothing) {
        container.add(container.scene.add.image(0, 0, armorSprite(hero.skirt, 'skirt')).setFlipX(isP2));
    }
    if (hero.greaves != ARMOR.nothing) {
        container.add(container.scene.add.image(0, 0, armorSprite(hero.greaves, 'greaves')).setFlipX(isP2));
    }
    container.add(container.scene.add.image(0, 0, 'hero_arm_r').setFlipX(isP2));
    if (rhs != ITEM.nothing) {
        container.add(container.scene.add.image(0, 0, itemSprite(rhs, true)).setFlipX(isP2));
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