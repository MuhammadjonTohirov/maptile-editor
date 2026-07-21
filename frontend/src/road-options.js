// One frontend catalog for every road-class control. Values deliberately
// mirror backend/road_catalog.py; the API remains the enforcement boundary.
const ROAD_TYPE_GROUPS = [
  {
    labelKey: 'roadGroupMajor',
    options: [
      ['motorway', 'roadMotorway'], ['motorway_link', 'roadMotorwayLink'],
      ['trunk', 'roadTrunk'], ['trunk_link', 'roadTrunkLink'],
      ['primary', 'roadPrimary'], ['primary_link', 'roadPrimaryLink'],
      ['secondary', 'roadSecondary'], ['secondary_link', 'roadSecondaryLink'],
      ['tertiary', 'roadTertiary'], ['tertiary_link', 'roadTertiaryLink'],
    ],
  },
  {
    labelKey: 'roadGroupLocal',
    options: [
      ['residential', 'roadResidential'], ['living_street', 'roadLivingStreet'],
      ['unclassified', 'roadUnclassified'], ['service', 'roadService'],
      ['track', 'roadTrack'],
    ],
  },
  {
    labelKey: 'roadGroupNonCar',
    options: [
      ['pedestrian', 'roadPedestrian'], ['cycleway', 'roadCycleway'],
      ['footway', 'roadFootway'], ['path', 'roadPath'], ['steps', 'roadSteps'],
    ],
  },
];

const SURFACE_OPTIONS = [
  ['', 'optionUnspecified'], ['asphalt', 'surfaceAsphalt'],
  ['concrete', 'surfaceConcrete'], ['paving_stones', 'surfacePavingStones'],
  ['cobblestone', 'surfaceCobblestone'], ['compacted', 'surfaceCompacted'],
  ['gravel', 'surfaceGravel'], ['fine_gravel', 'surfaceFineGravel'],
  ['dirt', 'surfaceDirt'], ['ground', 'surfaceGround'], ['unpaved', 'surfaceUnpaved'],
];

const LANE_OPTIONS = ['', '1', '2', '3', '4', '5', '6', '7', '8'];

export const VEHICLE_ROAD_TYPES = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link',
  'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'residential', 'living_street',
  'unclassified', 'service', 'track',
]);

export const DEFAULT_SPEED_BY_ROAD_TYPE = {
  motorway: 110, motorway_link: 60,
  trunk: 90, trunk_link: 60,
  primary: 70, primary_link: 50,
  secondary: 60, secondary_link: 50,
  tertiary: 50, tertiary_link: 40,
  unclassified: 40, residential: 30, living_street: 20,
  service: 20, track: 20,
};

export function isVehicleRoadType(roadType) {
  return VEHICLE_ROAD_TYPES.has(roadType);
}

export function updateRoadSpeedControl(elements, roadType, { applyDefault = false } = {}) {
  const input = elements['max-speed'];
  const field = elements['max-speed-field'];
  const vehicleRoad = isVehicleRoadType(roadType);
  if (field) field.hidden = !vehicleRoad;
  input.disabled = !vehicleRoad;
  if (!vehicleRoad && applyDefault) input.value = '';
  const nextDefault = DEFAULT_SPEED_BY_ROAD_TYPE[roadType];
  const previousDefault = input.dataset.defaultSpeed;
  if (vehicleRoad && applyDefault
    && (!input.value || (previousDefault && input.value === previousDefault))) {
    input.value = String(nextDefault);
  }
  input.dataset.defaultSpeed = nextDefault == null ? '' : String(nextDefault);
}

function populateRoadTypeSelect(select, translate) {
  const placeholder = new Option(translate('selectRoadClass'), '');
  placeholder.disabled = true;
  select.replaceChildren(placeholder);
  for (const group of ROAD_TYPE_GROUPS) {
    const optionGroup = document.createElement('optgroup');
    optionGroup.label = translate(group.labelKey);
    optionGroup.append(...group.options.map(([value, labelKey]) =>
      new Option(translate(labelKey), value)));
    select.append(optionGroup);
  }
  select.value = '';
}

function populateScalarSelect(select, values, translate) {
  select.replaceChildren(...values.map((value) =>
    new Option(value || translate('optionUnspecified'), value)));
}

export function populateRoadControls(elements, translate) {
  populateRoadTypeSelect(elements['new-road-type'], translate);
  populateRoadTypeSelect(elements['road-type'], translate);
  populateScalarSelect(elements['lane-count'], LANE_OPTIONS, translate);
  elements['road-surface'].replaceChildren(...SURFACE_OPTIONS.map(([value, labelKey]) =>
    new Option(translate(labelKey), value)));
}

export function setControlledSelectValue(select, value, translate) {
  const normalized = value == null ? '' : String(value);
  if (normalized && ![...select.options].some((option) => option.value === normalized)) {
    // An uncommon OSM value can round-trip but cannot be typed into a new
    // manual road. The backend applies the same unchanged-value exception.
    select.append(new Option(translate('roadImportedValue', { value: normalized }), normalized));
  }
  select.value = normalized;
}
