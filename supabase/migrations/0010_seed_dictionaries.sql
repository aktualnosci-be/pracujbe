-- =============================================================================
-- 0010_seed_dictionaries.sql
-- Pracuj.be — dane słownikowe (referencyjne, NIE demo).
--
-- Wypełnia: categories (10), locations (10 miast BE), languages, occupations,
-- skills, certificates. To dane produkcyjne (is_demo=false) — etykiety `name`
-- to wartości domyślne; UI i tak tłumaczy je przez next-intl (klucz = key/slug/code).
--
-- Idempotencja: INSERT ... ON CONFLICT (klucz naturalny) DO UPDATE — bezpieczne
-- przy ponownym uruchomieniu; nazwy/porządek aktualizują się do wartości z seeda.
-- Kolejność: categories najpierw (occupations/skills mają FK do categories.key).
-- =============================================================================

-- =============================================================================
-- categories — 10 kluczy zgodnych z enum job_category / kontraktem CategoryKey.
-- icon = nazwa ikony (lucide) używana przez UI.
-- =============================================================================
insert into public.categories (key, name, icon, sort_order, is_active, is_demo) values
  ('construction', 'Construction',  'hard-hat',     10, true, false),
  ('transport',    'Transport',     'truck',        20, true, false),
  ('warehouse',    'Warehouse',     'package',      30, true, false),
  ('production',   'Production',     'factory',      40, true, false),
  ('technical',    'Technical',     'wrench',       50, true, false),
  ('cleaning',     'Cleaning',      'spray-can',    60, true, false),
  ('hospitality',  'Hospitality',   'utensils',     70, true, false),
  ('care',         'Care',          'heart-pulse',  80, true, false),
  ('logistics',    'Logistics',     'boxes',        90, true, false),
  ('seasonal',     'Seasonal',      'sun',         100, true, false)
on conflict (key) do update
  set name       = excluded.name,
      icon       = excluded.icon,
      sort_order = excluded.sort_order,
      is_active  = excluded.is_active,
      updated_at = now();

-- =============================================================================
-- locations — 10 belgijskich miast z regionem (Flanders / Wallonia / Brussels-Capital)
-- i prowincją. Klucz slug = LocationKey z kontraktu. Współrzędne przybliżone (centrum).
-- =============================================================================
insert into public.locations (slug, name, region, province, country, latitude, longitude, sort_order, is_active, is_demo) values
  ('brussels',  'Brussels',  'Brussels-Capital', 'Brussels-Capital', 'BE', 50.850300, 4.351700,  10, true, false),
  ('antwerp',   'Antwerp',   'Flanders',         'Antwerp',          'BE', 51.219400, 4.402500,  20, true, false),
  ('ghent',     'Ghent',     'Flanders',         'East Flanders',    'BE', 51.054100, 3.717200,  30, true, false),
  ('leuven',    'Leuven',    'Flanders',         'Flemish Brabant',  'BE', 50.879600, 4.700500,  40, true, false),
  ('mechelen',  'Mechelen',  'Flanders',         'Antwerp',          'BE', 51.028100, 4.477600,  50, true, false),
  ('hasselt',   'Hasselt',   'Flanders',         'Limburg',          'BE', 50.930600, 5.337800,  60, true, false),
  ('liege',     'Liège',     'Wallonia',         'Liège',            'BE', 50.632600, 5.579700,  70, true, false),
  ('charleroi', 'Charleroi', 'Wallonia',         'Hainaut',          'BE', 50.411300, 4.444500,  80, true, false),
  ('bruges',    'Bruges',    'Flanders',         'West Flanders',    'BE', 51.209700, 3.224700,  90, true, false),
  ('kortrijk',  'Kortrijk',  'Flanders',         'West Flanders',    'BE', 50.828200, 3.264900, 100, true, false)
on conflict (slug) do update
  set name       = excluded.name,
      region     = excluded.region,
      province   = excluded.province,
      country    = excluded.country,
      latitude   = excluded.latitude,
      longitude  = excluded.longitude,
      sort_order = excluded.sort_order,
      is_active  = excluded.is_active,
      updated_at = now();

