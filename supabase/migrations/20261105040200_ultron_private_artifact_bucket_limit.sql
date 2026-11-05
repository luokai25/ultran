update storage.buckets
set public = false,
    file_size_limit = 52428800
where id = 'ultron-private';
