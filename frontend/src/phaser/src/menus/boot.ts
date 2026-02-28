import { DeployedPVPArenaAPI, PVPArenaDerivedState } from '@midnight-ntwrk/pvp-api';
import { logger, networkId, GAME_WIDTH, GAME_HEIGHT, fontStyle, makeSoundToggleButton } from '../main';
import { BrowserDeploymentManager } from '../wallet';
import { BatcherClient } from '../batcher-client';
import { MainMenu } from './main';
import { Subscription } from 'rxjs/internal/Subscription';
import { MockPVPArenaAPI } from '../battle/mockapi';
import { take } from 'rxjs';

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
        const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
        logger.info(`Joining contract at address: ${contractAddress}`);
        this.deployProvider.join(contractAddress).then((api) => {
            logger.info(`Successfully joined contract at address: ${contractAddress}`);
            api.beforeCircuitCall = (name) => BatcherClient.setCircuitName(name);
            this.api = api;
            // take(1): state$ is a continuous stream; we only need the first emission to
            // bootstrap into MainMenu. Without take(1), every subsequent contract state
            // change re-triggers scene.add('MainMenu', ...) which throws because the key
            // already exists, erroring the subscription before MainMenu can fully start.
            this.subscription = api.state$.pipe(take(1)).subscribe({
                next: (state) => this.onStateChange(state),
                error: (err) => {
                    const msg = err?.message ?? String(err);
                    logger.error(`state$ error on boot: ${msg}`);
                    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.75, `Error: ${msg}`, fontStyle(10, { wordWrap: { width: GAME_WIDTH - 32 }, color: '#ff4444' })).setOrigin(0.5);
                },
            });
        }).catch((err) => {
            const msg = err?.message ?? String(err);
            logger.error(`Failed to join contract at address: ${contractAddress} — ${msg}`);
            this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.75, `Connection failed: ${msg}`, fontStyle(10, { wordWrap: { width: GAME_WIDTH - 32 }, color: '#ff4444' })).setOrigin(0.5);
        });
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