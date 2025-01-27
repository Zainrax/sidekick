import { Uploader } from "@capgo/capacitor-uploader";
import {
  createDeviceReferenceImageSchema,
  DeviceReferenceImage,
  getAllDeviceReferenceImages,
  getDeviceReferenceImages,
  insertDeviceReferenceImage,
  transformId,
  UploadStatus,
} from "~/database/Entities/DeviceReferenceImages";
import { CacophonyPlugin } from "../CacophonyApi";
import { useLogsContext } from "../LogsContext";
import { useUserContext } from "../User";
import { db } from ".";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { deleteDeviceReferenceImage } from "~/database/Entities/DeviceReferenceImages";
import { getLocations } from "~/database/Entities/Location";
import { createResource, onMount } from "solid-js";
import { useDevice } from "../Device";
import { z } from "zod";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

export function useDeviceImagesStorage() {
  const log = useLogsContext();
  const userContext = useUserContext();

  const [deviceImages, { refetch: refetchDeviceImages }] = createResource(
    async () => {
      try {
        const images = await getAllDeviceReferenceImages(db)();
        console.log("Device Images", images);
        return images;
      } catch (error) {
        log.logError({
          message: "Failed to get device images",
          error,
        });
      }
    },
    { initialValue: [] }
  );

  const itemsToUpload = () =>
    deviceImages()?.filter(
      (i) => i.uploadStatus === "pending" || i.uploadStatus === "failed"
    ) ?? [];

  const hasItemsToUpload = () => itemsToUpload().length > 0;

  onMount(async () => {
    try {
      await db.execute(createDeviceReferenceImageSchema);
    } catch (error) {
      log.logError({
        message: "Failed to create device reference image table",
        error,
      });
    }
  });

  function base64ToArrayBuffer(base64: string): ArrayBuffer {
    // atob() decodes a base64-encoded string into a binary string
    const binaryString = window.atob(base64);

    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  const uploadDevicePhoto = async (
    deviceId: string,
    isProd: boolean,
    filePath: string,
    fileUrl: string,
    type: "pov" | "in-situ",
    timestamp?: Date
  ) => {
    try {
      const user = await userContext.getUser();
      if (!user) {
        const insertRes = await insertDeviceReferenceImage(db)({
          deviceId: parseInt(deviceId),
          filePath,
          timestamp: timestamp?.toISOString() ?? new Date().toISOString(),
          type,
          isProd,
          uploadStatus: "pending",
        });
        return;
      }
      debugger;

      const url = userContext.getServerUrl();

      const fileContents = await Filesystem.readFile({
        path: filePath, // Use local file path instead of URL
      });

      const base64Data = fileContents.data;

      const res = await CapacitorHttp.post({
        url: `${url}/api/v1/devices/${deviceId}/reference-image?type=${type}`,
        method: "POST",
        headers: {
          Authorization: user.token,
          "Content-Type": "image/jpeg",
        },
        data: base64Data,
        dataType: "file", // Critical for CapacitorHTTP
      });
      console.log("Upload Device Photo", res);
      const insertRes = await insertDeviceReferenceImage(db)({
        deviceId: parseInt(deviceId),
        filePath,
        timestamp: timestamp?.toISOString() ?? new Date().toISOString(),
        type,
        isProd,
        ...(res.status === 200
          ? {
              fileKey: z
                .object({ key: z.string(), size: z.number() })
                .parse(await res.data).key,
            }
          : { uploadStatus: "pending" }),
      });

      log.logSuccess({
        message: "Successfully uploaded device photo",
        details: JSON.stringify(insertRes),
      });

      return res.status === 200 ? res.data : null;
    } catch (error) {
      log.logError({
        message: "Failed to upload device photo",
        error,
      });
      throw error;
    } finally {
      refetchDeviceImages();
    }
  };

  const getDevicePhoto = async (device: {
    name: string;
    isProd: boolean;
    id: string;
  }) => {
    try {
      const images = deviceImages();
      console.log("Get Device Photo", images);
      const image = images?.find(
        (i) => i.deviceId === parseInt(device.id) && i.isProd === device.isProd
      );
      if (image) {
        return {
          ...image,
          url: Capacitor.convertFileSrc(image.filePath),
        };
      }
      const fileName = `${device.name}-${
        device.isProd ? "prod" : "dev"
      }-pov.jpg`;
      const path = await Filesystem.getUri({
        path: "",
        directory: Directory.Data,
      });
      const user = await userContext.getUser();
      if (!user) {
        throw new Error("User not authenticated");
      }
      const filePath = `${path.uri}/${fileName}`;
      debugger;
      const res = await CacophonyPlugin.saveDeviceImage({
        token: user.token,
        deviceId: device.id,
        filePath,
      });
      if (res.success) {
        const insertRes = await insertDeviceReferenceImage(db)({
          deviceId: device.id,
          filePath,
          timestamp: new Date().toISOString(),
          type: "pov",
          isProd: device.isProd,
        });
        await refetchDeviceImages();

        const deviceImage = deviceImages()?.find(
          (i) =>
            i.deviceId === parseInt(device.id) && i.isProd === device.isProd
        );
        if (!deviceImage) return null;
        return {
          ...deviceImage,
          url: Capacitor.convertFileSrc(filePath),
        };
      }
    } catch (error) {
      log.logError({
        message: "Failed to get device photo",
        error,
      });
      return null;
    }
  };

  const getDeviceImageData = async (
    deviceId: string,
    { fileKey, filePath }: { fileKey?: string | null; filePath: string }
  ) => {
    try {
      const user = await userContext.getUser();
      debugger;
      const res = await CacophonyPlugin.getReferenceImage({
        ...(user?.token && { token: user.token }),
        deviceId: deviceId,
        fileKey,
        filePath,
      });
      const data = res.success ? Capacitor.convertFileSrc(res.data) : null;
      console.log("Get Device Image Data", res, data);
      return data;
    } catch (error) {
      console.error("Error", error);
      log.logError({
        message: "Failed to get device photo",
        error,
      });
      return null;
    }
  };

  const deleteDevicePhoto = async (photo: {
    deviceId: number;
    isProd: boolean;
    fileKey?: string | null;
    filePath: string;
  }) => {
    try {
      const user = await userContext.getUser();
      if (!user) throw new Error("User not authenticated");
      debugger;
      await Filesystem.deleteFile({ path: photo.filePath }).catch((error) => {
        console.error("Error deleting file", error);
      });
      const res = await CapacitorHttp.delete({
        url: `${userContext.getServerUrl()}/api/v1/devices/${
          photo.deviceId
        }/reference-image`,
        headers: {
          authorization: user.token,
        },
      });
      console.log("Delete Device Photo", res);

      if (res.status === 200) {
        await deleteDeviceReferenceImage(db)(
          photo.deviceId,
          photo.isProd,
          photo.filePath
        );
        log.logSuccess({
          message: "Successfully deleted device photo",
        });
      }

      refetchDeviceImages();
    } catch (error) {
      log.logError({
        message: "Error deleting device photo",
        error,
      });
      throw error;
    } finally {
      refetchDeviceImages();
    }
  };

  const syncPendingPhotos = async () => {
    try {
      const user = await userContext.getUser();
      if (!user) return;
      const pendingPhotos = itemsToUpload();

      for (const photo of pendingPhotos) {
        try {
          debugger;
          const res = await CacophonyPlugin.uploadDeviceReferenceImage({
            token: user.token,
            deviceId: photo.deviceId.toString(),
            type: photo.type,
            atTime: photo.timestamp,
            filename: photo.filePath,
          });

          if (res.success) {
            const value = z
              .object({ key: z.string(), size: z.number() })
              .parse(JSON.parse(res.data));
            await insertDeviceReferenceImage(db)({
              ...photo,
              fileKey: value.key,
              uploadStatus: undefined,
            });
          }
        } catch (error) {
          log.logError({
            message: `Failed to sync photo for device ${photo.deviceId} ${photo.fileKey}`,
            error,
          });
        }
      }
    } catch (error) {
      log.logError({
        message: "Failed to sync pending photos",
        error,
      });
    } finally {
      refetchDeviceImages();
    }
  };

  const deleteUnuploadedPhotos = async () => {
    try {
      const photos = itemsToUpload();
      console.log("Delete Unuploaded Photos", photos);
      for (const photo of photos) {
        const res = await deleteDeviceReferenceImage(db)(
          photo.deviceId,
          photo.isProd,
          photo.filePath
        );
      }
    } catch (error) {
      log.logError({
        message: "Failed to delete unuploaded photos",
        error,
      });
    } finally {
      refetchDeviceImages();
    }
  };

  return {
    deviceImages,
    itemsToUpload,
    deleteUnuploadedPhotos,
    hasItemsToUpload,
    uploadDevicePhoto,
    getDevicePhoto,
    getDeviceImageData,
    deleteDevicePhoto,
    syncPendingPhotos,
  };
}
