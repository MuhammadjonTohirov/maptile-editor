-- Martin 1.12 warns that PostGIS before 3.5 may omit geometries at some zoom
-- levels. Keep an existing Postgres 15 volume's extension in step with the
-- image so editor vector tiles remain visible throughout the map's zoom range.
ALTER EXTENSION postgis UPDATE;
