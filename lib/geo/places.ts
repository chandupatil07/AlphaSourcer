/**
 * One place-name dataset for the whole pipeline.
 *
 * Three separate lists used to exist -- CITY_COUNTRY in relevance.ts, and
 * LOCATION_CITIES / LOCATION_COUNTRIES in parseSearchResult.ts -- each with a
 * different set of cities. A city present in one and missing from another
 * produces silent, hard-to-trace disagreements: a profile whose location the
 * parser can read but the filter does not recognise, or the reverse.
 *
 * Everything geographic now comes from here.
 */

/** Country names and the spellings people actually write, folded onto one key. */
export const COUNTRY_ALIASES: Record<string, string> = {
  india: 'india',
  bharat: 'india',
  'united states': 'united states',
  'united states of america': 'united states',
  usa: 'united states',
  us: 'united states',
  america: 'united states',
  'united kingdom': 'united kingdom',
  uk: 'united kingdom',
  britain: 'united kingdom',
  'great britain': 'united kingdom',
  england: 'united kingdom',
  scotland: 'united kingdom',
  wales: 'united kingdom',
  'northern ireland': 'united kingdom',
  canada: 'canada',
  australia: 'australia',
  singapore: 'singapore',
  germany: 'germany',
  deutschland: 'germany',
  france: 'france',
  netherlands: 'netherlands',
  holland: 'netherlands',
  ireland: 'ireland',
  japan: 'japan',
  china: 'china',
  'hong kong': 'hong kong',
  'united arab emirates': 'united arab emirates',
  uae: 'united arab emirates',
  'saudi arabia': 'saudi arabia',
  qatar: 'qatar',
  oman: 'oman',
  kuwait: 'kuwait',
  bahrain: 'bahrain',
  malaysia: 'malaysia',
  indonesia: 'indonesia',
  philippines: 'philippines',
  thailand: 'thailand',
  vietnam: 'vietnam',
  'sri lanka': 'sri lanka',
  bangladesh: 'bangladesh',
  nepal: 'nepal',
  pakistan: 'pakistan',
  poland: 'poland',
  spain: 'spain',
  italy: 'italy',
  portugal: 'portugal',
  sweden: 'sweden',
  norway: 'norway',
  denmark: 'denmark',
  finland: 'finland',
  switzerland: 'switzerland',
  austria: 'austria',
  belgium: 'belgium',
  israel: 'israel',
  turkey: 'turkey',
  'south africa': 'south africa',
  kenya: 'kenya',
  nigeria: 'nigeria',
  egypt: 'egypt',
  brazil: 'brazil',
  mexico: 'mexico',
  argentina: 'argentina',
  chile: 'chile',
  colombia: 'colombia',
  'new zealand': 'new zealand',
  'south korea': 'south korea',
  korea: 'south korea',
  taiwan: 'taiwan',
};

/** ISO 3166-1 alpha-2, for Serper's `gl` parameter. */
export const COUNTRY_GL: Record<string, string> = {
  india: 'in',
  'united states': 'us',
  'united kingdom': 'gb',
  canada: 'ca',
  australia: 'au',
  singapore: 'sg',
  germany: 'de',
  france: 'fr',
  netherlands: 'nl',
  ireland: 'ie',
  japan: 'jp',
  china: 'cn',
  'hong kong': 'hk',
  'united arab emirates': 'ae',
  'saudi arabia': 'sa',
  qatar: 'qa',
  oman: 'om',
  kuwait: 'kw',
  bahrain: 'bh',
  malaysia: 'my',
  indonesia: 'id',
  philippines: 'ph',
  thailand: 'th',
  vietnam: 'vn',
  'sri lanka': 'lk',
  bangladesh: 'bd',
  nepal: 'np',
  pakistan: 'pk',
  poland: 'pl',
  spain: 'es',
  italy: 'it',
  portugal: 'pt',
  sweden: 'se',
  norway: 'no',
  denmark: 'dk',
  finland: 'fi',
  switzerland: 'ch',
  austria: 'at',
  belgium: 'be',
  israel: 'il',
  turkey: 'tr',
  'south africa': 'za',
  kenya: 'ke',
  nigeria: 'ng',
  egypt: 'eg',
  brazil: 'br',
  mexico: 'mx',
  argentina: 'ar',
  chile: 'cl',
  colombia: 'co',
  'new zealand': 'nz',
  'south korea': 'kr',
  taiwan: 'tw',
};

