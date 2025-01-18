import { type PVPArenaDerivedState, type DeployedPVPArenaAPI } from '@midnight-ntwrk/pvp-api';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE } from '@midnight-ntwrk/pvp-contract';
import { Subscriber, Observable } from 'rxjs';
import { safeJSONString } from '../main';
import { MAX_HP } from './index';

const MOCK_DELAY = 500;

function generateRandomHero(): Hero {
    return {
        lhs: Phaser.Math.Between(0, 5) as ITEM,
        rhs: Phaser.Math.Between(0, 5) as ITEM,
        helmet: Phaser.Math.Between(0, 2) as ARMOR,
        chest: Phaser.Math.Between(0, 2) as ARMOR,
        skirt: Phaser.Math.Between(0, 2) as ARMOR,
        greaves: Phaser.Math.Between(0, 2) as ARMOR,
    };
}

export class MockPVPArenaAPI implements DeployedPVPArenaAPI {
    readonly deployedContractAddress: ContractAddress;
    readonly state$: Observable<PVPArenaDerivedState>;
    subscriber: Subscriber<PVPArenaDerivedState> | undefined;
    mockState: PVPArenaDerivedState;


    constructor() {
        this.deployedContractAddress = 'mocked address, do not use';
        this.state$ = new Observable<PVPArenaDerivedState>((subscriber) => {
            this.subscriber = subscriber;
        });
        this.mockState = {
            instance: BigInt(0),
            round: BigInt(0),
            state: GAME_STATE.p1_selecting_first_heroes,
            p1Heroes: [],
            p1Cmds: [BigInt(0), BigInt(0), BigInt(0)],
            p1Dmg: [BigInt(0), BigInt(0), BigInt(0)],
            p1Stances: [STANCE.neutral, STANCE.neutral, STANCE.neutral],
            isP1: true,
            p2Heroes: [],
            p2Cmds: [BigInt(0), BigInt(0), BigInt(0)],
            p2Dmg: [BigInt(0), BigInt(0), BigInt(0)],
            p2Stances: [STANCE.neutral, STANCE.neutral, STANCE.neutral],
        };
        setTimeout(() => {
            this.subscriber?.next(this.mockState);
        }, MOCK_DELAY);
    }

    async p1_select_first_heroes(first_p1_heroes: Hero[]): Promise<void> {
        setTimeout(() => {
            this.mockState = {
                ...this.mockState,
                p1Heroes: first_p1_heroes,
                state: GAME_STATE.p2_selecting_heroes,
            };
            this.subscriber?.next(this.mockState);
            // mock p2 select heroes
            setTimeout(() => {
                this.mockState = {
                    ...this.mockState,
                    p2Heroes: [
                        generateRandomHero(),
                        generateRandomHero(),
                        generateRandomHero(),
                    ],
                    state: GAME_STATE.p1_selecting_last_hero,
                };
                this.subscriber?.next(this.mockState);
            }, MOCK_DELAY);
        }, MOCK_DELAY)
    }
  
    async p2_select_heroes(all_p2_heroes: Hero[]): Promise<void> {
        // should never be called (TODO: let you have a p2 testing environment too?)
        throw new Error("do not call this");
    }

    async p1_select_last_hero(last_p1_hero: Hero): Promise<void> {
        setTimeout(() => {
            this.mockState = {
                ...this.mockState,
                p1Heroes: [...this.mockState.p1Heroes, last_p1_hero],
                state: GAME_STATE.p1_commit,
            };
            this.subscriber?.next(this.mockState);
        }, MOCK_DELAY)
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