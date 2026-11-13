CREATE POLICY "training public read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'training-dataset');
CREATE POLICY "training public upload" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'training-dataset');
CREATE POLICY "training public delete" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'training-dataset');