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


export class PracticeMenu extends Phaser.Scene {
    deployProvider: BrowserDeploymentManager;
    text: Phaser.GameObjects.Text | undefined;
    buttons: Button[];

    constructor(deployProvider: BrowserDeploymentManager) {
        super('PracticeMenu');
        this.deployProvider = deployProvider;
        this.buttons = [];
    }

    preload() {
    }

    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);
        this.text = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.65, '', fontStyle(12)).setOrigin(0.5, 0.65).setVisible(false);
        this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.3, 128, 32, 'On-chain Practice', 12, () => {
            this.setStatusText('Creating match, please wait...');
            this.deployProvider.create(true).then((api) => {
                console.log('====================\napi done from creating\n===============');
                console.log(`contract address: ${api.deployedContractAddress}`);
                navigator.clipboard.writeText(api.deployedContractAddress);
                this.scene.remove('EquipmentMenu');
                const equipMenu = new EquipmentMenu({ api, isP1: true });
                this.scene.add('EquipmentMenu', equipMenu);
                this.scene.start('EquipmentMenu');
            });
        }, 'Practice on-chain against the AI'));
        this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.5, 128, 32, 'Offline Practice', 12, () => {
            this.setStatusText('Entering mocked test arena...');
            setTimeout(() => {
                this.scene.remove('EquipmentMenu');
                this.scene.add('EquipmentMenu', new EquipmentMenu({ api: new MockPVPArenaAPI(true), isP1: true }));
                this.scene.start('EquipmentMenu');
            }, 1000);
        }, 'Practice off-chain against the AI'));
        this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.8, 128, 32, 'Back', 12, () => {
            this.scene.remove('MainMenu');
            this.scene.add('MainMenu', new MainMenu());
            this.scene.start('MainMenu');
        }, 'Return to main menu'));
    }

    private setStatusText(text: string) {
        this.buttons.forEach((button) => button.setVisible(false));
        this.text!.visible = true;
        this.text?.setText(text);
    }
}