import { createComputed, createSignal, on, Show } from "solid-js";
import { Browser } from "@capacitor/browser";
import { z } from "zod";
import CacaophonyLogo from "./components/CacaophonyLogo";
import { LoginResult, useUserContext } from "./contexts/User";
import { ImCog } from "solid-icons/im";
import { FaRegularEye, FaRegularEyeSlash } from "solid-icons/fa";
import { useDevice } from "./contexts/Device";
import { untrack } from "solid-js/web";
type LoginInput = {
  type: string;
  placeholder?: string;
  autoComplete: string;
  name: string;
  label: string;
  invalid: boolean;
  onInput: (event: Event) => void;
};

const LoginInput = (props: LoginInput) => {
  let inputRef: HTMLInputElement | undefined;
  const [showPassword, setShowPassword] = createSignal(false);
  const [type, setType] = createSignal(props.type);

  const toggleShowPassword = () => {
    if (props.type === "password") {
      setShowPassword(!showPassword());
      if (showPassword()) {
        setType("text");
      } else {
        setType("password");
      }
      inputRef?.focus();
    }
  };

  return (
    <div class="relative flex flex-col text-gray-600">
      <label class="font-base" for={props.name}>
        {props.label}
      </label>
      <input
        ref={inputRef}
        autocomplete={props.autoComplete}
        class="rounded-md border-2 px-2 py-3 shadow-inner transition-colors"
        classList={{
          "border-slate-50": !props.invalid,
          "border-red-300": props.invalid,
        }}
        type={type()}
        placeholder={props.placeholder}
        name={props.name}
        onInput={(e) => props.onInput(e)}
        required
      />
      <Show when={props.type === "password"}>
        <button
          onClick={(e) => {
            e.preventDefault();
            toggleShowPassword();
          }}
          class="absolute inset-y-1/2 right-0 mr-4 flex h-fit items-center pt-1"
        >
          <Show when={!showPassword()} fallback={<FaRegularEye size={24} />}>
            <FaRegularEyeSlash size={24} />
          </Show>
        </button>
      </Show>
    </div>
  );
};

const emailSchema = z.string().email("Invalid Email");
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

