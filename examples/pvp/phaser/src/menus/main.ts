import { BrowserDeploymentManager } from '../wallet';
import { logger, GAME_WIDTH, GAME_HEIGHT, fontStyle } from '../main';
import { MockPVPArenaAPI } from '../battle/mockapi';
import { Arena } from '../battle/arena';
import { EquipmentMenu } from './equipment';
import { Button } from './button';
import { HeroAnimationController, createHeroAnims, generateRandomHero } from '../battle/hero';
import { ARMOR, ITEM } from '@midnight-ntwrk/pvp-contract';
import { heroBalancing } from '../balancing';


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
        this.load.image('title_screen', 'title_screen.png');

        this.load.image('stone_button', 'stone_button.png');
        this.load.image('stone_button_over', 'stone_button_over.png');

        this.load.audio('select', 'select.wav');

        this.load.image('hero_quiver', 'hero_quiver.png');
        this.load.image('hero_body', 'hero_body.png');
        this.load.image('hero_axe_l', 'hero_axe_l.png');
        this.load.image('hero_sword_l', 'hero_sword_l.png');
        this.load.image('hero_shield_l', 'hero_shield_l.png');
        this.load.image('hero_spear_l', 'hero_spear_l.png');
        this.load.image('hero_bow_l', 'hero_bow_l.png');
        this.load.image('hero_axe_r', 'hero_axe_r.png');
        this.load.image('hero_sword_r', 'hero_sword_r.png');
        this.load.image('hero_shield_r', 'hero_shield_r.png');
        this.load.image('hero_spear_r', 'hero_spear_r.png');
        this.load.image('hero_bow_r', 'hero_bow_r.png');
        this.load.image('hero_arm_r', 'hero_arm_r.png');
        for (let material of ['leather', 'metal']) {
            for (let part of ['helmet', 'chest', 'skirt', 'greaves']) {
                this.load.image(`hero_${part}_${material}`, `hero_${part}_${material}.png`);
                console.log(`loading hero_${part}_${material}.png`);
            }
        }

        // maybe this will fix the bug when 2 local clients load at the same time
        this.load.image('hp_bar_back', 'hp_bar_back.png');
        this.load.image('hp_bar_side', 'hp_bar_side.png');
        this.load.image('hp_bar_middle', 'hp_bar_middle.png');

        this.load.image('arrow_move', 'arrow_move.png');
        this.load.image('arrow_attack', 'arrow_attack4.png');

        this.load.spritesheet('hero_body_idle', 'hero_body_idle.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_arm_r_idle', 'hero_arm_r_idle.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_body_run', 'hero_body_run.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_arm_r_run', 'hero_arm_r_run.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_greaves_metal_run', 'hero_greaves_metal_run.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_greaves_leather_run', 'hero_greaves_leather_run.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_skirt_metal_run', 'hero_skirt_metal_run.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_skirt_leather_run', 'hero_skirt_leather_run.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_bow_l_bow_attack_l', 'hero_bow_l_bow_attack_l.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_arm_r_bow_attack_l', 'hero_arm_r_bow_attack_l.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_bow_r_bow_attack_r', 'hero_bow_r_bow_attack_r.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_body_bow_attack_r', 'hero_body_bow_attack_r.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_arm_r_attack_thrust_r', 'hero_arm_r_attack_thrust_r.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_body_attack_thrust_l', 'hero_body_attack_thrust_l.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_body_attack_swing_l', 'hero_body_attack_swing_l.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_spear_l_attack_thrust_l', 'hero_spear_l_attack_thrust_l.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_axe_l_attack_swing_l', 'hero_axe_l_attack_swing_l.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_axe_r_attack_swing_r', 'hero_axe_r_attack_swing_r.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_arm_r_attack_swing_r', 'hero_arm_r_attack_swing_r.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_sword_l_attack_swing_l', 'hero_sword_l_attack_swing_l.png', { frameWidth: 48, frameHeight: 64 });
        this.load.spritesheet('hero_sword_r_attack_swing_r', 'hero_sword_r_attack_swing_r.png', { frameWidth: 48, frameHeight: 64 });
        
    }

    create() {
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);
        this.add.image(GAME_WIDTH / 2, GAME_HEIGHT * 0.3, 'title_screen');
        // this.add.text(GAME_WIDTH / 2 + 2, GAME_HEIGHT / 4 + 2, 'PVP ARENA', {fontSize: 64, color: 'black'}).setOrigin(0.5, 0.5);
        // this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 4, 'PVP ARENA', {fontSize: 64, color: 'white'}).setOrigin(0.5, 0.5);
        this.text = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT * 0.65, '', fontStyle(12)).setOrigin(0.5, 0.65).setVisible(false);
        this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.55, 128, 32, 'Create', 20, () => {
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
        this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.7, 128, 32, 'Join', 20, () => {
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
        this.buttons.push(new Button(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.85, 128, 32, 'Practice', 20, () => {
            this.setStatusText('Entering mocked test arena...');
            setTimeout(() => {
                this.scene.remove('EquipmentMenu');
                this.scene.add('EquipmentMenu', new EquipmentMenu({ api: new MockPVPArenaAPI(true), isP1: true }));
                this.scene.start('EquipmentMenu');
            }, 1000);
        }));
        // dev menu
        if (true) {
            this.buttons.push(new Button(this, 160 + GAME_WIDTH / 2, GAME_HEIGHT * 0.7, 128, 32, 'Balancing', 20, () => {
                console.log(`running balancing...`);
                heroBalancing();
            }, 'Run a balancing test (DEV ONLY)'));
            this.buttons.push(new Button(this, 160 + GAME_WIDTH / 2, GAME_HEIGHT * 0.85, 128, 32, 'Practice (P2)', 14, () => {
                this.setStatusText('Entering mocked test arena (as P2)...');
                setTimeout(() => {
                    this.scene.remove('EquipmentMenu');
                    this.scene.add('EquipmentMenu', new EquipmentMenu({ api: new MockPVPArenaAPI(false), isP1: false }));
                    this.scene.start('EquipmentMenu');
                }, 1000);
            }, 'Play a match against a local computer AI (DEV ONLY - as player 2)'));
        }

        createHeroAnims(this);
    }

    private setStatusText(text: string) {
        this.buttons.forEach((button) => button.setVisible(false));
        this.text!.visible = true;
        this.text?.setText(text);
    }
}
