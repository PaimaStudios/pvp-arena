import { BrowserDeploymentManager } from '../wallet';
import { logger, GAME_WIDTH, GAME_HEIGHT } from '../main';
import { MockPVPArenaAPI } from '../battle/mockapi';
import { Arena } from '../battle/arena';

export class MainMenu extends Phaser.Scene {
    deployProvider: BrowserDeploymentManager;
    waiting: boolean;
    text: Phaser.GameObjects.Text | undefined;

    constructor() {
        super('MainMenu');
        this.deployProvider = new BrowserDeploymentManager(logger);
        this.waiting = false;
    }

    preload ()
    {
        this.load.setBaseURL('/');

        this.load.image('arena_bg', 'arena_bg.png');
    }

    create ()
    {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);
        this.add.text(GAME_WIDTH / 2 + 2, GAME_HEIGHT / 4 + 2, 'PVP ARENA', {fontSize: 64, color: 'black'}).setOrigin(0.5, 0.5);
        this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 4, 'PVP ARENA', {fontSize: 64, color: 'white'}).setOrigin(0.5, 0.5);
        this.text = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.65, 'Press J to join, C to create', {fontSize: 12, color: 'white'}).setOrigin(0.5, 0.5);
        this.input?.keyboard?.on('keydown-C', () => {
            if (!this.waiting) {
                this.text?.setText('Creating match, please wait...');
                this.waiting = true;
                this.deployProvider.create().then((api) => {
                    console.log('====================\napi done from creating\n===============');
                    console.log(`contract address: ${api.deployedContractAddress}`);
                    navigator.clipboard.writeText(api.deployedContractAddress);
                    this.scene.remove('Arena');
                    const arena = new Arena(api, true);
                    this.scene.add('Arena', arena);
                    this.scene.start('Arena');
                });
            }
        });
        this.input?.keyboard?.on('keydown-J', () => {
            if (!this.waiting) {
                const contractAddress = window.prompt('Enter contract address to join')
                if (contractAddress != null) {
                    this.text?.setText('Joining match, please wait...');
                    this.waiting = true;
                    this.deployProvider.join(contractAddress).then((api) => {
                        console.log('=====================\napi done from joining\n======================');
                        this.scene.remove('Arena');
                        const arena = new Arena(api, false);
                        this.scene.add('Arena', arena);
                        this.scene.start('Arena');
                    });
                }
            }
        });
        // create an off-chain testing world for testing graphical stuff without having to wait a long time
        this.input?.keyboard?.on('keydown-T', () => {
            this.scene.remove('Arena');
            this.scene.add('Arena', new Arena(new MockPVPArenaAPI(), true));
            this.scene.start('Arena');
        });
    }
}