import { Core } from "@walletconnect/core";
import { DEFAULT_LOGGER, DEFAULT_PROJECT_ID } from "../constants";

export const core = new Core({
  projectId: DEFAULT_PROJECT_ID,
  logger: DEFAULT_LOGGER,
  relayUrl: relayerRegion,
});

export const getTopic: () => string = () => {
  const keys: string[] = core.pairing.pairings.keys;
  console.log("PAIRING KEYS: ", keys);
  const topic: string = core.pairing.pairings.get("").topic;
  return topic;
};
