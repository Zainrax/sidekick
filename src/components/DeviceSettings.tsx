import { Camera, CameraResultType } from "@capacitor/camera";
import { Dialog as Prompt } from "@capacitor/dialog";
import { A, useParams, useSearchParams } from "@solidjs/router";
import { AiOutlineInfoCircle } from "solid-icons/ai";
import {
	BiRegularNoSignal,
	BiRegularSave,
	BiRegularSignal1,
	BiRegularSignal2,
	BiRegularSignal3,
	BiRegularSignal4,
	BiRegularSignal5,
} from "solid-icons/bi";
import { BsCameraVideoFill, BsWifiOff } from "solid-icons/bs";
import {
	FaRegularEye,
	FaRegularEyeSlash,
	FaRegularTrashCan,
	FaSolidCheck,
	FaSolidFileAudio,
	FaSolidLock,
	FaSolidLockOpen,
	FaSolidPlus,
	FaSolidSpinner,
	FaSolidVideo,
} from "solid-icons/fa";
import { FiCloud, FiCloudOff, FiMapPin } from "solid-icons/fi";
import { ImCog, ImCross } from "solid-icons/im";
import {
	RiArrowsArrowDownSLine,
	RiArrowsArrowRightSLine,
} from "solid-icons/ri";
import { TbCameraPlus, TbPlugConnectedX } from "solid-icons/tb";
import {
	For,
	Match,
	Show,
	Switch,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	on,
	onCleanup,
	onMount,
} from "solid-js";
import { Portal } from "solid-js/web";
import FieldWrapper from "~/components/Field";
import { GoToPermissions } from "~/components/GoToPermissions";
import type { AudioMode, DeviceId, WifiNetwork } from "~/contexts/Device";
import { useDevice } from "~/contexts/Device";
import { useStorage } from "~/contexts/Storage";
import { BsWifi1, BsWifi2, BsWifi } from "solid-icons/bs";
import { useUserContext } from "~/contexts/User";
import type { Frame, Region, Track } from "~/contexts/Device/Camera";
import { VsArrowSwap } from "solid-icons/vs";
import { useLogsContext } from "~/contexts/LogsContext";
import {
	AndroidSettings,
	IOSSettings,
	NativeSettings,
} from "capacitor-native-settings";
import type { Location } from "~/database/Entities/Location";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
type CameraCanvas = HTMLCanvasElement | undefined;
const colours = ["#ff0000", "#00ff00", "#ffff00", "#80ffff"];
type SettingProps = { deviceId: DeviceId };

export function AudioSettingsTab(props: SettingProps) {
	// Simple test recording button
	const context = useDevice();
	const id = () => props.deviceId;

	const [audioFiles, { refetch: refetchAudioFiles }] = createResource(
		id,
		async (id) => {
			if (!id) return null;
			const res = await context.getAudioFiles(id);
			return res;
		},
	);
	const [audioStatus, { refetch: refetchAudioStatus }] = createResource(
		id,
		async (id) => {
			if (!id) return null;
			const res = await context.getAudioStatus(id);
			return res;
		},
	);
	const [currentStatusMonitor, setCurrentStatusMonitor] = createSignal();
	const monitorAudioStatus = () => {
		const currInterval = currentStatusMonitor();
		if (currInterval) {
			console.log("Clearing interval");
			clearInterval(currInterval as number);
		}
		const interval = setInterval(() => {
			if (audioStatus.loading) return;
			if (audioStatus()?.status === "ready") {
				if (!audioFiles.loading) {
					refetchAudioFiles();
				}
			} else {
				refetchAudioStatus();
			}
		}, 10000);
		setCurrentStatusMonitor(interval);
	};

	onMount(() => {
		monitorAudioStatus();
		onCleanup(() => {
			const currInterval = currentStatusMonitor();
			if (currInterval) {
				clearInterval(currInterval as number);
			}
		});
	});

	const [audioMode, { refetch: refetchAudioMode }] = createResource(
		id,
		async (id) => {
			if (!id) return null;
			const device = context.devices.get(id);
			if (!device) return null;
			const res = await context.getAudioMode(device.url);
			return res;
		},
	);
	const [recording, setRecording] = createSignal(false);
	const [result, setResult] = createSignal<"failed" | "success" | null>(null);
	const createTestRecording = async () => {
		const res = await context.takeAudioRecording(id());
		setResult(res ? "success" : "failed");
		refetchAudioStatus();
	};

	const [config] = createResource(id, async (id) => {
		if (!id) return null;
		const res = await context.getDeviceConfig(id);
		return res;
	});

	function timeToMinutes(time: string): number {
		const [hours, minutes] = time.split(":").map(Number);
		return hours * 60 + minutes;
	}
	type PercentageRange = [number, number];
	function timeToPercentage(time: string): number {
		const [hours, minutes] = time.split(":").map(Number);
		const totalMinutes = hours * 60 + minutes;
		return Number.parseFloat(((totalMinutes / (24 * 60)) * 100).toFixed(2));
	}
	function calculateTimePercentagePoints(
		startTime: string,
		endTime: string,
	): [PercentageRange, PercentageRange | null] {
		const startPercentage = timeToPercentage(startTime);
		const endPercentage = timeToPercentage(endTime);

		if (startPercentage <= endPercentage) {
			return [[startPercentage, endPercentage], null];
		}
		return [
			[0, endPercentage],
			[startPercentage, 100],
		];
	}
	const thermalMode = (): [PercentageRange, PercentageRange | null] | null => {
		const windowConfig = config()?.values.windows;
		const windowDefaultConfig = config()?.defaults.windows;
		if (!windowConfig) return null;
		const startTime =
			(windowConfig.StartRecording
				? windowConfig.StartRecording
				: windowDefaultConfig?.StartRecording) ?? "-30m";
		const stopTime =
			(windowConfig.StopRecording
				? windowConfig.StopRecording
				: windowDefaultConfig?.StopRecording) ?? "+30m";
		if (startTime === "-30m" || startTime === "+30m")
			return [
				[0, 33],
				[66, 100],
			] as const;
		const res = calculateTimePercentagePoints(startTime, stopTime);
		return res;
	};
	const calcWidth = (range: PercentageRange) => {
		const [start, end] = range;
		const value = end - start;
		if (value === 0) return 100;
		return value;
	};
	const calcAudioWidth = (range: [PercentageRange, PercentageRange | null]) => {
		const [start, end] = range;
		let endWidth = 0;
		if (end) {
			endWidth = calcWidth(end);
		}
		const startWidth = calcWidth(start);
		const value = 100 - startWidth - endWidth;
		return value;
	};

	// new audio settings state
	const [audioSettings, { refetch: refetchAudioSettings }] = createResource(
		id,
		async (id) => context.getAudioRecordingSettings(id),
	);
	createEffect(() => {
		console.log("Audio Settings: ", audioSettings());
	});
	const [seedValue, setSeed] = createSignal<string>(
		audioSettings()?.seed ?? "",
	);
	// add debounce effect to auto-save after typing stops
	let seedSaveTimeout: ReturnType<typeof setTimeout>;
	const setSeedValue = (value: string) => {
		setSeed(value);
		clearTimeout(seedSaveTimeout);
		seedSaveTimeout = setTimeout(() => {
			if (seedValue !== audioSettings()?.seed) {
				saveSeed();
			}
		}, 1000);
	};
	const [seedSaving, setSeedSaving] = createSignal(false);
	const saveSeed = async () => {
		setSeedSaving(true);
		await context.setAudioRecordingSettings(
			id(),
			audioMode() || "Disabled",
			seedValue(),
		);
		await refetchAudioSettings();
		setSeedSaving(false);
	};

	// --- Long Recording Controls ---
	const [selectedDuration, setSelectedDuration] = createSignal<number | null>(
		60,
	); // Duration in seconds
	const [customSeconds, setCustomSeconds] = createSignal(60);
	const [initiatingLongRecording, setInitiatingLongRecording] =
		createSignal(false); // Tracks the API call itself
	const [lastLongRecordingDuration, setLastLongRecordingDuration] =
		createSignal<number | null>(null); // Stores the duration for result display
	const [longResult, setLongResult] = createSignal<"failed" | "success" | null>(
		null,
	);

	// Effect to show success/failure message when recording finishes
	createEffect(
		on(audioStatus, (currentStatus, prevStatus) => {
			// Check if the status transitioned *from* long_recording *to* ready
			if (
				prevStatus?.status === "long_recording" &&
				currentStatus?.status === "ready"
			) {
				// Assume success if the API call didn't explicitly fail
				if (longResult() !== "failed") {
					setLongResult("success");
				}
				// Show result message for a few seconds
				setTimeout(() => {
					setLongResult(null);
					setLastLongRecordingDuration(null);
				}, 5000);
			}
		}),
	);

	const startLongRecording = async (duration: number) => {
		// Disable if already recording (any type) or initiating
		if (
			initiatingLongRecording() ||
			audioStatus()?.status === "recording" ||
			audioStatus()?.status === "long_recording" ||
			audioStatus()?.status === "busy"
		)
			return;

		setInitiatingLongRecording(true);
		setLastLongRecordingDuration(duration); // Store duration for potential result message
		setLongResult(null); // Clear previous result

		const ok = await context.takeLongAudioRecording(id(), duration);

		// If the API call itself failed immediately
		if (!ok) {
			setLongResult("failed");
			// Show failure message briefly
			setTimeout(() => {
				setLongResult(null);
				setLastLongRecordingDuration(null);
			}, 5000);
		}
		// Don't set longResult to success here, wait for status change effect

		setInitiatingLongRecording(false);
		// Status should update via the interval check or the immediate refetch in takeLongAudioRecording
	};

	const handleStartClick = () => {
		const duration = selectedDuration() ?? customSeconds();
		if (duration > 0) {
			startLongRecording(duration);
			monitorAudioStatus();
		}
	};

	return (
		<section class="space-y-4 px-2 py-4">
			<div class="flex items-center  text-gray-800">
				<p class="pl-2">
					Audio recordings are made 32 times a day for one minute at random
					intervals.
				</p>
			</div>
			<h1 class="pl-2 font-medium text-gray-500">Settings</h1>
			<FieldWrapper type="custom" title="Audio Mode">
				<div class="flex w-full items-center">
					<select
						onChange={async (e) => {
							const value = e.currentTarget.value;
							await context.setAudioMode(id(), value as AudioMode);
							refetchAudioMode();
						}}
						value={audioMode() ?? "Loading..."}
						class="h-full w-full appearance-none bg-white pl-2"
					>
						<option value="Disabled">Disabled</option>
						<option value="AudioOnly">Audio Only</option>
						<option value="AudioAndThermal">Audio and Thermal</option>
						<option value="AudioOrThermal">Audio or Thermal</option>
					</select>
					<RiArrowsArrowDownSLine size={32} />
				</div>
			</FieldWrapper>
			<div>
				<div class="flex items-center space-x-2 px-2">
					<div class="w-20" />
					<div class="flex w-full justify-between text-xs text-gray-500">
						<div>00:00</div>
						<div>12:00</div>
						<div>24:00</div>
					</div>
				</div>
				<div class="flex flex-col">
					<div class="flex items-center space-x-2 px-2">
						<Show when={thermalMode()}>
							{(thermalMode) => (
								<>
									<h2 class="w-20 text-gray-500">Thermal:</h2>
									<div class="relative flex h-5 w-full items-center rounded-full bg-gray-200 py-1">
										<Show when={audioMode() !== "AudioOnly"}>
											<div
												class="absolute h-3 rounded-full bg-green-300"
												style={{
													left: `${thermalMode()[0]}%`,
													width: `${calcWidth(thermalMode()[0])}%`,
												}}
											/>
											<Show when={thermalMode()[1]}>
												{(thermalMode) => (
													<div
														class="absolute h-3 rounded-full bg-green-300"
														style={{
															left: `${thermalMode()[0]}%`,
															width: `${calcWidth(thermalMode())}%`,
														}}
													/>
												)}
											</Show>
										</Show>
									</div>
								</>
							)}
						</Show>
					</div>

					<div class="flex items-center space-x-2 px-2">
						<Show when={thermalMode()}>
							{(thermalMode) => (
								<>
									<h2 class="w-20 text-gray-500">Audio:</h2>
									<div class="relative flex h-5 w-full items-center rounded-full bg-gray-200 py-1">
										<Switch>
											<Match
												when={
													audioMode() === "AudioOnly" ||
													audioMode() === "AudioAndThermal"
												}
											>
												<div
													class="absolute h-3 rounded-full bg-green-300"
													style={{
														width: "100%",
													}}
												/>
											</Match>
											<Match when={audioMode() === "AudioOrThermal"}>
												<div
													class="absolute h-3 rounded-full bg-green-300"
													style={{
														left: `${thermalMode()[0][1]}%`,
														width: `${calcAudioWidth(thermalMode())}%`,
													}}
												/>
											</Match>
										</Switch>
									</div>
								</>
							)}
						</Show>
					</div>
				</div>
			</div>
			{/* <Show when={audioMode() !== "Disabled"}>
				<div class="flex items-center  rounded-md border-2 border-slate-200 p-2 pl-2 text-slate-500">
					<AiOutlineInfoCircle class="mr-2" size={18} />
					<Switch>
						<Match when={audioMode() === "AudioOnly"}>
							<p>
								Records audio in a 24 hour window, and disables thermal
								recording.
							</p>
						</Match>
						<Match when={audioMode() === "AudioOrThermal"}>
							<p>Records audio outside of the thermal recording window.</p>
						</Match>
						<Match when={audioMode() === "AudioAndThermal"}>
							<p>
								Records audio in a 24 hour window, however the camera cannot
								record during the 1 minute of audio recording.
							</p>
						</Match>
					</Switch>
				</div>

			</Show> */}
			{/*<div>
				<div class="flex items-center rounded-lg border">
					<label
						for="audio-seed"
						class="text-xs text-center font-light text-gray-700 min-w-[96px]"
					>
						Audio Seed
					</label>
					<input
						id="audio-seed"
						type="number"
						class="flex-1 rounded-r border-l px-2 py-1"
						value={seedValue()}
						onInput={(e) =>
							setSeedValue((e.currentTarget as HTMLInputElement).value)
						}
					/>
					<Show when={seedSaving()}>
						<FaSolidSpinner class="animate-spin text-blue-500" size={16} />
					</Show>
				</div>
			</div>
*/}
			<Show when={context.devices.get(id())?.hasLongRecordingSupport}>
				<div class="space-y-2 rounded-lg border p-3 pb-0 shadow-sm">
					<label class="block text-sm text-gray-600">Audio Recording</label>
					{/* Updated Grid Layout */}
					<div class="grid grid-cols-4 gap-2">
						{/* Preset Buttons */}
						<For each={[60, 180, 300]}>
							{(duration) => (
								<button
									type="button"
									onClick={() => setSelectedDuration(duration)}
									disabled={
										initiatingLongRecording() ||
										audioStatus()?.status === "long_recording" ||
										audioStatus()?.status === "busy"
									}
									classList={{
										"bg-blue-500 text-white": selectedDuration() === duration,
										"bg-gray-200 text-gray-700 hover:bg-gray-300":
											selectedDuration() !== duration,
										"opacity-50 cursor-not-allowed":
											initiatingLongRecording() ||
											audioStatus()?.status === "long_recording" ||
											audioStatus()?.status === "busy",
									}}
									class="col-span-1 rounded px-3 py-1.5 text-sm transition" // Ensure col-span-1
								>
									{duration / 60} min
								</button>
							)}
						</For>

						{/* Start Button */}
						<button
							type="button"
							class="col-span-1 flex items-center justify-center space-x-1 rounded bg-green-500 px-3 py-1.5 text-sm text-white transition hover:bg-green-600 disabled:bg-gray-400 md:col-span-1" // Adjust col-span for different screen sizes
							onClick={handleStartClick}
							disabled={
								initiatingLongRecording() || // Disable while initiating
								audioStatus()?.status === "long_recording" || // Disable if already long recording
								audioStatus()?.status === "recording" || // Disable if short recording
								audioStatus()?.status === "busy" || // Disable if busy with video
								audioMode() === "Disabled" ||
								(!selectedDuration() && customSeconds() <= 0)
							}
						>
							<Switch>
								<Match when={initiatingLongRecording()}>
									<span>Starting...</span>
								</Match>
								<Match when={audioStatus()?.status === "long_recording"}>
									<FaSolidFileAudio size={16} />
									<span>Start</span>
								</Match>
								<Match
									when={
										!initiatingLongRecording() &&
										audioStatus()?.status !== "long_recording"
									}
								>
									<FaSolidFileAudio size={16} />
									<span>Start</span>
								</Match>
							</Switch>
						</button>
					</div>
					{/* Status/Result Display */}
					<div class=" text-center text-sm">
						{" "}
						{/* Added min-height */}
						<Show
							when={longResult() && audioStatus()?.status !== "long_recording"}
						>
							<span
								class={`${longResult() === "success" ? "text-green-600" : "text-red-600"}`}
							>
								{longResult() === "success"
									? `Recording (${lastLongRecordingDuration()}s) finished.`
									: `Recording (${lastLongRecordingDuration()}s) failed.`}
							</span>
						</Show>
					</div>
				</div>
			</Show>
			{/* End Long Recording Section */}

			{/* Test Recording Button */}
			<button
				type="button"
				class="flex w-full items-center justify-center space-x-2 rounded-lg py-3 text-white disabled:bg-gray-300 bg-blue-500"
				onClick={() => createTestRecording()}
				disabled={
					initiatingLongRecording() || // Disable if initiating long recording
					audioStatus()?.status === "long_recording" || // Disable if long recording active
					audioStatus()?.status === "recording" || // Disable if short recording active
					audioStatus()?.status === "busy" || // Disable if busy with video
					audioMode() === "Disabled"
				}
			>
				<Switch fallback={<FaSolidSpinner class="animate-spin" size={20} />}>
					<Match when={audioMode() === "Disabled"}>
						<span>Test Recording</span>
						<FaSolidFileAudio size={20} />
					</Match>
					<Match when={audioStatus()?.status === "pending"}>
						<span>Setting up...</span>
						<FaSolidSpinner class="animate-spin" size={20} />
					</Match>
					<Match when={audioStatus()?.status === "recording"}>
						<span>Recording...</span>
						<FaSolidSpinner class="animate-spin" size={20} />
					</Match>
					<Match when={audioStatus()?.status === "long_recording"}>
						<span>Long Recording Active...</span>
						<FaSolidSpinner class="animate-spin" size={20} />
					</Match>
					<Match when={audioStatus()?.status === "busy"}>
						<span class="sm:text-sm">Busy Recording Video...</span>
						<FaSolidSpinner class="animate-spin" size={20} />
					</Match>
					<Match when={audioStatus()?.status === "ready"}>
						<span>Test Recording</span>
						<FaSolidFileAudio size={20} />
					</Match>
				</Switch>
			</button>
		</section>
	);
}

