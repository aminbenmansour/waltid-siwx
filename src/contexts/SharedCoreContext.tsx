import { Core } from "@walletconnect/core";
import {
  calcExpiry,
  formatUri,
  generateRandomBytes32,
  getSdkError,
  parseExpirerTarget,
  TYPE_1,
} from "@walletconnect/utils";
import {
  isJsonRpcRequest,
  isJsonRpcResponse,
} from "@walletconnect/jsonrpc-utils";
import {
  ExpirerTypes,
  ICore,
  IPairing,
  IPairingPrivate,
  IStore,
  PairingJsonRpcTypes,
  PairingTypes,
  RelayerTypes,
} from "@walletconnect/types";
import { FIVE_MINUTES } from "@walletconnect/time";
import {
  generateChildLogger,
  getDefaultLoggerOptions,
  Logger,
} from "@walletconnect/logger";

import EventEmitter from "events";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import pino from "pino";

import { Store } from "../controllers/store";

import {
  CORE_DEFAULT,
  CORE_STORAGE_PREFIX,
  DEFAULT_LOGGER,
  DEFAULT_PROJECT_ID,
  DEFAULT_RELAY_URL,
  EXPIRER_EVENTS,
  PAIRING_CONTEXT,
  RELAYER_EVENTS,
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
  const log: Logger = pino(
    getDefaultLoggerOptions({ level: CORE_DEFAULT.logger })
  );
  const ignoredPayloadTypes = [TYPE_1];
  const [name] = useState<string>(PAIRING_CONTEXT);
  const [storagePrefix] = useState<string>(CORE_STORAGE_PREFIX);
  const [events] = useState(new EventEmitter());
  const [logger] = useState(generateChildLogger(log, name));

  const [sharedCore, setSharedCore] = useState<ICore>();
  const [pairings, setPairings] =
    useState<IStore<string, PairingTypes.Struct>>();
  const [initialized, setInitialized] = useState<boolean>(false);
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

  const createPairingProposal: IPairing["create"] = useCallback(async () => {
    const symKey = generateRandomBytes32();
    const topic = await sharedCore!.crypto.setSymKey(symKey);
    const expiry = calcExpiry(FIVE_MINUTES);
    const relay = { protocol: process.env.RELAYER_DEFAULT_PROTOCOL || "irn" };
    const pairing = { topic, expiry, relay, active: false };
    const uri = formatUri({
      protocol: sharedCore!.protocol,
      version: sharedCore!.version,
      topic,
      symKey,
      relay,
    });

    await sharedCore!.relayer.subscribe(topic);
    pairings!.set(topic, pairing);
    sharedCore!.expirer.set(topic, expiry);

    return { topic, uri };
  }, [sharedCore, pairings]);

  const _deletePairing: IPairingPrivate["deletePairing"] = useCallback(
    async (topic, expirerHasDeleted) => {
      // Await the unsubscribe first to avoid deleting the symKey too early below.
      await sharedCore!.relayer.unsubscribe(topic);
      await Promise.all([
        pairings!.delete(topic, getSdkError("USER_DISCONNECTED")),
        sharedCore!.crypto.deleteSymKey(topic),
        expirerHasDeleted ? Promise.resolve() : sharedCore!.expirer.del(topic),
      ]);
    },
    [sharedCore, pairings]
  );

  const registerExpirerEvents = useCallback(() => {
    sharedCore!.expirer.on(
      EXPIRER_EVENTS.expired,
      async (event: ExpirerTypes.Expiration) => {
        const { topic } = parseExpirerTarget(event.target);
        if (topic) {
          if (pairings!.keys.includes(topic)) {
            await _deletePairing(topic, true);
            events.emit("pairing_expire", { topic });
          }
        }
      }
    );
  }, [sharedCore, pairings, events, _deletePairing]);

  const initPairing: IPairing["init"] = useCallback(async () => {
    if (!initialized) {
      await pairings!.init();
      registerExpirerEvents();
      setInitialized(true);
      logger.trace(`Initialized`);
    }
  }, [initialized, pairings, registerExpirerEvents]);

  const onRelayEventRequest: IPairingPrivate["onRelayEventRequest"] = (
    event
  ) => {
    const { topic, payload } = event;
    const reqMethod = payload.method as PairingJsonRpcTypes.WcMethod;

    if (!pairings!.keys.includes(topic)) return;

    switch (reqMethod) {
      case "wc_pairingPing":
        return onPairingPingRequest(topic, payload);
      case "wc_pairingDelete":
        return onPairingDeleteRequest(topic, payload);
      default:
        return onUnknownRpcMethodRequest(topic, payload);
    }
  };

  const onRelayEventResponse: IPairingPrivate["onRelayEventResponse"] = async (
    event
  ) => {
    const { topic, payload } = event;
    const record = await sharedCore!.history.get(topic, payload.id);
    const resMethod = record.request.method as PairingJsonRpcTypes.WcMethod;

    if (!pairings!.keys.includes(topic)) return;

    switch (resMethod) {
      case "wc_pairingPing":
        return onPairingPingResponse(topic, payload);
      default:
        return onUnknownRpcMethodResponse(resMethod);
    }
  };

  const registerRelayerEvents = useCallback(() => {
    sharedCore!.relayer.on(
      RELAYER_EVENTS.message,
      async (event: RelayerTypes.MessageEvent) => {
        const { topic, message } = event;

        // messages of certain types should be ignored as they are handled by their respective SDKs
        if (
          ignoredPayloadTypes.includes(
            sharedCore!.crypto.getPayloadType(message)
          )
        ) {
          return;
        }

        const payload = await sharedCore!.crypto.decode(topic, message);
        if (isJsonRpcRequest(payload)) {
          sharedCore!.history.set(topic, payload);
          onRelayEventRequest({ topic, payload });
        } else if (isJsonRpcResponse(payload)) {
          await sharedCore!.history.resolve(payload);
          onRelayEventResponse({ topic, payload });
        }
      }
    );
  }, []);
  useEffect(() => {
    if (typeof sharedCore === "undefined") {
      initSharedCore();
      console.log("WalletConnect's Core is initialized");
    }
    if (!initialized) {
      setPairings(new Store(sharedCore!, logger, name, storagePrefix));
      initPairing();
      setInitialized(true);
      console.log("WalletConnect's Pairing API is initialized");
    }
  }, [
    sharedCore,
    initialized,
    logger,
    name,
    storagePrefix,
    initSharedCore,
    initPairing,
  ]);

  const value = useMemo(
    () => ({
      sharedCore,
      relayerRegion,
      setRelayerRegion,
    }),
    [sharedCore, relayerRegion, setRelayerRegion]
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
