/** Country → state/region → cities for the tour address form. */

export const COUNTRY_LOCATIONS: Record<string, Record<string, string[]>> = {
  India: {
    'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Tirupati', 'Nellore'],
    'Arunachal Pradesh': ['Itanagar', 'Naharlagun', 'Tawang'],
    Assam: ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat'],
    Bihar: ['Patna', 'Gaya', 'Muzaffarpur', 'Bhagalpur'],
    Chhattisgarh: ['Raipur', 'Bhilai', 'Bilaspur', 'Korba'],
    Goa: ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa'],
    Gujarat: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Gandhinagar'],
    Haryana: ['Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Karnal'],
    'Himachal Pradesh': ['Shimla', 'Dharamshala', 'Solan', 'Mandi'],
    Jharkhand: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro'],
    Karnataka: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Belagavi'],
    Kerala: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur'],
    'Madhya Pradesh': ['Bhopal', 'Indore', 'Gwalior', 'Jabalpur', 'Ujjain'],
    Maharashtra: ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Thane', 'Aurangabad'],
    Manipur: ['Imphal', 'Thoubal'],
    Meghalaya: ['Shillong', 'Tura'],
    Mizoram: ['Aizawl', 'Lunglei'],
    Nagaland: ['Kohima', 'Dimapur'],
    Odisha: ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Puri'],
    Punjab: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Mohali'],
    Rajasthan: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer'],
    Sikkim: ['Gangtok', 'Namchi'],
    'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem'],
    Telangana: ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar'],
    Tripura: ['Agartala', 'Udaipur'],
    'Uttar Pradesh': ['Lucknow', 'Noida', 'Ghaziabad', 'Kanpur', 'Varanasi', 'Agra'],
    Uttarakhand: ['Dehradun', 'Haridwar', 'Haldwani', 'Rishikesh'],
    'West Bengal': ['Kolkata', 'Howrah', 'Siliguri', 'Durgapur', 'Asansol'],
    Delhi: ['New Delhi', 'Delhi'],
    Chandigarh: ['Chandigarh'],
    'Jammu and Kashmir': ['Srinagar', 'Jammu'],
    Ladakh: ['Leh', 'Kargil'],
    Puducherry: ['Puducherry'],
  },
  USA: {
    California: ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento'],
    Texas: ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth'],
    'New York': ['New York City', 'Buffalo', 'Rochester', 'Albany', 'Syracuse'],
    Florida: ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale'],
    Illinois: ['Chicago', 'Springfield', 'Naperville', 'Peoria'],
    Washington: ['Seattle', 'Spokane', 'Tacoma', 'Bellevue'],
    Georgia: ['Atlanta', 'Savannah', 'Augusta', 'Columbus'],
    Arizona: ['Phoenix', 'Scottsdale', 'Tucson', 'Mesa'],
    Massachusetts: ['Boston', 'Cambridge', 'Worcester', 'Springfield'],
    Colorado: ['Denver', 'Colorado Springs', 'Boulder', 'Aurora'],
  },
  Dubai: {
    Dubai: ['Dubai', 'Jumeirah', 'Deira', 'Business Bay', 'Dubai Marina', 'Palm Jumeirah'],
    'Abu Dhabi': ['Abu Dhabi', 'Al Ain', 'Khalifa City'],
    Sharjah: ['Sharjah', 'Al Nahda', 'Muwaileh'],
    Ajman: ['Ajman'],
    'Ras Al Khaimah': ['Ras Al Khaimah'],
  },
  UK: {
    England: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Liverpool', 'Bristol', 'Oxford'],
    Scotland: ['Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee'],
    Wales: ['Cardiff', 'Swansea', 'Newport', 'Wrexham'],
    'Northern Ireland': ['Belfast', 'Derry', 'Lisburn'],
  },
  Australia: {
    'New South Wales': ['Sydney', 'Newcastle', 'Wollongong', 'Central Coast'],
    Victoria: ['Melbourne', 'Geelong', 'Ballarat', 'Bendigo'],
    Queensland: ['Brisbane', 'Gold Coast', 'Cairns', 'Townsville'],
    'Western Australia': ['Perth', 'Fremantle', 'Bunbury'],
    'South Australia': ['Adelaide', 'Mount Gambier', 'Whyalla'],
    Tasmania: ['Hobart', 'Launceston', 'Devonport'],
    ACT: ['Canberra'],
  },
}

export const COUNTRIES = Object.keys(COUNTRY_LOCATIONS)

export function statesForCountry(country: string): string[] {
  return Object.keys(COUNTRY_LOCATIONS[country] ?? {})
}

export function citiesForState(country: string, state: string): string[] {
  return COUNTRY_LOCATIONS[country]?.[state] ?? []
}