export function CameraSettingsTab(props: SettingProps) {
	const context = useDevice();
	const device = () => context.devices.get(props.deviceId);
	const [audioStatus, { refetch: refetchAudioStatus }] = createResource(
		props.deviceId,
		async (id) => {
			if (!id) return null;
			const res = await context.getAudioStatus(id);
			console.log("Audio Status: ", res);
			return res;
		},
	);
	const [currentStatusMonitor, setCurrentStatusMonitor] = createSignal();
	const monitorAudioStatus = () => {
		const currInterval = currentStatusMonitor();
		if (currInterval) {
			console.log("Clearing interval");
			clearInterval(currInterval as number);
		}
		const interval = setInterval(() => {
			if (audioStatus.loading) return;
			refetchAudioStatus();
		}, 10000);
		setCurrentStatusMonitor(interval);
	};

	onMount(() => {
		monitorAudioStatus();
		onCleanup(() => {
			const currInterval = currentStatusMonitor();
			if (currInterval) {
				clearInterval(currInterval as number);
			}
		});
	});
	const id = () => props.deviceId;
	const [config, { refetch }] = createResource(id, async (id) => {
		if (!id) return null;
		const res = await context.getDeviceConfig(id);
		return res;
	});
	const [recording, setRecording] = createSignal(false);
	const [result, setResult] = createSignal<"failed" | "success" | null>(null);
	const createTestRecording = async () => {
		setRecording(true);
		const res = await context.takeTestRecording(id());
		setResult(res ? "success" : "failed");
		setRecording(false);
		setTimeout(() => setResult(null), 2000);
	};
	let frameCanvas: CameraCanvas;
	let trackCanvas: CameraCanvas;
	let triggerTrap: HTMLButtonElement | undefined;
	async function processFrame(frame: Frame) {
		if (!frameCanvas || !trackCanvas) {
			return;
		}
		updateCanvasSize(
			frameCanvas,
			frame.frameInfo.Camera.ResX,
			frame.frameInfo.Camera.ResY,
		);
		//updateCanvasSize(
		//  trackCanvas,
		//  frame.frameInfo.Camera.ResX,
		//  frame.frameInfo.Camera.ResY
		//);

		const context = frameCanvas.getContext("2d", {
			willReadFrequently: true,
		}) as CanvasRenderingContext2D;
		processImageData(context, frame);

		//const trackContext = trackCanvas.getContext(
		//  "2d"
		//) as CanvasRenderingContext2D;
		//trackContext.clearRect(0, 0, trackCanvas.width, trackCanvas.height);
		//renderTracks(trackContext, frame.frameInfo.Tracks);
	}

	function updateCanvasSize(
		canvas: HTMLCanvasElement,
		width: number,
		height: number,
	) {
		if (canvas.width !== width) {
			canvas.width = width;
		}
		if (canvas.height !== height) {
			canvas.height = height;
		}
	}

	function processImageData(context: CanvasRenderingContext2D, frame: Frame) {
		const imgData = context.getImageData(
			0,
			0,
			frame.frameInfo.Camera.ResX,
			frame.frameInfo.Camera.ResY,
		);
		const irCamera = frame.frameInfo.Camera.ResX >= 640;
		if (triggerTrap) triggerTrap.style.display = irCamera ? "" : "none";
		let max = 0;
		let min = 0;
		let range = 0;
		if (!irCamera) {
			[min, max] = calculateMinMax(frame.frame);
			range = max - min;
		}
		const scale = 255.0 / range;

		for (let i = 0; i < frame.frame.length; i++) {
			const pix = irCamera
				? frame.frame[i]
				: Math.min(255, (frame.frame[i] - min) * scale);
			const index = i * 4;
			imgData.data[index] = pix;
			imgData.data[index + 1] = pix;
			imgData.data[index + 2] = pix;
			imgData.data[index + 3] = 255;
		}
		context.putImageData(imgData, 0, 0);
	}

	function calculateMinMax(data: Uint16Array): [number, number] {
		let min = data[0];
		let max = data[0];

		for (let i = 1; i < data.length; i++) {
			if (data[i] < min) min = data[i];
			if (data[i] > max) max = data[i];
		}

		return [min, max];
	}

	function scalePixel(pixel: number, min: number, range: number): number {
		return Math.min(255, ((pixel - min) / range) * 255.0);
	}

	function renderTracks(
		context: CanvasRenderingContext2D,
		tracks: Track[] | null,
	) {
		if (!tracks) return;
		for (let index = 0; index < tracks.length; index++) {
			const track = tracks[index];
			const label = track.predictions?.[0]?.label || null;
			drawRectWithText(
				context,
				track.positions[track.positions.length - 1],
				label,
				index,
			);
		}
	}
	function drawRectWithText(
		context: CanvasRenderingContext2D,
		region: Region,
		what: string | null,
		trackIndex: number,
	): void {
		const lineWidth = 1;
		const outlineWidth = lineWidth + 4;
		const halfOutlineWidth = outlineWidth / 2;

		const x = Math.max(
			halfOutlineWidth,
			Math.round(region.x) - halfOutlineWidth,
		);
		const y = Math.max(
			halfOutlineWidth,
			Math.round(region.y) - halfOutlineWidth,
		);
		const width = Math.round(
			Math.min(context.canvas.width - region.x, Math.round(region.width)),
		);
		const height = Math.round(
			Math.min(context.canvas.height - region.y, Math.round(region.height)),
		);
		context.lineJoin = "round";
		context.lineWidth = outlineWidth;
		context.strokeStyle = "rgba(0, 0, 0,  0.5)";
		context.beginPath();
		context.strokeRect(x, y, width, height);
		context.strokeStyle = colours[trackIndex % colours.length];
		context.lineWidth = lineWidth;
		context.beginPath();
		context.strokeRect(x, y, width, height);
		// If exporting, show all the best guess animal tags, if not unknown
		if (what !== null) {
			const text = what;
			const textHeight = 9;
			const textWidth = context.measureText(text).width;
			const marginX = 2;
			const marginTop = 2;
			let textX =
				Math.min(context.canvas.width, region.x) - (textWidth + marginX);
			let textY = region.y + region.height + textHeight + marginTop;
			// Make sure the text doesn't get clipped off if the box is near the frame edges
			if (textY + textHeight > context.canvas.height) {
				textY = region.y - textHeight;
			}
			if (textX < 0) {
				textX = region.x + marginX;
			}
			context.font = "13px sans-serif";
			context.lineWidth = 4;
			context.strokeStyle = "rgba(0, 0, 0, 0.5)";
			context.strokeText(text, textX, textY);
			context.fillStyle = "white";
			context.fillText(text, textX, textY);
		}
	}

	const camera = createMemo(() => context.getDeviceCamera(id()));
	const [isRecieving, setIsRecieving] = createSignal(false);

	// Detect user activity to keep the feed active
	const [userActive, setUserActive] = createSignal(true);
	let userActivityTimeout: number | null = null;

	// Function to refresh user activity status
	const refreshUserActivity = () => {
		setUserActive(true);
		if (userActivityTimeout) {
			clearTimeout(userActivityTimeout);
		}

		// Reset timeout after 60 seconds of inactivity
		userActivityTimeout = setTimeout(() => {
			setUserActive(false);
		}, 60000) as unknown as number;
	};

	// Setup activity listeners
	onMount(() => {
		// Track user activity
		const activityEvents = [
			"mousemove",
			"mousedown",
			"keypress",
			"touchstart",
			"scroll",
		];
		const handleActivity = () => refreshUserActivity();

		// Add all event listeners
		for (const event of activityEvents) {
			document.addEventListener(event, handleActivity);
		}

		// Start with active status
		refreshUserActivity();

		const cam = camera();
		if (cam) {
			cam.toggle();
			cam.run();
			cam.setOnFrame(() => (frame) => {
				if (!isRecieving()) setIsRecieving(true);
				requestAnimationFrame(() => processFrame(frame));
			});
		}

		// Monitor connection status
		const connectionInterval = setInterval(() => {
			const cam = camera();
			// If user is active but connection isn't active, reconnect
			if (userActive() && cam && !cam.isConnected()) {
				console.log(
					"Camera feed disconnected but user is active, reconnecting...",
				);
				cam.run();
			}
		}, 5000);

		onCleanup(() => {
			// Remove all event listeners
			for (const event of activityEvents) {
				document.removeEventListener(event, handleActivity);
			}

			// Clear all timeouts and intervals
			if (userActivityTimeout) {
				clearTimeout(userActivityTimeout);
			}

			clearInterval(connectionInterval);
		});
	});

	const isDefault = () => {
		const windows = config()?.values.windows;
		const windowsDefault = config()?.defaults.windows;
		if (!windows || !windowsDefault) return false;
		if (
			!windows.PowerOn &&
			!windows.PowerOff &&
			!windows.StartRecording &&
			!windows.StopRecording
		)
			return true;
		if (
			windows.StartRecording === windowsDefault.StartRecording &&
			windows.StopRecording === windowsDefault.StopRecording &&
			windows.PowerOn === windowsDefault.PowerOn &&
			windows.PowerOff === windowsDefault.PowerOff
		) {
			return true;
		}
		return false;
	};

	const is24Hours = () => {
		const start = "12:00";
		const stop = "12:00";
		const windows = config()?.values.windows;
		if (!windows) return false;
		if (windows.PowerOn === start && windows.PowerOff === stop) return true;
		return false;
	};

	const isCustom = () => {
		return config.loading ? false : !isDefault() && !is24Hours();
	};

	const setTo24Hours = async () => {
		try {
			setShowCustom(false);
			const on = "12:00";
			const off = "12:00";
			const res = await context.setRecordingWindow(id(), on, off);
			refetch();
		} catch (error) {
			console.error("Set 24 Hour Error: ", error);
		}
	};

	const setToDefault = async () => {
		try {
			setShowCustom(false);
			const defaults = config()?.defaults;
			if (!defaults) return;
			const on = defaults.windows?.PowerOn ?? "-30min";
			const off = defaults.windows?.PowerOff ?? "+30min";
			const res = await context.setRecordingWindow(id(), on, off);
			refetch();
		} catch (error) {
			console.error(error);
		}
	};

	const [lowerTime, setLowerTime] = createSignal(0);
	const [upperTime, setUpperTime] = createSignal(100);
	const lowerTimeStr = () => percentToTime(lowerTime());
	const upperTimeStr = () => percentToTime(upperTime());
	const [showCustom, setShowCustom] = createSignal(false);
	createEffect(() => {
		const conf = config();
		if (config.loading || config.error || !conf?.values.windows) return;
		if (isCustom()) {
			setShowCustom(true);
			setLowerTime(timeToPercent(conf.values.windows.PowerOn));
			setUpperTime(timeToPercent(conf.values.windows.PowerOff));
		}
	});
	const percentToTime = (percent: number): string => {
		if (typeof percent !== "number" || percent < 0 || percent > 100) {
			return "Invalid input";
		}

		const totalMinutes = Math.round((percent / 100) * 1440);
		let hours = Math.floor(totalMinutes / 60);
		if (hours === 24) {
			hours = 0;
		}
		const mins = totalMinutes % 60;

		const formattedHours = hours.toString().padStart(2, "0");
		const formattedMinutes = mins.toString().padStart(2, "0");
		return `${formattedHours}:${formattedMinutes}`;
	};

	const [saving, setSaving] = createSignal(false);
	const saveCustomWindow = async () => {
		try {
			const on = lowerTimeStr();
			const off = upperTimeStr();
			setSaving(true);
			const res = await context.setRecordingWindow(id(), on, off);
			if (res) {
				refetch();
			}
		} catch (error) {
			console.error(error);
		}
		setSaving(false);
	};

	const timeToPercent = (time: string): number => {
		const [hours, mins] = time.split(":");
		const minutes = Number(hours) * 60 + Number(mins);
		return (minutes / 1440) * 100;
	};

	const saveIsDisabled = () => {
		const conf = config();
		if (config.loading || config.error || !conf?.values?.windows) return true;

		if (lowerTime() !== timeToPercent(conf.values.windows.PowerOn))
			return false;
		if (upperTime() !== timeToPercent(conf.values.windows.PowerOff))
			return false;
		return true;
	};

	const [audioMode] = createResource(async () => {
		try {
			const device = context.devices.get(id());
			if (!device) return null;
			const res = await context.getAudioMode(device.url);
			return res;
		} catch (error) {
			console.error(error);
			return null;
		}
	});

	createEffect(() => {
		console.log("Audio Status: ", audioStatus());
		console.log("Audio Mode: ", audioMode());
	});

	return (
		<section>
			<Switch>
				<Match when={audioMode() === "AudioOnly"}>
					<p class="w-full p-8 text-center text-2xl text-neutral-600">
						Preview not available in audio only mode.
					</p>
				</Match>
				<Match
					when={audioStatus() === null || audioStatus()?.status === "ready"}
				>
					<Show
						when={isRecieving()}
						fallback={
							<div
								style={{
									height: "269px",
								}}
								class="flex h-full items-center justify-center gap-x-2 bg-slate-50"
							>
								<FaSolidSpinner class="animate-spin" size={32} />
								<p>Starting Camera...</p>
							</div>
						}
					>
						<div class="relative">
							<canvas
								ref={frameCanvas}
								id="frameCanvas"
								width="160"
								height="120"
								class="w-full"
							/>
							<canvas
								ref={trackCanvas}
								id="trackCanvas"
								width="160"
								height="120"
								class="absolute left-0 top-0 z-10 w-full"
							/>
						</div>
					</Show>
					<button
						ref={triggerTrap}
						style={{ position: "relative", display: "none" }}
						type="button"
					>
						Trigger trap
					</button>
					<button
						class="flex w-full items-center justify-center space-x-2 rounded-b-lg bg-blue-500 py-3 text-white"
						type="button"
						onClick={() => createTestRecording()}
						disabled={recording()}
					>
						<Switch>
							<Match when={recording()}>
								<p>Recording...</p>
								<FaSolidSpinner class="animate-spin" size={24} />
							</Match>
							<Match when={result() === "success"}>
								<p>Success!</p>
								<FaSolidCheck size={24} />
							</Match>
							<Match when={result() === "failed"}>
								<ImCross size={12} />
							</Match>
							<Match when={!recording() && !result()}>
								<p>Test Recording</p>
								<FaSolidVideo size={24} />
							</Match>
						</Switch>
					</button>
				</Match>
				<Match
					when={
						audioStatus() &&
						audioStatus()?.status !== "ready" &&
						audioMode() !== "Disabled"
					}
				>
					<p class="w-full p-8 text-center text-2xl text-neutral-600">
						Camera not available due to audio recording.
					</p>
				</Match>
			</Switch>
			<div class="px-6 py-2">
				<h1 class="font-semibold text-gray-800">Recording Window</h1>
				<div class="flex w-full justify-between">
					<div class="flex items-center gap-x-2">
						<input
							id="default"
							type="radio"
							name="recording-window"
							value="default"
							checked={isDefault()}
							onChange={() => setToDefault()}
						/>
						<label for="default">Default</label>
					</div>
					<div class="flex items-center gap-x-2">
						<input
							id="24-hours"
							type="radio"
							name="recording-window"
							value="24-hours"
							checked={is24Hours()}
							onChange={() => setTo24Hours()}
						/>
						<label for="24-hours">24 Hours</label>
					</div>
					<div class="flex items-center gap-x-2">
						<input
							id="custom"
							type="radio"
							name="recording-window"
							value="custom"
							checked={isCustom()}
							onChange={() => setShowCustom(true)}
						/>
						<label for="custom">Custom</label>
					</div>
				</div>
				<Show when={isDefault() && !showCustom()}>
					<p class="flex pt-2 text-sm text-gray-600">
						<span class="inline-block">
							<AiOutlineInfoCircle size={22} />
						</span>
						<span class="text-ellipsis px-2">
							30 minutes before sunset and 30 minutes after sunrise based on the
							device's location and seasonal timing.
						</span>
					</p>
				</Show>
				<Show when={showCustom()}>
					<div>
						<div class="flex items-center justify-center space-x-2 py-2">
							<input
								id="lower"
								name="upper"
								type="time"
								class="w-24 rounded-l bg-slate-50 py-2 pl-2 text-sm text-gray-800 outline-none"
								value={lowerTimeStr()}
								onChange={(e) => {
									const value = timeToPercent(e.target.value);
									setLowerTime(value);
								}}
							/>
							<button
								type="button"
								onClick={() => {
									const lower = lowerTime();
									const upper = upperTime();
									setLowerTime(upper);
									setUpperTime(lower);
								}}
								class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-slate-50 shadow-md"
							>
								<div class="p-2">
									<VsArrowSwap size={18} />
								</div>
							</button>
							<input
								id="upper"
								name="upper"
								type="time"
								class="w-24 rounded-r bg-slate-50 py-2 pl-2 text-sm text-gray-800 outline-none"
								value={upperTimeStr()}
								onChange={(e) => {
									const value = timeToPercent(e.target.value);
									setUpperTime(value);
								}}
							/>
						</div>
						<button
							type="button"
							classList={{
								"bg-blue-500 py-2 px-4 text-white": !saveIsDisabled(),
								"bg-gray-400 py-2 px-4 text-gray-500": saveIsDisabled(),
							}}
							class="flex w-full items-center justify-center space-x-2 rounded-lg  py-3 text-white"
							onClick={() => saveCustomWindow()}
							disabled={saveIsDisabled()}
						>
							{saving() ? "Saving..." : "Save"}
						</button>
					</div>
				</Show>
			</div>
		</section>
	);
}

