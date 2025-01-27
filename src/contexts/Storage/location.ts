import { createMemo, createResource, onMount } from "solid-js";
import {
  Location,
  LocationSchema,
  createLocationSchema,
  deleteLocation,
  getLocations,
  insertLocation,
  insertLocations,
  updateLocation,
} from "~/database/Entities/Location";
import { db } from ".";
import {
  ApiLocation,
  CacophonyPlugin,
  getLocationsForUser,
} from "../CacophonyApi";
import { useUserContext } from "../User";
import { useLogsContext } from "../LogsContext";

const MIN_STATION_SEPARATION_METERS = 60;

// The radius of the station is half the max distance between stations: any recording inside the radius can
// be considered to belong to that station.
const MAX_DISTANCE_FROM_STATION_FOR_RECORDING =
  MIN_STATION_SEPARATION_METERS / 2;

// Retry utility with exponential backoff
const retry = async <T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise((res) => setTimeout(res, delay));
    return retry(fn, retries - 1, delay * 2);
  }
};
export interface LatLng {
  lat: number;
  lng: number;
}
export function latLngApproxDistance(a: LatLng, b: LatLng): number {
  if (a.lat === b.lat && a.lng === b.lng) {
    return 0;
  }
  const R = 6371e3;
  // Using 'spherical law of cosines' from https://www.movable-type.co.uk/scripts/latlong.html
  const lat1 = (a.lat * Math.PI) / 180;
  const costLat1 = Math.cos(lat1);
  const sinLat1 = Math.sin(lat1);
  const lat2 = (b.lat * Math.PI) / 180;
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180;
  const part1 = Math.acos(
    sinLat1 * Math.sin(lat2) + costLat1 * Math.cos(lat2) * Math.cos(deltaLng)
  );
  return part1 * R;
}

function isWithinRadius(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  radius: number
): boolean {
  const distance = latLngApproxDistance(
    { lat: lat1, lng: lon1 },
    { lat: lat2, lng: lon2 }
  );
  return distance <= radius;
}

export const isWithinRange = (
  prevLoc: [number, number],
  newLoc: [number, number],
  accuracy: number,
  range = MAX_DISTANCE_FROM_STATION_FOR_RECORDING
) => {
  const [lat, lng] = prevLoc;
  const [latitude, longitude] = newLoc;
  const inRange = isWithinRadius(
    lat,
    lng,
    latitude,
    longitude,
    range + accuracy * 2
  );
  return inRange;
};

