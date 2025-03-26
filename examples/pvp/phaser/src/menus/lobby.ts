import { PVPArenaAPI } from "@midnight-ntwrk/pvp-api";
import { MockPVPArenaAPI } from "../battle/mockapi";
import { fontStyle, GAME_HEIGHT, GAME_WIDTH, joinContract, makeSoundToggleButton } from "../main";
import { BrowserDeploymentManager } from "../wallet";
import { Button } from "./button";
import { EquipmentMenu } from "./equipment";
import { MainMenu } from "./main";
import { PracticeMenu } from "./practice";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { GAME_STATE, pureCircuits } from "@midnight-ntwrk/pvp-contract";
import { Arena } from "../battle/arena";

type OpenMatchInfo = {
    lastUpdatedBlock: number;
    contractAddress: string;
};

const WON = "[color=green]Won[/color]";
const LOST = "[color=red]Lost[/color]";
const YOUR_TURN = "[color=yellow]Your turn[/color]";
const OPPONENT_TURN = "[b]Opponent's turn[/b]";
type PlayerMatchStatus =
    | typeof YOUR_TURN
    | typeof OPPONENT_TURN
    | typeof WON
    | typeof LOST
    | "Tie";

type PlayerMatchInfo = {
    lastUpdatedBlock: number;
    contractAddress: string;
    status: PlayerMatchStatus;
};

async function getOpenMatches(): Promise<OpenMatchInfo[]> {
    let batcherUrl = import.meta.env.VITE_BATCHER_MODE_BATCHER_URL;

    if (batcherUrl) {
        const playerPublicKey = await getPlayerPublicKey();

        const query = () =>
            fetch(
                `${batcherUrl}/lobbies/open?count=255&exclude_player=${playerPublicKey}`,
                {
                    method: "GET",
                }
            );

        const result = await query();

        const json: {
            address: string;
            block_height: number;
            p1_public_key: string;
        }[] = await result.json();

        return json.map((raw) => ({
            lastUpdatedBlock: raw.block_height,
            contractAddress: raw.address,
        }));
    } else {
        return [];
    }
}

let cachedPublicKey: Promise<string> | undefined;

async function getPlayerPublicKey(): Promise<string> {
    if (cachedPublicKey) {
        return cachedPublicKey;
    }

    const privateStateProvider = levelPrivateStateProvider({
        privateStateStoreName: "pvp-private-state",
    });

    cachedPublicKey = (async () => {
        const privateState =
            await PVPArenaAPI.getPrivateState(privateStateProvider);

        const commit = pureCircuits.derive_public_key(privateState?.secretKey);

        // for some reason that I don't understand the bytes are reversed when creating the bigint
        let hexBigEndian = commit.toString(16);

        if (hexBigEndian.length % 2 === 1) {
            hexBigEndian = `0${hexBigEndian}`;
        }

        const nibbles = hexBigEndian.split("");

        for (let i = 0; i < hexBigEndian.length; i += 2) {
            var tmp = nibbles[i];

            nibbles[i] = nibbles[i + 1];
            nibbles[i + 1] = tmp;
        }

        const publicKey = nibbles.reverse().join("");

        return publicKey;
    })();

    return cachedPublicKey!;
}