export function LocationSettingsTab(props: SettingProps) {
	const log = useLogsContext();
	const context = useDevice();
	const storage = useStorage();
	const userContext = useUserContext();
	const [showLocationSettings, setShowLocationSettings] = createSignal(false);
	const id = () => props.deviceId;
	const groupName = () => context.devices.get(id())?.group ?? "";
	const isProd = () => context.devices.get(id())?.isProd ?? false;
	const device = () => context.devices.get(id());
	const shouldUpdateLocState = () => context.shouldDeviceUpdateLocation(id());

	// Location state management
	const [locationRes, { refetch: refetchLocation }] =
		context.getLocationByDevice(id());
	const location = createMemo(() => locationRes());
	const [newName, setNewName] = createSignal("");
	const [photoFileToUpload, setPhotoFileToUpload] = createSignal<{
		url: string;
		path?: string;
	} | null>();

	// Photo management
	const [currentPhoto, { refetch: refetchPhoto }] = createResource(
		() => storage.deviceImages(),
		async (images) => {
			const device = context.devices.get(id());
			const photo = device ? await storage.getDevicePhoto(device) : null;
			console.log("Current Photo: ", photo);
			return photo;
		},
	);

	// Location coordinates handling
	const [locCoords, { refetch: refetchCoords }] = createResource(
		() => [id(), shouldUpdateLocState()] as const,
		async ([id]) => {
			const res = await context.getLocationCoords(id);
			return res.success ? res.data : null;
		},
	);

	const [isSyncing, setIsSyncing] = createSignal(false);
	// Save location data and handle photo upload
	const saveLocationSettings = async () => {
		try {
			setIsSyncing(true);
			const deviceLocation = await context.getLocationCoords(id());
			const loc = location();
			const photo = photoFileToUpload();

			// Validate device location
			if (!deviceLocation.success) {
				log.logWarning({
					message: "No device location found.",
				});
				return;
			}

			let savedLocation: Location | undefined;
			const locationCoords = deviceLocation.data;
			locationCoords.latitude = Number.parseFloat(
				locationCoords.latitude.toFixed(6),
			);
			locationCoords.longitude = Number.parseFloat(
				locationCoords.longitude.toFixed(6),
			);

			// Create/update location with proper error handling
			if (!loc) {
				savedLocation = await storage.createLocation(
					{
						name: newName(),
						coords: {
							lat: locationCoords.latitude,
							lng: locationCoords.longitude,
						},
						groupName: groupName(),
						isProd: isProd(),
					},
					context.apState() === "connected",
				);
			} else if (newName()) {
				await storage.updateLocationName(
					loc,
					newName(),
					context.apState() === "connected",
				);
				savedLocation = loc;
			}

			// Handle photo upload with location validation
			if (photo?.path) {
				await storage.uploadDevicePhoto(
					id(),
					isProd(),
					photo.path,
					"pov",
					context.apState() === "connected",
					savedLocation?.coords || {
						// Use saved location or device location
						lat: locationCoords.latitude,
						lng: locationCoords.longitude,
					},
				);
			}

			// Update state only after successful operations
			setNewName("");
			setPhotoFileToUpload(null);
			setShowLocationSettings(false);
			refetchLocation();
			refetchPhoto();
		} catch (error) {
			log.logError({
				message: "Error saving location settings",
				error,
			});
			// Preserve unsaved changes
			if (
				error instanceof Error &&
				error.message.includes("location coordinates")
			) {
				setShowLocationSettings(true);
			}
		} finally {
			setIsSyncing(false);
		}
	};

	async function centerCropImage(
		webPath: string,
		outWidth: number,
		outHeight: number,
	): Promise<{ url: string; filePath: string }> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = "anonymous";
			img.onload = async () => {
				try {
					// Create an offscreen canvas
					const canvas = document.createElement("canvas");
					canvas.width = outWidth;
					canvas.height = outHeight;
					const ctx = canvas.getContext("2d");
					if (!ctx) {
						reject("Could not get 2D context from canvas.");
						return;
					}

					// Original image width/height
					const imgWidth = img.width;
					const imgHeight = img.height;
					// Desired aspect ratio we want to crop to
					const desiredAspect = outWidth / outHeight;
					// Original aspect ratio
					const imgAspect = imgWidth / imgHeight;

					let renderWidth: number;
					let renderHeight: number;
					let offsetX: number;
					let offsetY: number;

					if (imgAspect > desiredAspect) {
						// Image is relatively wider than our desired aspect → match height
						renderHeight = outHeight;
						renderWidth = imgWidth * (renderHeight / imgHeight);
						offsetX = -(renderWidth - outWidth) / 2;
						offsetY = 0;
					} else {
						// Image is relatively taller or same ratio → match width
						renderWidth = outWidth;
						renderHeight = imgHeight * (renderWidth / imgWidth);
						offsetX = 0;
						offsetY = -(renderHeight - outHeight) / 2;
					}

					// Draw to canvas
					ctx.drawImage(img, offsetX, offsetY, renderWidth, renderHeight);

					// Convert to blob
					canvas.toBlob(
						async (blob) => {
							if (!blob) {
								reject("Failed converting canvas to Blob.");
								return;
							}

							// Convert Blob → base64, so we can save via Capacitor Filesystem
							const base64Data = await blobToBase64(blob);
							const fileName = `cropped_${Date.now()}.jpg`;

							// Write the file to the device (using a temporary location)
							await Filesystem.writeFile({
								path: fileName,
								data: base64Data,
								directory: Directory.Cache, // or Directory.Data if you prefer
							});

							// Grab the URI so we can later upload
							const fileUri = await Filesystem.getUri({
								path: fileName,
								directory: Directory.Cache,
							});

							// Create an object URL for quick previews in the app (optional)
							const objectUrl = URL.createObjectURL(blob);

							resolve({
								url: objectUrl, // for immediate preview (e.g. <img src={url} />)
								filePath: fileUri.uri, // the actual local URI of the cropped file
							});
						},
						"image/jpeg",
						0.9,
					);
				} catch (err) {
					reject(err);
				}
			};
			img.onerror = reject;
			img.src = webPath; // Kick off loading
		});
	}

	// Utility to convert Blob → base64 string
	function blobToBase64(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => {
				const dataUrl = reader.result as string;
				// DataURL format: "data:image/jpeg;base64,...."
				// We just want the base64 portion after the comma
				const base64String = dataUrl.split(",")[1];
				resolve(base64String);
			};
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	}

	// Add photo handler with offline support
	const addPhotoToDevice = async () => {
		try {
			const image = await Camera.getPhoto({
				quality: 100,
				allowEditing: false,
				resultType: CameraResultType.Uri,
			});

			if (image.webPath) {
				const { url, filePath } = await centerCropImage(
					image.webPath,
					640,
					480,
				);

				setPhotoFileToUpload({
					url,
					path: filePath,
				});
			}
			await saveLocationSettings();
		} catch (error) {
			log.logError({
				message: "Failed to capture photo",
				error,
			});
		}
	};

	const updateLocation = createMemo(shouldUpdateLocState, "current", {
		equals: (prev, curr) => {
			if (curr === "loading" && prev === "needsUpdate") return true;
			if (curr === prev) return true;
			return false;
		},
	});

	// Delete photo handler
	const removePhotoReference = async () => {
		const img = photoUrl();
		if (!img) return;

		const prompt = await Prompt.confirm({
			title: "Confirm Deletion",
			message: "Are you sure you want to delete this photo?",
		});

		if (prompt.value) {
			if (currentPhoto()) {
				await storage.deleteDevicesImages(
					id(),
					isProd(),
					context.apState() === "connected",
				);
				refetchPhoto();
			}
			setPhotoFileToUpload(null);
		}
	};
	const [settingLocation, setSettingLocation] = createSignal(false);

	// UI rendering helpers
	const locationName = () => {
		if (newName()) return newName();
		return location()?.updateName || location()?.name || "Unnamed Location";
	};

	const hasPendingChanges = () => {
		const hasChanges = !!newName() || !!photoFileToUpload();
		return hasChanges;
	};

	const hasChangesToUpload = () => {
		const loc = location();
		const needsTo =
			loc?.updateName ||
			loc?.needsCreation ||
			currentPhoto()?.serverStatus === "pending-upload";
		if (needsTo) {
			console.log("Needs to upload: ", loc, currentPhoto());
		}
		return needsTo;
	};

	const photoUrl = () =>
		photoFileToUpload()?.url ??
		(currentPhoto()?.serverStatus !== "pending-deletion"
			? currentPhoto()?.url
			: undefined);

	onMount(async () => {
		await context.refetchDeviceLocToUpdate();
	});

	return (
		<section class="mx-auto w-full max-w-md p-2 sm:p-4">
			<Show
				when={context.locationDisabled() || updateLocation() === "unavailable"}
			>
				<div class="flex w-full flex-col items-center space-y-2 sm:space-y-4">
					<p class="px-2 text-center text-xs text-red-500 sm:text-sm">
						Location services are disabled, please enable to save location
						settings.
					</p>
					<button
						class="
              flex items-center justify-center 
              space-x-2 
              rounded-md bg-blue-500 px-3 py-2 
              text-xs text-white disabled:cursor-not-allowed
              disabled:opacity-50 sm:text-sm
            "
						onClick={async () => {
							await NativeSettings.open({
								optionIOS: IOSSettings.LocationServices,
								optionAndroid: AndroidSettings.Location,
							});
							await context.refetchLocationPermission();
							context.shouldDeviceUpdateLocation(id());
						}}
					>
						Open Location Settings
					</button>
				</div>

				<Show when={context.locationDisabled()}>
					<GoToPermissions />
				</Show>
			</Show>

			<Show
				when={location() || !locationRes.loading}
				fallback={
					<div class="flex h-full w-full flex-col items-center justify-center py-8">
						<FaSolidSpinner size={28} class="animate-spin" />
						<p class="mt-2 text-sm">Loading Location...</p>
					</div>
				}
			>
				<Show when={hasChangesToUpload()}>
					<div class="mb-4 flex items-center space-x-2 rounded-lg border-2 border-orange-400 p-2">
						<FiCloudOff size={18} class="text-orange-400" />
						<p class="text-xs text-orange-400 sm:text-sm">
							You have changes waiting to be uploaded. They will upload
							automatically next time you're online, or you can upload them
							manually from the Storage tab.
						</p>
					</div>
				</Show>

				<Switch>
					<Match when={updateLocation() === "needsUpdate"}>
						<div class="flex w-full flex-col items-center">
							<button
								class="
                  my-2 flex items-center space-x-2 self-center 
                  rounded-md bg-blue-500 
                  px-3 py-2 
                  text-xs 
                  text-white disabled:cursor-not-allowed
                  disabled:opacity-50 sm:text-sm
                "
								onClick={async () => {
									try {
										setSettingLocation(true);
										await context.setDeviceToCurrLocation(id());
										await context.refetchDeviceLocToUpdate();
										await refetchLocation();
									} catch (e) {
										console.error("Failed to update location", e);
									} finally {
										setSettingLocation(false);
									}
								}}
								disabled={settingLocation()}
							>
								<Show
									when={!settingLocation()}
									fallback={
										<span class="text-xs sm:text-sm">
											Updating to Current Location...
										</span>
									}
								>
									<span class="text-xs sm:text-sm">Update Device Location</span>
								</Show>
								<FiMapPin size={18} />
							</button>
						</div>
					</Match>
					<Match when={updateLocation() === "current"}>
						<Show when={hasPendingChanges()}>
							<div class="mb-4 flex items-center space-x-2 rounded-lg border-2 border-blue-400 p-2">
								<FiCloud size={18} class="text-blue-400" />
								<p class="text-xs text-blue-400 sm:text-sm">
									{isSyncing() ? "Saving changes..." : "Save to apply changes."}
								</p>
							</div>
						</Show>

						<div class="space-y-4">
							<Show when={locCoords()}>
								<FieldWrapper type="custom" title="Coordinates">
									<div class="ml-2 flex items-center gap-2 text-xs sm:text-sm">
										<span class="font-medium">Lat:</span>
										<span>{locCoords()?.latitude.toFixed(3)}</span>
										<span class="font-medium">Lng:</span>
										<span>{locCoords()?.longitude.toFixed(3)}</span>
									</div>
								</FieldWrapper>
							</Show>

							<FieldWrapper type="custom" title="Name">
								<input
									type="text"
									class="
                    w-full rounded-md bg-slate-50 
                    px-2 py-1 
                    text-xs sm:text-sm
                  "
									placeholder={locationName()}
									value={newName()}
									onInput={(e) => setNewName(e.currentTarget.value)}
								/>
							</FieldWrapper>

							<div class="relative rounded-md bg-slate-100">
								<Switch>
									<Match when={photoUrl()}>
										<div
											style={{ "aspect-ratio": "4/3" }}
											class=" group relative w-full"
										>
											<img src={photoUrl()} class="h-full w-full rounded-md" />
											<div
												class="
                          z-100 absolute inset-0 
                          flex items-start justify-between 
                          p-2
                          opacity-80 
                          transition-opacity group-hover:opacity-100
                        "
											>
												<button
													onClick={addPhotoToDevice}
													class="rounded-lg bg-white/80 p-2 backdrop-blur-sm"
												>
													<TbCameraPlus size={24} />
												</button>
												<button
													onClick={removePhotoReference}
													class="rounded-lg bg-white/80 p-2 backdrop-blur-sm"
												>
													<FaRegularTrashCan size={20} />
												</button>
											</div>
										</div>
									</Match>
									<Match when={!photoFileToUpload() && !currentPhoto()}>
										<button
											onClick={addPhotoToDevice}
											class="
                        aspect-4/3 flex h-48 
                        w-full flex-col items-center justify-center gap-2 
                        text-blue-500 
                      "
										>
											<TbCameraPlus size={36} />
											<p class="text-xs text-gray-600 sm:text-sm">
												Add Camera Perspective Photo
											</p>
										</button>
									</Match>
								</Switch>
							</div>
						</div>
					</Match>
				</Switch>
			</Show>
		</section>
	);
}

