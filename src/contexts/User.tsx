import {
  createEffect,
  createResource,
  createSignal,
  on,
  onMount,
} from "solid-js";

import { createContextProvider } from "@solid-primitives/context";
import { Preferences } from "@capacitor/preferences";
import { Result } from ".";
import { z } from "zod";
import { CacophonyPlugin } from "./CacophonyApi";
import { useNavigate } from "@solidjs/router";
import { CapacitorHttp } from "@capacitor/core";
import { useLogsContext } from "./LogsContext";
import { Effect, Either } from "effect";

export type UserAuthResponse = z.infer<typeof UserAuthResponseSchema>;

const UserAuthResponseSchema = z.object({
  success: z.boolean(),
  messages: z.array(z.string()).optional(),
  token: z.string().optional(),
  refreshToken: z.string().optional(),
  expiry: z.string().optional(),
  userData: z
    .object({
      email: z.string(),
      globalPermission: z.string(),
      endUserAgreement: z.number().nullable(),
      emailConfirmed: z.boolean(),
      settings: z
        .object({
          displayMode: z.record(z.unknown()),
          lastKnownTimezone: z.string(),
          currentSelectedGroup: z
            .object({
              groupName: z.string(),
              id: z.number(),
            })
            .optional(),
        })
        .partial()
        .optional(),
      userName: z.string(),
      id: z.number(),
    })
    .optional(),
});

export type EUAResponse = z.infer<typeof EUAResponseSchema>;

const EUAResponseSchema = z.object({
  success: z.boolean(),
  messages: z.array(z.string()),
  euaVersion: z.number().optional(),
});

const UserSchema = z.object({
  token: z.string(),
  id: z.string(),
  email: z.string().email(),
  expiry: z.string().optional(),
  refreshToken: z.string(),
  prod: z.boolean(),
});

export type LoginResult =
  | { _tag: "Success"; user: User }
  | { _tag: "NeedsAgreement"; authToken: string }
  | { _tag: "Failed"; message: string };
// Keep track of ongoing refresh
let refreshPromise: Promise<User | null> | null = null;

