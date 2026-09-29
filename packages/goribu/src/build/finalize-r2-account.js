import { updateDeployConfig } from "./update-deploy-config.js";

/** Give the Worker signer the same account selected for deployment. */
export function finalizeR2Account({ projectRoot, appConfig, accountId }) {
  if (appConfig.r2 === undefined) return;
  if (typeof accountId !== "string" || !/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("[Goribu] R2 deployment needs a valid Cloudflare account ID. Run `pnpm exec goribu cloudflare-login`, select the intended account with CLOUDFLARE_ACCOUNT_ID, then retry `goribu deploy`.");
  }
  return updateDeployConfig({
    projectRoot,
    resource: "R2 account",
    update(config, fail) {
      if (config.name !== appConfig.name) throw fail("the emitted Worker name does not match goribu.config.js");
      if (config.vars !== undefined && (config.vars === null || typeof config.vars !== "object" || Array.isArray(config.vars))) {
        throw fail("the emitted vars are not an object");
      }
      config.vars = { ...config.vars, GORIBU_R2_ACCOUNT_ID: accountId };
    },
  });
}