export function WifiSettingsTab(props: SettingProps) {
	const context = useDevice();
	const log = useLogsContext();
	const id = () => props.deviceId;
	const device = () => context.devices.get(id());
	const [initialLoad, setInitialLoad] = createSignal(false);
	const [wifiNetworks, { refetch: refetchWifiNetowrks }] = createResource(
		() => [device(), context.apState()] as const,
		async ([currDevice]) => {
			try {
				console.log("Fetching Wifi Networks for ", currDevice);
				if (!currDevice?.isConnected) return null;
				const wifiNetworks = await context.getWifiNetworks(currDevice.id);
				return wifiNetworks;
			} catch (e) {
				console.error("Failed wifi networks", e);
			} finally {
				setInitialLoad(true);
			}
		},
	);
	const [currentWifi, { refetch }] = createResource(
		() => [device()],
		async () => context.getCurrentWifiNetwork(device()?.id ?? ""),
	);

	const [turnedOnModem] = createResource(async () => {
		const res = await context.turnOnModem(id());
		return res;
	});

	const [savedWifi, { refetch: refetchSavedWifi }] = createResource(
		async () => {
			const saved = await context.getSavedWifiNetworks(device()?.id ?? "");
			console.log(saved);
			return saved;
		},
	);
	const [password, setPassword] = createSignal("");
	const [apn, setAPN] = createSignal("");

	const getWifiIcon = (signal: number) => (
		<Switch>
			<Match when={signal <= 0}>
				<BsWifiOff size={28} />
			</Match>
			<Match when={signal < 34}>
				<BsWifi1 size={28} />
			</Match>
			<Match when={signal < 67}>
				<BsWifi2 size={28} />
			</Match>
			<Match when={signal >= 67}>
				<BsWifi size={28} />
			</Match>
		</Switch>
	);

	const sortWifi = (a: WifiNetwork, b: WifiNetwork) => {
		if (currentWifi()?.SSID === a.SSID) return -1;
		if (a.quality > b.quality) return -1;
		if (a.quality < b.quality) return 1;
		return 0;
	};

	const [openedNetwork, setOpenedNetwork] = createSignal<{
		SSID: string;
		quality: number;
		isSecured: boolean;
	} | null>(null);
	const [errorConnecting, setErrorConnecting] = createSignal<string | null>(
		null,
	);

	const [openedModem, setOpenedModem] = createSignal<boolean>();

	const [connecting, setConnecting] = createSignal<null | string>(null);
	createEffect(
		on(connecting, (ssid) => {
			const currDevice = device();
			if (currDevice) {
				if (ssid) {
					context.devicesConnectingToWifi.set(currDevice.id, ssid !== null);
				} else {
					context.devicesConnectingToWifi.delete(currDevice.id);
				}
			}
		}),
	);
	const connectToWifi = async () => {
		setErrorConnecting(null);
		const wifi = openedNetwork();
		if (!wifi) return;
		setConnecting(wifi.SSID);
		const res = await context.connectToWifi(id(), wifi.SSID, password());
		setConnecting(null);
		if (res) {
			setPassword("");
			setOpenedNetwork(null);
		} else {
			log.logEvent("Failed to connect to wifi");
			setErrorConnecting("Could not connect to wifi. Please try again.");
			setTimeout(() => {
				context.devicesConnectingToWifi.delete(device()?.id);
			}, 5000);
		}
		context.searchDevice();
		refetch();
	};
	createEffect(() => {
		on(context.apState, () => {
			if (!connecting()) {
				refetch();
			}
		});
	});

	// This state is used when a person disconnects from wifi
	const [disconnected, setDisconnected] = createSignal(false);

	createEffect(() => {
		const state = context.apState();
		if (state === "connected") {
			setDisconnected(false);
		}
	});

	const [params, setSearchParams] = useSearchParams();

	createEffect(() => {
		if (!disconnected() && !connecting() && !(device()?.isConnected ?? false)) {
			// remove
			setSearchParams({
				deviceSettings: null,
			});
		}
	});
	const disconnectFromWifi = async () => {
		setErrorConnecting(null);
		const res = await context.disconnectFromWifi(id());
		refetch();
		if (res) {
			setDisconnected(true);
		} else {
			setErrorConnecting("Could not disconnect from wifi.\n Please try again.");
		}
		context.searchDevice();
	};

	const forgetWifi = async (ssid: string) => {
		setErrorConnecting(null);
		const res = await context.forgetWifi(id(), ssid);
		if (res) {
			if (currentWifi()?.SSID === ssid) {
				refetch();
				setDisconnected(true);
			}
		} else {
			setErrorConnecting("Could not forget wifi. Please try again.");
		}
	};

	let inputRef: HTMLInputElement | undefined;
	const [showPassword, setShowPassword] = createSignal(false);
	createEffect(() => {
		on(
			() => showPassword(),
			() => {
				inputRef?.focus();
			},
		);
	});

	createEffect(() => {
		on(wifiNetworks, () => {
			if (!initialLoad()) return;
			if (wifiNetworks() === null || wifiNetworks.error) {
				refetchWifiNetowrks();
			}
		});
	});

	// Interval check for current wifi
	onMount(() => {
		const interval = setInterval(() => {
			if (!initialLoad()) return;
			if (!wifiNetworks.loading) {
				refetchWifiNetowrks();
			}
			if (!currentWifi.loading) {
				refetchSavedWifi();
			}
			if (modem() === null) {
				refetchModem();
			}
			if (!currentWifi.loading) {
				refetch();
			}
		}, 10000);
		onCleanup(() => clearInterval(interval));
	});

	const [wifiConnectedToInternet] = createResource(
		() => [currentWifi()],
		async ([wifi]) => {
			if (!wifi) return "no-wifi";
			setErrorConnecting(null);
			const res = await context.checkDeviceWifiInternetConnection(id());
			return res ? "connected" : "disconnected";
		},
	);

	const [modem, { refetch: refetchModem }] = createResource(async () => {
		try {
			const res = await context.getModem(id());
			console.log("MODEM", res);
			return res;
		} catch (error) {
			console.log(error);
		}
	});

	const [modemSignal] = createResource(async () => {
		try {
			const res = await context.getModemSignalStrength(id());
			console.log("modem signal", res);
			if (res === null) return null;
			if (typeof res === "number") return res / 5;
			return Number.parseInt(res.signal?.strength ?? "0") / 30;
		} catch (error) {
			console.log(error);
		}
	});

	const modemSignalStrength = () => {
		const currModem = modem();
		const currSignal = modemSignal();
		if (currModem === null && currSignal === null) return null;

		let signalStrength = null;

		// Try to get the signal strength from currModem
		if (currModem?.signal?.strength) {
			const signal = Number.parseInt(currModem.signal.strength);
			if (signal !== 99) {
				signalStrength = signal;
			}
		}

		// If currSignal is available, use it
		if (currSignal !== null && currSignal !== undefined) {
			signalStrength = currSignal;
		}

		// Handle unknown signal strength
		if (signalStrength === null || signalStrength === 99) {
			return null; // Signal strength is unknown
		}

		// Normalize the signal strength (ASU value from 0 to 31)
		const normalizedSignal = signalStrength / 31;

		// Ensure the normalized value is between 0 and 1
		return Math.min(Math.max(normalizedSignal, 0), 1);
	};

	const noSim = () => {
		const currModem = modem();
		return (
			currModem?.failedToFindSimCard ??
			currModem?.simCard?.simCardStatus?.includes("not inserted") ??
			false
		);
	};

	const [modemConnectedToInternet] = createResource(
		() => [modemSignalStrength()],
		async ([currModem]) => {
			if (!currModem) return "no-modem";
			const res = await context.checkDeviceModemInternetConnection(id());
			return res ? "connected" : "disconnected";
		},
	);

	const [hasNetworkEndpoints, { refetch: refetchHasNetworkEndpoints }] =
		createResource<boolean>(async () => {
			const hasEndpoint = await context.hasNetworkEndpoints(id());
			return hasEndpoint;
		});
	createEffect(() => {
		if (device()?.isConnected) {
			refetchHasNetworkEndpoints();
		}
		console.log("HAS END BOOL", hasNetworkEndpoints());
	});

	const LinkToNetwork = () => (
		<div class="flex w-full items-center justify-center py-2 text-lg text-blue-500">
			<A href={`/devices/${id()}/wifi-networks`}>Open Network Settings</A>
		</div>
	);

	const isSaved = (ssid: string) => {
		const saved = savedWifi();
		return saved?.includes(ssid);
	};
	const [showSaveNetwork, setShowSaveNetwork] = createSignal(false);
	const [ssid, setSsid] = createSignal("");
	type SaveState = "saving" | "saved" | "error" | null;
	const [saving, setSaving] = createSignal<SaveState>(null);
	const saveWifi = async () => {
		try {
			setSaving("saving");
			const res = await context.saveWifiNetwork(id(), ssid(), password());
			if (res) {
				setSaving("saved");
				refetchSavedWifi();
			} else {
				setSaving("error");
			}
			setTimeout(() => {
				setSaving(null);
			}, 3000);
		} catch (error) {
			console.log(error);
		}
	};
	const saveAPN = async () => {
		try {
			setSavingModem("saving");
			const res = await context.saveAPN(id(), apn());
			if (res) {
				setSaving("saved");
				setTimeout(() => {
					setOpenedModem(false);
				}, 2000);
			} else {
				setSaving("error");
			}
			refetchModem();
		} catch (error) {
			console.log("");
		}
	};

	const [savingModem, setSavingModem] = createSignal<SaveState>(null);

	createEffect(
		on(
			() => [modem, currentWifi] as const,
			([modem, wifi]) => {
				if (!modem.loading && !wifi.loading) {
					log.logEvent("device_connection", {
						wifi: wifi()?.SSID ? "connected" : "disconnected",
						modem: noSim() ? "no-sim" : modemConnectedToInternet(),
					});
				}
			},
		),
	);

	createEffect(() => {
		console.log(
			"Loading Wifi",
			wifiNetworks.loading,
			wifiNetworks(),
			initialLoad(),
		);
	});

	const disableConnect = (ssid: string) =>
		(showPassword() && password().length < 8) || connecting() === ssid;
	const hasApn = () => modem()?.modem?.apn !== undefined;
	const [isForgetting, setIsForgetting] = createSignal<boolean>(false);
	return (
		<div class="flex w-full flex-col space-y-2 px-2 py-2">
			<Show
				when={hasNetworkEndpoints() === undefined}
				fallback={
					<Show when={hasNetworkEndpoints()} fallback={LinkToNetwork()}>
						<button
							class="relative w-full space-y-2 pt-2"
							onClick={() => {
								if (!hasApn()) return;
								setOpenedModem(true);
							}}
						>
							<Show
								when={
									!noSim() &&
									modemConnectedToInternet() === "disconnected" &&
									hasApn()
								}
							>
								<div class="absolute left-[40%] top-[-0.1em] rounded-sm bg-yellow-400">
									<p class="px-2 py-1 text-sm">Set Modem APN</p>
								</div>
							</Show>
							<FieldWrapper
								type="custom"
								title={
									<div class="flex items-center justify-center gap-x-2">
										<div
											classList={{
												"bg-yellow-300": modemConnectedToInternet.loading,
												"bg-gray-400":
													modemConnectedToInternet() === "no-modem",
												"bg-green-500":
													modemConnectedToInternet() === "connected",
												"bg-red-500":
													modemConnectedToInternet() === "disconnected",
											}}
											class="h-2 w-2 rounded-full transition-colors"
										/>
										<p>Modem</p>
									</div>
								}
							>
								<div class="space-between flex h-full w-full items-center justify-between p-2 text-xs">
									<Switch>
										<Match when={modem.loading}>
											<FaSolidSpinner class="animate-spin" />
										</Match>
										<Match when={noSim()}>
											<p>No Sim Card</p>
										</Match>
										<Match
											when={modem.loading || modemConnectedToInternet.loading}
										>
											<p>Checking Connection</p>
										</Match>
										<Match
											when={
												modem()?.failedToFindModem ||
												modemConnectedToInternet() === "no-modem"
											}
										>
											<p>No Modem Connection</p>
										</Match>
										<Match when={modemConnectedToInternet() === "connected"}>
											<p>Internet Connection</p>
										</Match>
										<Match when={modemConnectedToInternet() === "disconnected"}>
											<p>No Mobile Data</p>
										</Match>
									</Switch>
									<div class="flex gap-x-2">
										<Show when={modemSignalStrength()}>
											{(modem) => (
												<Switch>
													<Match when={modem() <= 0.2}>
														<BiRegularSignal1 size={28} />
													</Match>
													<Match when={modem() <= 0.4}>
														<BiRegularSignal2 size={28} />
													</Match>
													<Match when={modem() <= 0.6}>
														<BiRegularSignal3 size={28} />
													</Match>
													<Match when={modem() <= 0.8}>
														<BiRegularSignal4 size={28} />
													</Match>
													<Match when={modem() <= 1}>
														<BiRegularSignal5 size={28} />
													</Match>
												</Switch>
											)}
										</Show>
										<Show when={modemSignalStrength() === null}>
											<BiRegularNoSignal size={28} />
										</Show>
									</div>
									<Show when={hasApn()}>
										<ImCog size={18} />
									</Show>
								</div>
							</FieldWrapper>
							<FieldWrapper
								type="custom"
								title={
									<div class="flex items-center justify-center gap-x-2 text-xs">
										<div
											classList={{
												"bg-yellow-300": wifiConnectedToInternet.loading,
												"bg-gray-400": wifiConnectedToInternet() === "no-wifi",
												"bg-green-500":
													wifiConnectedToInternet() === "connected",
												"bg-red-500":
													wifiConnectedToInternet() === "disconnected",
											}}
											class="h-2 w-2 rounded-full transition-colors"
										/>
										<p>WiFi</p>
									</div>
								}
							>
								<div class="flex h-full w-full items-center justify-between p-2">
									<p>
										{currentWifi()?.SSID !== "" ? currentWifi()?.SSID : "-"}
									</p>
								</div>
							</FieldWrapper>
						</button>
						<section class="flex h-32 flex-col space-y-2 overflow-y-auto rounded-md bg-neutral-100 p-2">
							<Show when={wifiNetworks.loading && wifiNetworks() === undefined}>
								<div class="flex h-full w-full flex-col items-center justify-center">
									<FaSolidSpinner size={28} class="animate-spin" />
									<p>Loading Networks...</p>
								</div>
							</Show>
							<For each={wifiNetworks()?.sort(sortWifi)}>
								{(val) => (
									<button
										classList={{
											"bg-white": currentWifi()?.SSID === val.SSID,
											"bg-gray-50": currentWifi()?.SSID !== val.SSID,
										}}
										class="flex w-full items-center justify-between rounded-md px-4 py-4"
										onClick={() => setOpenedNetwork(val)}
									>
										<div class="flex space-x-2">
											{getWifiIcon(val.quality)}
											<div class="flex flex-col items-start justify-center">
												<p class="text-start text-slate-900">{val.SSID}</p>
												<div class=" flex gap-x-1 text-xs text-slate-600">
													<Show when={val.SSID === currentWifi()?.SSID}>
														<Switch>
															<Match
																when={wifiConnectedToInternet() === "connected"}
															>
																<p>Internet Connection</p>
															</Match>
															<Match
																when={
																	wifiConnectedToInternet() === "disconnected"
																}
															>
																<p>No Internet Connection</p>
															</Match>
														</Switch>
													</Show>
													<Show
														when={
															val.SSID === currentWifi()?.SSID &&
															isSaved(val.SSID)
														}
													>
														<p>|</p>
													</Show>
													<Show when={isSaved(val.SSID)}>
														<p>Saved</p>
													</Show>
												</div>
											</div>
										</div>
										<Show when={val.SSID !== currentWifi()?.SSID}>
											<Show when={val.isSecured} fallback={<FaSolidLockOpen />}>
												<div class="text-gray-800">
													<FaSolidLock />
												</div>
											</Show>
										</Show>
									</button>
								)}
							</For>
							<For
								each={savedWifi()?.filter(
									(val) =>
										val !== "" &&
										val !== currentWifi()?.SSID &&
										!wifiNetworks()?.some((wifi) => wifi.SSID === val) &&
										val.toLowerCase() !== "bushnet",
								)}
							>
								{(val) => (
									<button
										class="flex w-full items-center justify-between rounded-md bg-gray-50 px-4 py-4"
										onClick={() =>
											setOpenedNetwork({
												SSID: val,
												quality: 0,
												isSecured: false,
											})
										}
									>
										<div class="flex space-x-2 text-gray-600">
											<BiRegularSave size={28} />
											<div class="flex flex-col items-start justify-center">
												<p class="text-start text-slate-900">{val}</p>
											</div>
										</div>
									</button>
								)}
							</For>
						</section>
						<section>
							<button
								onClick={() => setShowSaveNetwork(true)}
								class="text-md flex w-full items-center justify-center space-x-2 pb-3 pt-3 text-blue-700"
							>
								<p>Add Network</p>
								<FaSolidPlus size={16} />
							</button>
						</section>
					</Show>
				}
			>
				<div>
					<div class="flex w-full items-center justify-center">
						<FaSolidSpinner size={28} class="animate-spin" />
					</div>
				</div>
			</Show>
			<Portal>
				<Show when={openedModem()}>
					<div class="fixed left-1/2 top-1/2 z-40 h-auto w-11/12 -translate-x-1/2 -translate-y-1/2 transform rounded-xl border bg-white px-3 py-4  shadow-lg">
						<div class="flex justify-between px-4 pb-2">
							<div class="flex items-center space-x-4">
								<h1 class="text-lg text-neutral-800">Modem Settings</h1>
							</div>
							<button
								onClick={() => {
									setOpenedModem(false);
								}}
								class="p-2 text-gray-500"
							>
								<ImCross size={12} />
							</button>
						</div>
						<h1 class="text-md pb-2 pl-2 text-gray-800">Access Point Name</h1>
						<div class="flex gap-x-2">
							<input
								class="w-full rounded-md border border-gray-300 p-2 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
								type="text"
								ref={inputRef}
								autocapitalize="none"
								autocorrect="off"
								placeholder={modem()?.modem?.apn ?? ""}
								value={apn()}
								onInput={(e) => setAPN((e.target as HTMLInputElement).value)}
							/>
							<button
								class="flex w-24 items-center justify-center space-x-2 rounded-md  bg-blue-500 py-3 text-white"
								onClick={(e) => {
									e.preventDefault();
									saveAPN();
								}}
							>
								<p>
									{saving() === "saving"
										? "Saving..."
										: saving() === "error"
											? "Failed Saved..."
											: saving() === "saved"
												? "Saved"
												: "Save"}
								</p>
							</button>
						</div>
					</div>
				</Show>
			</Portal>
			<Portal>
				<Show when={openedNetwork()}>
					{(wifi) => (
						<div class="fixed left-1/2 top-1/2 z-40 h-auto w-11/12 -translate-x-1/2 -translate-y-1/2 transform rounded-xl border bg-white px-3 py-4  shadow-lg">
							<div class="flex justify-between px-4 pb-2">
								<div class="flex items-center space-x-4">
									{getWifiIcon(wifi().quality)}
									<h1 class="text-lg text-neutral-800">{wifi().SSID}</h1>
								</div>
								<button
									onClick={() => {
										setPassword("");
										setErrorConnecting(null);
										setOpenedNetwork(null);
									}}
									class="text-gray-500"
								>
									<ImCross size={12} />
								</button>
							</div>
							<p class="whitespace-pre-line px-3 py-2 text-red-500">
								{errorConnecting()}
							</p>
							<Show
								when={!currentWifi() || wifi().SSID !== currentWifi()?.SSID}
								fallback={
									<Show
										when={disconnected()}
										fallback={
											<div class="flex space-x-2">
												<button
													class="flex w-full items-center justify-center rounded-md bg-blue-500 py-3 text-white"
													onClick={() => {
														disconnectFromWifi();
														context.searchDevice();
													}}
												>
													<p>Disconnect</p>
												</button>
												<Show
													when={
														wifi().SSID.toLowerCase() !== "bushnet" &&
														isSaved(wifi().SSID)
													}
												>
													<button
														class="flex w-full items-center justify-center rounded-md bg-blue-500 py-3 text-white"
														onClick={() => {
															forgetWifi(wifi().SSID);
															context.searchDevice();
														}}
													>
														<p>Forget</p>
													</button>
												</Show>
											</div>
										}
									>
										<div>
											<p class="whitespace-pre-line pb-2 text-green-500">
												Successfully disconnected from WiFi.
												<br /> Would you like to try to connect to it?
											</p>
											<button
												class="flex w-full items-center justify-center rounded-md bg-blue-500 py-3 text-white"
												onClick={async () => {
													context.connectToDeviceAP();
												}}
												disabled={[
													"loadingDisconect",
													"loadingConnect",
												].includes(context.apState())}
											>
												{["loadingDisconect", "loadingConnect"].includes(
													context.apState(),
												)
													? "Connecting..."
													: "Connect to Device"}
											</button>
										</div>
									</Show>
								}
							>
								<Show when={connecting() === wifi().SSID}>
									<p class="px-2 pb-2">
										To continue accessing this device, ensure you are connected
										to the same WiFi network.
									</p>
								</Show>
								<div class="flex w-full flex-col items-center space-y-2 px-2">
									<Show
										when={
											wifi().isSecured &&
											!isSaved(wifi().SSID) &&
											connecting() !== wifi().SSID
										}
									>
										<div class="flex w-full items-center space-x-2">
											<input
												class="w-full rounded-md border border-gray-300 p-2 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
												type={showPassword() ? "text" : "password"}
												ref={inputRef}
												placeholder="Password"
												required
												value={password()}
												onInput={(e) =>
													setPassword((e.target as HTMLInputElement).value)
												}
											/>
											<button
												type="button"
												class="px-2 text-neutral-500"
												onClick={() => setShowPassword(!showPassword())}
											>
												<Show
													when={!showPassword()}
													fallback={<FaRegularEye size={24} />}
												>
													<FaRegularEyeSlash size={24} />
												</Show>
											</button>
										</div>
									</Show>
									<div class="flex w-full items-center space-x-2">
										<button
											type="submit"
											classList={{
												"bg-gray-300 text-gray-700": disableConnect(
													wifi().SSID,
												),
												"bg-blue-500": !disableConnect(wifi().SSID),
											}}
											class="flex w-full items-center justify-center space-x-2 rounded-md bg-blue-500 py-3 text-white"
											disabled={disableConnect(wifi().SSID)}
											onClick={(e) => {
												e.preventDefault();
												connectToWifi();
											}}
										>
											<Show
												when={connecting() === wifi().SSID}
												fallback={<p>Connect</p>}
											>
												<p>Connecting...</p>
											</Show>
										</button>
										<Show
											when={
												wifi().SSID.toLowerCase() !== "bushnet" &&
												isSaved(wifi().SSID)
											}
										>
											<button
												class="flex w-full items-center justify-center rounded-md bg-blue-500 py-3 text-white"
												onClick={async () => {
													setIsForgetting(true);
													await forgetWifi(wifi().SSID);
													setIsForgetting(false);
													await refetchSavedWifi();
													context.searchDevice();
												}}
											>
												<Show when={isForgetting()} fallback={<p>Forget</p>}>
													<p>Forgetting...</p>
												</Show>
											</button>
										</Show>
									</div>
								</div>
							</Show>
						</div>
					)}
				</Show>
			</Portal>
			<Portal>
				<Show when={showSaveNetwork()}>
					<div class="fixed left-1/2 top-1/2 z-40 h-auto w-11/12 -translate-x-1/2 -translate-y-1/2 transform rounded-xl border bg-white px-3 py-4  shadow-lg">
						<div class="flex justify-between px-4 pb-2">
							<h1 class="text-lg text-neutral-800">Save Network</h1>
							<button
								onClick={() => {
									setShowSaveNetwork(false);
								}}
								class="text-gray-500"
							>
								<ImCross size={12} />
							</button>
						</div>
						<p class="whitespace-pre-line px-3 py-2 text-red-500">
							{errorConnecting()}
						</p>
						<form class="flex w-full flex-col items-center space-y-2 px-2">
							<input
								type="text"
								value={ssid()}
								class="w-full rounded-md border border-gray-300 p-2 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
								placeholder="SSID"
								min={1}
								disabled={["saved", "saving"].includes(saving() ?? "")}
								onInput={(e) => setSsid((e.target as HTMLInputElement).value)}
							/>
							<div class="flex w-full items-center space-x-2">
								<input
									class="w-full rounded-md border border-gray-300 p-2 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
									type={showPassword() ? "text" : "password"}
									placeholder="Password"
									required
									value={password()}
									min={8}
									max={64}
									onInput={(e) =>
										setPassword((e.target as HTMLInputElement).value)
									}
								/>
								<button
									type="button"
									class="px-2 text-neutral-500"
									onClick={() => setShowPassword(!showPassword())}
								>
									<Show
										when={!showPassword()}
										fallback={<FaRegularEye size={24} />}
									>
										<FaRegularEyeSlash size={24} />
									</Show>
								</button>
							</div>
							<button
								class="flex w-full items-center justify-center space-x-2 rounded-md bg-blue-500 py-3 text-white"
								onClick={(e) => {
									e.preventDefault();
									saveWifi();
								}}
							>
								<p>
									{saving() === "saving"
										? "Saving..."
										: saving() === "error"
											? "Failed Saved..."
											: saving() === "saved"
												? "Saved"
												: "Save"}
								</p>
							</button>
						</form>
					</div>
				</Show>
			</Portal>
		</div>
	);
}

