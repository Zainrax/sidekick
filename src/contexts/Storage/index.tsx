import { KeepAwake } from "@capacitor-community/keep-awake";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import { createContextProvider } from "@solid-primitives/context";
import { createEffect, createResource, createSignal, on } from "solid-js";
import { openConnection } from "../../database";
import { useEventStorage } from "./event";
import { useLocationStorage } from "./location";
import { useRecordingStorage } from "./recording";
import { Network } from "@capacitor/network";
import { useLogsContext } from "../LogsContext";

const DatabaseName = "Cacophony";

const driver = new SQLiteConnection(CapacitorSQLite);
export const db = await openConnection(
  driver,
  DatabaseName,
  false,
  "no-encryption",
  2
);

const [StorageProvider, useStorage] = createContextProvider(() => {
  const [isUploading, setIsUploading] = createSignal(false);
  const recording = useRecordingStorage();
  const location = useLocationStorage();
  const event = useEventStorage();
  const log = useLogsContext();
  const uploadItems = async (warn = true) => {
    try {
      if (isUploading()) return;
      setIsUploading(true);
      if (await KeepAwake.isSupported()) {
        await KeepAwake.keepAwake();
      }
      await location.resyncLocations();
      await Promise.all([
        recording.uploadRecordings(warn),
        event.uploadEvents(),
      ]);
      if (await KeepAwake.isSupported()) {
        await KeepAwake.allowSleep();
      }
      setIsUploading(false);
    } catch (error) {
      log.logError({
        message: "Error during uploading events/recordings/locations",
        error,
      });
      setIsUploading(false);
    }
  };

  const stopUploading = () => {
    setIsUploading(false);
    recording.stopUploading();
    event.stopUploading();
  };

  const hasItemsToUpload = () => {
    return (
      recording.hasItemsToUpload() ||
      event.hasItemsToUpload() ||
      location.hasItemsToUpload()
    );
  };

  createEffect(
    on(hasItemsToUpload, async (hasItems) => {
      try {
        const status = await Network.getStatus();
        if (status.connectionType === "wifi" && hasItems) {
          uploadItems(false);
        }
      } catch (error) {
        console.error("Error getting network status:", error);
      }
    })
  );

  return {
    ...recording,
    ...location,
    ...event,
    uploadItems,
    stopUploading,
    isUploading,
    hasItemsToUpload,
  };
});
const definiteUseStorage = () => useStorage()!;
export { StorageProvider, definiteUseStorage as useStorage };