function Login() {
  const user = useUserContext();
  const device = useDevice();
  let form: HTMLFormElement | undefined;
  const [emailError, setEmailError] = createSignal("");
  const [passwordError, setPasswordError] = createSignal("");

  const [error, setError] = createSignal("");
  const [loggingIn, setLoggingIn] = createSignal(false);
  const [needsAgreement, setNeedsAgreement] = createSignal(false);
  const [authToken, setAuthToken] = createSignal<string | null>(null);
  const [storedEmail, setStoredEmail] = createSignal<string>("");
  const [storedPassword, setStoredPassword] = createSignal<string>("");

  const openAgreement = () => {
    Browser.open({
      url: "https://www.2040.co.nz/pages/2040-end-user-agreement",
    });
  };
  const handleLoginResult = (result: LoginResult | undefined) => {
    setLoggingIn(false);

    if (!result) {
      setError("Login failed - please try again");
      return;
    }

    switch (result._tag) {
      case "Success":
        // Login successful, handled by the login function
        break;

      case "NeedsAgreement":
        setAuthToken(result.authToken);
        setNeedsAgreement(true);
        break;

      case "Failed":
        setError(result.message);
        break;
    }
  };

  const onSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    const formData = new FormData(form);
    setLoggingIn(true);
    setEmailError("");
    setPasswordError("");
    setError("");
    setNeedsAgreement(false);

    const email = emailSchema.safeParse(formData.get("email"));
    const password = passwordSchema.safeParse(formData.get("password"));

    if (email.success === false) {
      setEmailError(email.error.message);
      setLoggingIn(false);
      return;
    }
    if (password.success === false) {
      setPasswordError(password.error.message);
      setLoggingIn(false);
      return;
    }

    // Store the credentials
    setStoredEmail(email.data);
    setStoredPassword(password.data);

    if (device.apState() === "connected") {
      createComputed(
        on(device.apState, async (ap) => {
          if (ap === "disconnected" || ap === "default") {
            const result = await user?.login(email.data, password.data);
            handleLoginResult(result);
            untrack(device.apState);
          }
        })
      );
      await device.disconnectFromDeviceAP();
    } else {
      const result = await user?.login(email.data, password.data);
      handleLoginResult(result);
    }
  };
  const onInput = (event: Event) => {
    event.preventDefault();
    const target = event.target as HTMLInputElement;
    if (target.name === "email") {
      setEmailError("");
    }
    if (target.name === "password") {
      setPasswordError("");
    }
    setError("");
  };
  // Create a way to check if user is holding logo down for 5 taps
  // If so, toggle server
  const [pressed, setPressed] = createSignal(0);
  const logoDown = () => {
    setPressed(pressed() + 1);
    if (pressed() === 5) {
      user?.toggleServer();
      setPressed(0);
    }
  };

  const openRegisterPage = () => {
    Browser.open({ url: "https://browse.cacophony.org.nz/register" });
  };

  return (
    <form
      ref={form}
      class="mx-auto flex h-screen w-screen max-w-screen-sm flex-col justify-center gap-y-4 bg-white px-8 text-lg"
      onSubmit={onSubmit}
    >
      <Show when={!user?.isProd()}>
        <div class="pt-safe absolute top-0 mt-8 flex items-center pr-8 font-bold text-neutral-700">
          <ImCog size={32} />
          <h1 class="ml-2">Test Mode</h1>
        </div>
      </Show>
      <div
        class="mb-6 mt-20 max-w-[90%] justify-center"
        role="button"
        onTouchStart={logoDown}
      >
        <CacaophonyLogo />
      </div>
      <Show
        when={!needsAgreement()}
        fallback={
          <div class="flex flex-col gap-6 rounded-lg border border-gray-100 bg-white px-4 py-6 shadow-md">
            <div class="space-y-3">
              <h2 class="text-2xl font-bold text-gray-800">
                User Agreement Required
              </h2>
              <p class="leading-relaxed text-gray-600">
                Before continuing, please review and accept our user agreement.
                This agreement outlines the terms and conditions for using the
                Cacophony Project's services.
              </p>
            </div>

            <div class="flex flex-col gap-4">
              <button
                type="button"
                class="flex items-center justify-center gap-2 rounded-md bg-blue-50 px-4 py-3 text-blue-600 transition-colors hover:bg-blue-100 hover:text-blue-700"
                onClick={openAgreement}
              >
                <span class="text-lg">📄</span>
                <span class="font-medium">Read User Agreement</span>
              </button>

              <div class="mt-2 flex flex-col gap-3">
                <button
                  type="button"
                  class="w-full rounded-md bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700"
                  onClick={async () => {
                    const token = authToken();
                    if (!token) {
                      setError("Session expired. Please try logging in again.");
                      setNeedsAgreement(false);
                      return;
                    }

                    const result = await user?.updateUserAgreement(token);
                    if (result && result._tag === "Right") {
                      const email = storedEmail();
                      const password = storedPassword();
                      if (email && password) {
                        const loginResult = await user?.login(email, password);
                        handleLoginResult(loginResult);
                      } else {
                        setError("Missing credentials. Please try logging in again.");
                      }
                    } else {
                      setError("Failed to accept agreement. Please try again.");
                    }
                  }}
                >
                  I Accept the Agreement
                </button>

                <button
                  type="button"
                  class="w-full rounded-md border border-gray-300 px-6 py-3 font-medium text-gray-700 transition-all hover:border-gray-400 hover:bg-gray-50 hover:text-gray-800"
                  onClick={() => setNeedsAgreement(false)}
                >
                  Decline
                </button>
              </div>
            </div>

            <p class="mt-4 text-sm text-gray-500">
              By accepting, you agree to be bound by the terms and conditions
              outlined in the user agreement.
            </p>
          </div>
        }
      >
        <LoginInput
          autoComplete="email"
          type="email"
          placeholder="example@gmail.com"
          name="email"
          label="Email"
          invalid={Boolean(emailError())}
          onInput={onInput}
        />
        <LoginInput
          autoComplete="current-password"
          type="password"
          name="password"
          label="Password"
          invalid={Boolean(passwordError())}
          onInput={onInput}
        />
        <Show when={error} fallback={<div class="h-8" />}>
          <p class="h-8 text-red-500">{error()}</p>
        </Show>
        <button
          class="mb-8 rounded-md bg-blue-500 py-4 font-semibold text-white"
          type="submit"
        >
          {loggingIn() ? "Logging In..." : "Login"}
        </button>
        <p class="text-base text-gray-600 md:text-base">
          Don't have a Cacophony Account?
          <button class="ml-1 text-blue-500" onClick={openRegisterPage}>
            Register
          </button>
        </p>
      </Show>
      <button
        class="text-blue-500"
        onClick={(e) => {
          e.preventDefault();
          user?.skip();
        }}
      >
        Skip Login
      </button>
    </form>
  );
}

export default Login;
