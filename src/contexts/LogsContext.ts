// LogsContext.ts

import { createContextProvider } from "@solid-primitives/context";
import {
  createEffect,
  createSignal,
  JSX,
  onCleanup,
  on,
  onMount,
  createResource,
} from "solid-js";
import * as Sentry from "@sentry/capacitor";
import * as SentrySolid from "@sentry/solid";
import { User, useUserContext } from "./User"; // Import User context
import { useLocation } from "@solidjs/router"; // Import router location
import { Preferences } from "@capacitor/preferences";
import { Primitive } from "zod";
import { browserTracingIntegration } from "@sentry/capacitor";

export enum TracingLevel {
  NON_PERSONALIZED = "non_personalized",
  PERSONALIZED = "personalized",
}

// Define preference keys
const LOGGING_LEVEL_KEY = "loggingLevel";

// Define types
type NotificationType = "error" | "warning" | "sync" | "success" | "loading";
type NotificationID = string;

export type Notification = {
  id: NotificationID;
  message: string;
  details?: string;
  type: NotificationType;
  timeout?: number;
  action?: JSX.Element;
  warn?: boolean;
};

type TimeoutID = ReturnType<typeof setTimeout>;

const generateID = (): NotificationID => {
  return (Date.now() + Math.random()).toString(36).replace(".", "");
};

const defaultDuration = 3000;

type LogDetails = {
  message: string;
  details?: string;
  timeout?: number;
  action?: JSX.Element;
  warn?: boolean;
};

type LogBase = {
  type: NotificationType;
};

type Log = LogBase & LogDetails;

type ErrorLog = { type: "error"; error: unknown | Error } & LogDetails;

type AnyLog = Log | ErrorLog;

function isErrorLog(log: AnyLog): log is ErrorLog {
  return log.type === "error" && "error" in log;
}

