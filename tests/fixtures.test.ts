// Compare the parser with what KiCad's own pcbnew computes for the same
// boards (KiCad 4 to 10 formats). Run `mise run fixtures` first; without the
// downloaded boards these tests are skipped.

import { describe, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { checkFile } from "./truth";

const dir = new URL("./fixtures/", import.meta.url).pathname;
const boards = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".kicad_pcb")) : [];

describe.skipIf(boards.length === 0)("parser vs pcbnew on KiCad demo boards", () => {
    for (const name of boards) {
        test(name, () => {
            checkFile(dir + name);
        });
    }
});
