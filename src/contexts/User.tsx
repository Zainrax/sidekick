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
import { unbindAndRebind } from "./Device";
import { CapacitorHttp } from "@capacitor/core";
import { FirebaseCrashlytics } from "@capacitor-firebase/crashlytics";
import { useLogsContext } from "./LogsContext";

const UserSchema = z.object({
  token: z.string(),
  id: z.string(),
  email: z.string().email(),
  expiry: z.string().optional(),
  refreshToken: z.string(),
  prod: z.boolean(),
});

export type User = z.infer<typeof UserSchema>;

const [UserProvider, useUserContext] = createContextProvider(() => {
  const log = useLogsContext();
  const nav = useNavigate();

  // Enhanced error handling by defining a specific type for user data
  const [data, { mutate: mutateUser, refetch }] = createResource<User | null>(
    async () => {
      try {
        const storedUser = await Preferences.get({ key: "user" });
        if (storedUser.value) {
          const json = JSON.parse(storedUser.value);
          // Validate that json is not an empty object
          if (json && Object.keys(json).length === 0) {
            return null;
          }
          const user = UserSchema.parse(json);
          setServer(user.prod ? "prod" : "test");
          const validUser = await getValidUser(user);
          return validUser;
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          log.logError({
            message: "User data validation failed",
            error,
            details: error.errors.map((e) => e.message).join(", "),
          });
        } else if (error instanceof Error) {
          log.logError({ message: "Could not retrieve valid user", error });
        } else {
          log.logWarning({
            message: "An unknown error occurred while fetching user data",
          });
        }
        const user = UserSchema.parse(JSON.parse(storedUser.value));
        setServer(user.prod ? "prod" : "test");
        getValidUser(user);

        return user;
      }
      return null;
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

  createEffect(() => {
    on(data, async (user) => {
      try {
        if (user) {
          await FirebaseCrashlytics.setUserId({ userId: user.id });
        } else {
          await FirebaseCrashlytics.setUserId({ userId: "" });
        }
      } catch (error) {
        log.logError({
          message: "Failed to set user ID in Crashlytics",
          error,
        });
      }
    });
  });

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

  async function login(email: string, password: string) {
    try {
      const authUser = await CacophonyPlugin.authenticateUser({
        email,
        password,
      });
      if (!authUser.success) {
        log.logWarning({
          message: "Login attempt failed",
          details: authUser.message,
        });
        throw new Error("Authentication failed");
      }
      const { token, refreshToken, expiry, id } = authUser.data;
      const user: User = {
        token,
        id,
        email,
        refreshToken,
        expiry,
        prod: isProd(),
      };
      await Preferences.set({ key: "skippedLogin", value: "false" });
      await Preferences.set({ key: "user", value: JSON.stringify(user) });
      mutateUser(user);
      mutateSkip(false);
      log.logSuccess({ message: "Login successful" });
    } catch (error) {
      log.logError({ message: "Login process failed", error });
    }
  }

  const [server, setServer] = createSignal<"test" | "prod">("prod");
  const isProd = () => server() === "prod";

  const [changeServer] = createResource(server, async (server) => {
    try {
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
  });

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

  async function getValidUser(user: User): Promise<User | null> {
    try {
      const { token, refreshToken, email, id } = user;
      const decodedToken = decodeJWT(token);
      if (!decodedToken) return null;

      const now = new Date();
      const bufferTime = 5000; // 5 seconds buffer

      if (decodedToken.expiresAt.getTime() < now.getTime() + bufferTime) {
        // Token is about to expire, try to refresh
        try {
          const refreshedUser = await unbindAndRebind(async () => {
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
              if (result.message.includes("Failed") && navigator.onLine) {
                log.logWarning({
                  message: "Token validation failed",
                  details: result.message,
                });
                await logout();
              }
              console.warn("Failed to refresh token");
              return user;
            }
          });
          return refreshedUser;
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
            return mutateUser(() => user);
          } else {
            // Token expired and cannot refresh
            await logout();
            return null;
          }
        }
      } else {
        return mutateUser(() => user);
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

      const res = await unbindAndRebind(async () => {
        return await CapacitorHttp.request({
          method: "POST",
          url: `${getServerUrl()}/api/v1/groups`,
          headers: {
            Authorization: user.token,
            "Content-Type": "application/json",
          },
          data: { groupName },
        });
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
      if (error instanceof Error) {
        log.logError({ message: "Failed to request account deletion", error });
      } else {
        log.logError({
          message: "Unknown error during account deletion request",
        });
      }
      throw error;
    }
  }

  function toggleServer() {
    if (changeServer.loading) {
      log.logWarning({ message: "Server switch already in progress" });
      return;
    }
    const newServer = isProd() ? "test" : "prod";
    setServer(newServer);
    log.logSuccess({ message: `Server toggled to ${newServer}` });
  }

  function getServerUrl() {
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

  const [groups, { refetch: refetchGroups }] = createResource(
    () => [data(), getServerUrl()] as const,
    async ([_, url]) => {
      try {
        const user = await getUser();
        if (!url || !user) {
          console.warn({
            message: "Cannot fetch groups without server URL or user",
          });
          return await getCachedGroups();
        }

        const res = await unbindAndRebind(async () => {
          return await CapacitorHttp.request({
            method: "GET",
            url: `${url}/api/v1/groups`,
            headers: {
              Authorization: user.token,
            },
          });
        });

        const result = GroupsResSchema.safeParse(res.data);
        if (
          !result.success ||
          !result.data.success ||
          result.data.groups.length === 0
        ) {
          console.warn({
            message: "Failed to fetch groups, using cached data",
          });
          return await getCachedGroups();
        }

        await Preferences.set({
          key: "groups",
          value: JSON.stringify(result.data.groups),
        });
        console.info("Groups fetched successfully");
        return result.data.groups;
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
    isLoggedIn,
  };
});

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const defineUserContext = () => useUserContext()!;

export { UserProvider, defineUserContext as useUserContext };
