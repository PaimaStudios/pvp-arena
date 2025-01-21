import { BrowserDeploymentManager } from '../wallet';
import { logger, GAME_WIDTH, GAME_HEIGHT } from '../main';
import { MockPVPArenaAPI } from '../battle/mockapi';
import { Arena } from '../battle/arena';
import { EquipmentMenu } from './equipment';
import { Button } from './button';

export class MainMenu extends Phaser.Scene {
    deployProvider: BrowserDeploymentManager;
    text: Phaser.GameObjects.Text | undefined;
    buttons: Button[];

    constructor() {
        super('MainMenu');
        this.deployProvider = new BrowserDeploymentManager(logger);
        this.buttons = [];
    }

    preload() {
        this.load.setBaseURL('/');

        this.load.image('arena_bg', 'arena_bg.png');
    }

    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);
        this.add.text(GAME_WIDTH / 2 + 2, GAME_HEIGHT / 4 + 2, 'PVP ARENA', {fontSize: 64, color: 'black'}).setOrigin(0.5, 0.5);
        this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 4, 'PVP ARENA', {fontSize: 64, color: 'white'}).setOrigin(0.5, 0.5);
        this.text = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.65, '', {fontSize: 12, color: 'white'}).setOrigin(0.5, 0.5).setVisible(false);
        this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.5, 96, 32, 'Create', 20, () => {
            this.setStatusText('Creating match, please wait...');
            this.deployProvider.create().then((api) => {
                console.log('====================\napi done from creating\n===============');
                console.log(`contract address: ${api.deployedContractAddress}`);
                navigator.clipboard.writeText(api.deployedContractAddress);
                this.scene.remove('EquipmentMenu');
                const equipMenu = new EquipmentMenu({ api, isP1: true });
                this.scene.add('EquipmentMenu', equipMenu);
                this.scene.start('EquipmentMenu');
            });
        }));
        this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.65, 96, 32, 'Join', 20, () => {
            const contractAddress = window.prompt('Enter contract address to join')
            if (contractAddress != null) {
                this.setStatusText('Joining match, please wait...');
                this.deployProvider.join(contractAddress).then((api) => {
                    console.log('=====================\napi done from joining\n======================');
                    this.scene.remove('EquipmentMenu');
                    const equipMenu = new EquipmentMenu({ api, isP1: false });
                    this.scene.add('EquipmentMenu', equipMenu);
                    this.scene.start('EquipmentMenu');
                });
            } else {
                // TODO: re-enable buttons
            }
        }));
        // create an off-chain testing world for testing graphical stuff without having to wait a long time
        this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.8, 96, 32, 'Testing', 20, () => {
            this.setStatusText('Entering mocked test arena...');
            setTimeout(() => {
                this.scene.remove('EquipmentMenu');
                this.scene.add('EquipmentMenu', new EquipmentMenu({ api: new MockPVPArenaAPI(), isP1: true }));
                this.scene.start('EquipmentMenu');
            }, 1000);
        }));
    }

    private setStatusText(text: string) {
        this.buttons.forEach((button) => button.setVisible(false));
        this.text!.visible = true;
        this.text?.setText(text);
    }
}