async function getPlayerMatches(): Promise<PlayerMatchInfo[]> {
    let batcherUrl = import.meta.env.VITE_BATCHER_MODE_BATCHER_URL;

    if (batcherUrl) {
        const pk = await getPlayerPublicKey();
        const query = () =>
            fetch(`${batcherUrl}/lobbies/player/${pk}?count=255`, {
                method: "GET",
            });

        const result = await query();

        const json: {
            address: string;
            block_height: number;
            p1_public_key: string;
            p2_public_key: string;
            state: string;
        }[] = await result.json();

        const isPlayerOneTurn = (state: number): boolean =>
            [
                GAME_STATE.p1_selecting_first_hero,
                GAME_STATE.p1_selecting_last_heroes,
                GAME_STATE.p1_commit,
                GAME_STATE.p1_reveal,
            ].some((s) => s === state);

        const isPlayerTwoTurn = (state: number): boolean =>
            [
                GAME_STATE.p2_selecting_first_heroes,
                GAME_STATE.p2_selecting_last_hero,
                GAME_STATE.p2_commit_reveal,
            ].some((s) => s === state);

        const matchStatus = (raw: (typeof json)[0]): PlayerMatchStatus => {
            const state = Number(raw.state);

            if (state === GAME_STATE.tie) {
                return "Tie";
            }

            if (raw.p1_public_key === pk) {
                if (state === GAME_STATE.p1_win) {
                    return WON;
                } else if (state === GAME_STATE.p2_win) {
                    return LOST;
                }

                if (isPlayerOneTurn(state)) {
                    return YOUR_TURN;
                }

                return OPPONENT_TURN;
            } else {
                if (state === GAME_STATE.p2_win) {
                    return WON;
                } else if (state === GAME_STATE.p1_win) {
                    return LOST;
                }

                if (isPlayerTwoTurn(state)) {
                    return YOUR_TURN;
                }

                return OPPONENT_TURN;
            }
        };

        return json.map((raw) => ({
            lastUpdatedBlock: raw.block_height,
            contractAddress: raw.address,
            status: matchStatus(raw),
        }));
    } else {
        return [];
    }
}

type RefreshingGrapihcs = {
    spinner: Phaser.GameObjects.Image;
    text: Phaser.GameObjects.Text;
};

const JOIN_WIDTH = 180;
const JOIN_HEIGHT = 240;
const JOIN_TITLE_HEIGHT = 32;

class JoinGamesUI<
    MatchInfo extends OpenMatchInfo | PlayerMatchInfo,
