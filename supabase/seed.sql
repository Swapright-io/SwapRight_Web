\copy public.university_domains(domain, institution_name, state, country_code, source) from 'supabase/seed/us_university_domains.csv' with (format csv, header true)
