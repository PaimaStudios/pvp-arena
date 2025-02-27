import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE, TotalStats } from '@midnight-ntwrk/pvp-contract';
import { fontStyle, GAME_HEIGHT, GAME_WIDTH, safeJSONString } from './main';
import { Button } from './menus/button';
import { addHeroImages } from './battle/hero';

function itemToStr(item: ITEM): string {
    switch (item) {
        case ITEM.nothing:
            return 'nothing';
        case ITEM.axe:
            return 'axe';
        case ITEM.shield:
            return 'shield';
        case ITEM.bow:
            return 'bow';
        case ITEM.sword:
            return 'sword';
        case ITEM.spear:
            return 'spear';
    }
}

function armorToStr(armor: ARMOR): string {
    switch (armor) {
        case ARMOR.nothing:
            return 'nothing';
        case ARMOR.leather:
            return 'leather';
        case ARMOR.metal:
            return 'metal';
    }
}

class BalanceHero {
    hero: Hero;
    stats: TotalStats;
    score: number;

    constructor(hero: Hero) {
        this.hero = hero;
        this.stats = pureCircuits.calc_stats(hero);
        this.score = 0;
    }
}

export async function heroBalancing(status: (m: string) => void): Promise<BalanceHero[]> {
    // start with all pairwise
    const items = [ITEM.axe, ITEM.bow, ITEM.nothing, ITEM.shield, ITEM.spear, ITEM.sword];
    const armors = [ARMOR.leather, ARMOR.metal, ARMOR.nothing];
    const heroes = [];
    for (let i = 0; i < items.length; ++i) {
        const lhs = items[i];
        status(`Building heroes (${Math.floor(100 * i / items.length)}%)`);
        for (const rhs of items) {
            if ((lhs == ITEM.shield && rhs == ITEM.shield) ||
                (lhs == ITEM.bow && rhs != ITEM.nothing) ||
                (rhs == ITEM.bow && lhs != ITEM.nothing)) {
                    continue;
            }
            // also we might want to not bloat with 1-handed
            if ((lhs == ITEM.nothing && rhs != ITEM.bow) || (rhs == ITEM.nothing && lhs != ITEM.bow)) {
                continue;
            }
            // de-bloat by not having both A/B and B/A for lhs/rhs
            if (lhs > rhs) {
                continue;
            }
            for (const helmet of armors) {
                for (const chest of armors) {
                    for (const skirt of armors) {
                        for (const greaves of armors) {
                            const hero = {
                                rhs,
                                lhs,
                                helmet,
                                chest,
                                skirt,
                                greaves,
                            };
                            heroes.push(new BalanceHero(hero));
                        }
                    }
                }
            }
        }
    }
    // do report on all
    console.log('BALANCE REPORT (ALL):');
    pairwiseHeroBattleBalancing(heroes, status, 'first pass - all');
    // do report on only best half
    const bestHeroes = heroes
        .sort((a, b) => b.score - a.score)
        .slice(0, heroes.length / 2)
        .map((h) => new BalanceHero(h.hero));
    console.log('BALANCE REPORT (BEST 50%):');
    return new Promise(resolve => setTimeout(resolve, 1337, pairwiseHeroBattleBalancing(bestHeroes, status, 'best half')));
}

