import { fontStyle } from "../main";

export class Button extends Phaser.GameObjects.Container {
    bg: Phaser.GameObjects.NineSlice;
    bgOver: Phaser.GameObjects.NineSlice;
    text: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, fontSize: number, onClick: () => void, helpText?: string) {
        super(scene, x, y);
        this.bg = scene.add.nineslice(0, 0, 'stone_button', undefined, w, h, 8, 8, 8, 8);
        this.add(this.bg);
        this.bgOver = scene.add.nineslice(0, 0, 'stone_button_over', undefined, w + 4, h + 4, 8, 8, 8, 8);
        this.bgOver.visible = false;
        this.add(this.bgOver);
        this.text = scene.add.text(0, 0, text, fontStyle(fontSize)).setOrigin(0.5, 0.65)
        this.add(this.text);

        this.setSize(w, h);
        this.setInteractive({
            useHandCursor: true,
            // hitArea: new Phaser.Geom.Rectangle(x, y, w, h),
            // hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        });
        this.on('pointerup', () => {
            scene.sound.play('select');
            onClick();
        });
        this.on('pointerover', () => {
            this.bg.visible = false;
            this.bgOver.visible = true;
        });
        this.on('pointerout', () => {
            this.bg.visible = true;
            this.bgOver.visible = false;
        });

        scene.add.existing(this);
    }
}