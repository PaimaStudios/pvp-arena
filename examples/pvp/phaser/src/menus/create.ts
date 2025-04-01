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


export class CreateMenu extends Phaser.Scene {
    deployProvider: BrowserDeploymentManager;
    status: StatusUI | undefined;

    constructor(deployProvider: BrowserDeploymentManager) {
        super('CreateMenu');
        this.deployProvider = deployProvider;
    }

    preload() {
    }

    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);
        this.status = new StatusUI(this, [
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.3, 128, 32, 'Public Match', 12, () => {
                this.status!.setText('Creating public match, please wait...');
                this.deployProvider.create({ isPractice: false, isPublic: true }).then((api) => {
                    console.log('====================\napi done from creating\n===============');
                    console.log(`contract address: ${api.deployedContractAddress}`);
                    this.scene.remove('EquipmentMenu');
                    const equipMenu = new EquipmentMenu({ api, isP1: true });
                    this.scene.add('EquipmentMenu', equipMenu);
                    this.scene.start('EquipmentMenu');
                })
                .catch((e) => {
                    this.status!.setError(e);
                });
            }, 'Practice on-chain against the AI'),
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.5, 128, 32, 'Private Match', 12, () => {
                this.status!.setText('Creating private match, please wait...');
                this.deployProvider
                    .create({ isPractice: false, isPublic: false })
                    .then((api) => {
                        console.log('====================\napi done from creating\n===============');
                        console.log(`contract address: ${api.deployedContractAddress}`);
                        this.scene.remove('EquipmentMenu');
                        const equipMenu = new EquipmentMenu({ api, isP1: true });
                        this.scene.add('EquipmentMenu', equipMenu);
                        this.scene.start('EquipmentMenu');
                    })
                    .catch((e) => {
                        this.status!.setError(e);
                    });
            }, 'Practice on-chain against the AI'),
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.8, 128, 32, 'Back', 12, () => {
                this.scene.remove('MainMenu');
                this.scene.add('MainMenu', new MainMenu());
                this.scene.start('MainMenu');
            }, 'Return to main menu'),
        ]);
    }
}
