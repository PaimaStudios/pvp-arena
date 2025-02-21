import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE, TotalStats } from '@midnight-ntwrk/pvp-contract';
import { safeJSONString } from './main';

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

export function heroBalancing() {
    // start with all pairwise
    const items = [ITEM.axe, ITEM.bow, ITEM.nothing, ITEM.shield, ITEM.spear, ITEM.sword];
    const armors = [ARMOR.leather, ARMOR.metal, ARMOR.nothing];
    const heroes = [];
    for (const lhs of items) {
        for (const rhs of items) {
            if ((lhs == ITEM.shield && rhs == ITEM.shield) ||
                (lhs == ITEM.bow && rhs != ITEM.nothing) ||
                (rhs == ITEM.bow && lhs != ITEM.nothing)) {
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
    pairwiseHeroBattleBalancing(heroes);
    // do report on only best half
    const bestHeroes = heroes.sort((a, b) => a.score - b.score).map((h) => new BalanceHero(h.hero)).slice(0, heroes.length / 2);
    console.log('BALANCE REPORT (BEST 50%):');
    pairwiseHeroBattleBalancing(bestHeroes);
}

export function pairwiseHeroBattleBalancing(heroes: BalanceHero[]) {
    for (let i = 0; i < heroes.length; ++i) {
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
        console.log(`ITEM ${itemToStr(itemScore[0])} = ${itemScore[1]} | ${Math.log10(itemScore[1])}`);
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
}