/** States and union territories, used to anchor "City, State, Country" runs. */
export const INDIAN_REGIONS: string[] = [
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh',
  'goa', 'gujarat', 'haryana', 'himachal pradesh', 'jharkhand', 'karnataka',
  'kerala', 'madhya pradesh', 'maharashtra', 'manipur', 'meghalaya', 'mizoram',
  'nagaland', 'odisha', 'orissa', 'punjab', 'rajasthan', 'sikkim', 'tamil nadu',
  'telangana', 'tripura', 'uttar pradesh', 'uttarakhand', 'west bengal',
  'andaman and nicobar islands', 'chandigarh', 'dadra and nagar haveli',
  'daman and diu', 'delhi', 'jammu and kashmir', 'ladakh', 'lakshadweep',
  'puducherry', 'pondicherry', 'national capital region', 'ncr',
];

/**
 * Cities, mapped to the country key they sit in. Coverage matters directly:
 * a city missing here means the profile's location cannot be read, which is
 * recorded as unknown -- and an unknown location is never rejected, so it
 * reaches the recruiter looking exactly like a filtering failure.
 */
export const CITY_COUNTRY: Record<string, string> = {
  // --- India: metros, IT hubs, state capitals, larger tier-2 cities
  bangalore: 'india', bengaluru: 'india', mumbai: 'india', bombay: 'india',
  delhi: 'india', 'new delhi': 'india', noida: 'india', 'greater noida': 'india',
  gurgaon: 'india', gurugram: 'india', faridabad: 'india', ghaziabad: 'india',
  hyderabad: 'india', secunderabad: 'india', chennai: 'india', madras: 'india',
  pune: 'india', 'pimpri chinchwad': 'india', kolkata: 'india', calcutta: 'india',
  ahmedabad: 'india', gandhinagar: 'india', surat: 'india', vadodara: 'india',
  baroda: 'india', rajkot: 'india', jaipur: 'india', jodhpur: 'india',
  udaipur: 'india', kota: 'india', ajmer: 'india',
  kochi: 'india', cochin: 'india', ernakulam: 'india', kozhikode: 'india',
  calicut: 'india', thrissur: 'india', kollam: 'india',
  thiruvananthapuram: 'india', trivandrum: 'india',
  indore: 'india', bhopal: 'india', jabalpur: 'india', gwalior: 'india',
  ujjain: 'india',
  coimbatore: 'india', madurai: 'india', tiruchirappalli: 'india',
  trichy: 'india', salem: 'india', tirunelveli: 'india', erode: 'india',
  vellore: 'india', tiruppur: 'india',
  chandigarh: 'india', mohali: 'india', panchkula: 'india', ludhiana: 'india',
  amritsar: 'india', jalandhar: 'india', patiala: 'india',
  nagpur: 'india', nashik: 'india', aurangabad: 'india', solapur: 'india',
  kolhapur: 'india', thane: 'india', 'navi mumbai': 'india',
  bhubaneswar: 'india', cuttack: 'india', rourkela: 'india',
  mysuru: 'india', mysore: 'india', mangalore: 'india', mangaluru: 'india',
  hubli: 'india', hubballi: 'india', belgaum: 'india', belagavi: 'india',
  davangere: 'india',
  lucknow: 'india', kanpur: 'india', varanasi: 'india', banaras: 'india',
  agra: 'india', meerut: 'india', prayagraj: 'india', allahabad: 'india',
  bareilly: 'india', aligarh: 'india', moradabad: 'india', gorakhpur: 'india',
  patna: 'india', gaya: 'india', muzaffarpur: 'india',
  ranchi: 'india', jamshedpur: 'india', dhanbad: 'india', bokaro: 'india',
  raipur: 'india', bhilai: 'india', bilaspur: 'india',
  guwahati: 'india', dibrugarh: 'india', silchar: 'india',
  dehradun: 'india', haridwar: 'india', roorkee: 'india',
  shimla: 'india', jammu: 'india', srinagar: 'india',
  visakhapatnam: 'india', vizag: 'india', vijayawada: 'india',
  guntur: 'india', tirupati: 'india', nellore: 'india', warangal: 'india',
  siliguri: 'india', durgapur: 'india', asansol: 'india', howrah: 'india',
  goa: 'india', panaji: 'india',
  puducherry: 'india', pondicherry: 'india',
  imphal: 'india', shillong: 'india', aizawl: 'india', kohima: 'india',
  itanagar: 'india', agartala: 'india', gangtok: 'india',

  // --- United States
  'new york': 'united states', 'new york city': 'united states', nyc: 'united states',
  brooklyn: 'united states', manhattan: 'united states',
  'san francisco': 'united states', 'san jose': 'united states',
  'palo alto': 'united states', 'mountain view': 'united states',
  sunnyvale: 'united states', cupertino: 'united states', 'santa clara': 'united states',
  oakland: 'united states', berkeley: 'united states', fremont: 'united states',
  seattle: 'united states', bellevue: 'united states', redmond: 'united states',
  portland: 'united states',
  austin: 'united states', dallas: 'united states', houston: 'united states',
  'san antonio': 'united states', plano: 'united states', irving: 'united states',
  chicago: 'united states', boston: 'united states', cambridge: 'united states',
  atlanta: 'united states', miami: 'united states', orlando: 'united states',
  tampa: 'united states', denver: 'united states', boulder: 'united states',
  phoenix: 'united states', 'las vegas': 'united states',
  'los angeles': 'united states', 'san diego': 'united states',
  sacramento: 'united states', 'santa monica': 'united states', irvine: 'united states',
  philadelphia: 'united states', pittsburgh: 'united states',
  detroit: 'united states', minneapolis: 'united states', columbus: 'united states',
  cleveland: 'united states', cincinnati: 'united states', indianapolis: 'united states',
  nashville: 'united states', charlotte: 'united states', raleigh: 'united states',
  durham: 'united states', 'washington dc': 'united states',
  arlington: 'united states', baltimore: 'united states', 'salt lake city': 'united states',
  'kansas city': 'united states', 'st louis': 'united states', milwaukee: 'united states',
  richmond: 'united states', jacksonville: 'united states',
  princeton: 'united states', stamford: 'united states', hartford: 'united states',
  lynchburg: 'united states', charleston: 'united states', huntington: 'united states',
  farmingdale: 'united states',

  // --- United Kingdom
  london: 'united kingdom', manchester: 'united kingdom', birmingham: 'united kingdom',
  leeds: 'united kingdom', liverpool: 'united kingdom', bristol: 'united kingdom',
  edinburgh: 'united kingdom', glasgow: 'united kingdom', cardiff: 'united kingdom',
  belfast: 'united kingdom', sheffield: 'united kingdom', nottingham: 'united kingdom',
  leicester: 'united kingdom', newcastle: 'united kingdom', oxford: 'united kingdom',
  reading: 'united kingdom', brighton: 'united kingdom', southampton: 'united kingdom',
  coventry: 'united kingdom', lanark: 'united kingdom',

  // --- Canada
  toronto: 'canada', vancouver: 'canada', montreal: 'canada', calgary: 'canada',
  ottawa: 'canada', edmonton: 'canada', waterloo: 'canada', mississauga: 'canada',
  winnipeg: 'canada', halifax: 'canada',

  // --- Australia and New Zealand
  sydney: 'australia', melbourne: 'australia', brisbane: 'australia',
  perth: 'australia', adelaide: 'australia', canberra: 'australia',
  auckland: 'new zealand', wellington: 'new zealand', christchurch: 'new zealand',

  // --- Middle East
  dubai: 'united arab emirates', 'abu dhabi': 'united arab emirates',
  sharjah: 'united arab emirates', riyadh: 'saudi arabia', jeddah: 'saudi arabia',
  dammam: 'saudi arabia', doha: 'qatar', muscat: 'oman', manama: 'bahrain',
  'kuwait city': 'kuwait',

  // --- Asia Pacific
  singapore: 'singapore', 'kuala lumpur': 'malaysia', penang: 'malaysia',
  jakarta: 'indonesia', bangkok: 'thailand', manila: 'philippines',
  cebu: 'philippines', hanoi: 'vietnam', 'ho chi minh city': 'vietnam',
  colombo: 'sri lanka', dhaka: 'bangladesh', kathmandu: 'nepal',
  karachi: 'pakistan', lahore: 'pakistan', islamabad: 'pakistan',
  tokyo: 'japan', osaka: 'japan', kyoto: 'japan',
  shanghai: 'china', beijing: 'china', shenzhen: 'china', guangzhou: 'china',
  'hong kong': 'hong kong', taipei: 'taiwan', seoul: 'south korea',

  // --- Europe
  berlin: 'germany', munich: 'germany', hamburg: 'germany', frankfurt: 'germany',
  cologne: 'germany', stuttgart: 'germany',
  paris: 'france', lyon: 'france', toulouse: 'france', marseille: 'france',
  amsterdam: 'netherlands', rotterdam: 'netherlands', eindhoven: 'netherlands',
  utrecht: 'netherlands',
  dublin: 'ireland', cork: 'ireland', galway: 'ireland',
  madrid: 'spain', barcelona: 'spain', valencia: 'spain',
  lisbon: 'portugal', porto: 'portugal',
  milan: 'italy', rome: 'italy', turin: 'italy',
  warsaw: 'poland', krakow: 'poland', wroclaw: 'poland',
  stockholm: 'sweden', gothenburg: 'sweden', oslo: 'norway',
  copenhagen: 'denmark', helsinki: 'finland',
  zurich: 'switzerland', geneva: 'switzerland', basel: 'switzerland',
  vienna: 'austria', brussels: 'belgium', antwerp: 'belgium',
  istanbul: 'turkey', ankara: 'turkey', 'tel aviv': 'israel', jerusalem: 'israel',

  // --- Africa and the Americas
  johannesburg: 'south africa', 'cape town': 'south africa',
  durban: 'south africa', pretoria: 'south africa',
  nairobi: 'kenya', lagos: 'nigeria', abuja: 'nigeria', cairo: 'egypt',
  'sao paulo': 'brazil', 'rio de janeiro': 'brazil',
  'mexico city': 'mexico', guadalajara: 'mexico',
  'buenos aires': 'argentina', santiago: 'chile', bogota: 'colombia',
};

