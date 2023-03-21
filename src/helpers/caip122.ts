import { generateNonce } from "@walletconnect/auth-client";
import { version } from "@walletconnect/auth-client/package.json";

import { AuthEngineTypes } from "@walletconnect/auth-client";



export const createRequestParams = (
  chainId: string,
  nbf?: string,
  exp?: string,
  requestId?: string,
  resources?: string[]
): AuthEngineTypes.PayloadParams => {
  const domain: string = window.location.hostname
    .split(".")
    .slice(-2)
    .join(".");
  const iat: string = new Date().toISOString();
  const aud: string = window.location.href;
  const statement: string = "Sign in to any ecosystem with waltId portal";
  // const iss: string = `did:pkh:${namespace}:${chainId}:${address}`;
  return {
    type: "eip4361",
    chainId,
    domain,
    aud,
    version,
    nonce: generateNonce(),
    iat,
    nbf,
    exp,
    statement,
    requestId,
    resources,
  };
};
const _domainBinding = () => {};
const serialize = () => {};
