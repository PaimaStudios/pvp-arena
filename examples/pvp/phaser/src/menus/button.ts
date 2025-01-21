export class Button extends Phaser.GameObjects.Container {
    bg: Phaser.GameObjects.Graphics;
    bgOver: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, fontSize: number, onClick: () => void) {
        super(scene, x, y);
        this.bg = scene.add.graphics({
            x: -w / 2,
            y: -h / 2,
            lineStyle: { width: 2, color: Phaser.Display.Color.GetColor(22, 41, 51) },
            fillStyle: { color: Phaser.Display.Color.GetColor(123, 146, 158) },
        }).fillRoundedRect(0, 0, w, h, 3).strokeRoundedRect(0, 0, w, h, 3);
        this.add(this.bg);
        this.bgOver = scene.add.graphics({
            x: -w / 2,
            y: -h / 2,
            lineStyle: { width: 2, color: Phaser.Display.Color.GetColor(22, 41, 51) },
            fillStyle: { color: Phaser.Display.Color.GetColor(112, 135, 148) },
        }).fillRoundedRect(-2, -2, w + 4, h + 4, 3).strokeRoundedRect(-2, -2, w + 4, h + 4, 3);
        this.bgOver.visible = false;
        this.add(this.bgOver);
        this.add(scene.add.text(0, 0, text, { fontSize, color: 'white' }).setOrigin(0.5, 0.5));

        this.setSize(w, h);
        this.setInteractive({
            useHandCursor: true,
            // hitArea: new Phaser.Geom.Rectangle(x, y, w, h),
            // hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        });
        this.on('pointerup', onClick);
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