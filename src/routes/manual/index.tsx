import Manual from "~/components/Manual";
import { createSignal, onMount } from "solid-js";

declare global {
	interface Window {
		FlyweightChat: Record<string, any>;
	}
}
let flyweightChatScriptLoaded = false;

export default function HelpPage() {
	const [isChatUIVisible, setIsChatUIVisible] = createSignal(false); // Controls our wrapper's visibility

	// Function to dispatch the event to open/close the chat *service*
	const controlFlyweightChatService = (show: boolean) => {
		const chatEvent = new CustomEvent("flyweightchatopen", { detail: show });
		window.dispatchEvent(chatEvent);
	};
	onMount(() => {
		// --- Dynamic Script Loading (Once) ---
		if (!flyweightChatScriptLoaded) {
			window.FlyweightChat = window.FlyweightChat || {};
			window.FlyweightChat.config = window.FlyweightChat.config || {};
			window.FlyweightChat.config.display = "NONE"; // The service should not render its own button/popup
			window.FlyweightChat.config.content =
				window.FlyweightChat.config.content || {};
			window.FlyweightChat.config.content.popup = "";
			window.FlyweightChat.config.appearance =
				window.FlyweightChat.config.appearance || {};
			window.FlyweightChat.config.appearance.popup =
				window.FlyweightChat.config.appearance.popup || {};
			window.FlyweightChat.config.appearance.popup.openAfter = 999999999;

			const script = document.createElement("script");
			script.type = "text/javascript";
			script.src =
				"https://assistant.flyweight.io/chat/index.js?apiKey=b289ef7c-3520-46bb-8312-4c5aaf67b1e0"; // Replace with your API key
			script.setAttribute("data-url-match", "*");
			script.setAttribute("data-display", "BUTTON");
			script.defer = true;
			document.head.appendChild(script);
			flyweightChatScriptLoaded = true;
		}

		// --- Event Listener for external open/close requests ---
		const handleExternalChatToggle = (event: Event) => {
			const customEvent = event as CustomEvent;
			if (typeof customEvent.detail === "boolean") {
				setIsChatUIVisible(customEvent.detail); // Sync our wrapper's visibility
			}
		};
		window.addEventListener("flyweightchatopen", handleExternalChatToggle);

		// --- Logic to find, move, and style the iframe for cropping ---
		const setupCropping = () => {
			const cropWrapper = document.getElementById("flyweight-chat-container");
			const flyweightChatDiv = document.querySelector(
				"#flyweight-chat",
			) as HTMLElement; // Div created by the service

			if (!cropWrapper) {
				console.warn("Cropping setup: cropWrapper not found.");
				return;
			}
			if (!flyweightChatDiv) {
				console.warn("Cropping setup: flyweightChatDiv not found.");
				return;
			}

			// 0. Log the contents of flyweightChatDiv
			console.log("flyweightChatDiv contents:", flyweightChatDiv.innerHTML);

			// 1. Move the service's div into our cropping wrapper if it's not already there
			if (flyweightChatDiv.parentElement !== cropWrapper) {
				cropWrapper.appendChild(flyweightChatDiv);
			}

			// 2. Style the service's div to fill our wrapper and be a positioning context
			flyweightChatDiv.style.position = "relative"; // Or 'absolute' if cropWrapper is 'static'
			flyweightChatDiv.style.width = "100%";
			flyweightChatDiv.style.height = "100%";
			flyweightChatDiv.style.overflow = "visible"; // Ensure it doesn't clip its iframe prematurely

			// 3. Find and style the *actual* iframe (chat-overlay)
			const chatOverlayIframe = flyweightChatDiv.querySelector(
				'iframe[data-testid="chat-overlay"]',
			) as HTMLIFrameElement;

			if (chatOverlayIframe) {
				console.log("Found chat-overlay iframe. Applying crop styles.");
				requestAnimationFrame(() => {
					chatOverlayIframe.style.position = "absolute";
					chatOverlayIframe.style.width = "100%";
					chatOverlayIframe.style.height = "200vh";
					chatOverlayIframe.style.top = "-75px";
					chatOverlayIframe.style.left = "0px";
					chatOverlayIframe.style.border = "none";
					chatOverlayIframe.style.overflow = "visible";
				});
			} else {
				console.warn(
					"Cropping setup: chat-overlay iframe not found within #flyweight-chat.",
				);
			}
		};

		// Observe the body for when #flyweight-chat is added
		const bodyObserver = new MutationObserver((mutationsList, observer) => {
			const flyweightChatDiv = document.querySelector("#flyweight-chat");
			const chatOverlayIframe = flyweightChatDiv?.querySelector(
				'iframe[data-testid="chat-overlay"]',
			) as HTMLIFrameElement;
			console.log("Found #flyweight-chat. Setting up cropping.");
			if (chatOverlayIframe) {
				setupCropping();
				observer.disconnect();
			}
		});

		if (document.querySelector("#flyweight-chat")) {
			setupCropping();
		} else {
			bodyObserver.observe(document.body, { childList: true, subtree: false });
		}

		return () => {
			window.removeEventListener("flyweightchatopen", handleExternalChatToggle);
			bodyObserver.disconnect();
		};
	});
	return (
		<>
			<div class="pt-bar pb-bar h-full ">
				<div class="mx-2 mb-2 rounded-lg bg-white px-2 py-4">
					<Manual />
				</div>
			</div>
			<div
				id="flyweight-chat-container"
				style={{
					// Visibility is controlled by the signal
					display: isChatUIVisible() ? "block" : "none",
					// Dynamic top and height based on your requirements
					top: "calc(4.5rem + env(safe-area-inset-top, 0px))",
					height:
						"calc(100% - (4.5rem + env(safe-area-inset-top, 0px)) - (5rem + env(safe-area-inset-bottom, 0px)))",
					// These should match your CSS for #flyweight-chat-container
					position: "fixed",
					left: "0",
					width: "100%",
					"z-index": "2147483646", // Just below the button if they overlap, or as needed
					overflow: "hidden",
				}}
			>
				{/* The service's #flyweight-chat div will be moved here */}
			</div>
		</>
	);
}
