import { createEffect, createSignal, onMount, onCleanup } from "solid-js";

declare global {
	interface Window {
		FlyweightChat: {
			config?: {
				display?: string;
				content?: {
					popup?: string;
				};
				appearance?: {
					popup?: {
						openAfter?: number;
					};
					button?: {
						display?: boolean;
					};
				};
			};
		};
	}
}

let flyweightChatScriptLoaded = false;

export const [isChatVisible, setIsChatVisible] = createSignal(false);
export const [isChatOnManualPage, setIsChatOnManualPage] = createSignal(false);

export default function FlyweightChatManager() {
	let iframeObserver: MutationObserver | null = null;

	onMount(() => {
		// Initialize Flyweight chat only once
		if (!flyweightChatScriptLoaded) {
			window.FlyweightChat = window.FlyweightChat || {};
			window.FlyweightChat.config = window.FlyweightChat.config || {};
			window.FlyweightChat.config.display = "POPUP";
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
				"https://assistant.flyweight.io/chat/index.js?apiKey=b289ef7c-3520-46bb-8312-4c5aaf67b1e0";
			script.setAttribute("data-url-match", "*");
			script.setAttribute("data-display", "BUTTON");
			document.body.appendChild(script);
			flyweightChatScriptLoaded = true;
		}

		// Add global styles
		const injectGlobalStyles = () => {
			if (!document.querySelector('#flyweight-override-styles')) {
				const style = document.createElement('style');
				style.id = 'flyweight-override-styles';
				style.textContent = `
					/* IMPORTANT: These CSS selectors depend on Flyweight's current implementation:
					 * - iframe element with data-testid="chat-overlay"
					 * - Inline styles containing "width: 50px" for button state
					 * - Inline styles containing "width: 100%" for chat state
					 * If Flyweight changes their HTML structure or attribute names,
					 * these selectors will need to be updated.
					 */
					
					/* Hide the iframe when it's in button state (50x50) */
					iframe[data-testid="chat-overlay"][style*="width: 50px"] {
						display: none !important;
					}
					
					/* When on manual page and chat is open, constrain the iframe */
					body.flyweight-manual-page iframe[data-testid="chat-overlay"][style*="width: 100%"] {
						top: calc(4.5rem + env(safe-area-inset-top, 0px) - 75px) !important;
						height: calc(100% - (4.5rem + env(safe-area-inset-top, 0px)) - (5rem + env(safe-area-inset-bottom, 0px)) + 75px) !important;
					}
					
					/* Hide chat completely when not on manual page */
					body:not(.flyweight-manual-page) iframe[data-testid="chat-overlay"] {
						display: none !important;
					}
				`;
				document.head.appendChild(style);
			}
		};

		// Setup iframe observer
		const setupIframeObserver = (iframe: HTMLIFrameElement) => {
			console.log("Setting up iframe observer");
			
			// IMPORTANT: This implementation relies on Flyweight's current iframe behavior:
			// - Button state: width: 50px, height: 50px
			// - Chat state: width: 100%, height: 100%
			// If Flyweight updates their implementation and changes these dimensions or
			// switches to a different approach (e.g., transform: scale, display: none, etc.),
			// this observer logic will need to be updated accordingly.
			// Monitor console logs to detect if the state detection stops working properly.
			
			// Create observer for style changes
			iframeObserver = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
						const style = iframe.getAttribute('style') || '';
						
						// Check if it's in button state (50x50) or chat state (100%)
						if (style.includes('width: 50px') && style.includes('height: 50px')) {
							console.log("Iframe is in button state - hiding");
							setIsChatVisible(false);
						} else if (style.includes('width: 100%') && style.includes('height: 100%')) {
							console.log("Iframe is in chat state - showing");
							setIsChatVisible(true);
						}
					}
				}
			});
			
			// Start observing
			iframeObserver.observe(iframe, {
				attributes: true,
				attributeFilter: ['style']
			});
			
			// Check initial state
			const currentStyle = iframe.getAttribute('style') || '';
			if (currentStyle.includes('width: 50px')) {
				setIsChatVisible(false);
			} else if (currentStyle.includes('width: 100%')) {
				setIsChatVisible(true);
			}
		};

		// Watch for iframe to appear
		const findAndObserveIframe = () => {
			const iframe = document.querySelector('iframe[data-testid="chat-overlay"]') as HTMLIFrameElement;
			if (iframe) {
				console.log("Found chat iframe");
				setupIframeObserver(iframe);
				return true;
			}
			return false;
		};

		// Initialize styles
		injectGlobalStyles();

		// Update body class based on page state
		createEffect(() => {
			if (isChatOnManualPage()) {
				document.body.classList.add('flyweight-manual-page');
			} else {
				document.body.classList.remove('flyweight-manual-page');
			}
		});

		// Look for iframe
		if (!findAndObserveIframe()) {
			// If not found, observe body for when it's added
			const bodyObserver = new MutationObserver(() => {
				if (findAndObserveIframe()) {
					bodyObserver.disconnect();
				}
			});
			
			bodyObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
			
			onCleanup(() => {
				bodyObserver.disconnect();
			});
		}

		// Listen for chat toggle events
		const handleChatToggle = (event: Event) => {
			const customEvent = event as CustomEvent;
			if (typeof customEvent.detail === "boolean") {
				// The iframe observer will handle the actual visibility state
				// This just triggers the Flyweight chat to open/close
			}
		};
		window.addEventListener("flyweightchatopen", handleChatToggle);

		onCleanup(() => {
			window.removeEventListener("flyweightchatopen", handleChatToggle);
			if (iframeObserver) {
				iframeObserver.disconnect();
			}
		});
	});

	return null;
}

// Helper function to open/close chat
export function toggleFlyweightChat(show: boolean) {
	const chatEvent = new CustomEvent("flyweightchatopen", { detail: show });
	window.dispatchEvent(chatEvent);
}