export async function handleTokenManagement(
  user: User,
  log: any
): Promise<User | null> {
  if (!user) return null;

  try {
    const decodedToken = decodeJWT(user.token);
    if (!decodedToken) {
      log.logWarning({ message: "Invalid token format" });
      return null;
    }

    const now = new Date();
    const bufferTime = 60000; // 1 minute buffer
    const tokenExpiry = decodedToken.expiresAt.getTime();
    const isExpiringSoon = tokenExpiry < now.getTime() + bufferTime;

    // Handle offline scenario
    if (!navigator.onLine) {
      // If token is still valid, continue using it
      if (tokenExpiry > now.getTime()) {
        log.logWarning({
          message: "Operating offline with valid token",
          details: `Token expires in ${Math.floor(
            (tokenExpiry - now.getTime()) / 1000
          )} seconds`,
        });
        return user;
      }

      // Provide grace period when offline
      const offlineGracePeriod = 3600000; // 1 hour
      if (tokenExpiry + offlineGracePeriod > now.getTime()) {
        log.logWarning({
          message: "Operating offline with grace period",
          details: "Will need to refresh token when back online",
        });
        return user;
      }

      log.logWarning({
        message: "Token expired and offline - login required when online",
      });
      return null;
    }

    // Handle online token refresh
    if (isExpiringSoon) {
      return await refreshUserToken(user, log);
    }

    return user;
  } catch (error) {
    log.logError({
      message: "Token management error",
      error,
      details: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

async function refreshUserToken(user: User, log: any): Promise<User | null> {
  // If already refreshing, wait for that to complete
  if (refreshPromise) {
    return refreshPromise;
  }

  try {
    refreshPromise = performTokenRefresh(user, log);
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function performTokenRefresh(user: User, log: any): Promise<User | null> {
  try {
    // Use Effect.retry for automatic retries on network failure
    const result = await Effect.runPromise(
      Effect.retry(
        Effect.tryPromise(() =>
          CacophonyPlugin.validateToken({ refreshToken: user.refreshToken })
        ),
        { times: 2, delay: 1000 } // Retry twice with 1 second delay
      )
    );

    if (result.success) {
      const updatedUser: User = {
        ...user,
        token: result.data.token,
        refreshToken: result.data.refreshToken,
        expiry: result.data.expiry,
      };

      await Preferences.set({
        key: "user",
        value: JSON.stringify(updatedUser),
      });

      log.logSuccess({
        message: "Token refreshed successfully",
        details: `New token expires at ${result.data.expiry}`,
      });
      return updatedUser;
    }
    if (result.message?.includes("Failed") && navigator.onLine) {
      log.logWarning({
        message: "Token refresh failed - new login required",
        details: result.message,
      });
      return null;
    }

    // If we get here, something went wrong but we're not sure what
    // Keep the existing token for now
    log.logWarning({
      message: "Token refresh gave unexpected response",
      details: "Keeping existing token",
    });
    return user;
  } catch (error) {
    log.logError({
      message: "Token refresh failed",
      error,
      details: error instanceof Error ? error.message : "Unknown error",
    });

    // If we're online, the error is likely permanent
    if (navigator.onLine) {
      return null;
    }

    // If offline, keep existing token
    return user;
  }
}

// Helper function to decode JWT
function decodeJWT(token: string) {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;

    const decoded = JSON.parse(atob(payload));
    return {
      ...decoded,
      expiresAt: new Date(decoded.exp * 1000),
      createdAt: new Date(decoded.iat * 1000),
    };
  } catch (error) {
    return null;
  }
}
export type User = z.infer<typeof UserSchema>;

const [UserProvider, useUserContext] = createContextProvider(() => {
  const log = useLogsContext();
  const nav = useNavigate();
  const ValidUrl = z.string().url();
  const [
    customServer,
    { refetch: refetchCustomServer, mutate: mutateCustomServer },
  ] = createResource<string | undefined>(async () => {
    const pref = ValidUrl.safeParse(
      (await Preferences.get({ key: "customServer" })).value
    );
    console.log(`Custom server: ${pref.data}`);
    if (pref.success) {
      await CacophonyPlugin.setToCustomServer({ url: pref.data });
    }
    return pref.data;
  });

  // Enhanced error handling by defining a specific type for user data
  const [data, { mutate: mutateUser, refetch }] = createResource(
    getServerUrl,
    async (server) => {
      try {
        if (!server) {
          return null;
        }

        // Add slightly longer delay to ensure loading screen appears first
        await new Promise((resolve) => setTimeout(resolve, 500));

        const storedUser = await Preferences.get({ key: "user" });
        if (!storedUser.value) return null;

        const json = JSON.parse(storedUser.value);
        if (!json || Object.keys(json).length === 0) return null;

        const user = UserSchema.parse(json);
        return await handleTokenManagement(user, log);
      } catch (error) {
        log.logError({ message: "User validation failed", error });
        return null;
      }
    },
    {
      initialValue: undefined,
      // Add SSR option to prevent hydration mismatch
      ssrLoadFrom: "initial",
    }
  );

  createEffect(() => {
    const user = data();
    if (user) {
      log.setUser(user);
    } else {
      log.setUser(null);
    }
  });

  const [skippedLogin, { mutate: mutateSkip }] = createResource<boolean>(
    async () => {
      try {
        const skippedLogin = await Preferences.get({ key: "skippedLogin" });
        if (skippedLogin.value) {
          return JSON.parse(skippedLogin.value) as boolean;
        }
      } catch (error) {
        log.logError({
          message: "Failed to retrieve skipped login status",
          error,
        });
      }
      return false;
    }
  );
  async function logout() {
    console.trace();
    try {
      await Preferences.set({ key: "user", value: "" });
      await Preferences.set({ key: "skippedLogin", value: "false" });
      mutateSkip(false);
      await refetch();
      log.logSuccess({ message: "Successfully logged out" });
    } catch (error) {
      log.logError({ message: "Logout failed", error });
    }
  }

  async function login(email: string, password: string): Promise<LoginResult> {
    try {
      // First get the latest EUA version
      const euaResponse = await CapacitorHttp.request({
        method: "GET",
        url: `${getServerUrl()}/api/v1/end-user-agreement/latest`,
        headers: {
          "Content-Type": "application/json",
        },
      });

      const euaResult = EUAResponseSchema.safeParse(euaResponse.data);
      if (
        !euaResult.success ||
        !euaResult.data.success ||
        !euaResult.data.euaVersion
      ) {
        log.logWarning({
          message: "Failed to get latest agreement version",
          warn: false,
        });
        return { _tag: "Failed", message: "System error" };
      }

      const latestEuaVersion = euaResult.data.euaVersion;

      // Normal authentication flow
      const authResponse = await CapacitorHttp.request({
        method: "POST",
        url: `${getServerUrl()}/authenticate_user`,
        headers: {
          "Content-Type": "application/json",
        },
        data: {
          email,
          password,
        },
      });

      const authResult = UserAuthResponseSchema.safeParse(authResponse.data);

      if (
        !authResult.success ||
        !authResult.data.success ||
        !authResult.data.userData
      ) {
        log.logWarning({
          message: "Authentication failed",
          details: authResult.success
            ? authResult.data.messages?.join(", ")
            : `Invalid response format: ${JSON.stringify(
                authResult.error
              )}, ${JSON.stringify(authResult.data)}`,
        });
        return { _tag: "Failed", message: "Invalid credentials" };
      }

      // Check if user needs to accept latest agreement
      const userEuaVersion = authResult.data.userData.endUserAgreement;
      if (!userEuaVersion || userEuaVersion < latestEuaVersion) {
        log.logWarning({
          message: "User agreement needed",
          details: `User version: ${userEuaVersion}, Latest version: ${latestEuaVersion}`,
          warn: false,
        });
        return {
          _tag: "NeedsAgreement",
          authToken: authResult.data.token!,
        };
      }

      // Create user object
      const user: User = {
        token: authResult.data.token!,
        id: authResult.data.userData.id.toString(),
        email,
        refreshToken: authResult.data.refreshToken!,
        expiry: authResult.data.expiry,
        prod: isProd(),
      };

      await Preferences.set({ key: "skippedLogin", value: "false" });
      await Preferences.set({ key: "user", value: JSON.stringify(user) });
      mutateUser(user);
      mutateSkip(false);
      log.logSuccess({ message: "Login successful" });

      return { _tag: "Success", user };
    } catch (error) {
      log.logError({ message: "Login process failed", error });
      return { _tag: "Failed", message: "Login process failed" };
    }
  }

  const [server, setServer] = createSignal<"test" | "prod" | "custom">("prod");
  const isProd = () => server() === "prod" || server() === "custom";

  const [changeServer] = createResource(
    () => [server(), customServer()] as const,
    async ([server, customServer]) => {
      try {
        if (customServer) {
          await CacophonyPlugin.setToCustomServer({ url: customServer });
          return;
        }
        const res =
          server === "prod"
            ? await CacophonyPlugin.setToProductionServer()
            : await CacophonyPlugin.setToTestServer();

        if (!res.success) {
          log.logWarning({
            message: "Server switch failed",
            details: res.message,
          });
          throw new Error(`Failed to switch to ${server} server`);
        }
        console.info({
          message: `Switched to ${server} server successfully`,
        });
      } catch (error) {
        log.logError({ message: "Error changing server", error });
      }
    }
  );

  interface JwtTokenPayload<
    T =
      | "user"
      | "device"
      | "reset-password"
      | "confirm-email"
      | "join-group"
      | "invite-new-user"
      | "invite-existing-user"
      | "refresh"
  > {
    exp: number;
    iat: number;
    _type: T;
    createdAt: Date;
    expiresAt: Date;
  }

  const decodeJWT = (jwtString: string): JwtTokenPayload | null => {
    const parts = jwtString.split(".");
    if (parts.length !== 3) {
      log.logWarning({ message: "Invalid JWT format" });
      return null;
    }
    try {
      const decodedToken = JSON.parse(atob(parts[1]));
      return {
        ...decodedToken,
        expiresAt: new Date(decodedToken.exp * 1000),
        createdAt: new Date(decodedToken.iat * 1000),
      };
    } catch (e) {
      log.logError({ message: "Failed to decode JWT", error: e });
      return null;
    }
  };

  let refreshingToken = false;

  async function getValidUser(user: User): Promise<User | null> {
    try {
      const { token, refreshToken, email, id } = user;
      const decodedToken = decodeJWT(token);
      if (!decodedToken) return null;

      const now = new Date();
      const bufferTime = 10000; // 10 second buffer

      if (decodedToken.expiresAt.getTime() < now.getTime() + bufferTime) {
        if (!refreshingToken) {
          refreshingToken = true;
          // Token is about to expire, try to refresh
          try {
            const result = await CacophonyPlugin.validateToken({
              refreshToken,
            });

            if (result.success) {
              const updatedUser: User = {
                token: result.data.token,
                refreshToken: result.data.refreshToken,
                id,
                email,
                expiry: result.data.expiry,
                prod: isProd(),
              };
              await Preferences.set({
                key: "user",
                value: JSON.stringify(updatedUser),
              });
              console.info({ message: "Token refreshed successfully" });
              return updatedUser;
            } else {
              if (
                result.message.includes("Failed") ||
                result.message.includes("403")
              ) {
                log.logWarning({
                  message: "Token validation failed",
                  details: result.message,
                });
                await logout();
              }
              console.warn("Failed to refresh token", result);
              return user;
            }
          } catch (networkError) {
            log.logError({
              message: "Network error during token validation",
              error: networkError,
            });
            // If network error, check if token is still valid
            if (decodedToken.expiresAt.getTime() > now.getTime()) {
              // Token is still valid, allow user to stay logged in
              log.logWarning({
                message: "Offline",
                details:
                  "You're currently offline. Some features may be unavailable.",
              });
              mutateUser(() => user);
              return user;
            } else {
              // Token expired and cannot refresh
              await logout();
              return null;
            }
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return getValidUser(user);
        }
      } else {
        mutateUser(() => user);
        return user;
      }
    } catch (error) {
      log.logError({ message: "Error validating current token", error });
      return null;
    }
  }

  const CreateGroupResSchema = z.object({
    success: z.boolean(),
    messages: z.array(z.string()),
  });

  async function createGroup(groupName: string) {
    try {
      const user = await getUser();
      if (!user) {
        log.logWarning({
          message: "Attempted to create group without a valid user",
        });
        throw new Error("User not authenticated");
      }

      const res = await CapacitorHttp.request({
        method: "POST",
        url: `${getServerUrl()}/api/v1/groups`,
        headers: {
          Authorization: user.token,
          "Content-Type": "application/json",
        },
        data: { groupName },
      });

      const parsed = CreateGroupResSchema.safeParse(res.data);
      if (!parsed.success || !parsed.data.success) {
        log.logWarning({
          message: "Group creation failed",
          details: parsed.success
            ? parsed.data.messages.join(", ")
            : "Invalid response format",
        });
        throw new Error("Failed to create group");
      }

      log.logSuccess({ message: "Group created successfully" });
      return parsed.data;
    } catch (error) {
      log.logError({ message: "Error creating group", error });
      throw error;
    }
  }

  async function getUser(): Promise<User | undefined | null> {
    try {
      if (data.loading) return undefined;
      const user = data();
      if (!user) {
        log.logWarning({ message: "No user data available" });
        return null;
      }
      const validUser = await getValidUser(user);
      if (validUser) {
        mutateUser(validUser);
        return validUser;
      }
      return null;
    } catch (error) {
      log.logError({ message: "Failed to retrieve user", error });
      return null;
    }
  }

  function skip() {
    try {
      Preferences.set({ key: "skippedLogin", value: "true" });
      nav("/devices");
      mutateSkip(true);
      log.logSuccess({ message: "Skipped login successfully" });
    } catch (error) {
      log.logError({ message: "Failed to skip login", error });
    }
  }

  async function requestDeletion(): Result<string> {
    try {
      const user = await getUser();
      if (!user) {
        log.logWarning({ message: "Deletion requested without a valid user" });
        throw new Error("User not authenticated");
      }
      const value = await CacophonyPlugin.requestDeletion({
        token: user.token,
      });
      log.logSuccess({ message: "Account deletion requested successfully" });
      return value;
    } catch (error) {
      log.logError({ message: "Failed to request account deletion", error });
      throw error;
    }
  }

  function toggleServer() {
    if (changeServer.loading) {
      log.logWarning({ message: "Server switch already in progress" });
      return;
    }
    const newServer = isProd() ? (customServer() ? "custom" : "test") : "prod";
    setServer(newServer);
    log.logSuccess({ message: `Server toggled to ${newServer}` });
  }
  function getServerUrl() {
    if (customServer.loading) return undefined;
    const currCustomServer = customServer();
    console.info("Custom Server", { currCustomServer });
    if (currCustomServer) {
      return currCustomServer;
    }
    return isProd()
      ? "https://api.cacophony.org.nz"
      : "https://api-test.cacophony.org.nz";
  }

  const GroupSchema = z.array(
    z.object({
      id: z.number(),
      groupName: z.string(),
    })
  );

  const GroupsResSchema = z.discriminatedUnion("success", [
    z.object({
      success: z.literal(true),
      messages: z.array(z.string()),
      groups: GroupSchema,
    }),
    z.object({
      success: z.literal(false),
      messages: z.array(z.string()),
    }),
  ]);

  const getCachedGroups = async (): Promise<(typeof GroupSchema)["_type"]> => {
    try {
      const cached = await Preferences.get({ key: "groups" });
      const parsed = GroupSchema.safeParse(JSON.parse(cached.value ?? "[]"));
      console.info("Using cached groups", parsed);
      return parsed.success ? parsed.data : [];
    } catch (error) {
      log.logError({ message: "Failed to retrieve cached groups", error });
      return [];
    }
  };

  const [groups, { refetch: refetchGroups, mutate: mutateGroups }] =
    createResource(
      () => [data(), getServerUrl()] as const,
      async ([_, url]) => {
        try {
          const user = await getUser();
          const groups = await getCachedGroups();
          if (!url || !user) {
            console.warn({
              message: "Cannot fetch groups without server URL or user",
            });
            return groups;
          }

          CapacitorHttp.request({
            method: "GET",
            url: `${url}/api/v1/groups`,
            headers: {
              Authorization: user.token,
            },
          }).then(async (res) => {
            const result = GroupsResSchema.safeParse(res.data);
            if (
              !result.success ||
              !result.data.success ||
              result.data.groups.length === 0
            ) {
              console.warn({
                message: "Failed to fetch groups, using cached data",
              });
              return;
            }
            mutateGroups(result.data.groups);

            await Preferences.set({
              key: "groups",
              value: JSON.stringify(result.data.groups),
            });
          });

          console.info("Groups fetched successfully");
          return groups;
        } catch (e) {
          log.logError({ message: "Error fetching groups", error: e });
          return await getCachedGroups();
        }
      }
    );

  async function hasAccessToGroup(name: string): Promise<boolean> {
    try {
      const user = await getUser();
      if (!user) {
        log.logWarning({ message: "Access check without valid user" });
        return false;
      }
      const currGroups = groups();
      if (!currGroups) {
        log.logWarning({ message: "No groups available for access check" });
        return false;
      }
      return currGroups.some((group) => group.groupName === name);
    } catch (error) {
      log.logError({ message: "Error checking group access", error });
      return false;
    }
  }

  const [dev, setDev] = createSignal(false);
  onMount(async () => {
    try {
      const devPref = await Preferences.get({ key: "dev" });
      if (devPref.value === "true") {
        setDev(true);
      }
    } catch (error) {
      log.logError({
        message: "Failed to load development mode preference",
        error,
      });
    }
  });

  const setToCustomServer = async (customUrl: string) => {
    try {
      const valid = ValidUrl.safeParse(customUrl);
      if (valid.success) {
        await Preferences.set({
          key: "customServer",
          value: customUrl,
        });
        await refetchCustomServer();
      }
    } catch (error) {}
  };

  const toggleDev = async () => {
    try {
      const newDevState = !dev();
      setDev(newDevState);
      await Preferences.set({
        key: "dev",
        value: newDevState ? "true" : "false",
      });
      log.logSuccess({
        message: `Development mode ${newDevState ? "enabled" : "disabled"}`,
      });
    } catch (error) {
      log.logError({ message: "Failed to toggle development mode", error });
    }
  };

  const isLoggedIn = () => {
    return !!data();
  };

  async function updateUserAgreement(authToken: string) {
    try {
      // Get the latest EUA version
      const euaResponse = await CapacitorHttp.request({
        method: "GET",
        url: `${getServerUrl()}/api/v1/end-user-agreement/latest`,
        headers: {
          Authorization: authToken,
        },
      });

      const euaResult = EUAResponseSchema.safeParse(euaResponse.data);
      if (
        !euaResult.success ||
        !euaResult.data.success ||
        !euaResult.data.euaVersion
      ) {
        return Either.left("Failed to get latest agreement version");
      }

      // Update user's agreement version
      const updateResponse = await CapacitorHttp.request({
        method: "PATCH",
        url: `${getServerUrl()}/api/v1/users`,
        headers: {
          Authorization: authToken,
          "Content-Type": "application/json",
        },
        data: {
          endUserAgreement: euaResult.data.euaVersion,
        },
      });

      const updateResult = z
        .object({
          success: z.boolean(),
          messages: z.array(z.string()),
        })
        .safeParse(updateResponse.data);

      if (!updateResult.success || !updateResult.data.success) {
        return Either.left("Failed to update user agreement");
      }

      log.logSuccess({ message: "User agreement updated successfully" });
      return Either.right(true);
    } catch (error) {
      log.logError({ message: "Error updating user agreement", error });
      return Either.left("Error updating user agreement");
    }
  }
  const clearCustomServer = async () => {
    try {
      await Preferences.remove({ key: "customServer" });
      mutateCustomServer(undefined);
      setServer("prod");
      log.logSuccess({
        message: "Custom server cleared. Reverted to production server.",
      });
      await logout();
    } catch (error) {
      log.logError({ message: "Failed to clear custom server", error });
    }
  };

  createEffect(() => {
    const user = data();
    if (customServer()) {
      setServer("custom");
    } else if (user && !user.prod) {
      setServer("test");
    } else {
      setServer("prod");
    }
  });

  return {
    data,
    groups,
    refetchGroups,
    skippedLogin,
    getUser,
    isProd,
    login,
    logout,
    skip,
    createGroup,
    hasAccessToGroup,
    requestDeletion,
    toggleServer,
    getServerUrl,
    dev,
    toggleDev,
    setToCustomServer,
    isLoggedIn,
    updateUserAgreement,
    clearCustomServer,
  };
});

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const defineUserContext = () => useUserContext()!;

export { UserProvider, defineUserContext as useUserContext };