export function GroupSelect(props: SettingProps) {
	const log = useLogsContext();
	const user = useUserContext();
	const context = useDevice();
	const id = () => props.deviceId;
	const device = () => context.devices.get(id());
	const groupName = () =>
		(device()?.group ?? "-") === "new" ? "-" : (device()?.group ?? "-");
	onMount(() => {
		try {
			const interval = setInterval(async () => {
				await user.refetchGroups();
			}, 5000);
			onCleanup(() => {
				clearInterval(interval);
			});
		} catch (e) {
			console.error(e);
		}
	});
	const [params, setSearchParams] = useSearchParams();
	const setGroup = async (v: string) => {
		if (!user.groups()?.some((g) => g.groupName === v)) {
			const res = await user.createGroup(v);
			if (!res.success) {
				throw new Error(res.messages.join("\n"));
			}
			log.logEvent("group_create", { name: v });
		}
		const token = (await user.getUser())?.token;
		if (token) {
			log.logEvent("group_change", { name: v });
			const [currId, success] = await context.changeGroup(id(), v, token);
			if (params.deviceSettings) {
				setSearchParams({ deviceSettings: currId, tab: params.tab });
			}
			if (params.setupDevice) {
				setSearchParams({ setupDevice: currId, step: params.step });
			}
		}
	};

	const [canChangeGroup] = createResource(async () => {
		const wifiRes = await context.checkDeviceWifiInternetConnection(id());
		const modemRes = await context.checkDeviceModemInternetConnection(id());
		return wifiRes || modemRes;
	});

	const message = () =>
		canChangeGroup() === false
			? "Device must have an internet connection to change group"
			: "";

	const onOpenGroups = async () => {
		try {
			const userIsProd = user.isProd();
			const deviceIsProd = device()?.isProd ?? true;
			const sameServer = deviceIsProd === userIsProd;
			const notifyUser = !user.isLoggedIn() || !sameServer;
			if (notifyUser) {
				// Prompt to login
				const message =
					user.isLoggedIn() && !sameServer
						? "You must be logged in the same server as device. Would you like to login?"
						: !user.isLoggedIn()
							? "You must be logged in to change group. Would you like to login?"
							: "";
				const res = await Prompt.confirm({
					title: "Login Required",
					message,
				});
				if (res.value) {
					await user.logout();
					return false;
				} else {
					return false;
				}
			}
			return true;
		} catch (e) {
			console.error(e);
			return true;
		}
	};

	return (
		<FieldWrapper
			type="dropdown"
			value={groupName()}
			title="Group"
			onChange={setGroup}
			shouldOpen={onOpenGroups}
			options={user.groups()?.map(({ groupName }) => groupName) ?? []}
			disabled={!canChangeGroup.loading && !canChangeGroup()}
			message={message()}
		/>
	);
}

