-- Remove the retired small heading from the saved public site settings.
update public.site_settings
set settings = settings - 'heroEyebrow',
    updated_at = now()
where settings ? 'heroEyebrow';
