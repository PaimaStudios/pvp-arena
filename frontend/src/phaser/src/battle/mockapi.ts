import { type PVPArenaDerivedState, type DeployedPVPArenaAPI, PVPArenaProviders, PVPArenaDerivedMatchState, safeJSONString } from '@midnight-ntwrk/pvp-api';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE } from '@midnight-ntwrk/pvp-contract';
import { Subscriber, Observable } from 'rxjs';
import { MAX_HP } from './index';
import { generateRandomHero } from './hero';
import { SAT } from 'matter';

const MOCK_DELAY = 500;
export const OFFLINE_PRACTICE_CONTRACT_ADDR = 'OFFLINE_PRACTICE_CONTRACT_ADDR';

export class MockPVPArenaAPI implements DeployedPVPArenaAPI {
    readonly deployedContractAddress: ContractAddress;
    readonly state$: Observable<PVPArenaDerivedState>;
    subscriber: Subscriber<PVPArenaDerivedState> | undefined;
    matches: Map<bigint, PVPArenaDerivedMatchState>;
    mockState: PVPArenaDerivedState;
    isP1: boolean;
    nextMatch: bigint;
    currentMatchId: bigint | undefined;


    constructor(isP1: boolean) {
        this.deployedContractAddress = OFFLINE_PRACTICE_CONTRACT_ADDR;
        this.state$ = new Observable<PVPArenaDerivedState>((subscriber) => {
            this.subscriber = subscriber;
        });
        this.matches = new Map();
        this.mockState = {
            currentMatch: null,
            myMatches: new Map(),
            openMatches: new Map(),
            currentMatchId: null,
            localPublicKey: null,
            myDelegatedAddress: null,
        };
        this.isP1 = isP1;
        this.nextMatch = BigInt(0);
    }

    async create_new_match(is_match_public: boolean, _is_match_practice?: boolean): Promise<bigint> {
        console.log(`running mockapi: create_new_match`);
        return new Promise((resolve) => {
            setTimeout(() => {
                const matchId = this.nextMatch++;
                this.matches.set(matchId, {
                    round: BigInt(0),
                    state: GAME_STATE.p1_selecting_first_hero,
                    p1Heroes: [],
                    p1Cmds: [BigInt(0), BigInt(0), BigInt(0)],
                    p1Dmg: [BigInt(0), BigInt(0), BigInt(0)],
                    p1Alive: [true, true, true],
                    p1Stances: [STANCE.neutral, STANCE.neutral, STANCE.neutral],
                    p1PubKey: BigInt(0),
                    isP1: this.isP1,
                    isP2: !this.isP1,
                    p2Heroes: [],
                    p2Cmds: [BigInt(0), BigInt(0), BigInt(0)],
                    p2Dmg: [BigInt(0), BigInt(0), BigInt(0)],
                    p2Alive: [true, true, true],
                    p2Stances: [STANCE.neutral, STANCE.neutral, STANCE.neutral],
                    p2PubKey: undefined,
                    nonce: undefined,
                    commit: undefined,
                    secretKey: new Uint8Array(),
                    isPublic: is_match_public,
                    isPractice: true,
                    lastMoveAt: BigInt(0),
                });

                this.mockState.myMatches.set(matchId, this.matches.get(matchId)!);
                this.mockState.currentMatch = this.matches.get(matchId)!;
                this.mockState.currentMatchId = matchId;

                setTimeout(() => {
                    this.subscriber?.next(this.mockState);
                    if (!this.isP1) {
                        setTimeout(() => {
                            this.matches.set(matchId, {
                                ...this.matches.get(matchId)!,
                                p1Heroes: [generateRandomHero()],
                                state: GAME_STATE.p2_selecting_first_heroes,
                            });
                            this.subscriber?.next(this.mockState);
                        }, MOCK_DELAY);
                    }
                }, MOCK_DELAY);

                resolve(matchId);
            });
        });
    }

