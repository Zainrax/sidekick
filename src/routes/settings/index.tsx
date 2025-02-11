import { createEffect, createResource, createSignal, Show } from "solid-js";
import { useUserContext } from "~/contexts/User";
import { BsPersonFill } from "solid-icons/bs";
import { ImCog, ImMobile } from "solid-icons/im";
import ActionContainer from "~/components/ActionContainer";
import { A } from "@solidjs/router";
import { RiArrowsArrowRightSLine } from "solid-icons/ri";
import { Dialog } from "@capacitor/dialog";
import { BiRegularLogOut } from "solid-icons/bi";
import { CacophonyPlugin } from "~/contexts/CacophonyApi";

function Settings() {
  const userContext = useUserContext();

  const Action = () => (
    <div class="text-blue-500">
      <Show when={userContext.data()}>
        <A href="user">
          <RiArrowsArrowRightSLine size={32} />
        </A>
      </Show>
    </div>
  );

  const logoutAccount = async () => {
    const existingUser = userContext.data();
    if (existingUser) {
      const { value } = await Dialog.confirm({
        title: "Confirm",
        message: `Are you sure you want to ${
          userContext.data() ? "logout" : "return to login screen"
        }?`,
      });
      if (value) {
        userContext.logout();
      }
    } else {
      userContext.logout();
    }
  };

  // Fetch app version from plugin
  const [version] = createResource(async () => {
    const res = await CacophonyPlugin.getAppVersion();
    return res.success ? res.data : "1.0.0";
  });

  // Secret trigger for dev mode
  const [pressed, setPressed] = createSignal(0);
  createEffect(() => {
    if (pressed() > 5) {
      userContext.toggleDev();
      setPressed(0);
    }
  });

  // Track the user’s typed URL
  const [customServer, setCustomServer] = createSignal("");

  const saveCustomServer = () => {
    try {
      // We call the context function that sets custom server & updates the plugin
      userContext.setToCustomServer(customServer());
    } catch (error) {
      console.error("Failed to save custom server URL", error);
    }
  };

  return (
    <section class="pt-bar mt-2 h-full space-y-2 bg-gray-200 px-2">
      {/* Account Section */}
      <div class="space-y-2 rounded-xl bg-slate-50 p-2">
        <h1 class="ml-2 text-xl text-neutral-500">Account</h1>
        <ActionContainer icon={BsPersonFill} action={<Action />}>
          <div class="pt-2">
            <Show
              when={userContext?.data()?.email}
              fallback={<h1>Not Logged In...</h1>}
            >
              <h1>{userContext?.data()?.email}</h1>
            </Show>
          </div>
        </ActionContainer>
        <ActionContainer>
          <button
            class="flex w-full items-center justify-center space-x-2 text-2xl text-blue-500"
            onClick={logoutAccount}
          >
            {userContext.data() ? "Logout" : "Return to Login"}
            <BiRegularLogOut size={24} />
          </button>
        </ActionContainer>
      </div>

      {/* Application Section */}
      <div class="mt-2 space-y-2 rounded-xl bg-slate-50 p-2">
        <h1 class="ml-2 text-xl text-neutral-500">Application</h1>
        {/* App version with hidden dev-mode trigger */}
        <div onClick={() => setPressed(pressed() + 1)}>
          <ActionContainer icon={ImMobile} header="App Version">
            <Show when={!version.loading} fallback={<h1>...</h1>}>
              <h1>{version()}</h1>
            </Show>
          </ActionContainer>
        </div>

        {/* Show a banner if the user is pointing to the test server */}
        <Show when={!userContext.isProd()}>
          <ActionContainer icon={ImCog}>
            <h1>Test Server Activated</h1>
          </ActionContainer>
        </Show>

        {/* Developer Section */}
        <Show when={userContext.dev()}>
          <ActionContainer icon={ImCog}>
            <h1>Dev Mode Activated</h1>
          </ActionContainer>

          {/* Dev Server Management */}
          <ActionContainer icon={ImCog} header="Dev Server">
            <div class="space-y-2">
              <label for="customUrl" class="text-sm font-semibold">
                Custom Server URL
              </label>
              <input
                id="customUrl"
                placeholder={userContext.getServerUrl()}
                type="url"
                class="w-full rounded-md border border-gray-300 bg-white p-2"
                onInput={(e) => setCustomServer(e.currentTarget.value)}
              />
              <div class="flex flex-col space-y-2">
                <button
                  class="flex-1 rounded-md bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:bg-gray-300"
                  disabled={!customServer()}
                  onClick={saveCustomServer}
                >
                  Set Custom Server
                </button>
                <button
                  class="flex-1 rounded-md bg-red-500 px-4 py-2 text-white hover:bg-red-600"
                  onClick={() => userContext.clearCustomServer()}
                >
                  Clear
                </button>
              </div>
            </div>
          </ActionContainer>
        </Show>
      </div>
    </section>
  );
}

export default Settings;
