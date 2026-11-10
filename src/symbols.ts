// Schematic symbols drawn inside each part's outline, as SVG path data.
// The same strings feed `new Path2D(d)` on the board canvas and `<path d>`
// in the parts list.
//
// Two-terminal symbols live in a box from (-1, -0.5) to (1, 0.5) with pin 1
// on the left (x = -1): on the board they are turned so pin 1 points at the
// part's pad 1. KiCad puts a diode's or LED's cathode on pad 1 and a
// polarized capacitor's or battery's plus on pad 1, so the bar of the diode
// and the "+" of the capacitor land on the right pad. Other symbols are
// centered in their own box and keep the footprint's orientation.

import type { Kind } from "./classify";

export interface SymbolDef {
    d: string;
    // Box size; the path spans -w/2..w/2 by -h/2..h/2.
    w: number;
    h: number;
    // Turned along the pin 1 to pin 2 axis.
    twoPin: boolean;
}

const ZIGZAG = "M-1 0H-0.6L-0.5-0.3L-0.3 0.3L-0.1-0.3L0.1 0.3L0.3-0.3L0.5 0.3L0.6 0H1";
const CIRCLE = (cx: number, cy: number, r: number) =>
    `M${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}`;

const two = (d: string): SymbolDef => ({ d, w: 2, h: 1, twoPin: true });
const square = (d: string): SymbolDef => ({ d, w: 1, h: 1, twoPin: false });
const wide = (d: string): SymbolDef => ({ d, w: 2, h: 1, twoPin: false });