export function GeneralSettingsTab(props: SettingProps) {
	const user = useUserContext();
	const context = useDevice();
	const device = () => context.devices.get(props.deviceId);
	const id = () => props.deviceId;
	const saltId = () => device()?.saltId ?? "";
	const name = () => device()?.name ?? "";

	// Use stable primitive values to prevent rendering loops
	const [deviceIdState] = createSignal(props.deviceId);

	// Avoid accessing reactive props directly in resource dependencies
	const [updateStatus, { refetch }] = createResource(
		deviceIdState,
		async (deviceId) => {
			if (!deviceId) return null;
			try {
				const res = await context.checkDeviceUpdate(deviceId);
				return res;
			} catch (error) {
				console.error("Error checking device update:", error);
				return null;
			}
		},
		{
			initialValue: null,
		},
	);

	// Implement safer interval checking with proper cleanup
	let updateCheckTimer: number | undefined;

	const [hasInternetConnection] = createResource<boolean>(async () => {
		try {
			const wifiRes = await context
				.checkDeviceWifiInternetConnection(deviceIdState())
				.catch(() => false);
			const modemRes = await context
				.checkDeviceModemInternetConnection(deviceIdState())
				.catch(() => false);
			return wifiRes || modemRes;
		} catch (error) {
			console.error("Error checking internet connection:", error);
			return false;
		}
	});
	const scheduleUpdateCheck = () => {
		// Clear any existing timer
		if (updateCheckTimer) {
			clearTimeout(updateCheckTimer);
			updateCheckTimer = undefined;
		}

		// Only schedule if we're not already updating
		if (!context.isDeviceUpdating(deviceIdState())) {
			updateCheckTimer = window.setTimeout(() => {
				const internetAvailable = hasInternetConnection();
				if (internetAvailable !== false) {
					refetch();
				}
				scheduleUpdateCheck(); // Reschedule for next check
			}, 30000);
		}
	};

	onMount(() => {
		// Initial check
		scheduleUpdateCheck();

		// Cleanup
		onCleanup(() => {
			if (updateCheckTimer) {
				clearTimeout(updateCheckTimer);
				updateCheckTimer = undefined;
			}
		});
	});

	// Precompute values to avoid recalculation in render function
	const updateError = createMemo(() => context.getUpdateError(deviceIdState()));

	const canUpdate = createMemo(() => {
		const internet = hasInternetConnection();
		const status = updateStatus();
		console.log("UPDATE STATUS", status, internet);
		if ((internet !== undefined && internet === false) || !status) return false;
		return true;
	}, false);

	const softwareUpdateMessage = createMemo(() => {
		if (context.isDeviceUpdating(deviceIdState())) return "Updating...";
		if (context.didDeviceUpdate(deviceIdState()) === false) {
			return "Failed to Update";
		}
		if (context.didDeviceUpdate(deviceIdState()) === true) {
			return "Update Complete";
		}
		if (canUpdate()) return "Software Update";
		return "No Update Available";
	});

	const [lowPowerMode, setLowPowerMode] = createSignal<boolean | null>(null);

	onMount(async () => {
		try {
			const res = await context.getDeviceConfig(deviceIdState());
			if (res) {
				setLowPowerMode(
					res.values.thermalRecorder?.UseLowPowerMode ??
						res.defaults["thermal-recorder"]?.UseLowPowerMode ??
						null,
				);
			}
		} catch (error) {
			console.error("Error loading device config:", error);
		}
	});

	onMount(async () => {
		user.refetchGroups();
	});

	// refetch the device update status when device finishes updating
	createEffect(
		on(
			() => context.isDeviceUpdating(deviceIdState()),
			(curr, prev) => {
				if (prev && !curr) {
					refetch();
				}
			},
		),
	);
	const showProgress = createMemo(() => {
		const internet = hasInternetConnection();
		const isUpdating = context.isDeviceUpdating(deviceIdState());
		const hasPercentage =
			context.getDeviceUpdating(deviceIdState())?.UpdateProgressPercentage !==
			undefined;
		return internet && isUpdating && hasPercentage;
	});

	const turnOnLowPowerMode = async (v: boolean) => {
		try {
			setLowPowerMode(v);
			const res = await context.setLowPowerMode(deviceIdState(), v);
			if (res === null) {
				console.error("Failed to set low power mode");
			}
		} catch (error) {
			console.error("Error setting power mode:", error);
		}
	};

	return (
		<div class="flex w-full flex-col space-y-2 px-2 py-4">
			<FieldWrapper type="text" value={name()} title="Name" />
			<GroupSelect deviceId={id()} />
			<FieldWrapper type="text" value={saltId()} title="ID" />

			<Show when={lowPowerMode() !== null}>
				<FieldWrapper type="custom" title={"Power Mode"}>
					<div class="flex w-full items-center gap-x-2 bg-gray-100 px-1">
						<button
							onClick={() => turnOnLowPowerMode(false)}
							classList={{
								"bg-white outline outline-2 outline-green-500":
									lowPowerMode() === false,
								"bg-gray-100": lowPowerMode() !== false,
							}}
							class="flex w-full appearance-none items-center justify-center rounded-lg p-1"
						>
							High
						</button>
						<button
							classList={{
								"bg-white outline outline-2 outline-green-500":
									lowPowerMode() === true,
								"bg-gray-100": lowPowerMode() !== true,
							}}
							onClick={() => turnOnLowPowerMode(true)}
							class="flex w-full appearance-none items-center justify-center rounded-lg bg-white p-1"
						>
							Low
						</button>
					</div>
				</FieldWrapper>
				<div class="flex items-center space-x-2 px-2 text-sm text-gray-500">
					<AiOutlineInfoCircle size={18} />
					<Switch>
						<Match when={lowPowerMode() === true}>
							<p>Low power mode only uploads once per day.</p>
						</Match>
						<Match when={lowPowerMode() === false}>
							<p>High power mode uploads after every recording.</p>
						</Match>
					</Switch>
				</div>
			</Show>

			<Show when={device()?.lastUpdated}>
				{(lastUpdated) => (
					<p class="flex gap-x-2 px-2">
						<span class="text-gray-500">Last Updated:</span>
						<span>{lastUpdated().toLocaleString()}</span>
					</p>
				)}
			</Show>

			<Show when={updateError()}>
				{(error) => <p class="text-red-500">{error()}</p>}
			</Show>

			<div>
				<Show when={showProgress()}>
					{(percentage) => (
						<div class="relative flex h-6 w-full items-center rounded-t-md bg-gray-400">
							<div
								class="transition-width m-1 h-4 rounded-full bg-blue-500 duration-500"
								style={{
									width: `${
										context.getDeviceUpdating(id())?.UpdateProgressPercentage
									}%`,
								}}
							/>
							<span class="absolute left-1/2 top-1 -translate-x-1/2 transform text-xs text-white">
								{context.getDeviceUpdating(id())?.UpdateProgressPercentage}%
							</span>
						</div>
					)}
				</Show>
				<button
					classList={{
						"bg-blue-500 py-2 px-4 text-white ": canUpdate(),
						"bg-gray-400 py-2 px-4 text-gray-500 ": !canUpdate(),
						"rounded-md": !showProgress(),
						"rounded-b-md": showProgress() !== false,
					}}
					disabled={!canUpdate?.() || canUpdate() === undefined}
					class="flex w-full items-center justify-center space-x-2 bg-blue-500 px-4 py-3 text-white "
					onClick={() => context.updateDevice(id())}
				>
					{softwareUpdateMessage()}
				</button>
			</div>
			<A
				class="flex w-full items-center justify-center py-2 text-center text-lg text-blue-600"
				href={`/devices/${device()?.id}`}
			>
				<span>Advanced</span>
				<RiArrowsArrowRightSLine size={26} />
			</A>
		</div>
	);
}

