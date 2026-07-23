import {
  isVehicleRoadType,
  populateRoadControls,
  setControlledSelectValue,
  updateRoadSpeedControl,
} from './road-options.js';

// Feature columns are canonical on the server. Only values outside this list
// belong in the JSONB properties object sent back to the API.
const COLUMN_KEYS = new Set([
  'name', 'description', 'icon', 'building_type', 'building_number',
  'road_type', 'direction', 'lane_count', 'max_speed', 'surface',
  'source_kind', 'feature_type', 'osm_id', 'osm_type', 'height_m',
    'business_type', 'building_id', 'created_by', 'updated_by',
    'created_at', 'updated_at',
]);

const FORM_FIELDS = [
  'feature-name', 'feature-description', 'feature-icon', 'building-type',
  'building-number', 'building-height', 'road-type', 'road-access', 'road-direction',
  'lane-count', 'max-speed', 'road-surface', 'business-type',
  'business-floor', 'business-phone', 'business-hours',
];

const FEATURE_TYPE_KEYS = {
  Point: [['point', 'typePoint'], ['poi', 'typePoi'], ['business', 'typeBusiness']],
  LineString: [['line', 'typeLine'], ['road', 'typeRoad'], ['waterway', 'typeWaterway']],
  Polygon: [
    ['area', 'typeArea'], ['building', 'typeBuilding'], ['landuse', 'typeLanduse'],
    ['park', 'typePark'], ['water', 'typeWater'], ['forest', 'typeForest'],
    ['grass', 'typeGrass'],
  ],
};

export const BUSINESS_ICONS = {
  shop: '🏪',
  restaurant: '🍽️',
  cafe: '☕',
  pharmacy: '💊',
  bank: '🏦',
  office: '🏢',
  other: '🏷️',
};

export function extraProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties || {}).filter(([key]) => !COLUMN_KEYS.has(key)),
  );
}

export function mergeFeatureProperties(feature) {
  return {
    ...feature.properties,
    name: feature.name,
    description: feature.description,
    building_type: feature.building_type,
    building_number: feature.building_number,
    icon: feature.icon,
    source_kind: feature.source_kind,
    feature_type: feature.feature_type,
    osm_id: feature.osm_id,
    osm_type: feature.osm_type,
    height_m: feature.height_m,
    business_type: feature.business_type,
    building_id: feature.building_id,
    road_type: feature.road_type,
    direction: feature.direction,
    lane_count: feature.lane_count,
    max_speed: feature.max_speed,
    surface: feature.surface,
    created_at: feature.created_at,
    updated_at: feature.updated_at,
  };
}

// Rebuild a complete API payload from stored data without consulting the
// current form. Undo and restore use this to preserve the exact old values.
export function rawFeaturePayload(geometry, properties) {
  const value = properties || {};
  return {
    name: value.name || '',
    description: value.description || '',
    geometry,
    properties: extraProperties(value),
    building_type: value.building_type ?? null,
    building_number: value.building_number ?? null,
    icon: value.icon ?? null,
    source_kind: value.source_kind || 'manual',
    feature_type: value.feature_type ?? null,
    osm_id: value.osm_id ?? null,
    osm_type: value.osm_type ?? null,
    height_m: value.height_m ?? null,
    road_type: value.road_type ?? null,
    direction: value.direction ?? null,
    lane_count: value.lane_count ?? null,
    max_speed: value.max_speed ?? null,
    surface: value.surface ?? null,
    business_type: value.business_type ?? null,
    building_id: value.building_id ?? null,
  };
}

export class FeatureForm {
  constructor(elements, translate, { onRoadDirectionChange = () => {} } = {}) {
    this.elements = elements;
    this.t = translate;
    this.onRoadDirectionChange = onRoadDirectionChange;
    populateRoadControls(elements, translate);
  }

  bind(root = document) {
    this.elements['feature-type'].addEventListener('change', () => this.updateFieldVisibility());
    this.elements['road-type'].addEventListener('change', (event) => {
      updateRoadSpeedControl(this.elements, event.target.value, { applyDefault: true });
    });
    this.elements['road-direction'].addEventListener('change', this.onRoadDirectionChange);
    this.elements['business-type'].addEventListener('change', () => {
      const icon = BUSINESS_ICONS[this.elements['business-type'].value];
      if (icon && !this.elements['feature-icon'].value.trim()) {
        this.elements['feature-icon'].value = icon;
      }
    });
    root.querySelectorAll('#icon-presets button').forEach((button) => {
      button.addEventListener('click', () => {
        this.elements['feature-icon'].value = 'clear' in button.dataset ? '' : button.textContent;
      });
    });
  }

  setSelectValue(elementId, value) {
    setControlledSelectValue(this.elements[elementId], value, this.t);
  }

  setRoadType(value, { applyDefault = false } = {}) {
    this.setSelectValue('road-type', value);
    updateRoadSpeedControl(this.elements, value, { applyDefault });
  }

  typeOptions(geometryType) {
    return (FEATURE_TYPE_KEYS[geometryType] || [['manual', 'typeFeature']])
      .map(([value, key]) => [value, this.t(key)]);
  }

  typeLabel(featureType) {
    const known = Object.values(FEATURE_TYPE_KEYS)
      .flat()
      .find(([value]) => value === featureType);
    return known ? this.t(known[1]) : this.t('typeFeature');
  }

  setTypeOptions(geometryType, currentType) {
    const options = this.typeOptions(geometryType);
    if (currentType && !options.some(([value]) => value === currentType)) {
      options.unshift([currentType, this.typeLabel(currentType)]);
    }
    const select = this.elements['feature-type'];
    select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    select.value = currentType || options[0][0];
  }

