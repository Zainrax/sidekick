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
import type {
	CancelOptions,
	LocalNotificationSchema,
} from "@capacitor/local-notifications";

const DatabaseName = "Cacophony";

// Notification IDs
const UPLOAD_REMINDER_1H_ID = 1001;
const UPLOAD_REMINDER_6H_ID = 1002;
const UPLOAD_REMINDER_12H_ID = 1003;
const LOCATION_SYNC_REMINDER_ID = 1004;
const ALL_REMINDER_IDS = [
	UPLOAD_REMINDER_1H_ID,
	UPLOAD_REMINDER_6H_ID,
	UPLOAD_REMINDER_12H_ID,
	LOCATION_SYNC_REMINDER_ID,
];

const driver = new SQLiteConnection(CapacitorSQLite);
export const db = await openConnection(
	driver,
	DatabaseName,
	false,
	"no-encryption",
	2,
);

const [StorageProvider, useStorage] = createContextProvider(() => {
	const [isUploading, setIsUploading] = createSignal(false);
	const recording = useRecordingStorage();
	const location = useLocationStorage();
	const deviceImages = useDeviceImagesStorage();
	const event = useEventStorage();
	const log = useLogsContext();

	const cancelAllReminders = async () => {
		try {
			const cancelOptions: CancelOptions = {
				notifications: ALL_REMINDER_IDS.map((id) => ({ id })),
			};
			await LocalNotifications.cancel(cancelOptions);
		} catch (error) {
			log.logError({
				message: "Failed to cancel reminder notifications",
				error,
			});
		}
	};

	onMount(async () => {
		// Clear any stale notifications on app start
		await cancelAllReminders();

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
		// Cancel reminders before starting upload
		await cancelAllReminders();
		try {
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

	const stopUploading = async () => {
		setIsUploading(false);
		recording.stopUploading();
		event.stopUploading();
		// Cancel reminders when stopping upload
		await cancelAllReminders();
	};

	const hasItemsToUpload = () => {
		return (
			recording.hasItemsToUpload() ||
			event.hasItemsToUpload() ||
			location.hasItemsToUpload() ||
			deviceImages.hasItemsToUpload()
		);
	};

	// Helper function to schedule notifications
	const scheduleUploadReminders = async () => {
		try {
			let permStatus: PermissionStatus =
				await LocalNotifications.checkPermissions();

			// Request permission if needed
			if (
				permStatus.display === "prompt" ||
				permStatus.display === "prompt-with-rationale"
			) {
				permStatus = await LocalNotifications.requestPermissions();
			}

			if (permStatus.display !== "granted") {
				log.logWarning({
					message:
						"Cannot schedule upload notification: Permission not granted.",
				});
				return;
			}

			// Clear existing reminders before scheduling new ones
			await cancelAllReminders();

			const recordingsCount = recording.unuploadedRecordings().length;
			const eventsCount = event.unuploadedEvents().length;
			const locationsToSync = location.hasItemsToUpload();
			const photosCount = deviceImages.itemsToUpload().length;

			const notifications: LocalNotificationSchema[] = [];
			const now = Date.now();
			const oneHour = now + 60 * 60 * 1000;
			const sixHours = now + 6 * 60 * 60 * 1000;
			const twelveHours = now + 12 * 60 * 60 * 1000;

			let uploadBody = "Items ready to upload: ";
			const parts: string[] = [];
			if (recordingsCount > 0) parts.push(`${recordingsCount} recordings`);
			if (eventsCount > 0) parts.push(`${eventsCount} events`);
			if (photosCount > 0) parts.push(`${photosCount} photos`);

			if (parts.length > 0) {
				uploadBody += parts.join(", ") + ".";

				// Schedule 1-hour reminder
				notifications.push({
					id: UPLOAD_REMINDER_1H_ID,
					title: "Upload Reminder",
					body: uploadBody,
					schedule: { at: new Date(oneHour) },
					smallIcon: "ic_stat_notify_upload",
					autoCancel: true,
				});

				// Schedule 6-hour reminder
				notifications.push({
					id: UPLOAD_REMINDER_1H_ID,
					title: "Upload Reminder",
					body: uploadBody,
					schedule: { at: new Date(sixHours) },
					smallIcon: "ic_stat_notify_upload",
					autoCancel: true,
				});

				// Schedule 12-hour reminder
				notifications.push({
					id: UPLOAD_REMINDER_12H_ID,
					title: "Upload Reminder",
					body: uploadBody,
					schedule: { at: new Date(twelveHours) },
					smallIcon: "ic_stat_notify_upload",
					autoCancel: true,
				});
			}

			// Separate notification for location sync
			if (locationsToSync) {
				notifications.push({
					id: LOCATION_SYNC_REMINDER_ID,
					title: "Location Sync Pending",
					body: "Device location data is ready to be synced.",
					schedule: { at: new Date(oneHour) }, // Schedule alongside the first upload reminder
					smallIcon: "ic_stat_notify_sync", // Consider a different icon
					autoCancel: true,
				});
			}

			if (notifications.length > 0) {
				await LocalNotifications.schedule({ notifications });
			}
		} catch (error) {
			log.logError({
				message: "Error scheduling upload reminders",
				error,
			});
		}
	};

	createEffect(
		on(hasItemsToUpload, async (hasItems) => {
			try {
				if (hasItems) {
					await scheduleUploadReminders();
				} else {
					// If no items, cancel all reminders
					await cancelAllReminders();
				}

				// Auto-upload on WiFi logic remains the same
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
		}),
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
