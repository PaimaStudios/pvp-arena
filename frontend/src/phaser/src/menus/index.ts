import { fontStyle, GAME_HEIGHT, GAME_WIDTH } from "../main";
import { Button } from "./button";

export class StatusUI {
    uiElements: Phaser.GameObjects.Components.Visible[];
    scene: Phaser.Scene;
    text: Phaser.GameObjects.Text;
    private progressTimers: Phaser.Time.TimerEvent[] = [];

    constructor(scene: Phaser.Scene, uiElements: Phaser.GameObjects.Components.Visible[]) {
        this.uiElements = uiElements;
        this.scene = scene;
        this.text = scene.add.text(
            GAME_WIDTH / 2,
            GAME_HEIGHT * 0.65,
            '',
            fontStyle(12, { wordWrap: { width: GAME_WIDTH - 64 } })
        )
            .setOrigin(0.5, 0.65)
            .setVisible(false);
    }

    public registerUi(uiElement: Phaser.GameObjects.Components.Visible) {
        this.uiElements.push(uiElement);
    }

    public setError(e: Error, onClick?: () => void, override?: string) {
        const errorString = `Error:\n${e}`;
        console.log(errorString);
        this.setText(errorString);
        this.text.y = GAME_HEIGHT / 2;
        const statusButton = new Button(
            this.scene,
            GAME_WIDTH / 2,
            GAME_HEIGHT / 2 + 128,
            128,
            32,
            override ?? 'Back',
            12,
            () => {
                this.clearStatusText();
                statusButton.destroy();
                if (onClick != undefined) {
                    onClick();
                }
            }
        );
    }

    /**
     * Show the first stage immediately, then cycle through subsequent stages
     * at the specified delays (in ms, measured from when this is called).
     * Each stage replaces the previous message so the player sees progress.
     */
    public setProgressText(stages: Array<{ text: string; delay: number }>) {
        this.clearProgressTimers();
        if (stages.length === 0) return;
        this.setText(stages[0].text);
        for (let i = 1; i < stages.length; i++) {
            const { text, delay } = stages[i];
            this.progressTimers.push(
                this.scene.time.delayedCall(delay, () => {
                    if (this.text.visible) this.text.setText(text);
                })
            );
        }
    }

    public setText(text: string) {
        this.clearProgressTimers();
        this.uiElements.forEach((e) => e.setVisible(false));
        this.text!.visible = true;
        this.text?.setText(text);
        this.text.y = GAME_HEIGHT * 0.9;
    }

    public clearStatusText() {
        this.clearProgressTimers();
        this.uiElements.forEach((e) => e.setVisible(true));
        this.text!.visible = false;
    }

    private clearProgressTimers() {
        this.progressTimers.forEach((t) => t.remove());
        this.progressTimers = [];
    }
}