export const SYMBOLS: Record<Kind, SymbolDef> = {
    // US zigzag resistor.
    resistor: two(ZIGZAG),
    // Three resistor bodies side by side.
    resistor_array: square("M-0.4-0.38H0.4V-0.2H-0.4ZM-0.4-0.09H0.4V0.09H-0.4ZM-0.4 0.2H0.4V0.38H-0.4Z"),
    // Zigzag with a wiper arrow from below.
    potentiometer: wide(`${ZIGZAG}M0 0.5V0.32M-0.1 0.44L0 0.32L0.1 0.44`),
    // Zigzag crossed by a slanted line with a foot.
    thermistor: two(`${ZIGZAG}M-0.5 0.45L0.5-0.45H0.7`),
    capacitor: two("M-1 0H-0.12M-0.12-0.42V0.42M0.12-0.42V0.42M0.12 0H1"),
    // Straight plate is plus (pin 1), curved plate is minus.
    capacitor_polarized: two("M-1 0H-0.12M-0.12-0.42V0.42M0.3-0.42Q0.06 0 0.3 0.42M0.18 0H1M-0.5-0.37H-0.26M-0.38-0.49V-0.25"),
    // Four humps.
    inductor: two("M-1 0H-0.6A0.15 0.15 0 0 1-0.3 0A0.15 0.15 0 0 1 0 0A0.15 0.15 0 0 1 0.3 0A0.15 0.15 0 0 1 0.6 0H1"),
    // Slanted block on a line.
    ferrite: two("M-1 0H-0.22M0.22 0H1M0.32-0.09L0.14-0.3L-0.32 0.09L-0.14 0.3Z"),
    // Two coils around a core.
    transformer: square(
        "M-0.5-0.4H-0.15A0.1 0.1 0 0 0-0.15-0.2A0.1 0.1 0 0 0-0.15 0A0.1 0.1 0 0 0-0.15 0.2A0.1 0.1 0 0 0-0.15 0.4H-0.5" +
            "M0.5-0.4H0.15A0.1 0.1 0 0 1 0.15-0.2A0.1 0.1 0 0 1 0.15 0A0.1 0.1 0 0 1 0.15 0.2A0.1 0.1 0 0 1 0.15 0.4H0.5" +
            "M-0.03-0.42V0.42M0.03-0.42V0.42",
    ),
    // Bar (cathode, pin 1) and a triangle pointing at it.
    diode: two("M-1 0H-0.25M0.3 0H1M-0.25-0.35V0.35M-0.25 0L0.3-0.35V0.35Z"),
    // Diode with two arrows of light.
    led: two(
        "M-1 0H-0.2M0.25 0H1M-0.2-0.28V0.28M-0.2 0L0.25-0.28V0.28Z" +
            "M-0.06-0.31L0.12-0.47M0.03-0.48H0.12V-0.39M0.14-0.31L0.32-0.47M0.23-0.48H0.32V-0.39",
    ),
    // NPN transistor in a circle.
    bjt: square(
        `${CIRCLE(0.05, 0, 0.42)}M-0.5 0H-0.15M-0.15-0.25V0.25M-0.15-0.08L0.2-0.3V-0.5M-0.15 0.08L0.2 0.3V0.5` +
            "M0.148 0.192L0.2 0.3L0.08 0.291",
    ),
    // N-channel MOSFET in a circle.
    mosfet: square(
        `${CIRCLE(0.02, 0, 0.42)}M-0.5 0.24H-0.26V-0.26M-0.12-0.3V-0.14M-0.12-0.08V0.08M-0.12 0.14V0.3` +
            "M-0.12-0.22H0.2V-0.5M-0.12 0.22H0.2V0.5M-0.12 0H0.2V0.22M0.02-0.07L-0.1 0L0.02 0.07",
    ),
    // Chip with legs and a notch at pin 1's end.
    ic: square(
        "M-0.3-0.4H-0.08A0.08 0.08 0 0 0 0.08-0.4H0.3V0.4H-0.3Z" +
            "M-0.45-0.25H-0.3M-0.45 0H-0.3M-0.45 0.25H-0.3M0.3-0.25H0.45M0.3 0H0.45M0.3 0.25H0.45",
    ),
    // Quartz between two plates.
    crystal: wide("M-1 0H-0.4M-0.4-0.32V0.32M0.4-0.32V0.32M0.4 0H1M-0.22-0.42H0.22V0.42H-0.22Z"),
    // Three pins ending in sockets.
    connector: square(
        "M-0.45-0.3H0.1M-0.45 0H0.1M-0.45 0.3H0.1" +
            "M0.1-0.38H0.3V-0.22H0.1ZM0.1-0.08H0.3V0.08H0.1ZM0.1 0.22H0.3V0.38H0.1Z",
    ),
    // Push button: open contact with a plunger.
    switch: wide("M-1 0.2H-0.5M0.5 0.2H1M-0.5 0.2L0.45-0.1M0-0.03V-0.42M-0.2-0.42H0.2" + CIRCLE(-0.5, 0.2, 0.05) + CIRCLE(0.5, 0.2, 0.05)),
    // Coil box and a contact.
    relay: square("M-0.45-0.25H-0.1V0.25H-0.45ZM-0.45 0.25L-0.1-0.25M0.15 0.45V0.3L0.42-0.2M0.42-0.45V-0.3M0.42 0.45V0.3"),
    // Box with the line through it.
    fuse: two("M-1 0H1M-0.45-0.2H0.45V0.2H-0.45Z"),
    // Long plate is plus (pin 1).
    battery: two("M-1 0H-0.15M-0.15-0.42V0.42M0.15-0.22V0.22M0.15 0H1M-0.5-0.37H-0.3M-0.4-0.47V-0.27"),
    // Speaker.
    buzzer: square("M-0.42-0.15H-0.18V0.15H-0.42ZM-0.18-0.15L0.18-0.4V0.4L-0.18 0.15"),
    antenna: square("M0 0.45V-0.4M-0.35-0.4L0 0.02L0.35-0.4ZM-0.35-0.4"),
    // Two half pads facing each other (solder jumper).
    jumper: two("M-1 0H-0.35M0.35 0H1M-0.1-0.25A0.25 0.25 0 0 0-0.1 0.25ZM0.1-0.25A0.25 0.25 0 0 1 0.1 0.25Z"),
    module: square("M-0.42-0.42H0.42V0.42H-0.42ZM-0.42-0.18H-0.18V-0.42"),
    testpoint: square(`${CIRCLE(0, -0.15, 0.2)}M0 0.05V0.45`),
    mounting_hole: square(`${CIRCLE(0, 0, 0.4)}M-0.28-0.28L0.28 0.28M-0.28 0.28L0.28-0.28`),
    fiducial: square(`${CIRCLE(0, 0, 0.25)}M-0.45 0H0.45M0-0.45V0.45`),
    logo: square(""),
    other: square("M-0.3-0.3H0.3V0.3H-0.3ZM-0.3-0.3L0.3 0.3"),
};

// An <svg> for the parts list, sized by CSS.
export function symbolSvg(kind: Kind): string {
    const s = SYMBOLS[kind];
    const pad = 0.12;
    const vb = `${-s.w / 2 - pad} ${-s.h / 2 - pad} ${s.w + 2 * pad} ${s.h + 2 * pad}`;
    return `<svg class="sym" viewBox="${vb}" aria-hidden="true"><path d="${s.d}"/></svg>`;
}
