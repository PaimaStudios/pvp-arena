import { type PVPArenaDerivedState, type DeployedPVPArenaAPI, PVPArenaProviders } from '@midnight-ntwrk/pvp-api';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE } from '@midnight-ntwrk/pvp-contract';
import { Subscriber, Observable } from 'rxjs';
import { safeJSONString } from '../main';
import { MAX_HP } from './index';
import { generateRandomHero } from './hero';
import { SAT } from 'matter';

const MOCK_DELAY = 500;

export class MockPVPArenaAPI implements DeployedPVPArenaAPI {
    readonly deployedContractAddress: ContractAddress;
    readonly state$: Observable<PVPArenaDerivedState>;
    subscriber: Subscriber<PVPArenaDerivedState> | undefined;
    mockState: PVPArenaDerivedState;
    isP1: boolean;


    constructor(isP1: boolean) {
        this.deployedContractAddress = 'mocked address, do not use';
        this.state$ = new Observable<PVPArenaDerivedState>((subscriber) => {
            this.subscriber = subscriber;
        });
        this.mockState = {
            instance: BigInt(0),
            round: BigInt(0),
            state: GAME_STATE.p1_selecting_first_hero,
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
        this.isP1 = isP1;
        setTimeout(() => {
            this.subscriber?.next(this.mockState);
            if (!isP1) {
                setTimeout(() => {
                    this.mockState = {
                        ...this.mockState,
                        p1Heroes: [generateRandomHero()],
                        state: GAME_STATE.p2_selecting_first_heroes,
                    },
                    this.subscriber?.next(this.mockState);
                }, MOCK_DELAY);
            }
        }, MOCK_DELAY);
    }

    async p1_select_first_hero(first_p1_hero: Hero): Promise<void> {
        if (!this.isP1) {
            throw new Error('Not P1 and p1_select_first_hero() called');
        }
        setTimeout(() => {
            this.mockState = {
                ...this.mockState,
                p1Heroes: [first_p1_hero],
                state: GAME_STATE.p2_selecting_first_heroes,
            };
            this.subscriber?.next(this.mockState);
            // mock p2 select first heroes
            setTimeout(() => {
                this.mockState = {
                    ...this.mockState,
                    p2Heroes: [
                        generateRandomHero(),
                        generateRandomHero(),
                    ],
                    state: GAME_STATE.p1_selecting_last_heroes,
                };
                this.subscriber?.next(this.mockState);
            }, MOCK_DELAY);
        }, MOCK_DELAY)
    }
  
    async p2_select_first_heroes(heroes: Hero[]): Promise<void> {
        if (this.isP1) {
            throw new Error('Not P2 and p2_select_first_heroes() called');
        }
        setTimeout(() => {
            this.mockState = {
                ...this.mockState,
                p2Heroes: heroes,
                state: GAME_STATE.p1_selecting_last_heroes,
            };
            this.subscriber?.next(this.mockState);
            // mock p1 selecting last heroes
            setTimeout(() => {
                this.mockState = {
                    ...this.mockState,
                    p1Heroes: [...this.mockState.p1Heroes, generateRandomHero(), generateRandomHero()],
                    state: GAME_STATE.p2_selecting_last_hero,
                };
                this.subscriber?.next(this.mockState);
            });
        }, MOCK_DELAY)
    }

    async p2_select_last_hero(hero: Hero): Promise<void> {
        if (this.isP1) {
            throw new Error('Not P2 and p2_select_first_heroes() called');
        }
        setTimeout(() => {
            this.mockState = {
                ...this.mockState,
                p2Heroes: [...this.mockState.p2Heroes, hero],
                state: GAME_STATE.p1_commit,
            };
            this.subscriber?.next(this.mockState);
            // also mock out p1 commit
            this.mockP1Commit();
        }, MOCK_DELAY)
    }

    async p1_select_last_heroes(last_p1_heroes: Hero[]): Promise<void> {
        if (!this.isP1) {
            throw new Error('Not P1 and p1_select_last_heroes() called');
        }
        setTimeout(() => {
            this.mockState = {
                ...this.mockState,
                p1Heroes: [...this.mockState.p1Heroes, ...last_p1_heroes],
                state: GAME_STATE.p2_selecting_last_hero,
            };
            this.subscriber?.next(this.mockState);
            // mock select last p2 hero
            setTimeout(() => {
                this.mockState = {
                    ...this.mockState,
                    p2Heroes: [...this.mockState.p2Heroes, generateRandomHero()],
                    state: GAME_STATE.p1_commit,
                };
                this.subscriber?.next(this.mockState);
            }, MOCK_DELAY);
        }, MOCK_DELAY)
    }

    async p1Commit(commands: bigint[], stances: STANCE[]): Promise<void> {
        if (!this.isP1) {
            throw new Error('Not P1 and p1Commit() called');
        }
        console.log(`p1Commit(${safeJSONString(commands)}, ${JSON.stringify(stances)})`);
        setTimeout(() => {
            this.mockState = {
                ...this.mockState,
                p1Cmds: commands,
                p1Stances: stances,
                state: GAME_STATE.p2_commit_reveal,
            };
            this.subscriber?.next(this.mockState);
            this.mockP2Commit();
        }, MOCK_DELAY);
    }

    async p2Commit(commands: bigint[], stances: STANCE[]): Promise<void> {
        if (this.isP1) {
            throw new Error('Not P2 and p2Commit() called');
        }
        console.log(`p2Commit(${safeJSONString(commands)}, ${JSON.stringify(stances)})`);
        setTimeout(() => {
            this.mockState = {
                ...this.mockState,
                p2Cmds: commands,
                p2Stances: stances,
                state: GAME_STATE.p1_reveal,
            };
            this.subscriber?.next(this.mockState);
            // mock p1 reveal
            this.p1Reveal();
        }, MOCK_DELAY);
    }

    async p1Reveal(): Promise<void> {
        setTimeout(() => {
            console.log(`MockState: ${safeJSONString(this.mockState)}`);
            let p1Dmg = this.mockState.p1Dmg;
            let p2Dmg = this.mockState.p2Dmg;
            const p1Alive = this.mockState.p1Dmg.map((hp) => hp < MAX_HP);
            const p2Alive = this.mockState.p2Dmg.map((hp) => hp < MAX_HP);
            for (let i = 0; i < 3; ++i) {
                if (p1Alive[i]) {
                    const p1Cmd = Number(this.mockState.p1Cmds![i]);
                    p2Dmg[p1Cmd] = this.mockState.p2Dmg[p1Cmd] + pureCircuits.calc_item_dmg_against(
                        pureCircuits.calc_stats(this.mockState.p1Heroes[i]),
                        this.mockState.p1Stances[i],
                        pureCircuits.calc_stats(this.mockState.p2Heroes[p1Cmd]),
                        this.mockState.p2Stances[p1Cmd],
                    );
                }
                if (p2Alive[i]) {
                    const p2Cmd = Number(this.mockState.p2Cmds![i]);
                    p1Dmg[p2Cmd] = this.mockState.p1Dmg[p2Cmd] + pureCircuits.calc_item_dmg_against(
                        pureCircuits.calc_stats(this.mockState.p2Heroes[i]),
                        this.mockState.p2Stances[i],
                        pureCircuits.calc_stats(this.mockState.p1Heroes[p2Cmd]),
                        this.mockState.p1Stances[p2Cmd],
                    );
                }
            }
            const allP1Dead = p1Dmg.every((hp) => hp >= BigInt(MAX_HP));
            const allP2Dead = p2Dmg.every((hp) => hp >= BigInt(MAX_HP));
            this.mockState = {
                ...this.mockState,
                state: allP1Dead ? (allP2Dead ? GAME_STATE.tie : GAME_STATE.p2_win) : (allP2Dead ? GAME_STATE.p1_win : GAME_STATE.p1_commit),
                round: this.mockState.round + BigInt(1),
                p1Dmg,
                p2Dmg,
            };
            this.subscriber?.next(this.mockState);
            // mock out p1 commit in case p1Reeal is called mocked out from p2's commands
            if (!this.isP1) {
                this.mockP1Commit();
            }
        }, MOCK_DELAY);
    }
    
    private mockP1Commit() {
        setTimeout(() => {
            // just randomly attack/move
            this.mockState = {
                ...this.mockState,
                p1Cmds: this.mockState.p1Cmds!.map((cmd, i) => {
                    if (this.mockState.p1Dmg[i] < MAX_HP) {
                        const availableTargets = [0, 1, 2].filter((j) => this.mockState.p2Dmg[j] < MAX_HP);
                        const ret = BigInt(availableTargets[Phaser.Math.Between(0, availableTargets.length - 1)]);
                        console.log(`availableTargets(${i}) = ${availableTargets} -> ${ret}`);
                        return ret;
                    }
                    // arbitrary but causes breaking errors early since dead units should never have their commands read
                    return BigInt(1000000);
                }),
                p1Stances: this.mockState.p1Stances.map((stance, i) => {
                    if (this.mockState.p1Dmg[i] < MAX_HP) {
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
                state: GAME_STATE.p2_commit_reveal,
            };
            this.subscriber?.next(this.mockState);
        }, MOCK_DELAY);
    }

    private mockP2Commit() {
        setTimeout(() => {
            // just randomly attack/move
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
    }
}