export function pairwiseHeroBattleBalancing(heroes: BalanceHero[], status: (m: string) => void, round: string): BalanceHero[] {
    const subStatus = (m: string) => status(`${m} ${round}`);
    for (let i = 0; i < heroes.length; ++i) {
        if (i % 100 == 0)
        subStatus(`Pairwise battling ${Math.floor(100 * i / heroes.length)}%`);
        for (let j = 0; j < i; ++j) {
            let iDmg = 0;
            try {
                iDmg = Number(pureCircuits.calc_item_dmg_against(heroes[i].stats, STANCE.neutral, heroes[j].stats, STANCE.neutral));
            } catch (e) {
                throw new Error(`${e} with \n${safeJSONString(heroes[i].hero)}\n -> \n${safeJSONString(heroes[i].stats)}\n vs ${safeJSONString(heroes[j].hero)}\n -> \n${safeJSONString([heroes[j].stats])}`);
            }
            let jDmg = 0;
            try {
                jDmg = Number(pureCircuits.calc_item_dmg_against(heroes[j].stats, STANCE.neutral, heroes[i].stats, STANCE.neutral));
            } catch (e) {
                throw new Error(`${e} with \n${safeJSONString(heroes[j].hero)}\n -> \n${safeJSONString(heroes[j].stats)}\n vs ${safeJSONString(heroes[i].hero)}\n -> \n${safeJSONString([heroes[i].stats])}`);
            }
            heroes[i].score += iDmg - jDmg;
            heroes[j].score += jDmg - iDmg;
        }
    }
    subStatus('Ranking items');
    // sum all scores across all heroes
    const itemSumScores = new Map<ITEM, number>();
    const armorSumScores = new Map<ARMOR, number>();
    for (const hero of heroes) {
        itemSumScores.set(hero.hero.lhs, (itemSumScores.get(hero.hero.lhs) ?? 0) + hero.score);
        itemSumScores.set(hero.hero.rhs, (itemSumScores.get(hero.hero.rhs) ?? 0) + hero.score);
        armorSumScores.set(hero.hero.helmet, (armorSumScores.get(hero.hero.helmet) ?? 0) + hero.score);
        armorSumScores.set(hero.hero.chest, (armorSumScores.get(hero.hero.chest) ?? 0) + hero.score);
        armorSumScores.set(hero.hero.skirt, (armorSumScores.get(hero.hero.skirt) ?? 0) + hero.score);
        armorSumScores.set(hero.hero.greaves, (armorSumScores.get(hero.hero.greaves) ?? 0) + hero.score);
    }
    const sortedItemSumScores = itemSumScores.entries().toArray().sort((a, b) => a[1] - b[1]);
    const sortedArmorSumScores = armorSumScores.entries().toArray().sort((a, b) => a[1] - b[1]);
    console.log('========= by sums =========');
    for (const itemScore of sortedItemSumScores) {
        console.log(`ITEM ${itemToStr(itemScore[0])} = ${itemScore[1]} | ${Math.log10(Math.abs(itemScore[1]))}`);
    }
    for (const armorScore of sortedArmorSumScores) {
        console.log(`ARMOR ${armorToStr(armorScore[0])} = ${armorScore[1]} | ${Math.log10(armorScore[1])}`);
    }
    // rank heroes by score then rank items based on where they are
    const itemRankScores = new Map<ITEM, number>();
    const itemOccurences = new Map<ITEM, number>();
    const armorRankScores = new Map<ARMOR, number>();
    const armorOccurences = new Map<ARMOR, number>();
    const sortedHeroes = heroes.sort((a, b) => a.score - b.score);
    for (let i = 0; i < sortedHeroes.length; ++i) {
        const hero = sortedHeroes[i];
        itemRankScores.set(hero.hero.lhs, (itemRankScores.get(hero.hero.lhs) ?? 0) + i);
        itemOccurences.set(hero.hero.lhs, (itemOccurences.get(hero.hero.lhs) ?? 0) + 1);
        itemRankScores.set(hero.hero.rhs, (itemRankScores.get(hero.hero.rhs) ?? 0) + i);
        itemOccurences.set(hero.hero.rhs, (itemOccurences.get(hero.hero.rhs) ?? 0) + 1);
        armorRankScores.set(hero.hero.helmet, (armorRankScores.get(hero.hero.helmet) ?? 0) + i);
        armorOccurences.set(hero.hero.helmet, (armorOccurences.get(hero.hero.helmet) ?? 0) + 1);
        armorRankScores.set(hero.hero.chest, (armorRankScores.get(hero.hero.chest) ?? 0) + i);
        armorOccurences.set(hero.hero.chest, (armorOccurences.get(hero.hero.chest) ?? 0) + 1);
        armorRankScores.set(hero.hero.skirt, (armorRankScores.get(hero.hero.skirt) ?? 0) + i);
        armorOccurences.set(hero.hero.skirt, (armorOccurences.get(hero.hero.skirt) ?? 0) + 1);
        armorRankScores.set(hero.hero.greaves, (armorRankScores.get(hero.hero.greaves) ?? 0) + i);
        armorOccurences.set(hero.hero.greaves, (armorOccurences.get(hero.hero.greaves) ?? 0) + 1);
    }
    for (const item of itemRankScores.keys()) {
        itemRankScores.set(item, itemRankScores.get(item)! / itemOccurences.get(item)!);
    }
    for (const armor of armorRankScores.keys()) {
        armorRankScores.set(armor, armorRankScores.get(armor)! / armorOccurences.get(armor)!);
    }
    console.log('========= by rank =========');
    for (const itemScore of sortedItemSumScores) {
        console.log(`ITEM ${itemToStr(itemScore[0])} = ${itemScore[1]} | occur # = ${itemOccurences.get(itemScore[0])!}`);
    }
    for (const armorScore of sortedArmorSumScores) {
        console.log(`ARMOR ${armorToStr(armorScore[0])} = ${armorScore[1]} | occur # = ${armorOccurences.get(armorScore[0])!}`);
    }
    return sortedHeroes;
}

