import { MockPVPArenaAPI } from "../battle/mockapi";
import { fontStyle, GAME_HEIGHT, GAME_WIDTH } from "../main";
import { BrowserDeploymentManager } from "../wallet";
import { Button } from "./button";
import { EquipmentMenu } from "./equipment";
import { MainMenu } from "./main";

// TODO: remove and replace with actual indexer
const mockedMatches: MatchInfo[] = [
    {
        contractAddress: '020094d87a67c3492527770a503f4e924761894f9e27db05121659f3be583349fc0a',
        lastUpdatedBlock: 1346,
    },
    {
        contractAddress: '0200bbbbaaaaaaaa2527770a503f4e924761894f9e27db05121659f3be58aaaaaaaa',
        lastUpdatedBlock: 121346,
    },
    {
        contractAddress: '020094d87a67c3492527770a503f4e924761894f9e27db05121659f3be583349fc0a',
        lastUpdatedBlock: 221346,
    },
    {
        contractAddress: '020094d87a67c3492527770a503f4e924761894f9e27db05121659f3be583349fc0a',
        lastUpdatedBlock: 331346,
    },
    {
        contractAddress: '020094d87a67c3492527770a503f4e924761894f9e27db05121659f3be583349fc0a',
        lastUpdatedBlock: 441346,
    },
    {
        contractAddress: '020094d87a67c3492527770a503f4e924761894f9e27db05121659f3be583349fc0a',
        lastUpdatedBlock: 551346,
    },
    {
        contractAddress: '020094d87a67c3492527770a503f4e924761894f9e27db05121659f3be583349fc0a',
        lastUpdatedBlock: 661346,
    },
    {
        contractAddress: '020094d87a67c3492527770a503f4e924761894f9e27db05121659f3be583349fc0a',
        lastUpdatedBlock: 771346,
    },
    {
        contractAddress: '020094d87a67c3492527770a503f4e924761894f9e27db05121659f3be583349fc0a',
        lastUpdatedBlock: 881346,
    },
    {
        contractAddress: '020094d87a67c3492527770a503f4e924761894f9e27db05121659f3be583349fc0a',
        lastUpdatedBlock: 991346,
    },
    {
        contractAddress: '020094d87a67c3492527770a503f4e924761894f9e27db05121659f3be583349fc0a',
        lastUpdatedBlock: 1001346,
    },
    {
        contractAddress: '0200ddddddddd3492527770a503f4e924761894f9e27db05121659f3be583349dddd',
        lastUpdatedBlock: 2001346,
    },
];

type MatchInfo = {
    lastUpdatedBlock: number,
    contractAddress: string,
}

async function getLatestMatches(): Promise<MatchInfo[]> {
    // TODO: remove and replace with actual indexer
    if (Math.random() < 0.5) {
        return new Promise(resolve => setTimeout(resolve, 1337, []));
    }
    return new Promise(resolve => setTimeout(resolve, 1337, mockedMatches));
}

type RefreshingGrapihcs = {
    spinner: Phaser.GameObjects.Image,
    text: Phaser.GameObjects.Text,
};

const JOIN_WIDTH = 180;
const JOIN_HEIGHT = 240;
const JOIN_TITLE_HEIGHT = 32;
const MAX_MATCHES_SHOWN = 5;

class JoinGamesUI extends Phaser.GameObjects.Container {
    lobby: LobbyMenu;
    refreshing: RefreshingGrapihcs | undefined;
    matches: MatchInfo[];
    matchIndex: number;
    matchButtons: Button[];
    suggestPractice: boolean;


    constructor(lobby: LobbyMenu, x: number, y: number, title: string, suggestPractice: boolean) {
        super(lobby, x, y);
        this.lobby = lobby;
        this.matchButtons = [];
        this.matches = [];
        this.matchIndex = 0;
        this.suggestPractice = suggestPractice;
        const REFRESH_WIDTH = 32;
        this.add(lobby.add.nineslice(0, 0, 'stone_button', undefined, JOIN_WIDTH, JOIN_HEIGHT, 8, 8, 8, 8));
        this.add(lobby.add.text(-REFRESH_WIDTH / 2, JOIN_TITLE_HEIGHT / 2 - JOIN_HEIGHT / 2, title, fontStyle(14)).setOrigin(0.5, 0.65));
        this.add(new Button(lobby, JOIN_WIDTH / 2 - REFRESH_WIDTH / 2 - 2, JOIN_TITLE_HEIGHT / 2 - JOIN_HEIGHT / 2 + 2, REFRESH_WIDTH - 6, REFRESH_WIDTH - 6, '', 10, () => this.refreshGames(), 'Refresh match list'));
        this.add(lobby.add.image(JOIN_WIDTH / 2 - REFRESH_WIDTH / 2 - 2, JOIN_TITLE_HEIGHT / 2 - JOIN_HEIGHT / 2 + 2, 'refresh').setAlpha(0.8));
        lobby.add.existing(this);

        this.refreshGames();
    }

