-- Source Documents read Excel and CSV files (docs/AI.md, "Source Documents";
-- Kenneth, 26 October 2026: "make the source document to support excel and
-- csv file reading"). The file bucket keeps every type it took (PDF, the
-- photo types, phone videos: 20261011180000) and takes spreadsheets too:
-- .xlsx, .xls and CSV, uploaded with their own type (FILE_TYPES in
-- lib/photos/paths.ts), within its 50 MB limit. Idempotent.
update storage.buckets
   set allowed_mime_types = array[
     'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
     'video/mp4', 'video/quicktime', 'video/webm',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'
   ]
 where id = 'inspection-files';
