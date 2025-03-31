import '@midnight-ntwrk/dapp-connector-api';
import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE } from '@midnight-ntwrk/pvp-contract';
import { type PVPArenaDerivedState, type DeployedPVPArenaAPI } from '@midnight-ntwrk/pvp-api';
import 'phaser';
import RexUIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin'
import { GAME_WIDTH, GAME_HEIGHT, gameStateStr, safeJSONString, MatchState, fontStyle, makeCopyAddressButton, makeExitMatchButton, makeSoundToggleButton, playSound } from '../main';
import { HeroActor } from './hero';
import { HeroIndex, hpDiv, Rank, Team } from './index';
import { Button } from '../menus/button';
import { init } from 'fp-ts/lib/ReadonlyNonEmptyArray';
import { closeTooltip, makeTooltip, TooltipId } from '../menus/tooltip';
import { makeCopyAddressButton, makeExitMatchButton } from '../menus/equipment';
import { OFFLINE_PRACTICE_CONTRACT_ADDR } from './mockapi';
import { Subscription } from 'rxjs';
import { StatusUI } from '../menus';

export type BattleConfig = {
    isP1: boolean,
    api: DeployedPVPArenaAPI,
};

export class Arena extends Phaser.Scene
{
    heroes: HeroActor[][];
    selected: HeroActor | undefined;
    // this is undefined in testing battles (offline) only, will always be defined in real battles (on-chain)
    config: BattleConfig;
    // we store the initial on-chain state as there won't be any state changes to trigger onStateChange
    // and also we must wait until create() is called to actually have Phaser things be created to apply this state
    initialState: PVPArenaDerivedState;
    onChainState: GAME_STATE;
    matchState: MatchState;
    status: StatusUI | undefined;
    round: number;
    submitButton: Button | undefined;
    subscription: Subscription | undefined;

    constructor(config: BattleConfig, initialState: PVPArenaDerivedState) {
        super('Arena');
        this.heroes = [];
        this.selected = undefined;
        this.config = config;
        this.initialState = initialState;
        this.onChainState = GAME_STATE.p1_commit;
        this.matchState = MatchState.Initializing;
        this.round = 0;
        this.submitButton = undefined;
    }

    preDestroy() {
        this.subscription?.unsubscribe();
    }

    playerTeam(): Team {
        return this.config.isP1 ? 0 : 1;
    }

    opponentTeam(): Team {
        return this.config.isP1 ? 1 : 0;
    }

    setMatchState(state: MatchState) {
        this.matchState = state;
        switch (state) {
            case MatchState.Initializing:
                this.status?.setText('Initializing...');
                break;
            case MatchState.WaitingOnPlayer:
                this.status?.setText('Make your move');
                for (const hero of this.getAliveHeroes(this.playerTeam())) {
                    hero.setInteractive({useHandCursor: true});
                }
                const firstHero = this.getAliveHeroes(this.playerTeam())[0];
                makeTooltip(this, firstHero.x, firstHero.y - 96, TooltipId.SelectHero, { clickHighlights: [new Phaser.Math.Vector2(firstHero.x, firstHero.y)] });
                break;
            case MatchState.WaitingOnOpponent:
                this.status?.setText('Waiting on opponent (submit)...');
                break;
            case MatchState.SubmittingMove:
                this.status?.setText('Submitting move...');
                this.selected?.deselect();
                this.selected = undefined;
                for (const hero of this.getAliveHeroes(this.playerTeam())) {
                    hero.disableInteractive();
                }
                break;
            case MatchState.RevealingMove:
                this.status?.setText('Revealing move...');
                break;
            case MatchState.WaitingOtherPlayerReveal:
                this.status?.setText('Waiting on opponent (reveal)...');
                break;
            case MatchState.CombatResolving:
                this.status?.setText('Battle!');
                break;
            case MatchState.GameOverP1Win:
                if (this.config.isP1) {
                    playSound(this, 'win');
                    this.displayEndMatchText('You won!');
                } else {
                    playSound(this, 'lose');
                    this.displayEndMatchText('Opponent\nwon!');
                }
                break;
            case MatchState.GameOverP2Win:
                if (this.config.isP1) {
                    playSound(this, 'lose');
                    this.displayEndMatchText('Opponent\nwon!');
                } else {
                    playSound(this, 'win');
                    this.displayEndMatchText('You won!');
                }
                break;
            case MatchState.GameOverTie:
                playSound(this, 'select'); // wasn't sure what to play, it's unlikely anyway
                this.displayEndMatchText('Battle tied!');
                break;
        }
    }

