// Lab reports and certificates on the capture screen and in the gallery
// (BUILD_SPEC 8.1). Uses the page's upload queue, like the photo slot:
//
//   <FileSlot inspectionId={id} moduleKey="tensile" kind="lab_report" focus={focus} readOnly={readOnly}
//             canAdd={slot.addable}
//             onAdded={(file) => ...keep file.id in the module's data if it needs one}
//             onRemoved={(fileId) => ...and drop it when that file goes} />
//
//   const files = useInspectionFiles(id); // the files as a module's calc reads them (InspectionMeta.files)
//
// Source Documents pages its files: <FileSlot ... pageSize={FILES_PER_PAGE} /> (newest first, add controls pinned on top).
export { FileSlot, type FileSlotProps, type AddedFile } from "./file-slot";
export { FileList } from "./file-list";
export { FILES_PER_PAGE } from "./file-pages";
export { useInspectionFiles } from "./use-inspection-files";