/** Two spellings of the same place, so a match on one accepts the other. */
export const CITY_ALIASES: Record<string, string[]> = {
  bangalore: ['bengaluru'], bengaluru: ['bangalore'],
  mumbai: ['bombay'], bombay: ['mumbai'],
  gurgaon: ['gurugram'], gurugram: ['gurgaon'],
  delhi: ['new delhi'], 'new delhi': ['delhi'],
  chennai: ['madras'], madras: ['chennai'],
  kolkata: ['calcutta'], calcutta: ['kolkata'],
  kochi: ['cochin', 'ernakulam'], cochin: ['kochi', 'ernakulam'],
  ernakulam: ['kochi', 'cochin'],
  vadodara: ['baroda'], baroda: ['vadodara'],
  mysuru: ['mysore'], mysore: ['mysuru'],
  mangalore: ['mangaluru'], mangaluru: ['mangalore'],
  hubli: ['hubballi'], hubballi: ['hubli'],
  belgaum: ['belagavi'], belagavi: ['belgaum'],
  thiruvananthapuram: ['trivandrum'], trivandrum: ['thiruvananthapuram'],
  prayagraj: ['allahabad'], allahabad: ['prayagraj'],
  visakhapatnam: ['vizag'], vizag: ['visakhapatnam'],
  varanasi: ['banaras'], banaras: ['varanasi'],
  tiruchirappalli: ['trichy'], trichy: ['tiruchirappalli'],
  kozhikode: ['calicut'], calicut: ['kozhikode'],
  puducherry: ['pondicherry'], pondicherry: ['puducherry'],
  'new york': ['new york city', 'nyc'], 'new york city': ['new york', 'nyc'],
};

export const CITY_NAMES: string[] = Object.keys(CITY_COUNTRY);
export const COUNTRY_NAMES: string[] = Object.keys(COUNTRY_ALIASES);

const tidy = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** Folds spelling variants onto one country key. Returns null when unknown. */
export function canonicalCountry(value: string): string | null {
  return COUNTRY_ALIASES[tidy(value)] ?? null;
}

/** The country a place sits in, whether it is a city, a region or a country. */
export function countryOfPlace(value: string): string | null {
  const key = tidy(value);
  if (!key) return null;
  const asCountry = canonicalCountry(key);
  if (asCountry) return asCountry;
  if (CITY_COUNTRY[key]) return CITY_COUNTRY[key];
  if (INDIAN_REGIONS.includes(key)) return 'india';
  return null;
}
