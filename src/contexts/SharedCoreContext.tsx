import { Core } from "@walletconnect/core";
import { CoreTypes, ICore, IPairing, PairingTypes } from "@walletconnect/types";

import { Web3Modal } from "@web3modal/standalone";

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
  pairPeers: IPairing["pair"];
  initPairing: IPairing["init"];
  createPairing: IPairing["create"];
  activatePairing: IPairing["activate"];
  registerPairing: IPairing["register"];
  updateExpiry: IPairing["updateExpiry"];
  updateMetadata: IPairing["updateMetadata"];
  getPairings: IPairing["getPairings"];
  pingPairing: IPairing["ping"];
  disconnectPairing: IPairing["disconnect"];
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
    console.info("WalletConnect's Core is initialized");
  }, [relayerRegion]);

  const initPairing: IPairing["init"] = useCallback(async () => {
    try {
      await sharedCore!.pairing.init();
      console.info(
        "Initialized sucessfully the client with persisted storage and a network connection"
      );
    } catch (error) {
      throw new Error(
        "Failed to initialize the client with persisted storage and a network connection"
      );
    }
  }, [sharedCore]);

  const pairPeers: IPairing["pair"] = useCallback(
    async (params: { uri: string; activatePairing?: boolean }) => {
      const uri = params.uri;
      const activatePairing = params.activatePairing;
      const result: PairingTypes.Struct = await sharedCore!.pairing.pair({
        uri,
        activatePairing,
      });
      return result;
    },
    [sharedCore]
  );

  const createPairing: IPairing["create"] = useCallback(async (): Promise<{
    topic: string;
    uri: string;
  }> => {
    try {
      const { topic, uri } = await sharedCore!.pairing.create();
      console.info("Proposer created 'inactive' pairing");
      return { topic, uri };
    } catch (error) {
      console.error;
      throw new Error("Proposer failed to create 'inactive' pairing");
    }
  }, [sharedCore]);

  const activatePairing: IPairing["activate"] = useCallback(
    async (params: { topic: string }) => {
      try {
        const topic = params.topic;
        await sharedCore!.pairing.activate({ topic });
        console.info("Activated successfully the previously created pairing");
      } catch (error) {
        console.error;
        throw new Error("Failed to activate the previously created pairing");
      }
    },
    [sharedCore]
  );

  const registerPairing: IPairing["register"] = useCallback(
    async (params: { methods: string[] }) => {
      try {
        const methods = params.methods;
        await sharedCore!.pairing.register({ methods });
        console.info("Successfully subscribed on methods requests");
      } catch (error) {
        console.error;
        throw new Error("Failed to subscribe on methods requests");
      }
    },
    [sharedCore]
  );

  const updateExpiry: IPairing["updateExpiry"] = useCallback(
    async (params: { topic: string; expiry: number }) => {
      try {
        const topic = params.topic;
        const expiry = params.expiry;
        await sharedCore!.pairing.updateExpiry({ topic, expiry });
        console.info("Pairing's expiry updated successfully");
      } catch (error) {
        throw new Error("Failed to update pairing's expiry");
      }
    },
    [sharedCore]
  );

  const updateMetadata: IPairing["updateMetadata"] = useCallback(
    async (params: { topic: string; metadata: CoreTypes.Metadata }) => {
      try {
        const topic = params.topic;
        const metadata = params.metadata;
        await sharedCore!.pairing.updateMetadata({ topic, metadata });
        console.info("Pairing's metadata updated");
      } catch (error) {
        throw new Error("Failed to update pairing's metadata");
      }
    },
    [sharedCore]
  );

  const getPairings: IPairing["getPairings"] = useCallback(() => {
    const pairings = sharedCore!.pairing.getPairings();
    console.info("Pairings fetched succefully");
    return pairings;
  }, [sharedCore]);

  const pingPairing: IPairing["ping"] = useCallback(
    async (params: { topic: string }) => {
      try {
        const topic = params.topic;
        await sharedCore!.pairing.ping({ topic });
      } catch (error) {
        throw new Error("Failed to ping pairing");
      }
    },
    [sharedCore]
  );

  const disconnectPairing: IPairing["disconnect"] = useCallback(
    async (params: { topic: string }) => {
      const topic = params.topic;
      try {
        await sharedCore!.pairing.disconnect({ topic });
      } catch (error) {
        throw new Error(`Failed to disconnect pairing with topic:\n${topic}`);
      }
    },
    [sharedCore]
  );

  useEffect(() => {
    if (typeof sharedCore === "undefined") {
      initSharedCore();
    }
  }, [sharedCore, initSharedCore, initPairing]);

  const value = useMemo(
    () => ({
      sharedCore,
      relayerRegion,
      pairPeers,
      initPairing,
      createPairing,
      activatePairing,
      registerPairing,
      updateExpiry,
      updateMetadata,
      getPairings,
      pingPairing,
      disconnectPairing,
      setRelayerRegion,
    }),
    [
      sharedCore,
      relayerRegion,
      pairPeers,
      initPairing,
      createPairing,
      activatePairing,
      registerPairing,
      updateExpiry,
      updateMetadata,
      getPairings,
      pingPairing,
      disconnectPairing,
      setRelayerRegion,
    ]
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
