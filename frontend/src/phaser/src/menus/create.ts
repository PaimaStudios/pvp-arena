import { BrowserDeploymentManager } from '../wallet';
import { logger, GAME_WIDTH, GAME_HEIGHT, fontStyle } from '../main';
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

    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);
        this.status = new StatusUI(this, [
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.3, 128, 32, 'Public Match', 12, () => {
                this.status!.setText('Creating public match, please wait...');
                this
                    .api
                    .create_new_match(true, false).then((matchId) => {
                        console.log(`match id: ${matchId}`);
                    this.scene.remove('EquipmentMenu');
                    const equipMenu = new EquipmentMenu({ api: this.api, isP1: true });
                    this.scene.add('EquipmentMenu', equipMenu);
                    this.scene.start('EquipmentMenu');
                })
                .catch((e) => {
                    this.status!.setError(e);
                });
            }, 'Host a public match'),
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.5, 128, 32, 'Private Match', 12, () => {
                this.status!.setText('Creating private match, please wait...');
                this.api
                    .create_new_match(false, false)
                    .then((matchId) => {
                        console.log(`match id: ${matchId}`);
                        this.scene.remove('EquipmentMenu');
                        const equipMenu = new EquipmentMenu({ api: this.api, isP1: true });
                        this.scene.add('EquipmentMenu', equipMenu);
                        this.scene.start('EquipmentMenu');
                    })
                    .catch((e) => {
                        this.status!.setError(e);
                    });
            }, 'Host a private match'),
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.8, 128, 32, 'Back', 12, () => {
                this.scene.remove('MainMenu');
                this.scene.add('MainMenu', new MainMenu(this.api, this.state));
                this.scene.start('MainMenu');
            }, 'Return to main menu'),
        ]);
    }
}
