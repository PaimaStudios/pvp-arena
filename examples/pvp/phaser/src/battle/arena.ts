import '@midnight-ntwrk/dapp-connector-api';
import { ITEM, RESULT, STANCE, Hero, ARMOR, pureCircuits, GAME_STATE } from '@midnight-ntwrk/pvp-contract';
import { type PVPArenaDerivedState, type DeployedPVPArenaAPI } from '@midnight-ntwrk/pvp-api';
import 'phaser';
import RexUIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin'
import { GAME_WIDTH, GAME_HEIGHT, gameStateStr, safeJSONString, MatchState } from '../main';
import { HeroActor } from './hero';
import { HeroIndex, hpDiv, Rank, Team } from './index';
import { init } from 'fp-ts/lib/ReadonlyNonEmptyArray';

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
    matchStateText: Phaser.GameObjects.Text | undefined;
    round: number;

    constructor(config: BattleConfig, initialState: PVPArenaDerivedState) {
        super('Arena');
        this.heroes = [];
        this.selected = undefined;
        this.config = config;
        this.initialState = initialState;
        this.onChainState = GAME_STATE.p1_commit;
        this.matchState = MatchState.Initializing;
        this.round = 0;

        const subscription = config.api.state$.subscribe((state) => this.onStateChange(state));
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
                this.matchStateText?.setText('Initializing...');
                break;
            case MatchState.WaitingOnPlayer:
                this.matchStateText?.setText('Make your move');
                for (const hero of this.getAliveHeroes(this.playerTeam())) {
                    hero.setInteractive({useHandCursor: true});
                }
                break;
            case MatchState.WaitingOnOpponent:
                this.matchStateText?.setText('Waiting on opponent (submit)...');
                break;
            case MatchState.SubmittingMove:
                this.matchStateText?.setText('Submitting move...');
                this.selected?.deselect();
                this.selected = undefined;
                for (const hero of this.getAliveHeroes(this.playerTeam())) {
                    hero.disableInteractive();
                }
                break;
            case MatchState.RevealingMove:
                this.matchStateText?.setText('Revealing move...');
                break;
            case MatchState.WaitingOtherPlayerReveal:
                this.matchStateText?.setText('Waiting on opponent (reveal)...');
                break;
            case MatchState.CombatResolving:
                this.matchStateText?.setText('Battle!');
                break;
            case MatchState.GameOverP1Win:
                this.matchStateText?.setText(this.config.isP1 ? 'You won! - Press Space to return to menu' : 'Opponent won! - Press Space to return to menu');
                break;
            case MatchState.GameOverP2Win:
                this.matchStateText?.setText(!this.config.isP1 ? 'You won! - Press Space to return to menu' : 'Opponent won! - Press Space to return to menu');
                break;
            case MatchState.GameOverTie:
                this.matchStateText?.setText('Battle tied! - Press Space to return to menu');
                break;
        }
    }

    onStateChange(state: PVPArenaDerivedState) {
        console.log(`new state: ${safeJSONString(state)}`);
        console.log(`NOW: ${gameStateStr(state.state)}`);

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

        // update commands/stances/damages
        if (state.p1Cmds != undefined && state.p2Cmds != undefined) {
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
                    hero.nextStance = stances[i];
                    hero.target = new Rank(newTargets[team][i] as HeroIndex, team == 0 ? 1 : 0);
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
            case GAME_STATE.p2_commit:
                this.setMatchState(this.config.isP1 ? MatchState.WaitingOnOpponent : MatchState.WaitingOnPlayer);
                break;
            case GAME_STATE.p1_reveal:
                if (this.config.isP1) {
                    console.log('revealing move (as p1)');
                    this.setMatchState(MatchState.RevealingMove);
                    // TODO: what happens if player cancels or closes window?
                    this.config.api.p1Reveal().then(() => {
                        // ??? (probably nothing - resolved by onStateChange)
                    });
                } else {
                    this.setMatchState(MatchState.WaitingOtherPlayerReveal);
                }
                break;
            case GAME_STATE.p2_reveal:
                if (this.config.isP1) {
                    this.setMatchState(MatchState.WaitingOtherPlayerReveal);
                } else {
                    console.log('revealing move (as p2)');
                    this.setMatchState(MatchState.RevealingMove);
                    // TODO: what happens if player cancels or closes window?
                    this.config.api.p2Reveal().then(() => {
                        // ??? (probably nothing - resolved by onStateChange)
                    });
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
            tweens.push({
                targets: hero,
                delay: 150,
                duration: 350,
                ease: 'Linear',
                x: hero.rank.x(hero.nextStance),
                onStart: () => {
                    // TODO: put in function
                    hero.left_arrow.visible = false;
                    hero.right_arrow.visible = false;
                },
                onComplete: () => {
                    hero.stance = hero.nextStance;
                    // TODO: smarter way
                    for (const h of this.getAllAliveUnits()) {
                        h.updateTargetLine();
                    }
                },
            });
        }
        tweens.push({
            targets: null,
            duration: 3000,
        });

        // attack tweens
        for (const hero of aliveUnits) {
            // can't use hero.x / enemy.x etc since those aren't where they'll be after they move to their new stance
            const heroX = hero.rank.x(hero.nextStance);
            const heroY = hero.rank.y(); // technically the same right now but could be different in the future
            const enemy = this.heroes[hero.target!.team][hero.target!.index];
            const enemyX = enemy.rank.x(enemy.nextStance);
            const enemyY = enemy.rank.y();
            // get rid of line/prepare delay
            tweens.push({
                targets: hero,
                duration: 150,
                onComplete: () => {
                    // get rid of line before attack
                    hero.setTarget(undefined);
                },
            });
            // move to enemy
            const dist = (new Phaser.Math.Vector2(heroX, heroY)).distance(new Phaser.Math.Vector2(enemyX, enemyY));
            tweens.push({
                targets: hero,
                ease: 'Quad.easeInOut',
                x: hero.target!.x(this.getHero(hero.target!).nextStance),
                y: hero.target!.y(),
                duration: 40 + dist * 2,
                onComplete: () => {
                    console.log(`half of tween [${hero.rank.team}][${hero.rank.index}]`);
                    // do graphical part of hp change (TODO: this should prob be in Hero)
                    // TODO: this is ALL damage done the entire turn to enemy so only
                    // the first attack will appear to change it. need to fix this, can't rely on just this
                    const stance_strs = ['def', 'neu', 'atk'];
                    for (let hero_stance = 0; hero_stance < 3; ++hero_stance) {
                        for (let enemy_stance = 0; enemy_stance < 3; ++enemy_stance) {
                            const dmg = pureCircuits.calc_item_dmg_against(pureCircuits.calc_stats(hero.hero), hero_stance as STANCE, pureCircuits.calc_stats(enemy.hero), enemy_stance as STANCE);
                            console.log(`dmg [${stance_strs[hero_stance]}] -> [${stance_strs[enemy_stance]}] = ${hpDiv(Number(dmg))}`);
                        }
                    }
                    const dmg = pureCircuits.calc_item_dmg_against(pureCircuits.calc_stats(hero.hero), hero.nextStance, pureCircuits.calc_stats(enemy.hero), enemy.nextStance);
                    if (enemy.attack(hero, Number(dmg))) {
                        // TODO: death anim? or this is resolved after?
                    }
                },
                persist: false,
            });
            // enemy knockback
            const angle = Phaser.Math.Angle.Between(heroX, heroY, enemyX, enemyY);
            tweens.push({
                targets: enemy,
                x: enemyX + Math.cos(angle) * 16,
                y: enemyY + Math.sin(angle) * 16,
                alpha: 0.4,
                duration: 50,
            });
            tweens.push({
                targets: enemy,
                x: enemyX,
                y: enemyY,
                alpha: 1,
                duration: 80,
            });
            // move back
            tweens.push({
                targets: hero,
                ease: 'Quad.easeInOut',
                x: hero.rank.x(hero.nextStance),
                y: hero.y,
                duration: 60 + dist * 3,
                onComplete: (tween) => {
                    console.log(`tween.targets = ${JSON.stringify(tween.targets)}`);
                    console.log(`completed tween [${hero.rank.team}][${hero.rank.index}]`);
                },
                persist: false,
            });
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
        this.load.image('select_circle', 'select_circle.png');

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
    }

    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);

        this.matchStateText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.9, '', {fontSize: 12, color: 'white'}).setOrigin(0.5, 0.5);

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
                const stances = this.heroes[this.playerTeam()].map((hero) => hero.nextStance);
                const moves = this.heroes[this.playerTeam()].filter((hero) => hero.isAlive() && hero.target != undefined && hero.target.team == this.opponentTeam()).map((hero) => BigInt(hero.target!.index));
                if (moves.length == this.getAliveHeroes(this.playerTeam()).length) {
                    this.setMatchState(MatchState.SubmittingMove);
                    // still must send moves for dead units to make sure indexing works, so pad with 0's
                    const paddedMoves = this.heroes[this.playerTeam()].map((hero) => BigInt(hero.isAlive() ? hero.target!.index : 0));
                    if (this.config.isP1) {
                        console.log('submitting move (as p1)');
                        this.config.api.p1Commit(paddedMoves, stances).then(() => {
                            // ???
                        });
                    } else {
                        console.log('submitting move (as p2)');
                        this.config.api.p2Commit(paddedMoves, stances).then(() => {
                            // ???
                        });
                    }
                } else {
                    console.log(`invalid move: |${moves.length} < ${this.getAliveHeroes(this.playerTeam()).length}| ${JSON.stringify(this.heroes[this.playerTeam()].map((hero) => hero.target))}`);
                }
            }
        });
        this.input?.keyboard?.on('keydown-SPACE', () => {
            if (this.matchState == MatchState.GameOverP1Win || this.matchState == MatchState.GameOverP2Win || this.matchState == MatchState.GameOverTie) {
                this.scene.start('MainMenu');
            }
        });
        const rexUI = (this.scene as any).rexUI as RexUIPlugin;

        this.setMatchState(MatchState.Initializing);

        this.onStateChange(this.initialState);
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
}