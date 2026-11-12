// A company proxy and its own certificates (report C6). Node's fetch only uses HTTPS_PROXY with NODE_USE_ENV_PROXY=1
// (Node 22.21+ and 24+), and NODE_EXTRA_CA_CERTS is read at start-up, so when either is needed nb starts itself again
// once with them set. Nothing changes for anyone who doesn't use a proxy or extra certificates.

/** Node versions whose fetch can use HTTPS_PROXY. @param {string} version like "22.22.0" */
export function proxyCapable(version) {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major >= 24 || (major === 22 && minor >= 21) || major === 23;
}

/**
 * What to add to the environment for this run, or null when nothing is needed.
 * @param {Record<string, any>} config the user config (`proxy`, `ca-file`) @param {NodeJS.ProcessEnv} env @param {string} nodeVersion
 * @returns {Record<string, string> | null}
 */
export function networkEnv(config, env, nodeVersion) {
  if (env.NB_NETWORK_APPLIED) return null;
  /** @type {Record<string, string>} */
  const add = {};
  if (config["ca-file"] && env.NODE_EXTRA_CA_CERTS !== config["ca-file"]) add.NODE_EXTRA_CA_CERTS = String(config["ca-file"]);
  const proxy = config.proxy ?? env.HTTPS_PROXY ?? env.https_proxy ?? null;
  if (proxy && proxyCapable(nodeVersion)) {
    if (config.proxy && env.HTTPS_PROXY !== config.proxy) { add.HTTPS_PROXY = String(config.proxy); add.HTTP_PROXY = String(config.proxy); }
    if (env.NODE_USE_ENV_PROXY !== "1") add.NODE_USE_ENV_PROXY = "1";
  }
  return Object.keys(add).length ? { ...add, NB_NETWORK_APPLIED: "1" } : null;
}
