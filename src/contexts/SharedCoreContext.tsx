import { Core } from "@walletconnect/core";
import {
  calcExpiry,
  createDelayedPromise,
  engineEvent,
  formatUri,
  generateRandomBytes32,
  getInternalError,
  getSdkError,
  isExpired,
  isValidParams,
  isValidString,
  isValidUrl,
  parseExpirerTarget,
  parseUri,
  TYPE_1,
} from "@walletconnect/utils";
import {
  formatJsonRpcError,
  formatJsonRpcRequest,
  formatJsonRpcResult,
  isJsonRpcError,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcResult,
} from "@walletconnect/jsonrpc-utils";
import {
  CoreTypes,
  ExpirerTypes,
  ICore,
  IPairing,
  IPairingPrivate,
  IStore,
  PairingJsonRpcTypes,
  PairingTypes,
  RelayerTypes,
} from "@walletconnect/types";
import { FIVE_MINUTES, THIRTY_DAYS } from "@walletconnect/time";
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
  PAIRING_RPC_OPTS,
  RELAYER_EVENTS,
} from "../constants";

/**
 * Types
 */
interface IContext {
  sharedCore: ICore | undefined;
  register: (params: { methods: string[] }) => void;
  create: () => Promise<{ topic: string; uri: string }>;
  pair: (params: {
    uri: string;
    activatePairing?: boolean | undefined;
  }) => Promise<PairingTypes.Struct>;
  activate: (params: { topic: string }) => Promise<void>;
  ping: (params: { topic: string }) => Promise<void>;
  updateExpiry: (params: { topic: string; expiry: number }) => Promise<void>;
  updateMetadata: (params: {
    topic: string;
    metadata: CoreTypes.Metadata;
  }) => Promise<void>;
  getPairings: () => PairingTypes.Struct[];
  disconnect: (params: { topic: string }) => Promise<void>;
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
  const [pending, setPending] = useState(false);
  const [initialized, setInitialized] = useState<boolean>(false);
  const [registeredMethods, setRegisteredMethods] = useState<string[]>([]);
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

  const init: IPairing["init"] = async () => {
    if (!initialized) {
      await pairings!.init();
      await cleanup();
      registerRelayerEvents();
      registerExpirerEvents();
      setInitialized(true);
      logger.trace(`Initialized`);
    }
  };

  const register: IPairing["register"] = ({ methods }) => {
    isInitialized();
    setRegisteredMethods([...new Set([...registeredMethods, ...methods])]);
  };

  const create: IPairing["create"] = async () => {
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
  };

  const pair: IPairing["pair"] = async (params) => {
    isInitialized();
    isValidPair(params);
    const { topic, symKey, relay } = parseUri(params.uri);

    if (pairings!.keys.includes(topic)) {
      throw new Error(`Pairing already exists: ${topic}`);
    }

    if (sharedCore!.crypto.hasKeys(topic)) {
      throw new Error(`Keychain already exists: ${topic}`);
    }

    const expiry = calcExpiry(FIVE_MINUTES);
    const pairing = { topic, relay, expiry, active: false };
    await pairings!.set(topic, pairing);
    await sharedCore!.crypto.setSymKey(symKey, topic);
    await sharedCore!.relayer.subscribe(topic, { relay });
    sharedCore!.expirer.set(topic, expiry);

    if (params.activatePairing) {
      await activate({ topic });
    }

    return pairing;
  };

  const activate: IPairing["activate"] = async ({ topic }) => {
    isInitialized();
    const expiry = calcExpiry(THIRTY_DAYS);
    await pairings!.update(topic, { active: true, expiry });
    sharedCore!.expirer.set(topic, expiry);
  };

  const ping: IPairing["ping"] = async (params) => {
    isInitialized();
    await isValidPing(params);
    const { topic } = params;
    if (pairings!.keys.includes(topic)) {
      const id = await sendRequest(topic, "wc_pairingPing", {});
      const { done, resolve, reject } = createDelayedPromise<void>();
      events.once(engineEvent("pairing_ping", id), ({ error }) => {
        if (error) reject(error);
        else resolve();
      });
      await done();
    }
  };

  const updateExpiry: IPairing["updateExpiry"] = async ({ topic, expiry }) => {
    isInitialized();
    await pairings!.update(topic, { expiry });
  };

