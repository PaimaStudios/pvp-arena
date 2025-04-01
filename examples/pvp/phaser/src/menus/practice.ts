import { BrowserDeploymentManager } from '../wallet';
import { logger, GAME_WIDTH, GAME_HEIGHT, fontStyle, makeSoundToggleButton } from '../main';
import { MockPVPArenaAPI } from '../battle/mockapi';
import { Arena } from '../battle/arena';
import { EquipmentMenu } from './equipment';
import { Button } from './button';
import { HeroAnimationController, createHeroAnims, generateRandomHero } from '../battle/hero';
import { ARMOR, ITEM } from '@midnight-ntwrk/pvp-contract';
import { BalancingTest, heroBalancing } from '../balancing';
import { MainMenu } from './main';
import { StatusUI } from '.';


export class PracticeMenu extends Phaser.Scene {
    deployProvider: BrowserDeploymentManager;
    status: StatusUI | undefined;

    constructor(deployProvider: BrowserDeploymentManager) {
        super('PracticeMenu');
        this.deployProvider = deployProvider;
    }

    preload() {
    }

    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);

        this.status = new StatusUI(this, [
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.3, 128, 32, 'On-chain Practice', 10, () => {
                this.status?.setText('Creating match, please wait...');
                this.deployProvider
                    .create({ isPractice: true, isPublic: false }).then((api) => {
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
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.55, 128, 32, 'Offline Practice', 10, () => {
                this.status?.setText('Entering offline practice arena...');
                setTimeout(() => {
                    this.scene.remove('EquipmentMenu');
                    this.scene.add('EquipmentMenu', new EquipmentMenu({ api: new MockPVPArenaAPI(true), isP1: true }));
                    this.scene.start('EquipmentMenu');
                }, 500);
            }, 'Practice off-chain against the AI'),
            new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.8, 128, 32, 'Back', 12, () => {
                this.scene.remove('MainMenu');
                this.scene.add('MainMenu', new MainMenu());
                this.scene.start('MainMenu');
            }, 'Return to main menu'),
        ]);
        // done after so status is created to add to it
        this.makeDescBox(GAME_HEIGHT * 0.375, 'All proofs generated/posted on-chain (Slower)');
        this.makeDescBox(GAME_HEIGHT * 0.625, 'Local only. Nothing is proven/submitted (Fastest)');

        makeSoundToggleButton(this, GAME_WIDTH - 16, 16);
    }

    private makeDescBox(y: number, desc: string) {
        const x = GAME_WIDTH / 2;
        const w = 320;
        const h = 48;
        this.status?.registerUi(this.add.nineslice(x, y, 'stone_button', undefined, w, h, 8, 8, 8, 8).setDepth(-1));
        this.status?.registerUi(this.add.text(x, y, desc, fontStyle(10, { wordWrap: { width: w - 8 } })).setDepth(-1).setOrigin(0.5, 0.5));
    }
}