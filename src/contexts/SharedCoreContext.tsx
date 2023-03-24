import { Core, Pairing } from "@walletconnect/core";
import { CoreTypes, ICore, IPairing, PairingTypes } from "@walletconnect/types";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  DEFAULT_LOGGER,
  DEFAULT_PROJECT_ID,
  DEFAULT_RELAY_URL,
} from "../constants";

/**
 * Types
 */
interface IContext {
  sharedCore: ICore | undefined;
  relayerRegion: string;
  setRelayerRegion: any;
}

/**
 * Context
 */
export const SharedCoreContext = createContext<IContext>({} as IContext);

/**
 * Provider
 */
export const SharedCoreContextProvider = ({
  children,
}: {
  children: ReactNode | ReactNode[];
}) => {
  const [sharedCore, setSharedCore] = useState<ICore>();
  const [relayerRegion, setRelayerRegion] = useState<string>(
    DEFAULT_RELAY_URL!
  );

  const initSharedCore = useCallback(() => {
    const core: ICore = new Core({
      projectId: DEFAULT_PROJECT_ID,
      logger: DEFAULT_LOGGER,
      relayUrl: relayerRegion,
    });
    setSharedCore(core);
  }, [relayerRegion]);

  const initPairing: IPairing["init"] = useCallback(async () => {
    await sharedCore!.pairing.init();
  }, []);

  const pairPeers: IPairing["pair"] = async (params: {
    uri: string;
    activatePairing?: boolean;
  }) => {
    const uri = params.uri;
    const activatePairing = params.activatePairing;
    const result: PairingTypes.Struct = await sharedCore!.pairing.pair({
      uri,
      activatePairing,
    });
    return result;
  };

  const createPairing: IPairing["create"] = useCallback(
    async (): Promise<{ topic: string; uri: string }> =>
      await sharedCore!.pairing.create(),
    []
  );

  const activatePairing: IPairing["activate"] = useCallback(
    async (params: { topic: string }) => {
      const topic = params.topic;
      await sharedCore!.pairing.activate({ topic });
    },
    []
  );

  const registerPairing: IPairing["register"] = useCallback(
    (params: { methods: string[] }) => {
      const methods = params.methods;
      sharedCore!.pairing.register({ methods });
    },
    []
  );

  const updateExpiry: IPairing["updateExpiry"] = useCallback(
    async (params: { topic: string; expiry: number }) => {
      const topic = params.topic;
      const expiry = params.expiry;
      sharedCore!.pairing.updateExpiry({ topic, expiry });
    },
    []
  );

  const updateMetadata: IPairing["updateMetadata"] = useCallback(
    async (params: { topic: string; metadata: CoreTypes.Metadata }) => {
      const topic = params.topic;
      const metadata = params.metadata;
      sharedCore!.pairing.updateMetadata({ topic, metadata });
    },
    []
  );

  const getPairings: IPairing["getPairings"] = useCallback(() => {
    const result: PairingTypes.Struct[] = sharedCore!.pairing.getPairings();
    return result;
  }, []);

  const pingPairing: IPairing["ping"] = useCallback(
    async (params: { topic: string }) => {
      const topic = params.topic;
      sharedCore!.pairing.ping({ topic });
    },
    []
  );

  const disconnectPairing: IPairing["disconnect"] = useCallback(
    async (params: { topic: string }) => {
      const topic = params.topic;
      await sharedCore!.pairing.disconnect({ topic });
    },
    []
  );

  useEffect(() => {
    if (typeof sharedCore === "undefined") {
      initSharedCore();
      console.log("WalletConnect's Core is initialized");
    }
  }, [sharedCore, initSharedCore]);

  const value = useMemo(
    () => ({
      sharedCore,
      relayerRegion,
      setRelayerRegion,
    }),
    [sharedCore, , relayerRegion, setRelayerRegion]
  );
  return (
    <SharedCoreContext.Provider value={{ ...value }}>
      {children}
    </SharedCoreContext.Provider>
  );
};

export const useSharedCoreContext = () => {
  const context = useContext(SharedCoreContext);
  if (context === undefined) {
    throw new Error(
      "useSharedCoreContext must be used within a SharedCoreContextProvider"
    );
  }
  return context;
};