  show(selected, { editingEnabled, userName }) {
    const properties = selected.properties || {};
    const geometryType = selected.geometry?.type || 'Feature';
    this.elements['feature-geometry'].textContent = this.t('featureMeta', { type: geometryType });
    const createdBy = userName(properties.created_by);
    const updatedBy = userName(properties.updated_by);
    this.elements['feature-audit'].textContent = (createdBy || updatedBy)
      ? this.t('featureAudit', { created: createdBy || '—', edited: updatedBy || '—' })
      : '';
    this.elements['feature-name'].value = properties.name || '';
    this.elements['feature-description'].value = properties.description || '';
    this.elements['feature-icon'].value = properties.icon || '';
    this.setTypeOptions(geometryType, properties.feature_type);
    this.elements['building-type'].value = properties.building_type || '';
    this.elements['building-number'].value = properties.building_number || '';
    this.elements['building-height'].value = properties.height_m ?? '';
    this.setSelectValue('road-type', properties.road_type);
    this.elements['road-access'].value = properties.routing_access || '';
    this.elements['road-direction'].value = properties.direction || '';
    this.setSelectValue('lane-count', properties.lane_count);
    this.elements['max-speed'].value = properties.max_speed ?? '';
    updateRoadSpeedControl(this.elements, properties.road_type, { applyDefault: false });
    this.setSelectValue('road-surface', properties.surface);
    this.elements['business-type'].value = properties.business_type || '';
    this.elements['business-floor'].value = properties.floor || '';
    this.elements['business-phone'].value = properties.phone || '';
    this.elements['business-hours'].value = properties.opening_hours || '';
    this.updateFieldVisibility();
    this.elements['delete-feature'].disabled = !editingEnabled;
    this.elements['duplicate-feature'].disabled = !editingEnabled;
    this.elements['feature-panel'].hidden = false;
  }

  updateFieldVisibility() {
    const featureType = this.elements['feature-type'].value;
    this.elements['building-fields'].hidden = featureType !== 'building';
    this.elements['road-fields'].hidden = featureType !== 'road';
    this.elements['business-fields'].hidden = featureType !== 'business';
    if (featureType === 'road') {
      updateRoadSpeedControl(
        this.elements,
        this.elements['road-type'].value,
        { applyDefault: false },
      );
    }
  }

  reset() {
    for (const id of FORM_FIELDS) this.elements[id].value = '';
    this.elements['feature-type'].replaceChildren();
    this.elements['feature-geometry'].textContent = '';
  }

  buildPayload(
    geometry,
    previousProperties = {},
    { pendingDrawFeatureType = null, pendingRoadType = null } = {},
  ) {
    const { mode, serverId, ...storedProperties } = previousProperties;
    const featureType = this.elements['feature-type'].value
      || previousProperties.feature_type
      || pendingDrawFeatureType
      || this.typeOptions(geometry.type)[0][0];
    const roadType = featureType === 'road'
      ? (this.elements['road-type'].value || pendingRoadType || null)
      : null;
    const vehicleRoad = isVehicleRoadType(roadType);
    const extras = extraProperties(storedProperties);
    if (featureType === 'business') this.applyBusinessExtras(extras);
    if (featureType === 'road') {
      const routingAccess = this.elements['road-access'].value;
      if (routingAccess) extras.routing_access = routingAccess;
      else delete extras.routing_access;
    } else {
      delete extras.routing_access;
    }
    return {
      name: this.elements['feature-name'].value.trim(),
      description: this.elements['feature-description'].value.trim(),
      geometry,
      properties: extras,
      building_type: featureType === 'building'
        ? (this.elements['building-type'].value || null)
        : null,
      building_number: featureType === 'building'
        ? (this.elements['building-number'].value.trim() || null)
        : null,
      icon: this.elements['feature-icon'].value.trim() || null,
      source_kind: previousProperties.source_kind || 'manual',
      feature_type: featureType,
      osm_id: previousProperties.osm_id ?? null,
      osm_type: previousProperties.osm_type ?? null,
      height_m: featureType === 'building'
        ? this.numberValue('building-height', Number.parseFloat)
        : (previousProperties.height_m ?? null),
      road_type: roadType,
      direction: featureType === 'road'
        ? (this.elements['road-direction'].value || null)
        : null,
      lane_count: featureType === 'road'
        ? this.numberValue('lane-count', (value) => Number.parseInt(value, 10))
        : null,
      max_speed: featureType === 'road' && vehicleRoad
        ? this.numberValue('max-speed', (value) => Number.parseInt(value, 10))
        : (featureType === 'road' && previousProperties.road_type === roadType
          ? (previousProperties.max_speed ?? null)
          : null),
      surface: featureType === 'road'
        ? (this.elements['road-surface'].value || null)
        : null,
      business_type: featureType === 'business'
        ? (this.elements['business-type'].value || null)
        : null,
      building_id: previousProperties.building_id ?? null,
    };
  }

  applyBusinessExtras(extras) {
    const fields = {
      floor: 'business-floor',
      phone: 'business-phone',
      opening_hours: 'business-hours',
    };
    for (const [key, elementId] of Object.entries(fields)) {
      const value = this.elements[elementId].value.trim();
      if (value) extras[key] = value;
      else delete extras[key];
    }
  }

  numberValue(elementId, parse) {
    const value = this.elements[elementId].value;
    if (value === '') return null;
    const parsed = parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
