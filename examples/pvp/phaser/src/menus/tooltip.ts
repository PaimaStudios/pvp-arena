import { toLowerCase } from "fp-ts/lib/string";
import { fontStyle } from "../main";
import { Button } from "./button";
import { boolean } from "fp-ts";

export enum TooltipId {
    EquipExplain1,
    EquipExplain2,
    EquipExplain3,
    EquipExplain4,
    PlayPracticeFirst,
    SelectHero,
    Move,
    MoveCloser,
    MoveFurther,
    SetFirstAttack,
    SetAllAttacks,
    ExitInProgressMatch,
};

const localStorageId = (id: TooltipId) => `seen_tooltip_${id}`;

function tooltipString(id: TooltipId): string {
    switch (id) {
        case TooltipId.EquipExplain1:
            return 'Select your gladiators\' weapons and armor. Players will take turns to give a chance to counter your opponent\'s choices.';
        case TooltipId.EquipExplain2:
            return 'Damage is divided into pierce and crush types. Axes deal more crush damage, while bows and spears deal more pierce damage';
        case TooltipId.EquipExplain3:
            return 'There is also a dexterity bonus based on the difference betwen your weight and the opponent\'s weight.';
        case TooltipId.EquipExplain4:
            return 'Certain weapons, in particular swords and bows, have a higher dexterity bonus.';
        case TooltipId.PlayPracticeFirst:
            return 'It is recommended to play a practice match first to learn how to play.';
        case TooltipId.SelectHero:
            return 'Click on one of your gladiators to control them.';
        case TooltipId.Move:
            return 'Click on the move icons to change stances.';
        case TooltipId.MoveCloser:
            return 'Moving closer increases the damage you deal, but also increases the damage you receive.';
        case TooltipId.MoveFurther:
            return 'Moving away decreases the damage you receive, but also decreases the damage you deal.';
        case TooltipId.SetAllAttacks:
            return 'Confirm a target for your other 2 gladiators and commit your move.';
        case TooltipId.SetFirstAttack:
            return 'Click on an enemy gladiator to target them.';
        case TooltipId.ExitInProgressMatch:
            return 'Click again to close the match. It can be resumed at any point from the Join menu.';
    }
}

const openTooltips: Map<TooltipId, Tooltip> = new Map();

export class Tooltip extends Phaser.GameObjects.Container {
    current: number;
    messages: TooltipId[];
    width: number;

    constructor(scene: Phaser.Scene, x: number, y: number, messages: TooltipId[], options?: TooltipOptions) {
        super(scene, x, y);
        this.width = options?.width ?? 128;
        this.current = 0;
        this.messages = messages;
        this.refresh();
        options?.clickHighlights?.forEach((clickHighlight) => {
            const clickHere = scene.add.sprite(clickHighlight.x - x, clickHighlight.y - y, 'click_here').setAlpha(0);
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
        });
    }

    protected preDestroy(): void {
        const matchedIds = openTooltips.entries().filter(([id, tooltip]) => tooltip == this);
        matchedIds.forEach(([id, tooltip]) => openTooltips.delete(id));
    }

    public close() {
        // just needs to exist, the 'true' is arbitrary
        const id = this.messages[this.current];
        localStorage.setItem(localStorageId(id), 'true');
        openTooltips.delete(id);
        ++this.current;
        this.removeAll(true);
        this.refresh();
    }

    private refresh() {
        if (this.current < this.messages.length) {
            const id = this.messages[this.current];
            const border = 4;
            const text = this.scene.add.text(border, 0, tooltipString(id), fontStyle(10, {
                wordWrap: { width: this.width },
            })).setOrigin(0.5, 0.5);
            
            const w = text.width + 2 * border;
            const h = text.height + 2 * border;
            const bg = this.scene.add.nineslice(0, 0, 'stone_button', undefined, w + 2 * border, h + 2 * border, 8, 8, 8, 8);
            this.add(bg);
            this.add(text);
            
            
            const close = new Button(this.scene, w / 2, -h / 2, 16, 16, 'x', 10, () => this.close(), 'Close');
            this.add(close);

            openTooltips.set(id, this);
        } else {
            this.destroy();
        }
    }
}

export type TooltipOptions = {
    width?: number,
    clickHighlights?: Phaser.Math.Vector2[],
};

/// closes a tooltip if it's open. marks it as read regardless of if seen or not
export const closeTooltip = (id: TooltipId) => openTooltips.get(id)?.close();

export const isTooltipOpen = (id: TooltipId) => openTooltips.get(id) != undefined;

export function makeTooltip(scene: Phaser.Scene, x: number, y: number, ids: TooltipId | TooltipId[], options?: TooltipOptions): Tooltip | undefined {
    // TODO: need separate key or is by message enough?
    if (!Array.isArray(ids)) {
        ids = [ids];
    }
    const unseenMessages = ids.filter((id) => localStorage.getItem(localStorageId(id)) == null);
    if (unseenMessages.length != 0 && unseenMessages.every((id) => openTooltips.get(id) == undefined)) {
        const tooltip = new Tooltip(scene, x, y, unseenMessages, options);
        scene.add.existing(tooltip);
        return tooltip;
    }
    return undefined;
}
