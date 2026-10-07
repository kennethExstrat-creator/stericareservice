// Lab reports and certificates on the capture screen and in the gallery
// (BUILD_SPEC 8.1). Uses the page's upload queue, like the photo slot:
//
//   <FileSlot inspectionId={id} moduleKey="tensile" kind="lab_report" focus={focus} readOnly={readOnly}
//             onAdded={(file) => ...keep file.id in the module's data if it needs one} />
export { FileSlot, type FileSlotProps, type AddedFile } from "./file-slot";
export { FileList } from "./file-list";
