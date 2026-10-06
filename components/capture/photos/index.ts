// Photos on the capture screen and in the gallery (BUILD_SPEC 8.1).
//
//   <PhotoQueueProvider userId={user.id}>    once around the capture screen
//     <PhotoSlot inspectionId={id} moduleKey="dimensions" focus={focus} readOnly={readOnly} />
//     <PhotoUploadBadge inspectionId={id} />  or SaveStatus pendingUploads={status.pending}
//   </PhotoQueueProvider>
//
//   const status = usePhotoUploadStatus(id); // submit waits while status.blocking (status.message says why)
//   if (await photoUploadsSettled(id)) ...   // the last check on submit, other tabs included
//   if (!(await photoUploadsSettled())) warn; stopPhotoQueue();   // on sign-out
export { PhotoSlot, type PhotoSlotProps } from "./photo-slot";
export { ModulePhotos, type ModulePhotosProps } from "./module-photos";
export { PhotoQueueProvider, InspectionMediaProvider } from "./provider";
export { PhotoUploadBadge } from "./upload-badge";
export { UploadNotices } from "./upload-notices";
export { PhotoAddControls } from "./photo-add-controls";
export {
  usePhotoUploadStatus,
  photoUploadsSettled,
  stopPhotoQueue,
  useAddPhotos,
  useInspectionMedia,
  usePhotoQueue,
  type PhotoFocus,
} from "./hooks";
export { uploadStatusFor, type PhotoUploadStatus } from "./photo-model";
