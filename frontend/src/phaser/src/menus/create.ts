import { BrowserDeploymentManager } from '../wallet';
import { logger, GAME_WIDTH, GAME_HEIGHT, fontStyle, makeAddressLabel } from '../main';
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


export class CreateMenu extends Phaser.Scene {
    api: DeployedPVPArenaAPI;
    status: StatusUI | undefined;
    state: PVPArenaDerivedState;

    constructor(api: DeployedPVPArenaAPI, initialState: PVPArenaDerivedState) {
        super('CreateMenu');
        this.api = api;
        this.state = initialState;
    }

    preload() {
    }

    private createMatch(isPublic: boolean) {
        this.status!.setText(`Creating ${isPublic ? 'public' : 'private'} match, please wait...`);
        BatcherClient.setCircuitName('create_new_match');
        this.api
            .create_new_match(isPublic, false)
            .then((matchId) => {
                console.log(`[CreateMenu] match created: ${matchId}`);
                BatcherClient.setCircuitName('set_current_match');
                return this.api.setCurrentMatch(matchId).then(() => matchId);
            })
            .then((matchId) => {
                BatcherClient.setCircuitName('');
                return firstValueFrom(
                    this.api.state$.pipe(filter(s => s.currentMatchId === matchId && s.currentMatch !== null))
                );
            })
            .then((initialState) => {
                this.scene.remove('EquipmentMenu');
                this.scene.add('EquipmentMenu', new EquipmentMenu({ api: this.api, isP1: true }, initialState));
                this.scene.start('EquipmentMenu');
            })
            .catch((e) => {
                this.status!.setError(e);
            });
    }

    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);
        makeAddressLabel(this, this.state.localPublicKey);
        this.status = new StatusUI(this, [
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.3, 128, 32, 'Public Match', 12, () => {
                this.createMatch(true);
            }, 'Host a public match'),
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.5, 128, 32, 'Private Match', 12, () => {
                this.createMatch(false);
            }, 'Host a private match'),
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.8, 128, 32, 'Back', 12, () => {
                this.scene.remove('MainMenu');
                this.scene.add('MainMenu', new MainMenu(this.api, this.state));
                this.scene.start('MainMenu');
            }, 'Return to main menu'),
        ]);
    }
}
