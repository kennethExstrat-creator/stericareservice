// Photos and files for capture (BUILD_SPEC 8.1, docs/OFFLINE.md): processing
// in the browser, tags, storage object names and the background upload queue.
export {
  processPhoto,
  type ProcessedPhoto,
  type ProcessPhotoResult,
  type ProcessPhotoFailure,
  type ImageCodec,
  type PhotoInput,
} from "./process";
export { browserCodec } from "./browser-codec";
export { prepareFile, type PreparedFile, type PrepareFileResult, type InspectionFileKind } from "./files";
export {
  autoTag,
  buildTarget,
  parseTarget,
  MODULE_TARGET_KEYS,
  TARGET_KEYS,
  PhotoTargetSchema,
  PhotoTagSchema,
  type CaptureFocus,
  type ParsedTarget,
  type PhotoTag,
  type PhotoTarget,
  type TargetKey,
} from "./target";
export {
  PHOTO_BUCKET,
  FILE_BUCKET,
  PHOTO_TYPES,
  FILE_TYPES,
  PHOTO_SIZE_LIMIT,
  FILE_SIZE_LIMIT,
  photoPath,
  thumbPath,
  filePath,
  storageInspectionId,
  type MediaBucket,
} from "./paths";
export {
  createUploadQueue,
  browserLock,
  type UploadQueue,
  type UploadQueueOptions,
  type UploadQueueSnapshot,
  type UploadItem,
  type UploadState,
  type UploadStorage,
  type UploadRequest,
  type MediaRepository,
  type TransferOutcome,
  type PhotoRow,
  type PhotoRowPatch,
  type FileRow,
  type ItemLock,
  type EnqueuePhoto,
  type EnqueueFile,
} from "./upload-queue";
export {
  createSupabaseUploadQueue,
  supabaseStorage,
  supabaseRepository,
  sessionToken,
  type SupabaseStorageOptions,
  type SupabaseUploadQueueOptions,
} from "./supabase-adapters";
export { parseExif, exifTakenAt, type ExifInfo } from "./exif";
export { PHOTO_MAX_EDGE, THUMB_MAX_EDGE, JPEG_QUALITY } from "./sizing";
