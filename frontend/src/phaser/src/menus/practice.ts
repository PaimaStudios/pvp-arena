import { BrowserDeploymentManager } from '../wallet';
import { logger, GAME_WIDTH, GAME_HEIGHT, fontStyle, makeSoundToggleButton, makeGuideButton, makeAddressLabel } from '../main';
import { MockPVPArenaAPI } from '../battle/mockapi';
import { Arena } from '../battle/arena';
import { EquipmentMenu } from './equipment';
import { Button } from './button';
import { HeroAnimationController, createHeroAnims, generateRandomHero } from '../battle/hero';
import { ARMOR, ITEM } from '@midnight-ntwrk/pvp-contract';
import { BalancingTest, heroBalancing } from '../balancing';
import { MainMenu } from './main';
import { StatusUI } from '.';
import { DeployedPVPArenaAPI, PVPArenaDerivedState } from '@midnight-ntwrk/pvp-api';
import { BatcherClient } from '../batcher-client';
import { firstValueFrom, filter } from 'rxjs';


export class PracticeMenu extends Phaser.Scene {
    status: StatusUI | undefined;
    api: DeployedPVPArenaAPI;
    state: PVPArenaDerivedState;

    constructor(api: DeployedPVPArenaAPI, initialState: PVPArenaDerivedState) {
        super('PracticeMenu');
        this.api = api;
        this.state = initialState;
    }

    preload() {
    }

    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);

        this.status = new StatusUI(this, [
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.3, 128, 32, 'On-chain Practice', 10, () => {
                this.status?.setProgressText([
                    { text: 'Creating practice match...', delay: 0 },
                    { text: 'Submitting to blockchain...', delay: 8_000 },
                    { text: 'Generating zero-knowledge proof...', delay: 18_000 },
                    { text: 'Almost there, up to a minute...', delay: 35_000 },
                ]);
                BatcherClient.setCircuitName('create_new_match');
                this.api.create_new_match(false, true).then((matchId) => {
                    BatcherClient.setCircuitName('join_match');
                    // Register P1 as P2 so the AI can call p2_* circuits on their behalf
                    return this.api.joinMatch(matchId).then(() => matchId);
                }).then((matchId) => {
                    BatcherClient.setCircuitName('');
                    // Wait for state$ to emit a state where currentMatch is set for this match
                    // (joinMatch writes to private DB but shareReplay caches pre-write state)
                    return firstValueFrom(
                        this.api.state$.pipe(filter(s => s.currentMatchId === matchId && s.currentMatch !== null))
                    );
                }).then((initialState) => {
                    this.scene.remove('EquipmentMenu');
                    const equipMenu = new EquipmentMenu({ api: this.api, isP1: true }, initialState);
                    this.scene.add('EquipmentMenu', equipMenu);
                    this.scene.start('EquipmentMenu');
                })
                .catch((e) => {
                    this.status!.setError(e);
                });
            }, 'Practice on-chain against the AI'),
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.55, 128, 32, 'Offline Practice', 10, () => {
                this.status?.setText('Entering offline practice arena...');
                const mockApi = new MockPVPArenaAPI(true);
                mockApi.create_new_match(false, true).then((matchId) => {
                    // Subscribe BEFORE setCurrentMatch so its synchronous emission is captured
                    const statePromise = firstValueFrom(
                        mockApi.state$.pipe(filter(s => s.currentMatchId === matchId && s.currentMatch !== null))
                    );
                    mockApi.setCurrentMatch(matchId);
                    return statePromise;
                }).then((initialState) => {
                    this.scene.remove('EquipmentMenu');
                    this.scene.add('EquipmentMenu', new EquipmentMenu({ api: mockApi, isP1: true }, initialState));
                    this.scene.start('EquipmentMenu');
                }).catch((e) => {
                    this.status?.setError(e);
                });
            }, 'Practice off-chain against the AI'),
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.8, 128, 32, 'Back', 12, () => {
                this.scene.remove('MainMenu');
                this.scene.add('MainMenu', new MainMenu(this.api, this.state));
                this.scene.start('MainMenu');
            }, 'Return to main menu'),
        ]);
        // done after so status is created to add to it
        this.makeDescBox(GAME_HEIGHT * 0.375, 'All proofs generated/posted on-chain (Slower)');
        this.makeDescBox(GAME_HEIGHT * 0.625, 'Local only. Nothing is proven/submitted (Fastest)');

        makeGuideButton(this, GAME_WIDTH - 48, 16);
        makeSoundToggleButton(this, GAME_WIDTH - 16, 16);
        makeAddressLabel(this, this.state.localPublicKey);
    }

    private makeDescBox(y: number, desc: string) {
        const x = GAME_WIDTH / 2;
        const w = 320;
        const h = 48;
        this.status?.registerUi(this.add.nineslice(x, y, 'stone_button', undefined, w, h, 8, 8, 8, 8).setDepth(-1));
        this.status?.registerUi(this.add.text(x, y, desc, fontStyle(10, { wordWrap: { width: w - 8 } })).setDepth(-1).setOrigin(0.5, 0.5));
    }
}