export function DeviceSettingsModal() {
	const context = useDevice();
	const user = useUserContext();
	const [params, setParams] = useSearchParams();
	const currTab = () => params.tab ?? "Camera";
	const device = () => context.devices.get(params.deviceSettings);
	const navItems = () => {
		const items = ["Camera", "General", "Network", "Location"] as const;
		console.log("Current test Device", device());
		if (device()?.hasAudioCapabilities) {
			return [...items, "Audio"] as const;
		} else {
			return items;
		}
	};

	// Other code remains the same...

	// Prevent rapid tab switching by debouncing the tab change
	const [isTabSwitching, setIsTabSwitching] = createSignal(false);

	const setCurrNav = (nav: ReturnType<typeof navItems>[number]) => {
		if (isTabSwitching()) return;

		setIsTabSwitching(true);
		console.log("Setting Nav Params", nav);
		setParams({ tab: nav, deviceSettings: params.deviceSettings });

		// Reset the switching state after a small delay
		setTimeout(() => setIsTabSwitching(false), 300);
	};

	const textSizeClass = createMemo(() => {
		const numItems = navItems().length;
		if (numItems <= 4) {
			return "text-base";
		} else if (numItems === 5) {
			return "text-sm";
		} else if (numItems >= 6) {
			return "text-xs";
		}
	});

	const isConnected = () =>
		context.devices.get(params.deviceSettings)?.isConnected;

	const deviceName = () => {
		const device = context.devices.get(params.deviceSettings);
		const deviceName = device?.name ?? device?.id;
		return deviceName;
	};

	const show = () => !params.step && params.deviceSettings;

	const clearParams = () => {
		console.log("Clearing Params");
		setParams({ deviceSettings: null, tab: null });
	};

	createEffect(() => {
		if (!context.devices.has(params.deviceSettings)) {
			console.log("Device not found, clearing params");
			clearParams();
		}
	});

	createEffect(() => {
		// path
		console.log(
			"Location Settings Tab",
			params.step,
			params.deviceSettings,
			show(),
		);
	});
	return (
		<Show when={show()}>
			{(id) => {
				return (
					<div class="fixed left-1/2 top-[70px] z-40 h-auto w-11/12 -translate-x-1/2 transform rounded-xl border bg-white shadow-lg">
						<header class="flex justify-between px-4">
							<div class="flex items-center py-4">
								<Show
									when={!isConnected()}
									fallback={<BsCameraVideoFill size={32} />}
								>
									<TbPlugConnectedX size={32} />
								</Show>
								<h1 class="pl-2 text-lg font-medium text-slate-600">
									{deviceName()}
								</h1>
							</div>
							<button onClick={() => clearParams()} class="text-gray-500">
								<ImCross size={12} />
							</button>
						</header>
						<nav class={`flex w-full justify-between ${textSizeClass()}`}>
							<For each={navItems()}>
								{(nav) => (
									<button
										classList={{
											"text-green-400": currTab() === nav,
											"bg-gray-100 text-slate-400": currTab() !== nav,
										}}
										class="w-full px-2 py-4"
										onClick={() => setCurrNav(nav)}
									>
										{nav}
									</button>
								)}
							</For>
						</nav>
						<Switch>
							<Match when={currTab() === "General"}>
								<GeneralSettingsTab deviceId={id()} />
							</Match>
							<Match when={currTab() === "Network"}>
								<WifiSettingsTab deviceId={id()} />
							</Match>
							<Match when={currTab() === "Location"}>
								<LocationSettingsTab deviceId={id()} />
							</Match>
							<Match when={currTab() === "Camera"}>
								<CameraSettingsTab deviceId={id()} />
							</Match>
							<Match
								when={currTab() === "Audio" && device()?.hasAudioCapabilities}
							>
								<AudioSettingsTab deviceId={id()} />
							</Match>
						</Switch>
					</div>
				);
			}}
		</Show>
	);
}