export function useLocationStorage() {
  const log = useLogsContext();
  const userContext = useUserContext();
  type ServerLocation = ApiLocation & { isProd: boolean };
  const message =
    "Could not to get locations. Please check your internet connection and you are log.logged in.";
  const getServerLocations = async (): Promise<ServerLocation[]> => {
    try {
      const user = await userContext.getUser();
      if (!user) return [];
      const locations = await getLocationsForUser(user.token);
      return locations.map((location) => ({
        ...location,
        isProd: user.prod,
      }));
    } catch (error) {
      log.logError({
        message,
        error,
      });
      return [];
    }
  };

  function getLocationsToUpdate(
    apiLocations: ServerLocation[],
    dbLocations: Location[]
  ): Location[] {
    return dbLocations
      .map((dbLoc: Location) => {
        // Update Locations
        const diffLoc = apiLocations.find(
          (userLoc) =>
            dbLoc.id === userLoc.id &&
            dbLoc.isProd === userLoc.isProd &&
            (dbLoc.name !== userLoc.name ||
              dbLoc.updatedAt !== userLoc.updatedAt)
        );
        if (diffLoc) {
          // get difference between location and savedLocation objects
          const locationKeys = Object.keys(diffLoc) as (keyof ApiLocation)[];
          const diff = locationKeys.reduce((result, key) => {
            const newLoc = diffLoc[key];
            const oldLoc = dbLoc[key];
            if (JSON.stringify(newLoc) !== JSON.stringify(oldLoc)) {
              result[key] = newLoc;
            }
            return result;
          }, {} as Record<keyof Location, unknown>);

          return {
            ...diff,
            isProd: dbLoc.isProd,
            id: dbLoc.id,
          };
        }
      })
      .filter(Boolean) as Location[];
  }

  async function syncLocations(): Promise<Location[]> {
    const locations = await getLocations(db)();
    for (const [i, loc] of locations.entries()) {
      if (loc.needsCreation) {
        const existingLoc = locations.findIndex(
          (l) =>
            l.id !== loc.id &&
            l.isProd === loc.isProd &&
            l.groupName === loc.groupName &&
            isWithinRange(
              [loc.coords.lat, loc.coords.lng],
              [l.coords.lat, l.coords.lng],
              0
            )
        );
        // remove the location that needs creation, but keep the new name and photos
        // in case the user created a new location getting the server version
        if (existingLoc !== -1) {
          const same = locations[existingLoc];
          const newLoc = {
            ...same,
            updateName: loc.updateName ?? loc.name,
          };
          await deleteLocation(db)(loc.id.toString(), loc.isProd);
          await updateLocation(db)(newLoc);
          // insert the new location
          locations[existingLoc] = newLoc;
          // remove the old location
          locations.splice(i, 1);
        }
      }
    }
    const user = await userContext.getUser();
    return await Promise.all(
      locations.map(async (location) => {
        if (!user || location.isProd !== user?.prod) return location;
        if (location.needsCreation) {
          const res = await createLocation({
            ...location,
            name: location.updateName ?? location.name,
          });
          return res;
        }
        if (location.updateName) {
          let name = location.updateName;
          while (locations.some((loc) => loc.name === name)) {
            name = `${location.updateName}(${Math.floor(Math.random() * 100)})`;
          }
          const synced = await syncLocationName(location, name);
          if (synced) {
            location.name = name;
            location.updateName = undefined;
          } else {
            location.updateName = name;
          }
        }
        return location;
      })
    );
  }

  const [savedLocations, { mutate, refetch }] = createResource(
    () => [userContext.data()] as const,
    async (data) => {
      try {
        // Update Locations based on user
        const user = data;
        console.log("User in saved location", user);
        if (!user) return [];
        const locations = await getServerLocations();
        console.log("Server Locations", locations);
        const dbLocations = await getLocations(db)();
        console.log("DB Locations", dbLocations);
        const locationsToInsert = locations.filter(
          (location) =>
            !dbLocations.some(
              (savedLocation) =>
                savedLocation.id === location.id &&
                savedLocation.isProd === location.isProd
            )
        );
        const locationsToUpdate = getLocationsToUpdate(locations, dbLocations);
        await insertLocations(db)(locationsToInsert);
        await Promise.all(locationsToUpdate.map(updateLocation(db)));
        const newLocations = await syncLocations();
        console.log("Locations", newLocations);
        return newLocations;
      } catch (error) {
        log.logError({
          message: "Failed to sync locations",
          error,
        });
        return [];
      }
    }
  );

  const updateLocationName = async (location: Location, newName: string) => {
    try {
      const validToken = await userContext.getUser();
      if (validToken) {
        while (savedLocations()?.some((loc) => loc.name === newName)) {
          newName = `${newName}(${Math.floor(Math.random() * 100)})`;
        }
        const res = await CacophonyPlugin.updateStation({
          token: validToken.token,
          id: location.id.toString(),
          name: newName,
        });
        if (res.success) {
          location.name = newName;
          location.updateName = undefined;
          log.logSuccess({
            message: "Successfully updated location name",
          });
        } else {
          location.updateName = newName;
        }
      } else {
        location.updateName = newName;
      }
      await updateLocation(db)(location);
      mutate((locations) =>
        locations?.map((loc) => (loc.id === location.id ? location : loc))
      );
    } catch (e) {
      location.updateName = newName;
      await updateLocation(db)(location);
      mutate((locations) =>
        locations?.map((loc) => (loc.id === location.id ? location : loc))
      );
    }
  };

  const getNextLocationId = () => {
    let randomId = Math.floor(Math.random() * 1000000000);
    while (savedLocations()?.some((loc: Location) => loc.id === randomId)) {
      randomId = Math.floor(Math.random() * 1000000000);
    }
    return randomId;
  };

  const saveLocation = async (
    location: Omit<
      Location,
      "id" | "updatedAt" | "needsCreation" | "needsDeletion" | "updateName"
    >
  ) => {
    const newLocation = LocationSchema.safeParse({
      ...location,
      id: getNextLocationId(),
      needsCreation: true,
      updatedAt: new Date().toISOString(),
    });
    if (!newLocation.success) {
      log.logWarning({
        message: "Failed to save location",
        details: JSON.stringify(newLocation.error),
      });
      return;
    }
    await insertLocation(db)(newLocation);
    mutate((locations) => [...(locations ?? []), newLocation.data]);
  };

  const syncLocationName = async (loc: Location, updateName: string) => {
    const user = await userContext.getUser();
    if (!user) return;
    let name = updateName;
    try {
      for (let i = 0; i < 3; i++) {
        name = i === 0 ? name : `${updateName}(${i})`;
        const res = await CacophonyPlugin.updateStation({
          token: user.token,
          id: loc.id.toString(),
          name,
        });
        if (res.success) {
          await updateLocation(db)({
            id: loc.id,
            isProd: loc.isProd,
            updateName: undefined,
          });
          return true;
        }
      }
    } catch (e) {
      await updateLocation(db)({
        id: loc.id,
        isProd: loc.isProd,
        updateName: name,
      });
    }
    return false;
  };

  const createLocation = async (settings: {
    id?: number;
    groupName: string;
    coords: { lat: number; lng: number };
    isProd: boolean;
    name?: string | null | undefined;
  }): Promise<Location> => {
    const user = await userContext.getUser();
    const fromDate = new Date().toISOString();
    const id = getNextLocationId();
    const location: Location = {
      id,
      ...settings,
      updatedAt: fromDate,
      needsCreation: true,
      needsRename: false,
    };
    if (user && user.prod === settings.isProd) {
      let success = false;
      let tries = 0;
      while (!success) {
        let name =
          settings.name ??
          `New Location ${settings.groupName} ${new Date().toISOString()}`;
        if (tries > 0) name = `${name}(${Math.floor(Math.random() * 1000)})`;
        while (
          savedLocations()?.some(
            (loc: Location) =>
              loc.name === name && loc.groupName === settings.groupName
          )
        ) {
          name = `${name}(${Math.floor(Math.random() * 100)})`;
        }
        const res = await CacophonyPlugin.createStation({
          token: user.token,
          name,
          groupName: settings.groupName,
          lat: settings.coords.lat.toString(),
          lng: settings.coords.lng.toString(),
          fromDate,
        });
        if (res.success) {
          if (settings.id) {
            // Delete old location if it exists
            await deleteLocation(db)(settings.id.toString(), settings.isProd);
          }
          location.id = parseInt(res.data);
          location.name = name;
          location.updateName = null;
          location.needsCreation = false;
          await insertLocation(db)(location);

          success = true;
          log.logSuccess({
            message: "Location created successfully",
          });
        } else if (res.message.includes("already exists") && tries < 3) {
          tries++;
        } else {
          success = true;
        }
      }
    }
    if (location.needsCreation) {
      log.logWarning({
        message:
          "Unable to establish this location. Ensure you have access to the group and are online.",
      });
      location.updateName = settings.name;
      location.name = null;
      if (!settings.id) {
        await insertLocation(db)(location);
      }
    }

    mutate((locations) => [
      ...(locations ?? []).filter((loc) => loc.id !== settings.id),
      location,
    ]);
    return location;
  };

  const deleteSyncLocations = async () => {
    if (!savedLocations.loading) {
      const locs = savedLocations() ?? [];
      await Promise.all(
        locs.map(async (loc) => {
          if (loc.needsCreation) {
            await deleteLocation(db)(loc.id.toString(), loc.isProd);
          }
          if (loc.updateName) {
            await updateLocation(db)({
              id: loc.id,
              isProd: loc.isProd,
              updateName: null,
            });
          }
        })
      );
      refetch();
    }
  };

  const hasItemsToUpload = createMemo(() => {
    const locs = savedLocations();
    return locs?.some((loc) => loc.updateName) ?? false;
  });

  onMount(async () => {
    try {
      await db.execute(createLocationSchema);
    } catch (error) {
      log.logError({
        message,
        error,
      });
    }
  });

  return {
    savedLocations,
    saveLocation,
    createLocation,
    deleteSyncLocations,
    resyncLocations: refetch,
    updateLocationName,
    hasItemsToUpload,
  };
}