> extends Phaser.GameObjects.Container {
    lobby: LobbyMenu;
    refreshing: RefreshingGrapihcs | undefined;
    matches: MatchInfo[];
    matchIndex: number;
    matchButtons: Button[];
    suggestPractice: boolean;
    getMatches: () => Promise<MatchInfo[]>;
    maxMatchesShown: number;

    constructor(
        lobby: LobbyMenu,
        x: number,
        y: number,
        title: string,
        suggestPractice: boolean,
        getMatches: () => Promise<MatchInfo[]>,
        maxMatchesShown: number,
    ) {
        super(lobby, x, y);
        this.lobby = lobby;
        this.matchButtons = [];
        this.matches = [];
        this.matchIndex = 0;
        this.suggestPractice = suggestPractice;
        this.getMatches = getMatches;
        this.maxMatchesShown = maxMatchesShown;
        const REFRESH_WIDTH = 32;
        this.add(
            lobby.add.nineslice(
                0,
                0,
                "stone_button",
                undefined,
                JOIN_WIDTH,
                JOIN_HEIGHT,
                8,
                8,
                8,
                8
            )
        );
        this.add(
            lobby.add
                .text(
                    -REFRESH_WIDTH / 2,
                    JOIN_TITLE_HEIGHT / 2 - JOIN_HEIGHT / 2,
                    title,
                    fontStyle(14)
                )
                .setOrigin(0.5, 0.65)
        );
        this.add(
            new Button(
                lobby,
                JOIN_WIDTH / 2 - REFRESH_WIDTH / 2 - 2,
                JOIN_TITLE_HEIGHT / 2 - JOIN_HEIGHT / 2 + 2,
                REFRESH_WIDTH - 6,
                REFRESH_WIDTH - 6,
                "",
                10,
                () => this.refreshGames(),
                "Refresh match list"
            )
        );
        this.add(
            lobby.add
                .image(
                    JOIN_WIDTH / 2 - REFRESH_WIDTH / 2 - 2,
                    JOIN_TITLE_HEIGHT / 2 - JOIN_HEIGHT / 2 + 2,
                    "refresh"
                )
                .setAlpha(0.8)
        );
        lobby.add.existing(this);

        this.refreshGames();
    }

    refreshGames() {
        if (this.refreshing == undefined) {
            this.refreshing = {
                spinner: this.scene.add
                    .image(0, -32, "refresh")
                    .setScale(4, 4)
                    .setAlpha(0.6),
                text: this.scene.add
                    .text(0, 32, "Refreshing...", fontStyle(16))
                    .setOrigin(0.5, 0.5),
            };
            this.add(this.refreshing.spinner);
            this.add(this.refreshing.text);
        }
        this.matchButtons.forEach((b) => b.destroy());
        this.matchButtons = [];
        this.matches = [];
        this.getMatches().then((matches) => {
            this.refreshing?.spinner.destroy();
            this.refreshing?.text.destroy();
            this.refreshing = undefined;
            this.matches = matches.sort(
                (a, b) => b.lastUpdatedBlock - a.lastUpdatedBlock
            );
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
        this.matchButtons = this.matches
            .slice(this.matchIndex, this.matchIndex + this.maxMatchesShown)
            .map((match, i) => {
                let buttonText = `${contractAddressShortString(match.contractAddress)}\nlast update: ${match.lastUpdatedBlock}`;

                if ("status" in match) {
                    buttonText = `${buttonText}\nstatus: ${match.status}`;
                }

                const button = new Button(
                    this.lobby,
                    -SCROLL_WIDTH / 2,
                    -(JOIN_HEIGHT - JOIN_TITLE_HEIGHT) / 2 +
                        JOIN_TITLE_HEIGHT +
                        JOIN_BORDER +
                        i *
                            (MATCH_HEIGHT +
                                MATCH_GAP +
                                ("status" in match ? 12 : 0)),
                    JOIN_WIDTH - 2 * JOIN_BORDER - SCROLL_WIDTH,
                    MATCH_HEIGHT + ("status" in match ? 16 : 0),
                    buttonText,
                    7,
                    () => this.lobby.join(match.contractAddress)
                );
                this.add(button);
                return button;
            });
        if (this.matchIndex > 0) {
            const scrollUp = new Button(
                this.scene,
                JOIN_WIDTH / 2 - SCROLL_WIDTH / 2 - 2,
                -(JOIN_HEIGHT - JOIN_TITLE_HEIGHT) / 2 +
                    JOIN_TITLE_HEIGHT +
                    JOIN_BORDER,
                SCROLL_WIDTH - 6,
                SCROLL_WIDTH - 6,
                "^",
                12,
                () => {
                    this.matchIndex -= this.maxMatchesShown;
                    this.makeMatchList();
                }
            );
            this.add(scrollUp);
            this.matchButtons.push(scrollUp);
        }
        if (this.matchIndex + this.maxMatchesShown < this.matches.length) {
            const scrollDown = new Button(
                this.scene,
                JOIN_WIDTH / 2 - SCROLL_WIDTH / 2 - 2,
                -(JOIN_HEIGHT - JOIN_TITLE_HEIGHT) / 2 +
                    JOIN_TITLE_HEIGHT +
                    JOIN_BORDER +
                    (this.maxMatchesShown - 1) * (MATCH_HEIGHT + MATCH_GAP),
                SCROLL_WIDTH - 6,
                SCROLL_WIDTH - 6,
                "v",
                12,
                () => {
                    this.matchIndex += this.maxMatchesShown;
                    this.makeMatchList();
                }
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
                "No matches found.\nClick here to play a practice match.",
                7,
                () => this.lobby.joinPractice(),
                "Play a match against a local computer AI"
            );
            this.add(practiceButton);
            this.matchButtons.push(practiceButton);
        }
    }
}

export class LobbyMenu extends Phaser.Scene {
    deployProvider: BrowserDeploymentManager;
    joinPublc: JoinGamesUI<OpenMatchInfo> | undefined;
    rejoin: JoinGamesUI<PlayerMatchInfo> | undefined;
    statusText: Phaser.GameObjects.Text | undefined;
    joinByAddress: Button | undefined;
    back: Button | undefined;
    pk: string | undefined;

    constructor(deployProvider: BrowserDeploymentManager) {
        super("LobbyMenu");
        this.deployProvider = deployProvider;
    }

    preload() {
        this.load.image("refresh", "refresh.png");
    }

    create() {
        this.joinPublc = new JoinGamesUI(
            this,
            GAME_WIDTH / 4,
            GAME_HEIGHT / 2,
            "Public Matches",
            true,
            () => getOpenMatches(),
            5
        );
        this.rejoin = new JoinGamesUI(
            this,
            (3 * GAME_WIDTH) / 4,
            GAME_HEIGHT / 2,
            "Your Matches",
            false,
            () => getPlayerMatches(),
            4
        );
        this.statusText = this.add
            .text(
                GAME_WIDTH / 2,
                GAME_HEIGHT / 2,
                "",
                fontStyle(8, { wordWrap: { width: GAME_WIDTH - 64 } })
            )
            .setVisible(false)
            .setOrigin(0.5, 0.5);
        this.add
            .image(GAME_WIDTH, GAME_HEIGHT, "arena_bg")
            .setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2)
            .setDepth(-3);
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
            "Direct Join",
            10,
            () => {
                const address = window.prompt(
                    "Copy contract address to join directly"
                );
                if (address != undefined) {
                    this.join(address);
                }
            },
            "Join a match by pasting the contract address"
        );
        this.back = new Button(
            this,
            GAME_WIDTH / 4 + BUTTON_GAP + BUTTON_WIDTH / 2,
            BUTTON_Y,
            BUTTON_WIDTH,
            BUTTON_HEIGHT,
            "Back",
            11,
            () => {
                this.scene.remove("MainMenu");
                this.scene.add("MainMenu", new MainMenu());
                this.scene.start("MainMenu");
            },
            "Return to main menu"
        );
        makeSoundToggleButton(this, GAME_WIDTH - 16, 16);
    }

    join(contractAddress: string) {
        this.setStatusText("Joining match, please wait...");
        joinContract(this.deployProvider, contractAddress)
            .then((joinInfo) => {
                switch (joinInfo.state.state) {
                    case GAME_STATE.p1_selecting_first_hero:
                    case GAME_STATE.p1_selecting_last_heroes:
                    case GAME_STATE.p2_selecting_last_hero:
                    case GAME_STATE.p2_selecting_first_heroes:
                        this.scene.remove("EquipmentMenu");
                        this.scene.add("EquipmentMenu", new EquipmentMenu(joinInfo.config));
                        this.scene.start("EquipmentMenu");
                        break;
                    case GAME_STATE.p1_commit:
                    case GAME_STATE.p1_reveal:
                    case GAME_STATE.p2_commit_reveal:
                    case GAME_STATE.p1_win:
                    case GAME_STATE.p2_win:
                    case GAME_STATE.tie:
                        this.scene.remove("Arena");
                        this.scene.add("Arena", new Arena(joinInfo.config, joinInfo.state));
                        this.scene.start("Arena");
                        break;
                }
            })
            .catch((e) => {
                const errorString = `Error joining match:\n${e}`;
                console.log(errorString);
                this.statusText?.setText(errorString);
                const statusButton = new Button(
                    this,
                    GAME_WIDTH / 2,
                    GAME_HEIGHT / 2 + 128,
                    128,
                    32,
                    "Back",
                    12,
                    () => {
                        this.clearStatusText();
                        statusButton.destroy();
                    }
                );
            });
    }

    joinPractice() {
        this.scene.remove('PracticeMenu');
        this.scene.add('PracticeMenu', new PracticeMenu(this.deployProvider));
        this.scene.start('PracticeMenu');
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
