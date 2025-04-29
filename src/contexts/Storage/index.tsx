import { KeepAwake } from "@capacitor-community/keep-awake";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import { createContextProvider } from "@solid-primitives/context";
import { createEffect, createSignal, on, onMount } from "solid-js";
import { openConnection } from "../../database";
import { useEventStorage } from "./event";
import { useLocationStorage } from "./location";
import { useRecordingStorage } from "./recording";
import { Network } from "@capacitor/network";
import { useLogsContext } from "../LogsContext";
import { useDeviceImagesStorage } from "./deviceImages";
import {
  LocalNotifications,
  type PermissionStatus,
} from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";

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
  const deviceImages = useDeviceImagesStorage();
  const event = useEventStorage();
  const log = useLogsContext();
  const UPLOAD_NOTIFICATION_ID = 1001;

  onMount(async () => {
    if (Capacitor.getPlatform() === "android") {
      let permStatus: PermissionStatus =
        await LocalNotifications.checkPermissions();
      if (
        permStatus.display === "prompt" ||
        permStatus.display === "prompt-with-rationale"
      ) {
        permStatus = await LocalNotifications.requestPermissions();
      }
      if (permStatus.display !== "granted") {
        log.logWarning({
          message:
            "Notification permission not granted. Upload reminders will not be shown.",
        });
      }
    }
  });

  const uploadItems = async (warn = true) => {
    try {
      await LocalNotifications.cancel({
        notifications: [{ id: UPLOAD_NOTIFICATION_ID }],
      });
      if (await KeepAwake.isSupported()) {
        await KeepAwake.keepAwake();
      }
      await recording.uploadRecordings(warn);
      await location.resyncLocations();
      await deviceImages.syncPendingPhotos();
      setIsUploading(false);
      await event.uploadEvents();
      if (await KeepAwake.isSupported()) {
        await KeepAwake.allowSleep();
      }
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
    LocalNotifications.cancel({
      notifications: [{ id: UPLOAD_NOTIFICATION_ID }],
    });
  };

  const hasItemsToUpload = () => {
    return (
      recording.hasItemsToUpload() ||
      event.hasItemsToUpload() ||
      location.hasItemsToUpload() ||
      deviceImages.hasItemsToUpload()
    );
  };

  createEffect(
    on(hasItemsToUpload, async (hasItems) => {
      try {
        if (hasItems) {
          let permStatus: PermissionStatus =
            await LocalNotifications.checkPermissions();
          if (permStatus.display === "granted") {
            await LocalNotifications.schedule({
              notifications: [
                {
                  id: UPLOAD_NOTIFICATION_ID,
                  title: "Upload Pending",
                  body: "You have recordings or events ready to upload.",
                  schedule: { at: new Date(Date.now() + 1000) },
                  smallIcon: "ic_stat_notify_upload",
                  autoCancel: true,
                },
              ],
            });
          } else if (
            permStatus.display === "prompt" ||
            permStatus.display === "prompt-with-rationale"
          ) {
            permStatus = await LocalNotifications.requestPermissions();
            if (permStatus.display === "granted") {
              await LocalNotifications.schedule({
                notifications: [
                  {
                    id: UPLOAD_NOTIFICATION_ID,
                    title: "Upload Pending",
                    body: "You have recordings or events ready to upload.",
                    schedule: { at: new Date(Date.now() + 1000) },
                    smallIcon: "ic_stat_notify_upload",
                    autoCancel: true,
                  },
                ],
              });
            }
          } else {
            log.logWarning({
              message:
                "Cannot schedule upload notification: Permission not granted.",
            });
          }
        } else {
          await LocalNotifications.cancel({
            notifications: [{ id: UPLOAD_NOTIFICATION_ID }],
          });
        }

        const status = await Network.getStatus();
        if (status.connectionType === "wifi" && hasItems) {
          uploadItems(false);
        }
      } catch (error) {
        log.logError({
          message: "Error handling upload notification or auto-upload",
          error,
        });
      }
    })
  );

  return {
    ...recording,
    ...location,
    ...event,
    ...deviceImages,
    uploadItems,
    stopUploading,
    isUploading,
    hasItemsToUpload,
  };
});

// Provide a safe useStorage hook that ensures the context is available
function useStorageSafe() {
  const context = useStorage();
  if (!context) {
    throw new Error("useStorage must be used within StorageProvider");
  }
  return context;
}

export { StorageProvider, useStorageSafe as useStorage };
