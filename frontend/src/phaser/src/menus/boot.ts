import { DeployedPVPArenaAPI, PVPArenaDerivedState } from '@midnight-ntwrk/pvp-api';
import { logger, networkId, GAME_WIDTH, GAME_HEIGHT, fontStyle, makeSoundToggleButton } from '../main';
import { BrowserDeploymentManager } from '../wallet';
import { MainMenu } from './main';
import { Subscription } from 'rxjs/internal/Subscription';
import { MockPVPArenaAPI } from '../battle/mockapi';

export class PVPArenaCombinedAPIs {
    private deployed: DeployedPVPArenaAPI;
    private mock: DeployedPVPArenaAPI;
    private current: DeployedPVPArenaAPI;

    constructor(deployed: DeployedPVPArenaAPI, mock: DeployedPVPArenaAPI) {
        this.deployed = deployed;
        this.mock = mock;
        this.current = deployed;
    }
};

export class ContractLoader extends Phaser.Scene {
    deployProvider: BrowserDeploymentManager;
    api: DeployedPVPArenaAPI | undefined;
    subscription: Subscription | undefined;

    constructor() {
        super('ContractLoader');
        this.deployProvider = new BrowserDeploymentManager(logger);
    }
    
    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);
        this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.65, 'Connecting to contract...', fontStyle(18)).setOrigin(0.5, 0.65);
        // this.deployProvider.join(import.meta.env.VITE_CONTRACT_ADDRESS).then((api) => {
        //     this.api = api;
        //     this.subscription = api.state$.subscribe((state) => this.onStateChange(state));
        // });
        const api = new MockPVPArenaAPI(true);
        this.scene.add('MainMenu', new MainMenu(api, api.mockState));
        this.scene.start('MainMenu');
    }

    preload() {
        this.load.setBaseURL('/');

        this.load.image('arena_bg', 'arena_bg.png');
    }

    preDestroy() {
        this.subscription?.unsubscribe();
    }

    private onStateChange(state: PVPArenaDerivedState) {
        this.scene.add('MainMenu', new MainMenu(this.api!, state));
        this.scene.start('MainMenu');
    }
}