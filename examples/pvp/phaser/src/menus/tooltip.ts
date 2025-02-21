import { fontStyle } from "../main";
import { Button } from "./button";

// TODO: store these properly in some global settings store
const tooltipStore: Set<string> = new Set();

export class Tooltip extends Phaser.GameObjects.Container {
    current: number;
    messages: string[];
    width: number;

    constructor(scene: Phaser.Scene, x: number, y: number, messages: string[], options?: TooltipOptions) {
        super(scene, x, y);
        this.width = options?.width ?? 128;
        this.current = 0;
        this.messages = messages;
        this.refresh();
        if (options?.clickHighlight != undefined) {
            console.log(`clickHere: ${options.clickHighlight.x - x}, ${options.clickHighlight.y - y}`);
            const clickHere = scene.add.sprite(options.clickHighlight.x - x, options.clickHighlight.y - y, 'click_here').setAlpha(0);
            this.add(clickHere);
            clickHere.anims.play({
                key: 'click_here',
                duration: 1000,
                repeat: -1,
            });
            scene.tweens.add({
                targets: clickHere,
                alpha: 0.85,
                delay: 200,
                duration: 750,
            });
        }
    }

    private refresh() {
        if (this.current < this.messages.length) {
            const border = 4;
            const text = this.scene.add.text(border, 0, this.messages[this.current], fontStyle(10, {
                wordWrap: { width: this.width },
            })).setOrigin(0.5, 0.5);
            
            const w = text.width + 2 * border;
            const h = text.height + 2 * border;
            const bg = this.scene.add.nineslice(0, 0, 'stone_button', undefined, w + 2 * border, h + 2 * border, 8, 8, 8, 8);
            this.add(bg);
            this.add(text);
            
            
            const close = new Button(this.scene, w / 2, -h / 2, 16, 16, 'x', 10, () => {
                tooltipStore.add(this.messages[this.current]);
                ++this.current;
                this.removeAll(true);
                this.refresh();
            }, 'Close');
            this.add(close);
        } else {
            this.destroy();
        }
    }
}

export type TooltipOptions = {
    width?: number,
    clickHighlight?: Phaser.Math.Vector2,
};

export function makeTooltip(scene: Phaser.Scene, x: number, y: number, message: string | string[], options?: TooltipOptions) {
    console.log(`Tooltip(${message})`);
    // TODO: need separate key or is by message enough?
    if (typeof message == 'string') {
        message = [message];
    }
    const unseenMessages = message.filter((m) => !tooltipStore.has(m));
    if (unseenMessages.length != 0) {
        const tooltip = new Tooltip(scene, x, y, message, options);
        scene.add.existing(tooltip);
        return tooltip;
    }
}