export class BalancingTest extends Phaser.Scene {
    heroes: BalanceHero[];
    page: number;
    text: Phaser.GameObjects.Text | undefined;
    drawn: Phaser.GameObjects.GameObject[];
    status: Phaser.GameObjects.Text | undefined;

    constructor() {
        super('BalancingTest');
        this.heroes = [];
        this.page = 0;
        this.drawn = [];
    }

    preload() {
    }

    create() {
        this.status = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Running tests...').setOrigin(0.5, 0.65);
        this.drawn.push(this.status);

        setTimeout(async () => { heroBalancing((text: string) => {
            if (this.status != undefined) {
                this.status.setText(text);
            }
            console.log(text);
        }).then((heroes) => {
            this.heroes = heroes.reverse();
            this.refresh();
        });
    }, 100);
    }


    private refresh() {
        for (const d of this.drawn) {
            d.destroy();
        }
        this.drawn = [];
        const MAX_COLUMNS = Math.floor(GAME_WIDTH / 64);
        const MAX_ROWS = Math.floor(GAME_HEIGHT / 64);
        console.log(`PAGE SIZE: ${MAX_COLUMNS} x ${MAX_ROWS}`);
        const start = this.page * MAX_COLUMNS * MAX_ROWS;
        const left = Math.min(this.heroes.length - start, MAX_COLUMNS * MAX_ROWS);
        const rows = Math.ceil(left / MAX_COLUMNS);
        for (let r = 0; r < rows; ++r) {
            for (let c = 0; c < MAX_COLUMNS; ++c) {
                const index = start + r * MAX_COLUMNS + c;
                if (index >= this.heroes.length) {
                    break;
                }
                const hero = new Phaser.GameObjects.Container(this, c * 64 + 48, r * 64 + 48);
                this.add.existing(hero);
                addHeroImages(hero, this.heroes[index].hero, false);
                this.drawn.push(hero);
                this.drawn.push(this.add.text(c * 64 + 48, r * 64 + 80, this.heroes[index].score.toString(), fontStyle(8)).setOrigin(0.5, 0.65));
            }
        }
        const pages = Math.ceil(this.heroes.length / (MAX_COLUMNS * MAX_ROWS));
        if (this.page > 0) {
            this.drawn.push(new Button(this, 8, 8, 16, 16, '<', 10, () => {
                --this.page;
                this.refresh();
            }));
        }
        if (this.page >= 5) {
            this.drawn.push(new Button(this, 32, 8, 16, 16, '<<', 10, () => {
                this.page -= 5;
                this.refresh();
            }));
        }
        if (this.page < pages - 1) {
            this.drawn.push(new Button(this, GAME_WIDTH - 8, 8, 16, 16, '>', 10, () => {
                ++this.page;
                this.refresh();
            }));
        }
        if (this.page < pages - 5) {
            this.drawn.push(new Button(this, GAME_WIDTH - 32, 8, 16, 16, '>>', 10, () => {
                this.page += 5;
                this.refresh();
            }));
        }
        this.drawn.push(this.add.text(GAME_WIDTH / 2, 16, `Page ${this.page + 1} / ${pages}`).setOrigin(0.5, 0.65));
    }
}