    refreshGames() {
        if (this.refreshing == undefined) {
            this.refreshing = {
                spinner: this.scene.add.image(0, -32, 'refresh').setScale(4, 4).setAlpha(0.6),
                text: this.scene.add.text(0, 32, 'Refreshing...', fontStyle(16)).setOrigin(0.5, 0.5),
            };
            this.add(this.refreshing.spinner);
            this.add(this.refreshing.text);
        }
        this.matchButtons.forEach((b) => b.destroy());
        this.matchButtons = [];
        this.matches = [];
        getLatestMatches().then((matches) => {
            this.refreshing?.spinner.destroy();
            this.refreshing?.text.destroy();
            this.refreshing = undefined;
            this.matches = matches.sort((a, b) => b.lastUpdatedBlock - a.lastUpdatedBlock);
            this.matchIndex = 0;
            this.makeMatchList();
        });
    }

    preUpdate() {
        if (this.refreshing != undefined) {
            this.refreshing.spinner.angle += 0.7;
        }
    }

    makeMatchList() {
        const JOIN_BORDER = 8;
        const MATCH_HEIGHT = 32;
        const MATCH_GAP = 8;
        const SCROLL_WIDTH = 32;

        this.matchButtons.forEach((b) => b.destroy());
        this.matchButtons = this
            .matches
            .slice(this.matchIndex, this.matchIndex + MAX_MATCHES_SHOWN)
            .map((match, i) => {
                const button = new Button(
                    this.lobby,
                    -SCROLL_WIDTH / 2,
                    -(JOIN_HEIGHT - JOIN_TITLE_HEIGHT) / 2 + JOIN_TITLE_HEIGHT + JOIN_BORDER + i * (MATCH_HEIGHT + MATCH_GAP),
                    JOIN_WIDTH - 2 * JOIN_BORDER - SCROLL_WIDTH,
                    MATCH_HEIGHT,
                    `${contractAddressShortString(match.contractAddress)}\nlast update: ${match.lastUpdatedBlock}`,
                    7,
                    () => this.lobby.join(match.contractAddress),
                );
                this.add(button);
                return button;
            });
        if (this.matchIndex > 0) {
            const scrollUp = new Button(
                this.scene,
                JOIN_WIDTH / 2 - SCROLL_WIDTH / 2 - 2,
                -(JOIN_HEIGHT - JOIN_TITLE_HEIGHT) / 2 + JOIN_TITLE_HEIGHT + JOIN_BORDER,
                SCROLL_WIDTH - 6,
                SCROLL_WIDTH - 6,
                '^',
                12,
                () => {
                    this.matchIndex -= MAX_MATCHES_SHOWN;
                    this.makeMatchList();
                },
            );
            this.add(scrollUp);
            this.matchButtons.push(scrollUp);
        }
        if (this.matchIndex + MAX_MATCHES_SHOWN < this.matches.length) {
            const scrollDown = new Button(
                this.scene,
                JOIN_WIDTH / 2 - SCROLL_WIDTH / 2 - 2,
                -(JOIN_HEIGHT - JOIN_TITLE_HEIGHT) / 2 + JOIN_TITLE_HEIGHT + JOIN_BORDER + (MAX_MATCHES_SHOWN - 1) * (MATCH_HEIGHT + MATCH_GAP),
                SCROLL_WIDTH - 6,
                SCROLL_WIDTH - 6,
                'v',
                12,
                () => {
                    this.matchIndex += MAX_MATCHES_SHOWN;
                    this.makeMatchList();
                },
            );
            this.add(scrollDown);
            this.matchButtons.push(scrollDown);
        }
        if (this.suggestPractice && this.matches.length == 0) {
            const practiceButton = new Button(
                this.scene,
                0,
                0,
                JOIN_WIDTH - 2 * JOIN_BORDER - SCROLL_WIDTH,
                MATCH_HEIGHT * 2,
                'No matches found.\nClick here to play a practice match.',
                7,
                () => this.lobby.joinPractice(),
                'Play a match against a local computer AI'
            );
            this.add(practiceButton);
            this.matchButtons.push(practiceButton);
        }
    }
}

