// The parts list as a bottom sheet over the board: drag its header up or
// down to resize it, tap the header to collapse or expand it. The height is
// kept as a fraction of the board area so it suits any screen.

import { loadSheetFraction, saveSheetFraction } from "./store";

const MAX_FRACTION = 0.92;

export class Sheet {
    readonly el: HTMLElement;
    private head: HTMLElement;
    private stage: HTMLElement;
    private frac = loadSheetFraction();
    collapsed = false;
    // Called whenever the sheet's height changes.
    onChange: () => void = () => {};
    private drag: { y: number; h: number; moved: boolean } | null = null;
    private observer: ResizeObserver;

    constructor(stage: HTMLElement, el: HTMLElement, head: HTMLElement) {
        this.stage = stage;
        this.el = el;
        this.head = head;
        this.apply();
        head.addEventListener("pointerdown", (e) => this.down(e));
        head.addEventListener("pointermove", (e) => this.move(e));
        head.addEventListener("pointerup", (e) => this.up(e));
        head.addEventListener("pointercancel", () => {
            this.drag = null;
            this.apply();
        });
        this.observer = new ResizeObserver(() => this.onChange());
        this.observer.observe(el);
    }

    destroy(): void {
        this.observer.disconnect();
    }

    // Height of the board area the sheet covers, in CSS pixels.
    covered(): number {
        return this.el.getBoundingClientRect().height;
    }

    setCollapsed(c: boolean): void {
        this.collapsed = c;
        this.apply();
    }

    toggle(): void {
        this.setCollapsed(!this.collapsed);
    }

    private apply(): void {
        this.el.classList.toggle("collapsed", this.collapsed);
        this.el.style.height = this.collapsed ? "" : `${(this.frac * 100).toFixed(2)}%`;
        this.head.setAttribute("aria-expanded", String(!this.collapsed));
    }

    private headHeight(): number {
        return this.head.getBoundingClientRect().height;
    }

    private down(e: PointerEvent): void {
        if ((e.target as Element).closest("button, input, a")) return;
        this.head.setPointerCapture(e.pointerId);
        this.drag = { y: e.clientY, h: this.covered(), moved: false };
    }

    private move(e: PointerEvent): void {
        const d = this.drag;
        if (!d) return;
        const dy = d.y - e.clientY;
        if (!d.moved && Math.abs(dy) < 5) return;
        d.moved = true;
        const max = this.stage.clientHeight * MAX_FRACTION;
        const h = Math.max(this.headHeight(), Math.min(max, d.h + dy));
        this.el.classList.remove("collapsed");
        this.el.style.height = `${h}px`;
    }

    private up(e: PointerEvent): void {
        const d = this.drag;
        this.drag = null;
        if (!d) return;
        if (!d.moved) {
            this.toggle();
            return;
        }
        const h = this.covered();
        const stageH = this.stage.clientHeight || 1;
        // Dragged nearly shut: collapse and keep the last open height.
        if (h < this.headHeight() + 0.06 * stageH || e.type !== "pointerup") {
            this.setCollapsed(true);
            return;
        }
        this.frac = Math.min(MAX_FRACTION, h / stageH);
        saveSheetFraction(this.frac);
        this.collapsed = false;
        this.apply();
    }
}