    async p1_select_first_hero(first_p1_hero: Hero): Promise<void> {
        if (!this.isP1) {
            throw new Error('Not P1 and p1_select_first_hero() called');
        }
        setTimeout(() => {
            this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                p1Heroes: [first_p1_hero],
                state: GAME_STATE.p2_selecting_first_heroes,
            });
            // mock p2 select first heroes
            setTimeout(() => {
                this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                    p2Heroes: [
                        generateRandomHero(),
                        generateRandomHero(),
                    ],
                    state: GAME_STATE.p1_selecting_last_heroes,
                });
            }, MOCK_DELAY);
        }, MOCK_DELAY)
    }
  
    async p2_select_first_heroes(heroes: Hero[]): Promise<void> {
        if (this.isP1) {
            throw new Error('Not P2 and p2_select_first_heroes() called');
        }
        setTimeout(() => {
            this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                p2Heroes: heroes,
                state: GAME_STATE.p1_selecting_last_heroes,
            });

            // mock p1 selecting last heroes
            setTimeout(() => {
                this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                    p1Heroes: [...this.mockState.currentMatch!.p1Heroes, generateRandomHero(), generateRandomHero()],
                    state: GAME_STATE.p2_selecting_last_hero,
                });
            });
        }, MOCK_DELAY)
    }

    async p2_select_last_hero(hero: Hero): Promise<void> {
        if (this.isP1) {
            throw new Error('Not P2 and p2_select_first_heroes() called');
        }
        setTimeout(() => {
            this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                p2Heroes: [...this.mockState.currentMatch!.p2Heroes, hero],
                state: GAME_STATE.p1_commit,
            });
            // also mock out p1 commit
            this.mockP1Commit();
        }, MOCK_DELAY)
    }

    async p1_select_last_heroes(last_p1_heroes: Hero[]): Promise<void> {
        if (!this.isP1) {
            throw new Error('Not P1 and p1_select_last_heroes() called');
        }
        setTimeout(() => {
            this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                p1Heroes: [...this.mockState.currentMatch!.p1Heroes, ...last_p1_heroes],
                state: GAME_STATE.p2_selecting_last_hero,
            });

            // mock select last p2 hero
            setTimeout(() => {
                this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                    p2Heroes: [...this.mockState.currentMatch!.p2Heroes, generateRandomHero()],
                    state: GAME_STATE.p1_commit,
                });
            }, MOCK_DELAY);
        }, MOCK_DELAY)
    }

    async p1Commit(commands: bigint[], stances: STANCE[]): Promise<void> {
        if (!this.isP1) {
            throw new Error('Not P1 and p1Commit() called');
        }
        console.log(`p1Commit(${safeJSONString(commands)}, ${JSON.stringify(stances)})`);
        setTimeout(() => {
            this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                p1Cmds: commands,
                p1Stances: stances,
                state: GAME_STATE.p2_commit_reveal,
            });
            this.mockP2Commit();
        }, MOCK_DELAY);
    }

    async p2Commit(commands: bigint[], stances: STANCE[]): Promise<void> {
        if (this.isP1) {
            throw new Error('Not P2 and p2Commit() called');
        }
        console.log(`p2Commit(${safeJSONString(commands)}, ${JSON.stringify(stances)})`);
        setTimeout(() => {
            this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                p2Cmds: commands,
                p2Stances: stances,
                state: GAME_STATE.p1_reveal,
            });
            // mock p1 reveal
            this.p1Reveal(commands, stances);
        }, MOCK_DELAY);
    }

    async p1Reveal(commands: bigint[], stances: STANCE[]): Promise<void> {
        setTimeout(() => {
            console.log(`MockState: ${safeJSONString(this.mockState)}`);
            let p1Dmg = this.mockState.currentMatch!.p1Dmg;
            let p2Dmg = this.mockState.currentMatch!.p2Dmg;
            const p1Alive = this.mockState.currentMatch!.p1Dmg.map((hp) => hp < MAX_HP);
            const p2Alive = this.mockState.currentMatch!.p2Dmg.map((hp) => hp < MAX_HP);
            for (let i = 0; i < 3; ++i) {
                if (p1Alive[i]) {
                    const p1Cmd = Number(this.mockState.currentMatch!.p1Cmds![i]);
                    p2Dmg[p1Cmd] = this.mockState.currentMatch!.p2Dmg[p1Cmd] + pureCircuits.calc_item_dmg_against(
                        pureCircuits.calc_stats(this.mockState.currentMatch!.p1Heroes[i]),
                        this.mockState.currentMatch!.p1Stances[i],
                        pureCircuits.calc_stats(this.mockState.currentMatch!.p2Heroes[p1Cmd]),
                        this.mockState.currentMatch!.p2Stances[p1Cmd],
                    );
                }
                if (p2Alive[i]) {
                    const p2Cmd = Number(this.mockState.currentMatch!.p2Cmds![i]);
                    p1Dmg[p2Cmd] = this.mockState.currentMatch!.p1Dmg[p2Cmd] + pureCircuits.calc_item_dmg_against(
                        pureCircuits.calc_stats(this.mockState.currentMatch!.p2Heroes[i]),
                        this.mockState.currentMatch!.p2Stances[i],
                        pureCircuits.calc_stats(this.mockState.currentMatch!.p1Heroes[p2Cmd]),
                        this.mockState.currentMatch!.p1Stances[p2Cmd],
                    );
                }
            }
            const allP1Dead = p1Dmg.every((hp) => hp >= BigInt(MAX_HP));
            const allP2Dead = p2Dmg.every((hp) => hp >= BigInt(MAX_HP));
            this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                state: allP1Dead ? (allP2Dead ? GAME_STATE.tie : GAME_STATE.p2_win) : (allP2Dead ? GAME_STATE.p1_win : GAME_STATE.p1_commit),
                round: this.mockState.currentMatch!.round + BigInt(1),
                p1Dmg,
                p2Dmg,
                p1Alive,
                p2Alive,
            });

            // mock out p1 commit in case p1Reeal is called mocked out from p2's commands
            if (!this.isP1) {
                this.mockP1Commit();
            }
        }, MOCK_DELAY);
    }

    async joinMatch(matchId: bigint): Promise<void> {
        return this.setCurrentMatch(matchId);
    }

    async setCurrentMatch(matchId: bigint): Promise<void> {
        this.currentMatchId = matchId;
        this.mockState.currentMatch = this.matches.get(matchId) ?? null;
        this.mockState.currentMatchId = matchId;
        this.subscriber?.next(this.mockState);
    }

    async clearCurrentMatch(): Promise<void> {
        this.currentMatchId = undefined;
        this.mockState = {
            ...this.mockState,
            currentMatch: null,
            currentMatchId: null,
        };
        this.subscriber?.next(this.mockState);
    }

    forceStateRefresh(): void {
        // Mock API emits synchronously via subscriber — no deferred refresh needed.
        this.subscriber?.next(this.mockState);
    }

    async registerDelegation(_walletAddress: bigint): Promise<void> {
        // Not applicable in offline mode
    }

    async claimTimeoutWin(): Promise<void> {
        // Not applicable in offline mode
    }

    async surrender(): Promise<void> {
        const matchId = this.currentMatchId!;
        this.updateMatch({
            ...this.matches.get(matchId)!,
            state: this.isP1 ? GAME_STATE.p2_win : GAME_STATE.p1_win,
        });
    }

    async closeMatch(): Promise<void> {
        const matchId = this.currentMatchId!;
        this.updateMatch({
            ...this.matches.get(matchId)!,
            state: GAME_STATE.tie,
        });
    }

    async cleanupMatch(): Promise<void> {
        const matchId = this.currentMatchId!;
        this.matches.delete(matchId);
        this.currentMatchId = undefined;
        this.mockState = {
            ...this.mockState,
            currentMatch: null,
            currentMatchId: null,
            myMatches: new Map([...this.mockState.myMatches].filter(([id]) => id !== matchId)),
        };
        this.subscriber?.next(this.mockState);
    }
    
    private mockP1Commit() {
        setTimeout(() => {
            // just randomly attack/move
            this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                p1Cmds: this.mockState.currentMatch!.p1Cmds!.map((cmd, i) => {
                    if (this.mockState.currentMatch!.p1Dmg[i] < MAX_HP) {
                        const availableTargets = [0, 1, 2].filter((j) => this.mockState.currentMatch!.p2Dmg[j] < MAX_HP);
                        const ret = BigInt(availableTargets[Phaser.Math.Between(0, availableTargets.length - 1)]);
                        console.log(`availableTargets(${i}) = ${availableTargets} -> ${ret}`);
                        return ret;
                    }
                    // arbitrary but causes breaking errors early since dead units should never have their commands read
                    return BigInt(1000000);
                }),
                p1Stances: this.mockState.currentMatch!.p1Stances.map((stance, i) => {
                    if (this.mockState.currentMatch!.p1Dmg[i] < MAX_HP) {
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
            });
        }, MOCK_DELAY);
    }

    private mockP2Commit() {
        setTimeout(() => {
            // just randomly attack/move
            this.updateMatch({
                ...this.matches.get(this.currentMatchId!)!,
                p2Cmds: this.mockState.currentMatch!.p2Cmds!.map((cmd, i) => {
                    if (this.mockState.currentMatch!.p2Dmg[i] < MAX_HP) {
                        const availableTargets = [0, 1, 2].filter((j) => this.mockState.currentMatch!.p1Dmg[j] < MAX_HP);
                        const ret = BigInt(availableTargets[Phaser.Math.Between(0, availableTargets.length - 1)]);
                        console.log(`availableTargets(${i}) = ${availableTargets} -> ${ret}`);
                        return ret;
                    }
                    // arbitrary but causes breaking errors early since dead units should never have their commands read
                    return BigInt(1000000);
                }),
                p2Stances: this.mockState.currentMatch!.p2Stances.map((stance, i) => {
                    if (this.mockState.currentMatch!.p2Dmg[i] < MAX_HP) {
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
            });
        }, MOCK_DELAY);
    }

    private updateMatch(newState: PVPArenaDerivedMatchState) {
        this.matches.set(this.currentMatchId!, newState);
        this.mockState.myMatches.set(this.currentMatchId!, newState);
        this.mockState.currentMatch = newState;
        this.subscriber?.next(this.mockState);
    }
}