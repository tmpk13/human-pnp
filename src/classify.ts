// What kind of part a footprint is, from its reference prefix, footprint
// library name, value and descriptions. The kind picks the symbol drawn
// in its outline, its place in the parts list, and how its value is read.

export type Kind =
    | "resistor"
    | "resistor_array"
    | "potentiometer"
    | "thermistor"
    | "capacitor"
    | "capacitor_polarized"
    | "inductor"
    | "ferrite"
    | "transformer"
    | "diode"
    | "led"
    | "bjt"
    | "mosfet"
    | "ic"
    | "crystal"
    | "connector"
    | "switch"
    | "relay"
    | "fuse"
    | "battery"
    | "buzzer"
    | "antenna"
    | "jumper"
    | "module"
    | "testpoint"
    | "mounting_hole"
    | "fiducial"
    | "logo"
    | "other";

// List order and display names.
export const KIND_INFO: Record<Kind, { label: string; order: number }> = {
    resistor: { label: "Resistor", order: 0 },
    resistor_array: { label: "Resistor array", order: 1 },
    potentiometer: { label: "Potentiometer", order: 2 },
    thermistor: { label: "Thermistor", order: 3 },
    capacitor: { label: "Capacitor", order: 4 },
    capacitor_polarized: { label: "Polarized capacitor", order: 5 },
    inductor: { label: "Inductor", order: 6 },
    ferrite: { label: "Ferrite bead", order: 7 },
    transformer: { label: "Transformer", order: 8 },
    diode: { label: "Diode", order: 9 },
    led: { label: "LED", order: 10 },
    bjt: { label: "Transistor", order: 11 },
    mosfet: { label: "MOSFET", order: 12 },
    ic: { label: "IC", order: 13 },
    crystal: { label: "Crystal", order: 14 },
    connector: { label: "Connector", order: 15 },
    switch: { label: "Switch", order: 16 },
    relay: { label: "Relay", order: 17 },
    fuse: { label: "Fuse", order: 18 },
    battery: { label: "Battery", order: 19 },
    buzzer: { label: "Buzzer", order: 20 },
    antenna: { label: "Antenna", order: 21 },
    jumper: { label: "Jumper", order: 22 },
    module: { label: "Module", order: 23 },
    testpoint: { label: "Test point", order: 24 },
    mounting_hole: { label: "Mounting hole", order: 25 },
    fiducial: { label: "Fiducial", order: 26 },
    logo: { label: "Graphic", order: 27 },
    other: { label: "Other", order: 28 },
};

// Kinds that are drawn but never hand-placed.
export const NOT_PLACED = new Set<Kind>(["mounting_hole", "fiducial", "logo"]);

export interface PartText {
    ref: string;
    value: string;
    lib: string;
    descr: string;
    props: Record<string, string>;
}

// Leading letters of a reference: "R12" -> "R", "LED3" -> "LED".
export function refPrefix(ref: string): string {
    const m = /^[A-Za-z]+/.exec(ref);
    return m ? m[0].toUpperCase() : "";
}

const MOSFET_WORDS =
    /mos|fet|2n7002|bss1|bs170|bs250|ao3|ao4|aon|si2|si3|si4|irf|irl|dmg|dmn|dmp|fdn|fdv|ntr|nce|csd|vn10/;
const TRANSISTOR_PACKAGE = /sot-?23|sot-?323|sot-?89|sot-?223|sc-?70|to-?92|to-?220|to-?252|to-?263|dpak/;
const LED_WORDS = /\bled\b|led_|_led|light emitting/;
const CRYSTAL_WORDS = /crystal|xtal|oscillator|resonator/;
const CONNECTOR_WORDS =
    /connector|conn[_-]|usb|pinheader|pin_header|pinsocket|header|hdr[_-]|jst|molex|terminalblock|terminal_block|barrel|dc-in|idc|rj45|rj11|sma|u\.fl|hirose|jack|socket|receptacle|plug/;

function transistor(text: string): Kind {
    return MOSFET_WORDS.test(text) ? "mosfet" : "bjt";
}

