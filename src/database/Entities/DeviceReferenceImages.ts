import type { SQLiteDBConnection } from "@capacitor-community/sqlite";
import { z } from "zod";
import { insertIntoTable, insertManyIntoTable } from "..";

const TABLE_CONTENTS = `id INTEGER PRIMARY KEY AUTOINCREMENT,
  deviceId INTEGER NOT NULL,
  fileKey TEXT,
  filePath TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  type TEXT CHECK(type IN ('pov', 'in-situ')) NOT NULL,
  serverStatus TEXT CHECK(serverStatus IN ('pending-upload', 'pending-deletion')),
  isProd INTEGER NOT NULL,
  lat REAL,
  lng REAL,
  UNIQUE(deviceId, type, serverStatus)
`;
const TABLE_NAME = "DeviceReferenceImageV9";
export const createDeviceReferenceImageSchema = `
CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
${TABLE_CONTENTS}
);`;

export const DeviceReferenceImageSchema = z.object({
  id: z.number().optional(),
  // Union of string or number, if string convert to number
  deviceId: z.union([z.string().transform(Number), z.number()]),
  fileKey: z.string().nullish(),
  filePath: z.string(),
  timestamp: z.string(),
  type: z.enum(["pov", "in-situ"]),
  serverStatus: z.enum(["pending-upload", "pending-deletion"]).nullish(),
  isProd: z.boolean(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
});
export const QueryDeviceReferenceImageSchema = z.object({
  id: z.number(),
  // Union of string or number, if string convert to number
  deviceId: z.number(),
  fileKey: z.string().nullish(),
  filePath: z.string(),
  timestamp: z.string(),
  type: z.enum(["pov", "in-situ"]),
  serverStatus: z.enum(["pending-upload", "pending-deletion"]).nullish(),
  isProd: z.number().transform((val) => Boolean(val)),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
});

export type DeviceReferenceImage = z.infer<typeof DeviceReferenceImageSchema>;

export const transformId = <T extends { deviceId: number; isProd: boolean }>(
  val: T
) => ({
  ...val,
  deviceId: (val.deviceId << 1) | (val.isProd ? 1 : 0),
});

const reverseTransformId = <T extends { deviceId: number }>(val: T) => ({
  ...val,
  deviceId: val.deviceId >> 1,
  isProd: Boolean(val.deviceId & 1),
});

export const MutationImageSchema =
  DeviceReferenceImageSchema.transform(transformId);
export const QueryImageSchema =
  QueryDeviceReferenceImageSchema.transform(reverseTransformId);

export const insertDeviceReferenceImage = insertIntoTable({
  tableName: TABLE_NAME,
  schema: MutationImageSchema,
});

export const insertDeviceReferenceImages = insertManyIntoTable({
  tableName: TABLE_NAME,
  schema: MutationImageSchema,
  keys: Object.keys(DeviceReferenceImageSchema.shape),
});

const getDeviceReferenceImagesSql = `SELECT * FROM ${TABLE_NAME} WHERE deviceId = ?`;
export const getDeviceReferenceImages =
  (db: SQLiteDBConnection) =>
  async (
    deviceId: number,
    isProd: boolean
  ): Promise<DeviceReferenceImage[]> => {
    const result = await db.query(getDeviceReferenceImagesSql, [
      transformId({ deviceId, isProd }).deviceId,
    ]);
    if (!result.values) return [];
    return result.values.map((row) => QueryImageSchema.parse(row));
  };

const deleteDeviceReferenceImageSql = `DELETE FROM ${TABLE_NAME} WHERE deviceId = ? AND filePath = ?`;
export const deleteDeviceReferenceImage =
  (db: SQLiteDBConnection) =>
  async (deviceId: number, isProd: boolean, filePath: string) =>
    db.run(deleteDeviceReferenceImageSql, [
      transformId({ deviceId, isProd }).deviceId,
      filePath,
    ]);

const getAllDeviceReferenceImagesSql = `SELECT * FROM ${TABLE_NAME}`;
export const getAllDeviceReferenceImages =
  (db: SQLiteDBConnection) => async (): Promise<DeviceReferenceImage[]> => {
    const result = await db.query(getAllDeviceReferenceImagesSql);
    if (!result.values) return [];
    return result.values.map((row) => QueryImageSchema.parse(row));
  };

const markPhotoForServerOperationSql = `
  UPDATE ${TABLE_NAME} 
  SET serverStatus = ?, lat = ?, lng = ?
  WHERE deviceId = ? AND filePath = ?
`;

export const markPhotoForServerOperation =
  (db: SQLiteDBConnection) =>
  async (
    deviceId: number,
    isProd: boolean,
    filePath: string,
    operation: "pending-upload" | "pending-deletion" | null,
    location?: { lat: number; lng: number }
  ) => {
    return db.run(markPhotoForServerOperationSql, [
      operation,
      location?.lat ?? null,
      location?.lng ?? null,
      transformId({ deviceId, isProd }).deviceId,
      filePath,
    ]);
  };

const getPendingServerOperationsSql = `
  SELECT * FROM ${TABLE_NAME} 
  WHERE serverStatus IS NOT NULL
`;

export const getPendingServerOperations =
  (db: SQLiteDBConnection) => async (): Promise<DeviceReferenceImage[]> => {
    const result = await db.query(getPendingServerOperationsSql);
    if (!result.values) return [];
    return result.values.map((row) => QueryImageSchema.parse(row));
  };

const clearServerOperationStatusSql = `
  UPDATE ${TABLE_NAME} 
  SET serverStatus = NULL 
  WHERE deviceId = ? AND filePath = ?
`;

export const clearServerOperationStatus =
  (db: SQLiteDBConnection) =>
  async (deviceId: number, isProd: boolean, filePath: string) => {
    return db.run(clearServerOperationStatusSql, [
      transformId({ deviceId, isProd }).deviceId,
      filePath,
    ]);
  };