  const updateMetadata: IPairing["updateMetadata"] = async ({
    topic,
    metadata,
  }) => {
    isInitialized();
    await pairings!.update(topic, { peerMetadata: metadata });
  };

  const getPairings: IPairing["getPairings"] = () => {
    isInitialized();
    return pairings!.values;
  };

  const disconnect: IPairing["disconnect"] = async (params) => {
    isInitialized();
    await isValidDisconnect(params);
    const { topic } = params;
    if (pairings!.keys.includes(topic)) {
      await sendRequest(
        topic,
        "wc_pairingDelete",
        getSdkError("USER_DISCONNECTED")
      );
      await deletePairing(topic);
    }
  };

  // ---- Expirer Events ----
  const registerExpirerEvents = useCallback(() => {
    sharedCore!.expirer.on(
      EXPIRER_EVENTS.expired,
      async (event: ExpirerTypes.Expiration) => {
        const { topic } = parseExpirerTarget(event.target);
        if (topic) {
          if (pairings!.keys.includes(topic)) {
            await deletePairing(topic, true);
            events.emit("pairing_expire", { topic });
          }
        }
      }
    );
  }, [sharedCore, pairings, events]);
  // ------------------------

  const onPairingPingRequest: IPairingPrivate["onPairingPingRequest"] = async (
    topic,
    payload
  ) => {
    const { id } = payload;
    try {
      isValidPing({ topic });
      await sendResult<"wc_pairingPing">(id, topic, true);
      events.emit("pairing_ping", { id, topic });
    } catch (err: any) {
      await sendError(id, topic, err);
      logger.error(err);
    }
  };

  const onPairingDeleteRequest: IPairingPrivate["onPairingDeleteRequest"] =
    async (topic, payload) => {
      const { id } = payload;
      try {
        isValidDisconnect({ topic });
        await deletePairing(topic);
        events.emit("pairing_delete", { id, topic });
      } catch (err: any) {
        await sendError(id, topic, err);
        logger.error(err);
      }
    };

  const onUnknownRpcMethodRequest: IPairingPrivate["onUnknownRpcMethodRequest"] =
    async (topic, payload) => {
      const { id, method } = payload;

      try {
        // Ignore if the implementing client has registered this method as known.
        if (registeredMethods.includes(method)) return;
        const error = getSdkError("WC_METHOD_UNSUPPORTED", method);
        await sendError(id, topic, error);
        logger.error(error);
      } catch (err: any) {
        await sendError(id, topic, err);
        logger.error(err);
      }
    };

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

  const onPairingPingResponse: IPairingPrivate["onPairingPingResponse"] = (
    _topic,
    payload
  ) => {
    const { id } = payload;
    // put at the end of the stack to avoid a race condition
    // where pairing_ping listener is not yet initialized
    setTimeout(() => {
      if (isJsonRpcResult(payload)) {
        events.emit(engineEvent("pairing_ping", id), {});
      } else if (isJsonRpcError(payload)) {
        events.emit(engineEvent("pairing_ping", id), { error: payload.error });
      }
    }, 500);
  };

