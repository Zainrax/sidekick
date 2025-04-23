declare module "capacitor-ios-autofill-save-password" {
  export function promptDialog(options: {
    username: string;
    password: string;
  }): Promise<void>;
}