export function classify(p: PartText): Kind {
    const lib = p.lib.toLowerCase();
    const name = lib.slice(lib.indexOf(":") + 1);
    const prefix = refPrefix(p.ref);
    const description = `${p.props["Description"] ?? ""} ${p.descr}`.toLowerCase();
    const value = p.value.toLowerCase();
    const all = `${lib} ${value} ${description}`;

    // Footprints that say what they are whatever the reference.
    if (/mountinghole|mounting_hole|mounting-hole/.test(lib)) return "mounting_hole";
    if (/fiducial/.test(lib)) return "fiducial";
    if (/^symbol:|logo/.test(lib) || prefix === "LOGO") return "logo";
    if (/testpoint|test_point/.test(lib)) return "testpoint";

    switch (prefix) {
        case "R":
            if (/r_array|resistor_array|_array|network/.test(lib)) return "resistor_array";
            if (/ntc|ptc|thermistor|varistor/.test(all)) return "thermistor";
            if (/potentiometer|trimmer/.test(all)) return "potentiometer";
            return "resistor";
        case "RN":
        case "RA":
        case "RR":
        case "RM":
            return "resistor_array";
        case "RV":
        case "VR":
        case "POT":
            return /varistor/.test(all) ? "thermistor" : "potentiometer";
        case "RT":
        case "TH":
        case "NTC":
        case "PTC":
            return "thermistor";
        case "C":
            return /cp_|capacitor_tantalum|tantal|electrolytic|polarized|polymer/.test(all)
                ? "capacitor_polarized"
                : "capacitor";
        case "CP":
        case "CE":
            return "capacitor_polarized";
        case "CV":
        case "VC":
            return "capacitor";
        case "L":
            // Murata BLM, TDK MPZ/MMZ and Wurth 742792 are ferrite beads.
            return /ferrite|bead|blm\d|mpz\d|mmz\d|742792/.test(all) ? "ferrite" : "inductor";
        case "FB":
        case "FER":
            return "ferrite";
        case "D":
        case "CR":
        case "DS":
            return LED_WORDS.test(all) || prefix === "DS" ? "led" : "diode";
        case "LED":
        case "LD":
            return "led";
        case "Q":
        case "VT":
            return transistor(all);
        case "T":
        case "TR":
        case "TX":
            if (/transformer/.test(all)) return "transformer";
            return TRANSISTOR_PACKAGE.test(name) ? transistor(all) : "transformer";
        case "U":
        case "IC":
        case "N":
        case "AR":
            return "ic";
        case "Y":
        case "XTAL":
        case "XT":
        case "OSC":
            return "crystal";
        case "X":
            return CRYSTAL_WORDS.test(all) || /hz\b/.test(value) ? "crystal" : "connector";
        case "J":
        case "P":
        case "CN":
        case "CON":
        case "USB":
            return "connector";
        case "JP":
        case "SJ":
            return "jumper";
        case "SW":
        case "S":
        case "BTN":
        case "KEY":
        case "PB":
            return "switch";
        case "K":
        case "RL":
        case "RLY":
        case "RY":
            return "relay";
        case "F":
        case "FU":
            return "fuse";
        case "BT":
        case "BAT":
            return "battery";
        case "BZ":
        case "BUZ":
        case "LS":
        case "SP":
        case "SPK":
        case "MK":
            return "buzzer";
        case "AE":
        case "ANT":
            return "antenna";
        case "TP":
            return "testpoint";
        case "H":
        case "MH":
        case "HOLE":
            return "mounting_hole";
        case "FID":
        case "FD":
            return "fiducial";
        case "M":
        case "MOD":
        case "A":
        case "MD":
            return "module";
        default:
            break;
    }

    // Unknown prefix: go by the footprint.
    if (/^r_|resistor/.test(name) || lib.startsWith("resistor")) return "resistor";
    if (/^cp_/.test(name)) return "capacitor_polarized";
    if (/^c_|capacitor/.test(name) || lib.startsWith("capacitor")) return "capacitor";
    if (LED_WORDS.test(name) || lib.startsWith("led")) return "led";
    if (/^l_|inductor/.test(name) || lib.startsWith("inductor")) return "inductor";
    if (/^d_|diode/.test(name) || lib.startsWith("diode")) return "diode";
    if (CRYSTAL_WORDS.test(lib)) return "crystal";
    if (/button|switch|^sw[-_]/.test(name)) return "switch";
    if (/fuse/.test(lib)) return "fuse";
    if (CONNECTOR_WORDS.test(lib) || prefix.startsWith("J")) return "connector";
    if (/soic|ssop|tssop|qfn|dfn|qfp|bga|dip|msop|sot-?23-[5-8]|package_|lga|wlcsp/.test(lib)) return "ic";
    return "other";
}
