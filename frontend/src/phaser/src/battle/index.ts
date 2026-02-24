import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE } from '@midnight-ntwrk/pvp-contract';
import { Arena } from './arena';
import { fontStyle, GAME_WIDTH } from '../main';

export const MAX_HP = 100000;
export const HP_DIV = 1000;

export function hpDiv(dmg: number): number {
    return Math.floor((dmg / HP_DIV));
}

export class DamageText extends Phaser.GameObjects.Text {
    xSpeed: number;
    ySpeed: number;
    lifetime: number;
    constructor(arena: Arena, x: number, y: number, dmg: number) {
        super(arena, x, y, hpDiv(dmg).toString(), fontStyle(12));
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

export class BloodDrop extends Phaser.GameObjects.Sprite {
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

export class SandKickup extends Phaser.GameObjects.Sprite {
    xPrev: number;
    yPrev: number;
    // moving in 3d space so use our own super-basic physics
    xSpeed: number;
    ySpeed: number;
    zSpeed: number;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, 'dust');//`dust${Phaser.Math.Between(0, 1)}`);
        this.xPrev = x;
        this.yPrev = y;
        const dir = Phaser.Math.Angle.Random();
        const spd = 0.15 + Math.random() * 0.35;
        // probably fine but might need to look at Phaser.Math.SinCosTableGenerator
        this.xSpeed = spd * Math.cos(dir);
        this.ySpeed = spd * Math.sin(dir);
        this.zSpeed = -(Math.random() * 0.9 + 0.3);
        this.angle = Phaser.Math.Angle.Random();
        this.setAlpha(0.3 + 0.3 * Math.random());
    }

    preUpdate() {
        this.x += this.xSpeed;
        this.y += this.ySpeed + this.zSpeed;
        //this.z += this.zSpeed;

        this.rotation = Phaser.Math.Angle.Between(this.xPrev, this.yPrev, this.x, this.y);
        this.xPrev = this.x;
        this.yPrev = this.y;

        if (this.alpha <= 0) {
            this.destroy();
        }
        this.alpha -= 0.03;
    }
}

export type HeroIndex = 0 | 1 | 2;
export type Team = 0 | 1;

export class Rank {
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
        return stanceContribution + (this.team == 0 ? (160 - 4 * this.index) : (GAME_WIDTH - 160 + 4 * this.index));
    }

    y(): number {
        return 140 + 68 * this.index;
    }
}