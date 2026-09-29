/** Runtime signing only. Provisioning inspects names and never calls this. */
export function requireR2SigningCredentials(env, operation) {
  const { R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, GORIBU_R2_ACCOUNT_ID: accountId } = env;
  if (typeof accessKeyId !== "string" || !accessKeyId || typeof secretAccessKey !== "string" || !secretAccessKey) {
    const repair = operation === "presigned downloads"
      ? "Configure both Worker secrets, or remove both to use Worker-served links."
      : "Create an R2 Object Read & Write token scoped to the app's buckets and configure both Worker secrets before uploading.";
    throw new Error(`[Goribu] R2 ${operation} need both R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY. ${repair}`);
  }
  if (typeof accountId !== "string" || !/^[a-f0-9]{32}$/i.test(accountId)) throw new Error(`[Goribu] R2 ${operation} need the generated GORIBU_R2_ACCOUNT_ID Worker variable. Run \`goribu deploy\` to attach the authenticated account ID.`);
  return { accountId, accessKeyId, secretAccessKey };
}
