// The standard address used by every panel: a barangay of Tuguegarao City from the official list,
// a street from that barangay's list (lib/server/streets.js), and an optional house, building or
// unit number. The city, province and zip code are fixed, because Onetap serves Tuguegarao only.
// Shared by the forms and the server, so both apply the same rules.

export const CITY = { city: 'Tuguegarao City', province: 'Cagayan', zip: '3500', country: 'Philippines' };

// The 49 barangays of Tuguegarao City, as the Philippine Standard Geographic Code names them.
export const BARANGAYS = [
  'Annafunan East', 'Annafunan West', 'Atulayan Norte', 'Atulayan Sur', 'Bagay', 'Buntun', 'Caggay', 'Capatan',
  'Carig Norte', 'Carig Sur', 'Caritan Centro', 'Caritan Norte', 'Caritan Sur',
  'Cataggaman Nuevo', 'Cataggaman Pardo', 'Cataggaman Viejo',
  'Centro 01 (Bagumbayan)', 'Centro 02', 'Centro 03', 'Centro 04', 'Centro 05 (Bagumbayan)', 'Centro 06', 'Centro 07',
  'Centro 08', 'Centro 09 (Bagumbayan)', 'Centro 10 (Riverside)', 'Centro 11 (Balzain East)', 'Centro 12 (Balzain West)',
  'Dadda', 'Gosi Norte', 'Gosi Sur', 'Larion Alto', 'Larion Bajo', 'Leonarda', 'Libag Norte', 'Libag Sur',
  'Linao East', 'Linao Norte', 'Linao West', 'Namabbalan Norte', 'Namabbalan Sur', 'Pallua Norte', 'Pallua Sur',
  'Pengue-Ruyu', 'San Gabriel', 'Tagga', 'Tanza', 'Ugac Norte', 'Ugac Sur',
];

export const HOUSE_NUMBER_MAX = 40;
export const STREET_NAME_MAX = 80;
// Letters (any language), digits, spaces and the punctuation street names use.
export const STREET_NAME_PATTERN = "[\\p{L}\\p{N} .,'()&/#-]{2,80}";

export const isBarangay = (value) => BARANGAYS.includes(value);

// One line for labels, lists and waybills: "12B Rizal Street, Centro 01 (Bagumbayan), Tuguegarao City,
// Cagayan 3500". Older free-text addresses (no houseNumber) read the same way.
export function formatAddress(address) {
  if (!address) return '';
  const line = [address.houseNumber, address.street].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  const place = [address.city, [address.province, address.zip].filter(Boolean).join(' ')].filter(Boolean);
  return [line, address.barangay, ...place].filter(Boolean).join(', ');
}

// The address fields every panel uses, as a schema section. `values` fills them in, but only when
// the saved barangay is on the official list: older free-text addresses start empty, so they are
// entered again in the new format.
export function addressSection(legend, values) {
  const standard = isBarangay(values?.barangay);
  return {
    legend,
    address: true,
    fields: [
      { name: 'barangay', label: 'Barangay', type: 'barangay', options: BARANGAYS, value: standard ? values.barangay : '' },
      { name: 'street', label: 'Street', type: 'street', maxlength: STREET_NAME_MAX, value: standard ? values?.street || '' : '' },
      { name: 'houseNumber', label: 'House / Building / Unit No.', optional: true, maxlength: HOUSE_NUMBER_MAX, placeholder: 'e.g., 12B, Unit 3 Rizal Bldg', value: standard ? values?.houseNumber || '' : '' },
      { name: 'city', label: 'City', type: 'fixed', options: [CITY.city], value: CITY.city },
      { name: 'province', label: 'Province', type: 'fixed', options: [CITY.province], value: CITY.province },
      { name: 'zip', label: 'Zip Code', type: 'fixed', options: [CITY.zip], value: CITY.zip },
    ],
  };
}