    displayEndMatchText(message: string) {
        this.status?.clearStatusText();
        this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.4, message, fontStyle(64, { align: 'center' })).setOrigin(0.5, 0.65);
        new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.9, 128, 32, 'Main Menu', 18, () => {
            this.scene.start('MainMenu');
            this.scene.remove('Arena');
        });
    }

    private createHeroes(state: PVPArenaDerivedState) {
        // create heroes initially
        if (this.heroes.length == 0) {
            for (let team = 0; team < 2; ++team) {
                let hero_actors = [];
                for (let i = 0; i < 3; ++i) {
                    const rank = new Rank(i as HeroIndex, team as Team);
                    // TODO: how to do these loops so typescript knows that team/i are 0-1 and 0-2?
                    hero_actors.push(new HeroActor(this, team == 0 ? state.p1Heroes[i] : state.p2Heroes[i], rank));
                }
                this.heroes.push(hero_actors);
            }
        }
    }

    onStateChange(state: PVPArenaDerivedState) {
        console.log(`new state: ${safeJSONString(state)}`);
        console.log(`NOW: ${gameStateStr(state.state)}`);

        if (state.state == GAME_STATE.p1_selecting_first_hero || state.state == GAME_STATE.p2_selecting_first_heroes || state.state == GAME_STATE.p1_selecting_last_heroes || state.state == GAME_STATE.p2_selecting_last_hero) {
            // for some reason we're getting updates here using old state that we can ignore
            // it calls onStateChange for every state update that had previously happened on the equipment screen
            return;
        }

        this.createHeroes(state);

        // update commands/stances/damages
        if (state.p1Cmds != undefined && state.p2Cmds != undefined/* && (state.state == GAME_STATE.p1_commit)*/) {
            console.log(`***** UPDATING CMDS ****`);
            const newTargets = [
                state.p1Cmds.map(Number),
                state.p2Cmds.map(Number)
            ];
            for (let team = 0; team < 2; ++team) {
                const heroes = team == 0 ? state.p1Heroes : state.p2Heroes;
                const dmgs = team == 0 ? state.p1Dmg : state.p2Dmg;
                const stances = team == 0 ? state.p1Stances : state.p2Stances;
                for (let i = 0; i < 3; ++i) {
                    const hero = this.heroes[team][i];
                    // update damage now, but no graphical effect shown
                    hero.realDmg = Number(dmgs[i]);
                    //if ((i == 0 && state.state == GAME_STATE.p1_commit) || (i == 1 && state.state == GAME_STATE.p1_reveal)) {
                    if (team != this.playerTeam()) {
                        hero.nextStance = stances[i];
                        hero.target = new Rank(newTargets[team][i] as HeroIndex, team == 0 ? 1 : 0);
                    }
                }
            }
        }
        
        // TODO: it's weird we have both this and the combat animations to control MatchState
        // we should consolidate this
        this.onChainState = state.state;

        if (this.round < state.round) {
            this.runCombatAnims();
            this.round = Number(state.round);
        } else {
            this.runStateChange();
        }
    }

    runStateChange() {
        switch (this.onChainState) {
            case GAME_STATE.p1_commit:
                this.setMatchState(this.config.isP1 ? MatchState.WaitingOnPlayer : MatchState.WaitingOnOpponent);
                break;
            case GAME_STATE.p2_commit_reveal:
                this.setMatchState(this.config.isP1 ? MatchState.WaitingOnOpponent : MatchState.WaitingOnPlayer);
                break;
            case GAME_STATE.p1_reveal:
                if (this.config.isP1) {
                    console.log('revealing move (as p1)');
                    this.setMatchState(MatchState.RevealingMove);
                    this.config.api.p1Reveal(this.movesForContract(), this.stancesForContract())
                        .catch((e) => {
                            // just re-try
                            this.status!.setError(e, () => this.runStateChange(), 'Retry');
                        });
                } else {
                    this.setMatchState(MatchState.WaitingOtherPlayerReveal);
                }
                break;
            case GAME_STATE.p1_win:
                this.setMatchState(MatchState.GameOverP1Win);
                break;
            case GAME_STATE.p2_win:
                this.setMatchState(MatchState.GameOverP2Win);
                break;
            case GAME_STATE.tie:
                this.setMatchState(MatchState.GameOverTie);
                break;
        }
    }

    runCombatAnims() {
        this.setMatchState(MatchState.CombatResolving);
        const tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
        // stance change tweens
        const aliveUnits = this.getAllAliveUnits();
        for (const hero of aliveUnits) {
            if (hero.stance != hero.nextStance) {
                tweens.push({
                    targets: hero,
                    delay: 150,
                    duration: 350,
                    ease: 'Linear',
                    x: hero.rank.x(hero.nextStance),
                    onStart: () => {
                        playSound(this, 'move');
                        // TODO: put in function
                        hero.left_arrow.visible = false;
                        hero.right_arrow.visible = false;
                        hero.anims.run();
                        hero.anims.setFlipX(hero.rank.x(hero.nextStance) < hero.x);
                    },
                    onComplete: () => {
                        hero.stance = hero.nextStance;
                        hero.anims.idle();
                        hero.anims.setFlipX(hero.rank.team == 1);
                        // TODO: smarter way
                        for (const h of this.getAllAliveUnits()) {
                            h.updateTargetLine();
                        }
                    },
                });
            }
        }
        tweens.push({
            targets: null,
            duration: 3000,
        });

        // attack tweens
        for (const hero of aliveUnits) {
            hero.attackTween(tweens);
        }
        tweens.push({
            targets: null,
            onComplete: () => {
                // const deadUnits = aliveUnits.filter((h) => !h.isAlive());
                // this.tweens.add({
                //     targets: deadUnits,
                //     alpha: 0,
                //     onComplete: (_tween: Phaser.Tweens.Tween, targets: HeroActor[]) => {
                //         for (let target of targets) {
                //             target.visible = false;
                //             this.add.image(target.x, target.y, 'skull').setFlipX(target.rank.team == 1).setDepth(-1);
                //         }
                //     },
                // });
                this.getAllAliveUnits().forEach((h) => h.onTurnEnd());

                this.runStateChange();
            }
        });
        this.tweens.chain({
            // this doesn't seem to do anything (always overridden?) but if you pass null it errors
            targets: this.heroes[0],
            tweens,
        });
    }

    preload() {
        this.load.setBaseURL('/');

        this.load.image('arena_bg', 'arena_bg.png');

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

        this.load.image('hp_bar_back', 'hp_bar_back.png');
        this.load.image('hp_bar_side', 'hp_bar_side.png');
        this.load.image('hp_bar_middle', 'hp_bar_middle.png');

        this.load.image('arrow_move', 'arrow_move.png');
        this.load.image('arrow_attack', 'arrow_attack4.png');
        this.load.image('select_circle', 'select_circle.png');

        this.load.image('arrow', 'arrow.png');
        this.load.image('skull', 'skull.png');
        this.load.image('blood_drop0', 'blood_drop0.png');
        this.load.image('blood_drop1', 'blood_drop1.png');
        this.load.image('blood_drop2', 'blood_drop2.png');
        this.load.image('blood_drop3', 'blood_drop3.png');
        this.load.image('blood_puddle0', 'blood_puddle0.png');
        this.load.image('blood_puddle1', 'blood_puddle1.png');
        this.load.image('blood_puddle2', 'blood_puddle2.png');
        this.load.image('blood_puddle3', 'blood_puddle3.png');
        this.load.image('blood_puddle4', 'blood_puddle4.png');
        this.load.image('blood_puddle5', 'blood_puddle5.png');
        this.load.image('blood_puddle6', 'blood_puddle6.png');

        this.load.audio('move', 'move.wav');
        this.load.audio('select', 'select.wav');
        this.load.audio('damage', 'damage.wav');
        this.load.audio('death', 'death.wav');
        this.load.audio('win', 'win.wav');
        this.load.audio('lose', 'lose.wav');
    }

    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);
        if (this.config.api.deployedContractAddress != OFFLINE_PRACTICE_CONTRACT_ADDR) {
            makeCopyAddressButton(this, GAME_WIDTH - 80, 16, this.config.api.deployedContractAddress);
        }
        makeExitMatchButton(this, GAME_WIDTH - 48, 16);
        makeSoundToggleButton(this, GAME_WIDTH - 16, 16);

        // should we get rid of these?
        this.input?.keyboard?.on('keydown-ONE', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][0];
                const enemy = this.heroes[this.opponentTeam()][0]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-TWO', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][0];
                const enemy = this.heroes[this.opponentTeam()][1]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-THREE', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][0];
                const enemy = this.heroes[this.opponentTeam()][2]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-Q', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][1];
                const enemy = this.heroes[this.opponentTeam()][0]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-W', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][1];
                const enemy = this.heroes[this.opponentTeam()][1]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-E', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][1];
                const enemy = this.heroes[this.opponentTeam()][2]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-A', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][2];
                const enemy = this.heroes[this.opponentTeam()][0]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-S', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][2];
                const enemy = this.heroes[this.opponentTeam()][1]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-D', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][2];
                const enemy = this.heroes[this.opponentTeam()][2]
                if (hero.isAlive() && enemy.isAlive()) {
                    hero.setTarget(enemy.rank);
                }
            }
        });
        this.input?.keyboard?.on('keydown-FOUR', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][0];
                if (hero.isAlive()) {
                    hero.toggleNextStance();
                }
            }
        });
        this.input?.keyboard?.on('keydown-R', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][1];
                if (hero.isAlive()) {
                    hero.toggleNextStance();
                }
            }
        });
        this.input?.keyboard?.on('keydown-F', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const hero = this.heroes[this.playerTeam()][2];
                if (hero.isAlive()) {
                    hero.toggleNextStance();
                }
            }
        });
        this.input?.keyboard?.on('keydown-Z', () => {
            if (this.matchState == MatchState.WaitingOnPlayer) {
                const moves = this.heroes[this.playerTeam()].filter((hero) => hero.isAlive() && hero.target != undefined && hero.target.team == this.opponentTeam()).map((hero) => BigInt(hero.target!.index));
                if (moves.length == this.getAliveHeroes(this.playerTeam()).length) {
                    this.setMatchState(MatchState.SubmittingMove);
                    // still must send moves for dead units to make sure indexing works, so pad with 0's
                    if (this.config.isP1) {
                        console.log('submitting move (as p1)');
                        this.config.api.p1Commit(this.movesForContract(), this.stancesForContract())
                            .catch((e) => this.recoverFromSubmitError(MatchState.WaitingOnPlayer, e));
                    } else {
                        console.log('submitting move (as p2)');
                        this.config.api.p2Commit(this.movesForContract(), this.stancesForContract())
                           .catch((e) => this.recoverFromSubmitError(MatchState.WaitingOnPlayer, e));
                    }
                } else {
                    console.log(`invalid move: |${moves.length} < ${this.getAliveHeroes(this.playerTeam()).length}| ${JSON.stringify(this.heroes[this.playerTeam()].map((hero) => hero.target))}`);
                }
            }
        });
        this.input?.keyboard?.on('keydown-SPACE', () => {
            if (this.matchState == MatchState.GameOverP1Win || this.matchState == MatchState.GameOverP2Win || this.matchState == MatchState.GameOverTie) {
                this.scene.start('MainMenu');
                this.scene.remove('Arena');
            }
        });

        this.submitButton = new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.9, 64, 24, 'Submit', 12, () => {
            this.setMatchState(MatchState.SubmittingMove);
            // still must send moves for dead units to make sure indexing works, so pad with 0's
            if (this.config.isP1) {
                console.log('submitting move (as p1)');
                this.config.api.p1Commit(this.movesForContract(), this.stancesForContract())
                    .catch((e) => this.recoverFromSubmitError(MatchState.WaitingOnPlayer, e));
            } else {
                console.log('submitting move (as p2)');
                this.config.api.p2Commit(this.movesForContract(), this.stancesForContract())
                    .catch((e) => this.recoverFromSubmitError(MatchState.WaitingOnPlayer, e));
            }
            this.submitButton!.visible = false;
            closeTooltip(TooltipId.SetAllAttacks);
        });
        this.status = new StatusUI(this, [
            this.submitButton,
        ]);
        this.submitButton!.visible = false;
        this.add.existing(this.submitButton);

        this.setMatchState(MatchState.Initializing);

        if (this.initialState.round != BigInt(0) || this.initialState.state != GAME_STATE.p1_commit) {
            this.createHeroes(this.initialState);

            this.round = Number(this.initialState.round);
            // we can't know previous stances for player 2 so to make the resuming consistent just default to the on-chain values
            for (let team = 0; team < 2; ++team) {
                const stances = team == 0 ? this.initialState.p1Stances : this.initialState.p2Stances;
                const dmgs = team == 0 ? this.initialState.p1Dmg : this.initialState.p2Dmg;
                for (let i = 0; i < 3; ++i) {
                    const stance = stances[i];
                    const hero = this.heroes[team][i];
                    hero.stance = stance;
                    hero.nextStance = stance;
                    hero.setX(hero.rank.x(stance));
                    hero.setDamageForResume(Number(dmgs[i]));
                }
            }

            // we need to bruteforce to see what our commit was for
            // this takes ~1-3s on my machine in dev mode, do we need further optimization?
            // e.g. only consider valid moves
            const guessTargetsForP1 = () => {
                const startTime = Date.now();
                for (let stance0 = 0; stance0 < 3; ++stance0) {
                    for (let stance1 = 0; stance1 < 3; ++stance1) {
                        for (let stance2 = 0; stance2 < 3; ++stance2) {
                            for (let target0 = 0; target0 < 4; ++target0) {
                                for (let target1 = 0; target1 < 4; ++target1) {
                                    for (let target2 = 0; target2 < 4; ++target2) {
                                        const commit = pureCircuits.calc_commit_for_checking(
                                            this.initialState.secretKey,
                                            [BigInt(target0), BigInt(target1), BigInt(target2)],
                                            [stance0, stance1, stance2],
                                            this.initialState.nonce!,
                                        );
                                        if (commit == this.initialState.commit) {
                                            console.log(`found match [${stance0}, ${stance1}, ${stance2}]; [${target0}, ${target1}, ${target2}] in ${Date.now() - startTime}ms`);
                                            this.heroes[0][0].setNextStance(stance0);
                                            this.heroes[0][1].setNextStance(stance1);
                                            this.heroes[0][2].setNextStance(stance2);
                                            this.heroes[0][0].setTarget(new Rank(target0 as HeroIndex, 1));
                                            this.heroes[0][1].setTarget(new Rank(target1 as HeroIndex, 1));
                                            this.heroes[0][2].setTarget(new Rank(target2 as HeroIndex, 1));
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                throw new Error('could not find matching commit');
            };
            switch (this.initialState.state) {
                case GAME_STATE.p2_commit_reveal:
                    if (this.config.isP1) {
                        guessTargetsForP1();
                    }
                    break;
                case GAME_STATE.p1_reveal:
                    if (this.config.isP1) {
                        guessTargetsForP1();
                    } else {
                        for (let i = 0; i < 3; ++i) {
                            this.heroes[1][i].setTarget(new Rank(Number(this.initialState.p2Cmds![i]) as HeroIndex, 0));
                        }
                    }
                    break;
            }
        } else {
            this.onStateChange(this.initialState);
        }

        this.subscription = this.config.api.state$.subscribe((state) => this.onStateChange(state));
    }

    update() {
    }

    getHero(rank: Rank): HeroActor {
        return this.heroes[rank.team][rank.index];
    }

    getAliveHeroes(team: Team): HeroActor[] {
        return this.heroes[team].filter((h) => h.isAlive());
    }

    getAllAliveUnits(): HeroActor[] {
        return this.heroes.flat(1).filter((h) => h.isAlive())
    }

    public enableSubmitButton() {
        this.submitButton!.visible = true;
        this.status?.clearStatusText();
    }

    private movesForContract(): bigint[] {
        return this.heroes[this.playerTeam()].map((hero) => BigInt(hero.isAlive() ? hero.target!.index : 0));
    }

    private stancesForContract(): STANCE[] {
        return this.heroes[this.playerTeam()].map((hero) => hero.nextStance);
    }

    private recoverFromSubmitError(recoveryState: MatchState, e: Error) {
        console.log(`submit error: ${e}`);
        this.status!.setError(e, () => {
            this.setMatchState(recoveryState);
            this.enableSubmitButton();
        });
    }
}