-- =============================================================================
-- languages — języki wymagań ofert / profili. Kolejność: rynek pracy w Belgii
-- (nl/fr/en) + Polonia (pl) na górze, dalej najczęstsze języki migracji zarobkowej.
-- =============================================================================
insert into public.languages (code, name, sort_order, is_active, is_demo) values
  ('pl', 'Polish',     10, true, false),
  ('nl', 'Dutch',      20, true, false),
  ('fr', 'French',     30, true, false),
  ('en', 'English',    40, true, false),
  ('de', 'German',     50, true, false),
  ('ro', 'Romanian',   60, true, false),
  ('bg', 'Bulgarian',  70, true, false),
  ('uk', 'Ukrainian',  80, true, false),
  ('ru', 'Russian',    90, true, false),
  ('es', 'Spanish',   100, true, false),
  ('it', 'Italian',   110, true, false),
  ('pt', 'Portuguese',120, true, false),
  ('tr', 'Turkish',   130, true, false),
  ('ar', 'Arabic',    140, true, false)
on conflict (code) do update
  set name       = excluded.name,
      sort_order = excluded.sort_order,
      is_active  = excluded.is_active,
      updated_at = now();

-- =============================================================================
-- occupations — przykładowe zawody przypięte do kategorii (category_key -> categories.key).
-- =============================================================================
insert into public.occupations (slug, name, category_key, sort_order, is_active, is_demo) values
  -- construction
  ('bricklayer',            'Bricklayer',              'construction', 10, true, false),
  ('carpenter',             'Carpenter',               'construction', 20, true, false),
  ('painter-decorator',     'Painter / Decorator',     'construction', 30, true, false),
  ('plumber',               'Plumber',                 'construction', 40, true, false),
  ('electrician',           'Electrician',             'construction', 50, true, false),
  ('roofer',                'Roofer',                  'construction', 60, true, false),
  ('plasterer',             'Plasterer',               'construction', 70, true, false),
  ('tiler',                 'Tiler',                   'construction', 80, true, false),
  -- transport
  ('truck-driver',          'Truck Driver (C/C+E)',    'transport',    10, true, false),
  ('delivery-driver',       'Delivery Driver',         'transport',    20, true, false),
  ('bus-driver',            'Bus Driver',              'transport',    30, true, false),
  -- warehouse
  ('warehouse-worker',      'Warehouse Worker',        'warehouse',    10, true, false),
  ('order-picker',          'Order Picker',            'warehouse',    20, true, false),
  ('forklift-operator',     'Forklift Operator',       'warehouse',    30, true, false),
  -- production
  ('production-operator',   'Production Operator',      'production',   10, true, false),
  ('assembler',             'Assembler',               'production',   20, true, false),
  ('machine-operator',      'Machine Operator',        'production',   30, true, false),
  -- technical
  ('welder',                'Welder',                  'technical',    10, true, false),
  ('mechanic',              'Mechanic',                'technical',    20, true, false),
  ('maintenance-technician','Maintenance Technician',  'technical',    30, true, false),
  ('cnc-operator',          'CNC Operator',            'technical',    40, true, false),
  -- cleaning
  ('cleaner',               'Cleaner',                 'cleaning',     10, true, false),
  ('industrial-cleaner',    'Industrial Cleaner',      'cleaning',     20, true, false),
  -- hospitality
  ('kitchen-porter',        'Kitchen Porter',          'hospitality',  10, true, false),
  ('waiter',                'Waiter / Waitress',       'hospitality',  20, true, false),
  ('cook',                  'Cook',                    'hospitality',  30, true, false),
  ('housekeeper',           'Housekeeper',             'hospitality',  40, true, false),
  -- care
  ('caregiver',             'Caregiver',               'care',         10, true, false),
  ('nurse-assistant',       'Nurse Assistant',         'care',         20, true, false),
  -- logistics
  ('logistics-coordinator', 'Logistics Coordinator',   'logistics',    10, true, false),
  ('dispatcher',            'Dispatcher',              'logistics',    20, true, false),
  -- seasonal
  ('fruit-picker',          'Fruit Picker',            'seasonal',     10, true, false),
  ('harvest-worker',        'Harvest Worker',          'seasonal',     20, true, false)