  const onUnknownRpcMethodResponse: IPairingPrivate["onUnknownRpcMethodResponse"] =
    (method) => {
      // Ignore if the implementing client has registered this method as known.
      if (registeredMethods.includes(method)) return;
      logger.error(getSdkError("WC_METHOD_UNSUPPORTED", method));
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

  // ---- Private Helpers ----
  const sendRequest: IPairingPrivate["sendRequest"] = async (
    topic,
    method,
    params
  ) => {
    const payload = formatJsonRpcRequest(method, params);
    const message = await sharedCore!.crypto.encode(topic, payload);
    const opts = PAIRING_RPC_OPTS[method].req;
    sharedCore!.history.set(topic, payload);
    await sharedCore!.relayer.publish(topic, message, opts);

    return payload.id;
  };

  const sendResult: IPairingPrivate["sendResult"] = async (
    id,
    topic,
    result
  ) => {
    const payload = formatJsonRpcResult(id, result);
    const message = await sharedCore!.crypto.encode(topic, payload);
    const record = await sharedCore!.history.get(topic, id);
    const opts =
      PAIRING_RPC_OPTS[record.request.method as PairingJsonRpcTypes.WcMethod]
        .res;
    await sharedCore!.relayer.publish(topic, message, opts);
    await sharedCore!.history.resolve(payload);
  };

  const sendError: IPairingPrivate["sendError"] = async (id, topic, error) => {
    const payload = formatJsonRpcError(id, error);
    const message = await sharedCore!.crypto.encode(topic, payload);
    const record = await sharedCore!.history.get(topic, id);
    const method = record.request.method as PairingJsonRpcTypes.WcMethod;
    const opts: RelayerTypes.PublishOptions = PAIRING_RPC_OPTS[method]
      ? PAIRING_RPC_OPTS[method].res
      : PAIRING_RPC_OPTS.unregistered_method.res;

    await sharedCore!.relayer.publish(topic, message, opts);
    await sharedCore!.history.resolve(payload);
  };

  const deletePairing: IPairingPrivate["deletePairing"] = async (
    topic,
    expirerHasDeleted
  ) => {
    // Await the unsubscribe first to avoid deleting the symKey too early below.
    await sharedCore!.relayer.unsubscribe(topic);
    await Promise.all([
      pairings!.delete(topic, getSdkError("USER_DISCONNECTED")),
      sharedCore!.crypto.deleteSymKey(topic),
      expirerHasDeleted ? Promise.resolve() : sharedCore!.expirer.del(topic),
    ]);
  };

  const isInitialized = () => {
    if (!initialized) {
      const { message } = getInternalError("NOT_INITIALIZED", name);
      throw new Error(message);
    }
  };

  const cleanup = async () => {
    const expiredPairings = pairings!
      .getAll()
      .filter((pairing) => isExpired(pairing.expiry));
    await Promise.all(
      expiredPairings.map((pairing) => deletePairing(pairing.topic))
    );
  };

  // ---- Validation Helpers ----
  const isValidPair = (params: { uri: string }) => {
    if (!isValidParams(params)) {
      const { message } = getInternalError(
        "MISSING_OR_INVALID",
        `pair() params: ${params}`
      );
      throw new Error(message);
    }
    if (!isValidUrl(params.uri)) {
      const { message } = getInternalError(
        "MISSING_OR_INVALID",
        `pair() uri: ${params.uri}`
      );
      throw new Error(message);
    }
  };

  const isValidPing = async (params: { topic: string }) => {
    if (!isValidParams(params)) {
      const { message } = getInternalError(
        "MISSING_OR_INVALID",
        `ping() params: ${params}`
      );
      throw new Error(message);
    }
    const { topic } = params;
    await isValidPairingTopic(topic);
  };

  const isValidDisconnect = async (params: { topic: string }) => {
    if (!isValidParams(params)) {
      const { message } = getInternalError(
        "MISSING_OR_INVALID",
        `disconnect() params: ${params}`
      );
      throw new Error(message);
    }
    const { topic } = params;
    await isValidPairingTopic(topic);
  };

  const isValidPairingTopic = async (topic: any) => {
    if (!isValidString(topic, false)) {
      const { message } = getInternalError(
        "MISSING_OR_INVALID",
        `pairing topic should be a string: ${topic}`
      );
      throw new Error(message);
    }
    if (!pairings!.keys.includes(topic)) {
      const { message } = getInternalError(
        "NO_MATCHING_KEY",
        `pairing topic doesn't exist: ${topic}`
      );
      throw new Error(message);
    }
    if (isExpired(pairings!.get(topic).expiry)) {
      await deletePairing(topic);
      const { message } = getInternalError(
        "EXPIRED",
        `pairing topic: ${topic}`
      );
      throw new Error(message);
    }
  };
  // ----------------------------

  useEffect(() => {
    if (typeof sharedCore === "undefined") {
      initSharedCore();
      console.log("WalletConnect's Core is initialized");
    }
    if (!initialized) {
      setPairings(new Store(sharedCore!, logger, name, storagePrefix));
      init();
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
    init,
  ]);

  const value = useMemo(
    () => ({
      sharedCore,
      register,
      create,
      pair,
      activate,
      ping,
      updateExpiry,
      updateMetadata,
      getPairings,
      disconnect,
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
