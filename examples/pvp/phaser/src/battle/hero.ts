import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE } from '@midnight-ntwrk/pvp-contract';
import { safeJSONString, MatchState, fontStyle, GAME_WIDTH, rootObject } from '../main';
import { Arena } from './arena';
import { MAX_HP, Rank, BloodDrop, DamageText, hpDiv } from '.';
import { makeTooltip } from '../menus/tooltip';

const MELEE_ATTACK_TIME = 300;
const BOW_ATTACK_TIME = 1000;
const IDLE_ANIM_TIME = 1000;
const RUN_ANIM_TIME = 1000;

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
    anims: HeroAnimationController;

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

        //addHeroImages(this, hero, isP2);
        this.anims = new HeroAnimationController(this.scene, 0, 0, this.hero, this.rank.team == 1);
        this.add(this.anims);

        this.hpBar = new HpBar(arena, 0, -31, 40);
        this.add(this.hpBar);

        arena.add.existing(this);

        this.setSize(32, 48);
        arena.input.enableDebug(this);
        this.on('pointerup', () => {
            if (this.arena.matchState == MatchState.WaitingOnPlayer) {
                arena.sound.play('select');
                const firstEnemy = this.arena.getAliveHeroes(this.arena.opponentTeam())[0];
                makeTooltip(this.scene, firstEnemy.x, firstEnemy.y - 96, 'Click on an enemy gladiator to target them.', { clickHighlight: new Phaser.Math.Vector2(firstEnemy.x, firstEnemy.y) });
                makeTooltip(this.scene, this.x + 96, this.y + 96, 'Click on the move icons to change stances.', { clickHighlight: new Phaser.Math.Vector2(rootObject(this.left_arrow).x, rootObject(this.left_arrow).y) });
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
                    makeTooltip(this.scene, GAME_WIDTH / 2, 100, 'Confirm a target for your other 2 gladiators and commit your move.');
                }
            }
        });
        const closerTooltip = 'Moving closer increases the damage you deal, but also increases the damage you receive.';
        const furtherTooltip = 'Moving away decreases the damage you receive, but also decreases the damage you deal.'
        this.left_arrow.on('pointerup', () => {
            arena.sound.play('select');
            const leftStance = this.leftStance()!;
            // toggle to undo moving if already in this stance
            this.nextStance = this.nextStance == leftStance ? this.stance : leftStance;
            this.updateNextStanceArrow();
            makeTooltip(this.scene, GAME_WIDTH / 2, 100, this.rank.team == 0 ? furtherTooltip : closerTooltip);
        });
        this.right_arrow.on('pointerup', () => {
            arena.sound.play('select');
            const rightStance = this.rightStance()!;
            this.nextStance = this.nextStance == rightStance ? this.stance : rightStance;
            this.updateNextStanceArrow();
            makeTooltip(this.scene, GAME_WIDTH / 2, 100, this.rank.team == 0 ? closerTooltip : furtherTooltip);
        });
    }

    private leftStance(): STANCE | undefined {
        return this.rank.team == 0 ? furtherStance(this.stance) : closerStance(this.stance);
    }

    private rightStance(): STANCE | undefined {
        return this.rank.team == 0 ? closerStance(this.stance) : furtherStance(this.stance);
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

        this.arena.add.existing(new DamageText(this.arena, this.x, this.y - 24, dmg));

        this.uiDmg = Math.min(MAX_HP, this.uiDmg + dmg);
        this.updateHpBar();
        if (this.isAlive()) {
            return false;
        }
        return true;
    }

    public onTurnEnd() {
        if (this.uiDmg != Math.min(MAX_HP, this.realDmg)) {
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
        //console.log(`isAlive(${this.rank.team}, ${this.rank.index}) => ${this.preTurnDmg < MAX_HP} | ${this.preTurnDmg, this.uiDmg, this.realDmg}`);
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
        const leftStance = this.leftStance();
        if (leftStance == undefined) {
            this.left_arrow.visible = false;
        } else {
            this.left_arrow.visible = true;
            if (this.nextStance == leftStance) {
                this.left_arrow.setAlpha(1).setScale(1, 1);
            } else {
                this.left_arrow.setAlpha(0.75).setScale(0.5, 0.5);
            }
        }
        const rightStance = this.rightStance();
        if (rightStance == undefined) {
            this.right_arrow.visible = false;
        } else {
            this.right_arrow.visible = true;
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

        if (this.arena.matchState == MatchState.WaitingOnPlayer && target != undefined && this.arena.getAliveHeroes(this.arena.playerTeam()).every((h) => h.targetLine.visible)) {
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

        if (this.leftStance() != undefined) {
            this.left_arrow.setInteractive({useHandCursor: true});
            this.left_arrow.visible = true;
        }
        if (this.rightStance() != undefined) {
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

    public attackTween(tweens: Phaser.Types.Tweens.TweenBuilderConfig[]) {
        // can't use hero.x / enemy.x etc since those aren't where they'll be after they move to their new stance
        const heroX = this.rank.x(this.nextStance);
        const heroY = this.rank.y(); // technically the same right now but could be different in the future
        const enemy = this.arena.heroes[this.target!.team][this.target!.index];
        const enemyX = enemy.rank.x(enemy.nextStance);
        const enemyY = enemy.rank.y();
        const dist = (new Phaser.Math.Vector2(heroX, heroY)).distance(new Phaser.Math.Vector2(enemyX, enemyY));
        // get rid of line/prepare delay
        tweens.push({
            targets: this,
            duration: 150,
            onComplete: () => {
                // get rid of line before attack
                this.setTarget(undefined);
                if (this.hero.lhs == ITEM.bow) {
                    this.anims.lhsAttack();
                }
                if (this.hero.rhs == ITEM.bow) {
                    this.anims.rhsAttack();
                }
            },
        });
        if (this.hero.lhs == ITEM.bow || this.hero.rhs == ITEM.bow) {
            // bow attack
            const arrow = this.arena.add.image(heroX, heroY, 'arrow')
                .setVisible(false)
                .setRotation(Phaser.Math.Angle.Between(heroX, heroY, enemyX, enemyY));
            tweens.push({
                targets: arrow,
                duration: dist * 2,
                // start arrow on frame 4 of the animation
                delay: (4/6) * BOW_ATTACK_TIME,
                x: enemyX,
                y: enemyY,
                onStart: () => {
                    arrow.visible = true;
                },
                onComplete: () => {
                    this.anims.idle();
                    arrow.destroy();
                },
            });
        } else {
            const meleeAttackX = this.target!.x(this.arena.getHero(this.target!).nextStance) + (this.rank.team == 0 ? -32 : 32);
            const meleeAttackY = enemyY;
            // move to enemy
            tweens.push({
                targets: this,
                ease: 'Quad.easeInOut',
                x: meleeAttackX,
                y: meleeAttackY,
                duration: 40 + dist * 2,
                onStart: () => {
                    this.arena.sound.play('move');
                    this.anims.run();
                },
            });
            // melee attacks
            if (this.anims.lhsAttackAnim != undefined) {
                tweens.push({
                    targets: this,
                    x: meleeAttackX,
                    y: meleeAttackY,
                    delay: 100,
                    duration: MELEE_ATTACK_TIME / 2,
                    onStart: () => {
                        this.anims.lhsAttack();
                    },
                });
            }
            if (this.anims.rhsAttackAnim != undefined) {
                tweens.push({
                    targets: this,
                    x: meleeAttackX,
                    y: meleeAttackY,
                    delay: this.anims.lhsAttackAnim != undefined ? MELEE_ATTACK_TIME / 2 : 100,
                    duration: MELEE_ATTACK_TIME / 2,
                    onStart: () => {
                        this.anims.rhsAttack();
                    },
                });
            }
        }
        // enemy knockback
        const angle = Phaser.Math.Angle.Between(heroX, heroY, enemyX, enemyY);
        tweens.push({
            targets: enemy,
            x: enemyX + Math.cos(angle) * 16,
            y: enemyY + Math.sin(angle) * 16,
            alpha: 0.4,
            duration: 50,
            onStart: () => {
                const stance_strs = ['def', 'neu', 'atk'];
                for (let hero_stance = 0; hero_stance < 3; ++hero_stance) {
                    for (let enemy_stance = 0; enemy_stance < 3; ++enemy_stance) {
                        const dmg = pureCircuits.calc_item_dmg_against(pureCircuits.calc_stats(this.hero), hero_stance as STANCE, pureCircuits.calc_stats(enemy.hero), enemy_stance as STANCE);
                        console.log(`dmg [${stance_strs[hero_stance]}] -> [${stance_strs[enemy_stance]}] = ${hpDiv(Number(dmg))}`);
                    }
                }
                const dmg = pureCircuits.calc_item_dmg_against(pureCircuits.calc_stats(this.hero), this.nextStance, pureCircuits.calc_stats(enemy.hero), enemy.nextStance);
                if (enemy.attack(this, Number(dmg))) {
                    // TODO: death anim? or this is resolved after?
                }
            },
        });
        tweens.push({
            targets: enemy,
            x: enemyX,
            y: enemyY,
            alpha: 1,
            duration: 80,
        });
        if (this.hero.lhs != ITEM.bow && this.hero.rhs != ITEM.bow) {
            // move back
            tweens.push({
                targets: this,
                ease: 'Quad.easeInOut',
                x: this.rank.x(this.nextStance),
                y: this.y,
                duration: 60 + dist * 3,
                onStart: () => {
                    // disabled because it sounds weird right after the damage sound
                    //this.sound.play('move');
                    this.anims.run();
                    this.anims.setFlipX(this.rank.team == 0);
                },
                onComplete: (tween) => {
                    console.log(`tween.targets = ${JSON.stringify(tween.targets)}`);
                    console.log(`completed tween [${this.rank.team}][${this.rank.index}]`);
                    this.anims.idle();
                    this.anims.setFlipX(this.rank.team == 1);
                },
                persist: false,
            });
        }
    }
}

function furtherStance(stance: STANCE): STANCE | undefined {
    switch (stance) {
        case STANCE.aggressive:
            return STANCE.neutral;
        case STANCE.neutral:
            return STANCE.defensive;
        case STANCE.defensive:
            return undefined;
    }
}

function closerStance(stance: STANCE): STANCE | undefined {
    switch (stance) {
        case STANCE.aggressive:
            return undefined;
        case STANCE.neutral:
            return STANCE.aggressive;
        case STANCE.defensive:
            return STANCE.neutral;
    }
}

export function generateRandomHero(): Hero {
    // avoid useless things like double shields, unarmed, etc
    const rightHanded = Phaser.Math.Between(0, 1) == 0;
    const mainWeapons = [ITEM.axe, ITEM.bow, ITEM.spear, ITEM.sword];
    const mainWeapon = mainWeapons[Phaser.Math.Between(0, 3)];
    const secondaryWeapons = [ITEM.axe, ITEM.shield, ITEM.spear, ITEM.sword];
    const secondaryWeapon = mainWeapon == ITEM.bow ? ITEM.nothing : secondaryWeapons[Phaser.Math.Between(0, 3)];
    return {
        lhs: rightHanded ? secondaryWeapon : mainWeapon,
        rhs: rightHanded ? mainWeapon : secondaryWeapon,
        helmet: Phaser.Math.Between(0, 2) as ARMOR,
        chest: Phaser.Math.Between(0, 2) as ARMOR,
        skirt: Phaser.Math.Between(0, 2) as ARMOR,
        greaves: Phaser.Math.Between(0, 2) as ARMOR,
    };
}



type PositionalAnimation = {
    image: Phaser.GameObjects.Image,
    offset: Phaser.Math.Vector2[],
};

type AnimatedLayer = {
    sprite: Phaser.GameObjects.Sprite,
    animKey: string,
};

type HeroAnimationConfig = {
    key: string,
    lhs?: Phaser.Math.Vector2[],
    rhs?: Phaser.Math.Vector2[],
    helmet: Phaser.Math.Vector2[],
    chest: Phaser.Math.Vector2[],
    skirt?: Phaser.Math.Vector2[] | undefined,
    greaves?: Phaser.Math.Vector2[] | undefined,
};

function attackAnimConfig(rhs: boolean, item: ITEM): HeroAnimationConfig | undefined {
    const side = (base: string) => `${base}_${rhs ? 'r' : 'l'}`;
    switch (item) {
        case ITEM.bow:
            return {
                key: side('bow_attack'),
                helmet: [],
                chest: [],
            };
        case ITEM.spear:
            return {
                key: side('attack_thrust'),
                helmet: [],
                chest: [],
                rhs: rhs ? [new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(-2, 1), new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(3, -1)] : undefined,
                lhs: rhs ? undefined : [new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(-2, 1), new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(3, -1)],
            };
        case ITEM.axe:
        case ITEM.sword:
            return {
                key: side('attack_swing'),
                helmet: [],
                chest: [],
            };

    }
    return undefined;
}

export class HeroAnimationController extends Phaser.GameObjects.Container {
    idleAnim: HeroAnimation;
    runAnim: HeroAnimation;
    lhsAttackAnim: HeroAnimation | undefined;
    rhsAttackAnim: HeroAnimation | undefined;

    constructor(scene: Phaser.Scene, x: number, y: number, hero: Hero, isP2: boolean) {
        super(scene, x, y);

        this.idleAnim = new HeroAnimation(scene, 0, 0, hero, isP2, {
            key: 'idle',
            lhs: [new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(0, 2)],
            rhs: [new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(-1, 1)],
            helmet: [new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(0, 1)],
            chest: [new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(0, 1)],
            skirt: [new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(0, 1)],
        });
        this.add(this.idleAnim);

        this.runAnim = new HeroAnimation(scene, 0, 0, hero, isP2, {
            key: 'run',
            lhs: [new Phaser.Math.Vector2(-12, 9), new Phaser.Math.Vector2(-9, 9), new Phaser.Math.Vector2(-3, 6), new Phaser.Math.Vector2(-3, 8), new Phaser.Math.Vector2(-6, 9), new Phaser.Math.Vector2(-11, 8)],
            rhs: [new Phaser.Math.Vector2(4, 0), new Phaser.Math.Vector2(1, 2), new Phaser.Math.Vector2(-2, 5), new Phaser.Math.Vector2(-8, 5), new Phaser.Math.Vector2(-2, 4), new Phaser.Math.Vector2(0, 2)],
            helmet: [new Phaser.Math.Vector2(1, 0), new Phaser.Math.Vector2(0, 2), new Phaser.Math.Vector2(0, 3), new Phaser.Math.Vector2(1, 0), new Phaser.Math.Vector2(0, 2), new Phaser.Math.Vector2(0, 1)],
            chest: [new Phaser.Math.Vector2(1, 0), new Phaser.Math.Vector2(0, 1), new Phaser.Math.Vector2(0, 3), new Phaser.Math.Vector2(1, 0), new Phaser.Math.Vector2(0, 1), new Phaser.Math.Vector2(0, 1)],
        });
        this.add(this.runAnim);

        const lhsConfig = attackAnimConfig(false, hero.lhs);
        if (lhsConfig != undefined) {
            console.log(`lhsConfig: ${JSON.stringify(lhsConfig)}`);
            this.lhsAttackAnim = new HeroAnimation(scene, 0, 0, hero, isP2, lhsConfig);
            this.add(this.lhsAttackAnim);
        }
        
        const rhsConfig = attackAnimConfig(true, hero.rhs);
        if (rhsConfig != undefined) {
            console.log(`rhsConfig: ${JSON.stringify(rhsConfig)}`);
            this.rhsAttackAnim = new HeroAnimation(scene, 0, 0, hero, isP2, rhsConfig);
            this.add(this.rhsAttackAnim);
        }

        this.idle();

        this.setFlipX(isP2);


        this.addToUpdateList();
    }

    // it sure would be nice if Container just had this....
    public setFlipX(flipped: boolean) {
        this.idleAnim.setFlipX(flipped);
        this.runAnim.setFlipX(flipped);
        this.lhsAttackAnim?.setFlipX(flipped);
        this.rhsAttackAnim?.setFlipX(flipped);
    }

    public idle() {
        this.runAnim.visible = false;
        this.idleAnim.visible = true;
        this.lhsAttackAnim?.setVisible(false);
        this.rhsAttackAnim?.setVisible(false);
        this.idleAnim.play(Phaser.Math.Between(IDLE_ANIM_TIME * 0.9, IDLE_ANIM_TIME * 1.1));
    }

    public run() {
        this.runAnim.visible = true;
        this.idleAnim.visible = false;
        this.lhsAttackAnim?.setVisible(false);
        this.rhsAttackAnim?.setVisible(false);
        this.runAnim.play();
    }

    public lhsAttack() {
        this.runAnim.visible = false;
        this.idleAnim.visible = false;
        this.lhsAttackAnim!.visible = true;
        this.rhsAttackAnim?.setVisible(false);
        this.lhsAttackAnim?.play();
    }

    public rhsAttack() {
        this.runAnim.visible = false;
        this.idleAnim.visible = false;
        this.rhsAttackAnim!.visible = true;
        this.lhsAttackAnim?.setVisible(false);
        this.rhsAttackAnim?.play();
    }

    preUpdate() {
        // why isn't this called?
        this.idleAnim.preUpdate();
        this.runAnim.preUpdate();
        this.lhsAttackAnim?.preUpdate();
        this.rhsAttackAnim?.preUpdate();
    }
}

// managed Hero animations/graphics
// we don't just use the phaser animations to a void a bunch of animation art work
// and instead just use positional offsets for most layers to avoid re-drawing
// or positioning every single one for every single animation frame in aesprite
export class HeroAnimation extends Phaser.GameObjects.Container {
    animated: AnimatedLayer[];
    positionChanging: PositionalAnimation[];

    constructor(scene: Phaser.Scene, x: number, y: number, hero: Hero, isP2: boolean, config: HeroAnimationConfig) {
        super(scene, x, y);
        this.animated = [];
        this.positionChanging = [];
        if (hero.lhs == ITEM.bow || hero.rhs == ITEM.bow) {
            const image = scene.add.image(0, 0, 'hero_quiver');
            this.positionChanging.push({
                image,
                offset: config.chest ?? config.helmet ?? [],
            });
            this.add(image);
        }
        if (hero.lhs != ITEM.nothing) {
            this.addLayer(config, 'lhs', itemSprite(hero.lhs, false));
        }
        this.addAnimated(config, 'hero_body');
        if (hero.helmet != ARMOR.nothing) {
            this.addLayer(config, 'helmet', armorSprite(hero.helmet, 'helmet'));
        }
        if (hero.chest != ARMOR.nothing) {
            this.addLayer(config, 'chest', armorSprite(hero.chest, 'chest'));
        }
        if (hero.skirt != ARMOR.nothing) {
            this.addLayer(config, 'skirt', armorSprite(hero.skirt, 'skirt'));
        }
        if (hero.greaves != ARMOR.nothing) {
            this.addLayer(config, 'greaves', armorSprite(hero.greaves, 'greaves'));
        }
        if (hero.rhs == ITEM.shield) {
            this.addAnimated(config, 'hero_arm_r');
        }
        if (hero.rhs != ITEM.nothing) {
            this.addLayer(config, 'rhs', itemSprite(hero.rhs, true));
        }
        if (hero.rhs != ITEM.shield) {
            this.addAnimated(config, 'hero_arm_r');
        }
    }

    public setFlipX(flipped: boolean) {
        for (const layer of this.animated) {
            layer.sprite.setFlipX(flipped);
        }
        for (const layer of this.positionChanging) {
            layer.image.setFlipX(flipped);
        }
    }

    public play(duration?: number) {
        for (const layer of this.animated) {
            layer.sprite.anims.play({
                key: layer.animKey,
                duration,
            });
        }
    }

    private addAnimated(config: HeroAnimationConfig, name: string) {
        const animKey = `${name}_${config.key}`;
        if (this.scene.textures.exists(animKey)) {
            const sprite = this.scene.add.sprite(0, 0, animKey);
            this.add(sprite);
            this.animated.push({ sprite, animKey });
        } else {
            const image = this.scene.add.image(0, 0, name);
            this.positionChanging.push({
                image,
                offset: [],
            });
            this.add(image);
        }
    }

    private addLayer(config: HeroAnimationConfig, key: keyof HeroAnimationConfig, name: string) {
        const offset = config[key] as Phaser.Math.Vector2[] | undefined;
        const animTexture = `${name}_${config.key}`;
        if (this.scene.textures.exists(animTexture)) {
            this.addAnimated(config, name);
        } else {
            const image = this.scene.add.image(0, 0, name);
            this.positionChanging.push({
                image,
                offset: offset ?? [],
            });
            this.add(image);
        }
    }

    preUpdate() {
        if (this.animated[0].sprite.anims.currentFrame != undefined) {
            for (const layer of this.positionChanging) {
                if (layer.offset.length != 0) {
                    const index = this.animated[0].sprite.anims.currentFrame!.index - 1;
                    const pos = layer.offset[index];
                    if (pos != undefined) {
                        layer.image.setPosition(layer.image.flipX ? -pos.x : pos.x, pos.y);
                    }
                }
            }
        }
    }
}

export function createHeroAnims(scene: Phaser.Scene) {
    // it doesn't seem like we can re-use an animation for a separate sprites
    // so create 1 per layer
    const layers = ['body'];
    for (const side of ['r', 'l']) {
        for (const part of ['arm', 'bow', 'sword', 'axe', 'spear', 'shield']) {
            layers.push(`${part}_${side}`);
        }
    }
    for (const mat of ['leather', 'metal']) {
        for (const part of ['helmet', 'chest', 'skirt', 'greaves']) {
            layers.push(`${part}_${mat}`);
        }
    }
    for (const layer of layers) {
        const idleKey = `hero_${layer}_idle`;
        if (scene.textures.exists(idleKey)) {
            scene.anims.create({
                key: idleKey,
                frames: [0, 1].map((i) => { return { frame: i, key: idleKey }; }),
                repeat: -1,
                duration: IDLE_ANIM_TIME,
            });
        }
        const runKey = `hero_${layer}_run`;
        if (scene.textures.exists(runKey)) {
            scene.anims.create({
                key: runKey,
                frames: [0, 1, 2, 3, 4, 5].map((i) => { return { frame: i, key: runKey }; }),
                repeat: -1,
                duration: RUN_ANIM_TIME,
            });
        }
        for (const side of ['r', 'l']) {
            const bowAttackKey = `hero_${layer}_bow_attack_${side}`;
            if (scene.textures.exists(bowAttackKey)) {
                scene.anims.create({
                    key: bowAttackKey,
                    frames: [0, 1, 2, 3, 4, 5].map((i) => { return { frame: i, key: bowAttackKey }; }),
                    repeat: 1,
                    duration: BOW_ATTACK_TIME,
                });
            }
            const thrustAttackKey = `hero_${layer}_attack_thrust_${side}`;
            if (scene.textures.exists(thrustAttackKey)) {
                scene.anims.create({
                    key: thrustAttackKey,
                    frames: [0, 1, 2].map((i) => { return { frame: i, key: thrustAttackKey }; }),
                    repeat: 1,
                    duration: MELEE_ATTACK_TIME,
                });
            }
            const swingAttackKey = `hero_${layer}_attack_swing_${side}`;
            if (scene.textures.exists(swingAttackKey)) {
                scene.anims.create({
                    key: swingAttackKey,
                    frames: [0, 1, 2].map((i) => { return { frame: i, key: swingAttackKey }; }),
                    repeat: 1,
                    duration: MELEE_ATTACK_TIME,
                });
            }
        }
    }
}

export function addHeroImages(container: Phaser.GameObjects.Container, hero: Hero, isP2: boolean) {
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