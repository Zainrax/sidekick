import { DevicesNav, StorageNav, SettingsNav, ManualNav } from "./NavButtons";

function NavBar() {
  return (
    <nav class="pb-safe fixed bottom-0 z-30 flex w-screen flex-row justify-around border border-t-2 bg-white px-4">
      <DevicesNav />
      <StorageNav />
      <ManualNav />
      <SettingsNav />
    </nav>
  );
}

export default NavBar;
