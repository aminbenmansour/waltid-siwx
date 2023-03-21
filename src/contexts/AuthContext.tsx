import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Core } from "@walletconnect/core";
import AuthClient from "@walletconnect/auth-client";
import { ICore, SessionTypes } from "@walletconnect/types";
import {
  Cacao,
  getAppMetadata,
  formatMessage,
  getNamespacedDidChainId,
  getDidAddress,
} from "@walletconnect/utils";

import { DEFAULT_APP_METADATA, DEFAULT_PROJECT_ID } from "../constants";
import { createRequestParams } from "../helpers/caip122";
import { useWalletConnectClient } from "./ClientContext";
import { useSharedCoreContext } from "./SharedCoreContext";

/**
 * Types
 */

interface IContext {
  authClient: AuthClient | undefined;
  authHasInitialized: boolean;
  authUri: string;
  signIn: (_session: SessionTypes.Struct) => void;
}

// request: (
//   params: RequestParams,
//   topic: string
// ) => Promise<{ uri: any; id: any }>;
// respond: (params: RespondParams, iss: string) => Promise<boolean>;
// getPendingRequests: () => Promise<Record<number, PendingRequest>>;
// formatMessage: (payload: PayloadParams, iss: string) => Promise<string>;

/**
 * Context
 */
export const AuthContext = createContext<IContext>({} as IContext);

/**
 * Provider
 */
export function AuthContextProvider({
  children,
}: {
  children: ReactNode | ReactNode[];
}) {
  const [authClient, setClient] = useState<AuthClient>();
  const [authHasInitialized, setHasInitialized] = useState(false);
  const [authUri, setUri] = useState<string>("");
  const [addresses, setAddresses] = useState<string[]>([]);

  const { sharedCore } = useSharedCoreContext();
  const { session, pairings } = useWalletConnectClient();

  const _subscribeToEvents = useCallback(async (_client: AuthClient) => {
    if (typeof _client === "undefined") {
      throw new Error("Authentication Client is not initialized");
    }
    _client.on("auth_request", ({ params }) => {
      console.log("Authentication Request", params);
    });

    _client.on("auth_response", ({ params }) => {
      console.log("Authentication Response: ", params);
    });
  }, []);

  const createClient = useCallback(async () => {
    const metadata = getAppMetadata() || DEFAULT_APP_METADATA;
    const projectId = DEFAULT_PROJECT_ID;

    try {
      if (typeof sharedCore === "undefined") return;

      const authClient = await AuthClient.init({
        core: sharedCore,
        metadata,
        projectId,
      });
      setHasInitialized(true);
      await _subscribeToEvents(authClient);
      console.log("CREATED AUTH CLIENT: ", authClient);
    } catch (error) {
      console.log(error);
    }
  }, [sharedCore, _subscribeToEvents]);

  const signIn = useCallback(
    (_session: SessionTypes.Struct) => {
      if (!authClient) return;

      const topic: string = /*currentTopic();*/ "";

      // const topic: string = _session.topic;

      Object.keys(_session.namespaces).map((namespace) => {
        console.log(`Sign In to Namespace: ${namespace}`);
        _session.namespaces[namespace].accounts.map(async (account) => {
          const [chainId, address] = [
            account.split(":")[1],
            account.split(":")[2],
          ];
          const request = createRequestParams(chainId);
          const response: Cacao | void = await authClient
            .request(request, {
              topic,
            })
            .then(async ({ uri }) => {
              if (uri) {
                setUri(uri);
                setAddresses((addresses) => {
                  console.log(
                    "This Address is AUTHENTICATED WIWOUU: ",
                    address
                  );
                  addresses.push(address);
                  return addresses;
                });
              }
            });

          if (response instanceof Object) {
            const iss = response.p.iss;
            console.log(
              "Authentication successful for :",
              getNamespacedDidChainId(iss),
              "for address: ",
              getDidAddress(iss)
            );
            console.log(
              "signed the following message: ",
              formatMessage(response.p, iss)
            );
          }
        });
      });
    },
    [authClient, setUri, setAddresses]
  );

  useEffect(() => {
    if (!authClient) {
      createClient();
    }
  }, [authClient, createClient]);

  const value = useMemo(
    () => ({
      authClient,
      authHasInitialized,
      authUri,
      signIn,
    }),
    [authClient, authHasInitialized, authUri, signIn]
  );

  return (
    <AuthContext.Provider
      value={{
        ...value,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useWCAuthClient = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error(
      "useWCAuthClient must be used within a AuthContextProvider"
    );
  }
  return context;
};