// Create LogsProvider using createContextProvider
const [LogsProvider, useLogsContext] = createContextProvider(() => {
  // Import user context to get current user
  const [userData, setUser] = createSignal<User | null>();
  onMount(() => {
    Sentry.init({
      dsn: "https://90b77917fa4030b726635b1bb8cea254@sentry.crittergames.co.nz/2",
      integrations: [
        SentrySolid.browserTracingIntegration(),
        SentrySolid.replayIntegration({
          maskAllText: false,
          blockAllMedia: false,
        }),
      ],
      tracesSampleRate: 0.2,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
  });

  // Notifications state
  const [notifications, setNotifications] = createSignal<Notification[]>([]);
  const timeoutIDs = new Map<NotificationID, TimeoutID>();

  const removeNotificationAfterDuration = (id: string, duration: number) => {
    return setTimeout(() => {
      setNotifications(
        notifications().filter((notification) => notification.id !== id)
      );
    }, duration);
  };

  const hideNotification = (id: NotificationID, delay = defaultDuration) => {
    // Clear existing timeout if any
    if (timeoutIDs.has(id)) {
      clearTimeout(timeoutIDs.get(id));
    }
    const timeoutID = removeNotificationAfterDuration(id, delay);
    timeoutIDs.set(id, timeoutID);
  };

  const keepNotification = (id: NotificationID) => {
    if (timeoutIDs.has(id)) {
      clearTimeout(timeoutIDs.get(id));
    }
  };
  // Tracing level state
  const [tracingLevel, setTracingLevel] = createSignal<TracingLevel>(
    TracingLevel.NON_PERSONALIZED
  );
  const loadTracingLevel = async () => {
    const levelValue = await Preferences.get({ key: LOGGING_LEVEL_KEY });
    const level =
      (levelValue.value as TracingLevel) || TracingLevel.NON_PERSONALIZED;
    setTracingLevel(level);
  };
  // Set user context in Sentry
  const setSentryUser = () => {
    const currentUser = userData();
    const scope = Sentry.getCurrentScope();
    if (currentUser && tracingLevel() === TracingLevel.PERSONALIZED) {
      scope.setUser({
        id: currentUser.id,
        email: currentUser.email,
      });
    } else {
      scope.setUser(null);
    }
  };
  onMount(async () => {
    await loadTracingLevel();
  });

  createEffect(() => {
    setSentryUser();
  });
  // Track screen views using router location
  const location = useLocation();
  createEffect(
    on(
      () => location.pathname,
      (pathname) => {
        // Add a breadcrumb for navigation
        // Add a breadcrumb for navigation
        Sentry.addBreadcrumb({
          category: "navigation",
          message: `Navigated to ${pathname}`,
          level: "info",
        });
      }
    )
  );

  const logAction = async (log: AnyLog) => {
    // Remove duplicate notifications
    if (
      notifications().find(
        (notification) =>
          notification.message === log.message &&
          notification.details === log.details
      )
    )
      return;

    const id = generateID();
    const details = log.details ? `${log.details}\n` : "";
    const errorInfo = isErrorLog(log) && log.error ? `${log.error}` : "";
    console.debug(`[${log.type}] ${log.message} ${details} ${errorInfo}`);
    const shouldWarn = log.warn ?? false;
    if (shouldWarn) {
      const existingNotifcation = notifications().find(
        ({ message }) => log.message === message
      );
      if (existingNotifcation) {
        existingNotifcation.details += `\n ${log.details}`;
        setNotifications([
          ...notifications().filter(({ id }) => id !== existingNotifcation.id),
          existingNotifcation,
        ]);
      } else {
        setNotifications([
          ...notifications(),
          {
            id,
            message: log.message,
            details: log.details,
            type: log.type,
            timeout: log.timeout,
            action: log.action,
          },
        ]);
      }
      if (log.type === "success" || log.type === "loading" || log.timeout) {
        hideNotification(id, log.timeout ?? defaultDuration);
      }
    }

    // Ensure user context is up-to-date in Sentry
    setSentryUser();

    if (isErrorLog(log)) {
      // Capture exception with Sentry
      if (log.error instanceof Error) {
        Sentry.captureException(log.error, {
          contexts: {
            log: {
              message: log.message,
              details: log.details ?? "",
            },
          },
        });
      } else {
        Sentry.captureException(new Error(`${log.error}`), {
          contexts: {
            log: {
              message: log.message,
              details: log.details ?? "",
            },
          },
        });
      }
    } else {
      // Capture message with Sentry
      Sentry.captureMessage(log.message, {
        level: mapLogTypeToSentryLevel(log.type),
        contexts: {
          log: {
            details: log.details ?? "",
          },
        },
      });
    }
  };

  const mapLogTypeToSentryLevel = (
    type: NotificationType
  ): Sentry.SeverityLevel => {
    switch (type) {
      case "error":
        return "error";
      case "warning":
        return "warning";
      case "success":
        return "info";
      case "loading":
        return "info";
      case "sync":
        return "info";
      default:
        return "info";
    }
  };

  const logError = (errorLog: Omit<ErrorLog, "type">) =>
    logAction({ ...errorLog, type: "error" });
  const logWarning = (warningLog: LogDetails) =>
    logAction({ ...warningLog, type: "warning" });
  const logSync = (syncLog: LogDetails) =>
    logAction({ ...syncLog, type: "sync" });
  const logSuccess = (successLog: LogDetails) =>
    logAction({ ...successLog, type: "success" });
  const logLoading = (loadingLog: LogDetails) =>
    logAction({ ...loadingLog, type: "loading" });

  // Function to log custom events
  const logEvent = (name: string, tags?: { [key: string]: Primitive }) => {
    setSentryUser(); // Ensure user context is up-to-date
    Sentry.captureEvent({
      message: name,
      level: "info",
      tags,
    });
  };

  const setTracing = async (level: TracingLevel) => {
    await Preferences.set({ key: LOGGING_LEVEL_KEY, value: level });
    setTracingLevel(level);
    refetch();
  };

  // Consent management functions
  const grantConsent = async () => {
    await setTracing(TracingLevel.PERSONALIZED);
  };

  const revokeConsent = async () => {
    await setTracing(TracingLevel.NON_PERSONALIZED);
  };

  const [hasSetConsent, { refetch }] = createResource(async () => {
    const res = await Preferences.get({ key: LOGGING_LEVEL_KEY });
    return res.value !== null;
  });

  return {
    tracingLevel,
    hasSetConsent,
    grantConsent,
    revokeConsent,
    setUser,
    logError,
    logWarning,
    logSync,
    logSuccess,
    logLoading,
    logEvent, // Export logEvent function
    notifications,
    hideNotification,
    keepNotification,
  };
});

// Export the useLogsContext function
const defineLogsContext = () => useLogsContext()!;

export { LogsProvider, defineLogsContext as useLogsContext };