export class LobbyMenu extends Phaser.Scene {
    deployProvider: BrowserDeploymentManager;
    joinPublc: JoinGamesUI | undefined;
    rejoin: JoinGamesUI | undefined;
    statusText: Phaser.GameObjects.Text | undefined;
    joinByAddress: Button | undefined;
    back: Button | undefined;
    

    constructor(deployProvider: BrowserDeploymentManager) {
        super('LobbyMenu');
        this.deployProvider = deployProvider;
    }

    preload() {
        this.load.image('refresh', 'refresh.png');
    }

    create() {
        this.joinPublc = new JoinGamesUI(this, GAME_WIDTH / 4, GAME_HEIGHT / 2, 'Public Matches', true);
        this.rejoin = new JoinGamesUI(this, 3 * GAME_WIDTH / 4, GAME_HEIGHT / 2, 'Your Matches', false);
        this.statusText = this
            .add
            .text(
                GAME_WIDTH / 2,
                GAME_HEIGHT / 2,
                '',
                fontStyle(8, { wordWrap: { width: GAME_WIDTH - 64 } }))
            .setVisible(false)
            .setOrigin(0.5, 0.5);
        this.add.image(GAME_WIDTH, GAME_HEIGHT, 'arena_bg').setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(-3);
        const BUTTON_GAP = 6;
        const BUTTON_WIDTH = JOIN_WIDTH / 2 - BUTTON_GAP;
        const BUTTON_HEIGHT = 32;
        const BUTTON_Y = JOIN_HEIGHT + 2 * BUTTON_HEIGHT + BUTTON_GAP * 3;
        this.joinByAddress = new Button(
            this,
            GAME_WIDTH / 4 - BUTTON_GAP - BUTTON_WIDTH / 2,
            BUTTON_Y,
            BUTTON_WIDTH,
            BUTTON_HEIGHT,
            'Direct Join',
            10,
            () => {
                const address = window.prompt('Copy contract address to join directly');
                if (address != undefined) {
                    this.join(address);
                }
            },
            'Join a match by pasting the contract address'
        );
        this.back = new Button(
            this,
            GAME_WIDTH / 4 + BUTTON_GAP + BUTTON_WIDTH / 2,
            BUTTON_Y,
            BUTTON_WIDTH,
            BUTTON_HEIGHT,
            'Back',
            11,
            () => {
                this.scene.remove('MainMenu');
                this.scene.add('MainMenu', new MainMenu());
                this.scene.start('MainMenu');
            },
            'Return to main menu'
        );
    }

    join(contractAddress: string) {
        this.setStatusText('Joining match, please wait...');
        this.deployProvider.join(contractAddress).then((api) => {
            this.scene.remove('EquipmentMenu');
            const equipMenu = new EquipmentMenu({ api, isP1: false });
            this.scene.add('EquipmentMenu', equipMenu);
            this.scene.start('EquipmentMenu');
        }).catch((e) => {
            const errorString = `Error joining match:\n${e}`;
            console.log(errorString);
            this.statusText?.setText(errorString);
            const statusButton = new Button(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 128, 128, 32, 'Back', 12, () => {
                this.clearStatusText();
                statusButton.destroy();
            });
        });
    }

    joinPractice() {
        this.setStatusText('Entering mocked test arena...');
        setTimeout(() => {
            this.scene.remove('EquipmentMenu');
            this.scene.add('EquipmentMenu', new EquipmentMenu({ api: new MockPVPArenaAPI(true), isP1: true }));
            this.scene.start('EquipmentMenu');
        }, 1000);
    }

    private clearStatusText() {
        this.joinPublc?.setVisible(true);
        this.rejoin?.setVisible(true);
        this.statusText?.setVisible(false);
        this.joinByAddress?.setVisible(true);
        this.back?.setVisible(true);
    }

    private setStatusText(text: string) {
        this.joinPublc?.setVisible(false);
        this.rejoin?.setVisible(false);
        this.joinByAddress?.setVisible(false);
        this.back?.setVisible(false);
        this.statusText!.visible = true;
        this.statusText?.setText(text);
    }
}

export function contractAddressShortString(contractAddress: string): string {
    return `${contractAddress.slice(undefined, 8)}...${contractAddress.slice(-8)}`;
}