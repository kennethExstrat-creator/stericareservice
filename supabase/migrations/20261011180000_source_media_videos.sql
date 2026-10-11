-- Source Documents, Media (docs/AI.md): the inspection's photos and videos
-- are uploaded on the first step; videos are inspection_files with
-- module_key 'source_media'. The file bucket takes phone videos too (MP4,
-- an iPhone's QuickTime movie, WebM), within its 50 MB limit. Idempotent.
update storage.buckets
   set allowed_mime_types = array[
     'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
     'video/mp4', 'video/quicktime', 'video/webm'
   ]
 where id = 'inspection-files';
