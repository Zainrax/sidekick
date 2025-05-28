import {
	createRecordingSchema,
	type Recording,
	type UploadedRecording,
} from "~/database/Entities/Recording";
import {
	getRecordings,
	deleteRecording as deleteRecordingFromDb,
	deleteRecordings as deleteRecordingsFromDb,
	updateRecording as updateRecordingInDb,
	insertRecording,
} from "~/database/Entities/Recording";
import { db } from ".";
import { CacophonyPlugin } from "../CacophonyApi";
import { type DeviceDetails, DevicePlugin } from "../Device";
import { createMemo, createSignal, onMount } from "solid-js";
import { useUserContext } from "../User";
import { useLogsContext } from "../LogsContext";
import type { PluginListenerHandle } from "@capacitor/core";

type RecordingFile = {
	filename: string;
	path: string;
	size: number;
	isProd: boolean;
};

export function useRecordingStorage() {
	const log = useLogsContext();
	const userContext = useUserContext();
	const [savedRecordings, setSavedRecordings] = createSignal<Recording[]>([]);
	const uploadedRecordings = createMemo(
		() =>
			savedRecordings().filter((rec) => rec.isUploaded) as UploadedRecording[],
	);
	const unuploadedRecordings = createMemo(() =>
		savedRecordings().filter((rec) => !rec.isUploaded),
	);
	const unuploadedThermalRecordings = createMemo(() =>
		unuploadedRecordings().filter((rec) => rec.name.endsWith("cptv")),
	);
	const unuploadedAudioRecordings = createMemo(() =>
		unuploadedRecordings().filter((rec) => rec.name.endsWith("aac")),
	);

	const [shouldUpload, setShouldUpload] = createSignal(false);

	// Native batch upload state
	let currentQueueId = "";
	let progressListener: PluginListenerHandle | undefined;
	let completedListener: PluginListenerHandle | undefined;
	let failedListener: PluginListenerHandle | undefined;
	let queueStatusListener: PluginListenerHandle | undefined;

	const cleanupListeners = async () => {
		if (progressListener) await progressListener.remove();
		if (completedListener) await completedListener.remove();
		if (failedListener) await failedListener.remove();
		if (queueStatusListener) await queueStatusListener.remove();
		progressListener = undefined;
		completedListener = undefined;
		failedListener = undefined;
		queueStatusListener = undefined;
	};

	const stopUploading = () => {
		setShouldUpload(false);
		// Cancel native queue if running
		if (currentQueueId) {
			CacophonyPlugin.cancelUploadQueue(currentQueueId);
			currentQueueId = "";
			cleanupListeners();
		}
	};

	const getSavedRecordings = async (options?: {
		device?: string;
		uploaded?: boolean;
	}): Promise<Recording[]> => getRecordings(db)(options);

	const deleteRecording = async (recording: Recording) => {
		console.log("Deleting recording", recording);
		const res = await DevicePlugin.deleteRecording({
			recordingPath: recording.name,
		});
		if (!res.success) {
			log.logWarning({
				message: "Failed to delete recording",
				details: res.message,
			});
			return;
		}
		await deleteRecordingFromDb(db)(recording);
		setSavedRecordings((prev) => prev.filter((r) => r.id !== recording.id));
	};

	const deleteRecordings = async () => {
		console.log("Deleting all recordings");
		const res = await DevicePlugin.deleteRecordings();
		if (!res.success) {
			log.logWarning({
				message: "Failed to delete recordings",
				details: res.message,
			});
			return;
		}
		// Delete all recordings from the database apart from uploaded ones
		// as the device may not have internet access
		const recs = savedRecordings().filter((r) => !r.isUploaded);
		await deleteRecordingsFromDb(db)(recs);
		setSavedRecordings(savedRecordings().filter((r) => r.isUploaded));
	};

	const [uploadProgress, setUploadProgress] = createSignal<{
		current: number;
		total: number;
		percentage: number;
	}>({ current: 0, total: 0, percentage: 0 });

	// Helper function to yield control back to the event loop
	const yieldToUI = () => new Promise((resolve) => setTimeout(resolve, 0));

	// Process a single recording upload
	const uploadSingleRecording = async (
		recording: Recording,
		user: { token: string },
	) => {
		const type = recording.name.endsWith("cptv") ? "thermalRaw" : "audio";

		const res = await CacophonyPlugin.uploadRecording({
			token: user.token,
			type,
			device: recording.device,
			filename: recording.path.split("/").pop() ?? recording.name,
		});

		if (res.success) {
			recording.isUploaded = true;
			recording.uploadId = res.data.recordingId;
			await updateRecordingInDb(db)(recording);
			setSavedRecordings((prev) => {
				return [...prev.filter((r) => r.name !== recording.name), recording];
			});
			console.log("Deleting uploaded recording", recording);
			const deletion = await DevicePlugin.deleteRecording({
				recordingPath: recording.name,
			});
			if (!deletion.success) {
				console.error(deletion.message);
			}
			return { success: true };
		}
		if (
			res.message.includes("FileNotFoundException") ||
			res.message.includes("ENOENT")
		) {
			// File doesn't exist on device, remove DB record
			log.logWarning({
				message: `Recording file not found on device: ${recording.name}. Removing record.`,
				details: res.message,
				warn: false,
			});
			await deleteRecordingFromDb(db)(recording);
			setSavedRecordings((prev) => prev.filter((r) => r.id !== recording.id));
			return { success: true, skipDevice: true };
		}
		if (res.message.includes("AuthError")) {
			// Check if this is specifically a device access issue
			if (
				res.message.includes("Could not find a device") &&
				res.message.includes("for user")
			) {
				// Trigger device access request popup using deviceName + groupName
				userContext.setUserNeedsGroupAccess({
					deviceId: "",
					deviceName: recording.deviceName,
					groupName: recording.groupName,
				});

				log.logWarning({
					message: `Device access required for ${recording.deviceName} in group ${recording.groupName}`,
					details: `You need access to device ${recording.deviceName} to upload recordings`,
					warn: false,
				});
			} else {
				log.logWarning({
					message: "Your account does not have access to upload recordings",
					details: res.message,
					warn: false,
				});
			}
			return { success: false, authError: true, device: recording.device };
		}
		if (res.message.includes("Failed to verify JWT")) {
			log.logWarning({
				message: "Failed to upload recording, please try again or log in again",
				details: `${recording.name} - ${res.message}`,
				warn: false,
			});
			return { success: false };
		}
		if (res.message.includes("recordingDateTime")) {
			// This is a temporary fix for the issue where the audio file is corrupted, simply mark it as uploaded
			recording.isUploaded = true;
			recording.uploadId = null;
			await updateRecordingInDb(db)(recording);
			setSavedRecordings((prev) => {
				return [...prev.filter((r) => r.name !== recording.name), recording];
			});
			console.warn("Corrupted recording, marking as uploaded");
			const deletion = await DevicePlugin.deleteRecording({
				recordingPath: recording.name,
			});
			if (!deletion.success) {
				console.error(deletion.message);
			}
			return { success: true };
		}
		log.logWarning({
			message: "Failed to upload recording",
			details: `${recording.name} - ${res.message}`,
			warn: false,
		});
		return { success: false };
	};

	// Native batch upload for large numbers of files
	const uploagRecordingsBatch = async (warn = true) => {
		debugger;
		setShouldUpload(true);
		const userProd = userContext.isProd();
		const recordings = unuploadedRecordings().filter(
			(rec) => rec.isProd === userProd,
		);
		const total = recordings.length;

		if (total === 0) return;

		// Set initial progress
		setUploadProgress({ current: 0, total, percentage: 0 });

		const user = await userContext.getUser();
		if (!user) {
			setUploadProgress({ current: 0, total: 0, percentage: 0 });
			return;
		}

		// Prepare batch
		const uploadBatch = recordings.map((rec) => ({
			id: rec.id,
			type: rec.name.endsWith("cptv")
				? ("thermalRaw" as const)
				: ("audio" as const),
			device: rec.device,
			filename: rec.name,
			filepath: rec.path,
		}));

		// Track progress
		const progressMap = new Map<string, number>();
		let completedCount = 0;

		try {
			// Set up listeners
			progressListener = await CacophonyPlugin.addListener(
				"uploadProgress",
				(data) => {
					progressMap.set(data.recordingId, data.progress || 100);
					// Calculate overall progress
					const totalProgress = Array.from(progressMap.values()).reduce(
						(a, b) => a + b,
						0,
					);
					const avgProgress = totalProgress / total;
					setUploadProgress({
						current: completedCount,
						total,
						percentage: Math.round(avgProgress),
					});
				},
			);

			completedListener = await CacophonyPlugin.addListener(
				"uploadCompleted",
				async (data) => {
					const recording = recordings.find((r) => r.id === data.recordingId);
					if (recording) {
						recording.isUploaded = true;
						recording.uploadId = data.uploadId;
						await updateRecordingInDb(db)(recording);
						setSavedRecordings((prev) => {
							return [...prev.filter((r) => r.id !== recording.id), recording];
						});

						// Delete from device
						await DevicePlugin.deleteRecording({
							recordingPath: recording.name,
						});

						completedCount++;
						progressMap.delete(data.recordingId);

						setUploadProgress({
							current: completedCount,
							total,
							percentage: Math.round((completedCount / total) * 100),
						});
					}
				},
			);

			failedListener = await CacophonyPlugin.addListener(
				"uploadFailed",
				(data) => {
					const recording = recordings.find((r) => r.id === data.recordingId);
					if (recording && data.error.includes("AuthError")) {
						userContext.setUserNeedsGroupAccess({
							deviceId: "",
							deviceName: recording.deviceName,
							groupName: recording.groupName,
						});
					}
					progressMap.delete(data.recordingId);
					log.logWarning({
						message: `Failed to upload ${recording?.name || "recording"}`,
						details: data.error,
						warn: false,
					});
				},
			);

			queueStatusListener = await CacophonyPlugin.addListener(
				"queueStatusChanged",
				(data) => {
					// Update overall status if needed
					if (data.completed + data.failed === data.total) {
						// All done
						setUploadProgress({ current: 0, total: 0, percentage: 0 });
						setShouldUpload(false);
						cleanupListeners();
					}
				},
			);

			// Start batch upload
			const result = await CacophonyPlugin.batchUploadRecordings({
				token: user.token,
				recordings: uploadBatch,
				maxConcurrent: 3,
			});

			if (result.success) {
				currentQueueId = result.data.queueId;
			} else {
				log.logError({
					message: "Failed to start batch upload",
					error: new Error(result.message),
				});
				await cleanupListeners();
				setUploadProgress({ current: 0, total: 0, percentage: 0 });
			}
		} catch (error) {
			log.logError({
				message: "Error setting up batch upload",
				error,
			});
			await cleanupListeners();
			setUploadProgress({ current: 0, total: 0, percentage: 0 });
		}
	};

	const uploadRecordings = async (warn = true) => {
		// Use native batch upload for large numbers
		const recordings = unuploadedRecordings();
		if (recordings.length > 10) {
			return uploagRecordingsBatch(warn);
		}

		// Otherwise use existing concurrent JavaScript approach
		setShouldUpload(true);
		const userProd = userContext.isProd();
		const recs = unuploadedRecordings();
		const recordingsFiltered = recs.filter((rec) => rec.isProd === userProd);
		const total = recordingsFiltered.length;

		// Set initial progress
		setUploadProgress({ current: 0, total, percentage: 0 });

		// Batch size for UI updates
		const BATCH_SIZE = 5;
		// Maximum concurrent uploads
		const MAX_CONCURRENT = 3;

		let uploadedCount = 0;
		const authErrorDevices = new Set<string>();

		for (let i = 0; i < recordingsFiltered.length; i += MAX_CONCURRENT) {
			const shouldCancel = !shouldUpload();
			if (shouldCancel) {
				setUploadProgress({ current: 0, total: 0, percentage: 0 });
				return;
			}

			const user = await userContext.getUser();
			if (!user) {
				setUploadProgress({ current: 0, total: 0, percentage: 0 });
				return;
			}

			// Process up to MAX_CONCURRENT recordings in parallel
			const batch = recordingsFiltered.slice(
				i,
				Math.min(i + MAX_CONCURRENT, recordingsFiltered.length),
			);
			const batchPromises = batch
				.filter((recording) => !authErrorDevices.has(recording.device))
				.map((recording) => uploadSingleRecording(recording, user));

			const results = await Promise.all(batchPromises);

			// Check for auth errors and filter out devices with auth issues
			for (const result of results) {
				if (result.authError && result.device) {
					authErrorDevices.add(result.device);
				}
				if (result.success) {
					uploadedCount++;
				}
			}

			// Update progress
			const currentProgress = Math.min(
				i + batch.length,
				recordingsFiltered.length,
			);
			setUploadProgress({
				current: currentProgress,
				total,
				percentage: Math.round((currentProgress / total) * 100),
			});

			// Yield to UI every BATCH_SIZE uploads to prevent blocking
			if (uploadedCount % BATCH_SIZE === 0) {
				await yieldToUI();
			}
		}

		// Reset progress when done
		setUploadProgress({ current: 0, total: 0, percentage: 0 });

		// Show final warning if needed
		if (warn && authErrorDevices.size > 0) {
			log.logWarning({
				message: "Some devices require access permissions",
				details: `Unable to upload recordings for ${authErrorDevices.size} device(s) due to missing permissions`,
				warn: true,
			});
		}
	};

	const findRecording = async (
		options: { id: string } | { name: string; device: string },
	): Promise<Recording | undefined> => {
		const recordings = await getRecordings(db)(options);
		const recording = recordings[0];
		return recording;
	};

	const saveRecording = async ({
		id,
		name,
		group,
		path,
		filename,
		size,
		isProd,
	}: DeviceDetails & RecordingFile) => {
		try {
			const existingRecording = await findRecording({ id });
			if (existingRecording) {
				return existingRecording;
			}
			const recording = {
				name: filename,
				path,
				groupName: group,
				device: id,
				deviceName: name,
				size: size.toString(),
				isProd,
				isUploaded: false,
			};

			await insertRecording(db)(recording);
			const savedRecording = await findRecording({
				name: filename,
				device: id,
			});

			if (!savedRecording) {
				throw new Error("Failed to find recording");
			}
			setSavedRecordings((prev) => [...prev, savedRecording]);
			return savedRecording;
		} catch (e) {
			if (e instanceof Error) {
				log.logError({
					message: "Failed to save recording",
					details: e.message,
					error: e,
					warn: false,
				});
			}
		}
	};

	const hasItemsToUpload = createMemo(() => {
		return unuploadedRecordings().length > 0;
	});

	const deleteUploadedRecordings = async (deviceId: string) => {
		try {
			const toDelete = savedRecordings().filter(
				(r) => r.isUploaded && r.device === deviceId,
			);
			if (!toDelete.length) return;

			for (const rec of toDelete) {
				const res = await DevicePlugin.deleteRecording({
					recordingPath: rec.name,
				});
				if (!res.success) {
					log.logWarning({
						message: `Failed to delete uploaded recording ${rec.name}`,
						details: res.message,
					});
				}
			}

			// Delete from the DB
			await deleteRecordingsFromDb(db)(toDelete);

			// Remove from our local signal
			setSavedRecordings((prev) =>
				prev.filter((r) => !(r.isUploaded && r.device === deviceId)),
			);
		} catch (error) {
			log.logError({
				message: "Failed to delete uploaded recordings",
				error,
			});
		}
	};
	onMount(async () => {
		try {
			await db.execute(createRecordingSchema);
			setSavedRecordings(await getSavedRecordings());
		} catch (error) {
			log.logError({
				message: "Failed to create recording schema",
				error,
			});
		}
	});

	return {
		savedRecordings,
		saveRecording,
		stopUploading,
		uploadedRecordings,
		unuploadedRecordings,
		deleteRecording,
		deleteRecordings,
		uploadRecordings,
		getSavedRecordings,
		hasItemsToUpload,
		deleteUploadedRecordings,
		uploadProgress,
	};
}
