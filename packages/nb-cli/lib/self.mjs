// How nb runs itself again (nb learn, nb start, nb ui, completions, the MCP finish step). From npm it's
// `node <path to nb.mjs> …`; the single-file build (report C7) is one program, so it's just `nb …`.
/** @type {boolean} set by scripts/single-file.mjs */
export const SINGLE_FILE = Boolean(/** @type {any} */ (globalThis).__NB_SINGLE_FILE__);

/** The program and the first arguments that start nb again. @param {string[]} args @returns {[string, string[]]} */
export const self = (args) => [process.execPath, SINGLE_FILE ? args : [process.argv[1] ?? "", ...args]];