on conflict (slug) do update
  set name         = excluded.name,
      category_key = excluded.category_key,
      sort_order   = excluded.sort_order,
      is_active    = excluded.is_active,
      updated_at   = now();

-- =============================================================================
-- skills — przykładowe umiejętności (opcjonalnie przypięte do kategorii).
-- =============================================================================
insert into public.skills (slug, name, category_key, is_active, is_demo) values
  -- construction
  ('reading-blueprints',  'Reading Blueprints',        'construction', true, false),
  ('formwork',            'Formwork',                  'construction', true, false),
  ('masonry',             'Masonry',                   'construction', true, false),
  ('drywall',             'Drywall Installation',      'construction', true, false),
  ('scaffolding',         'Scaffolding',               'construction', true, false),
  -- transport
  ('tachograph',          'Tachograph Operation',      'transport',    true, false),
  ('route-navigation',    'Route Navigation',          'transport',    true, false),
  -- warehouse
  ('order-picking',       'Order Picking',             'warehouse',    true, false),
  ('inventory-management','Inventory Management',      'warehouse',    true, false),
  ('wms-systems',         'WMS Systems',               'warehouse',    true, false),
  ('reach-truck',         'Reach Truck Operation',     'warehouse',    true, false),
  -- production
  ('assembly-line',       'Assembly Line Work',        'production',   true, false),
  ('quality-control',     'Quality Control',           'production',   true, false),
  ('machine-setup',       'Machine Setup',             'production',   true, false),
  -- technical
  ('welding-mig-mag',     'MIG/MAG Welding',           'technical',    true, false),
  ('welding-tig',         'TIG Welding',               'technical',    true, false),
  ('hydraulics',          'Hydraulics',                'technical',    true, false),
  ('pneumatics',          'Pneumatics',                'technical',    true, false),
  ('plc-programming',     'PLC Programming',           'technical',    true, false),
  -- cleaning
  ('floor-machines',      'Floor Cleaning Machines',   'cleaning',     true, false),
  ('disinfection',        'Disinfection',              'cleaning',     true, false),
  -- hospitality
  ('food-preparation',    'Food Preparation',          'hospitality',  true, false),
  ('customer-service',    'Customer Service',          'hospitality',  true, false),
  -- care
  ('patient-care',        'Patient Care',              'care',         true, false),
  ('mobility-assistance', 'Mobility Assistance',       'care',         true, false),
  -- logistics
  ('route-planning',      'Route Planning',            'logistics',    true, false),
  ('supply-chain',        'Supply Chain Coordination', 'logistics',    true, false),
  -- ogólne (bez kategorii)
  ('teamwork',            'Teamwork',                  null,           true, false),
  ('physical-fitness',    'Physical Fitness',          null,           true, false),
  ('shift-work',          'Shift Work Availability',   null,           true, false)
on conflict (slug) do update
  set name         = excluded.name,
      category_key = excluded.category_key,
      is_active    = excluded.is_active,
      updated_at   = now();

-- =============================================================================
-- certificates — formalne uprawnienia/certyfikaty istotne na rynku belgijskim.
-- =============================================================================
insert into public.certificates (slug, name, is_active, is_demo) values
  ('vca',                  'VCA (Safety) Certificate',        true, false),
  ('vca-vol',              'VCA VOL (Supervisors)',           true, false),
  ('code-95',              'Code 95 (Driver CPC)',            true, false),
  ('adr',                  'ADR (Dangerous Goods)',           true, false),
  ('forklift-license',     'Forklift License',                true, false),
  ('reach-truck-license',  'Reach Truck License',             true, false),
  ('driving-license-b',    'Driving License B',               true, false),
  ('driving-license-ce',   'Driving License C+E',             true, false),
  ('first-aid',            'First Aid / EHBO',                true, false),
  ('haccp',                'HACCP (Food Safety)',             true, false),
  ('ba4-ba5',              'BA4/BA5 (Electrical Safety)',     true, false),
  ('working-at-height',    'Working at Height',               true, false),
  ('asbestos-awareness',   'Asbestos Awareness',              true, false)
on conflict (slug) do update
  set name       = excluded.name,
      is_active  = excluded.is_active,
      updated_at = now();
