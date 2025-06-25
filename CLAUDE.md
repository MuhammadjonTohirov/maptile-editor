## Development Principles

- Follow SOLID and DRY principles

## Project Goals

- Build a Self-Sufficient Map Server with Editor

## Technology Stack

- FastAPI, PostgreSQL + PostGIS, OpenLayers Draw + Modify tools, TileServer GL + OpenMapTiles, OpenLayers should be used to create this project

## Project Overview

This is a **Self-Sufficient Map Server with Editor** - a fully offline, self-hosted map service with feature editing capabilities. The project enables users to create, edit, and manage geographical features (points, lines, polygons) on interactive maps while storing data in a spatial database.

## Architecture Components

### Backend (`/backend/`)
- **FastAPI Application** (`main.py`): RESTful API with CRUD operations for geographical features
- **Database Models** (`models.py`): SQLAlchemy Feature model with spatial geometry support  
- **Pydantic Schemas** (`schemas.py`): Data validation and serialization for API requests/responses
- **Database Config** (`database.py`): Async SQLAlchemy setup with PostgreSQL connection
- **Python Version**: 3.11 (virtual environment in `.venv/`)

### Frontend (`/frontend/`)
- **HTML Interface** (`index.html`): Single-page application with map container and controls
- **Map Editor** (`js/map-editor.js`): OpenLayers-based editor with drawing and editing tools
- **Nginx Config** (`nginx.conf`): Reverse proxy routing API calls to backend, tiles to TileServer

### Database (`/db/`)
- **PostgreSQL + PostGIS**: Spatial database with geometry support
- **Init Script** (`init/01-init.sql`): Creates features table with spatial indexes and triggers
- **Schema**: Features table with id, name, description, geometry (EPSG:4326), properties (JSONB), timestamps

### Tile Server (`/tiles/`)
- **TileServer GL**: Serves vector map tiles from .mbtiles files
- **Configuration**: `config.json` with data paths
- **Storage**: Directory for .mbtiles files (OpenMapTiles or custom)

## API Endpoints

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| `GET` | `/features` | Get all features | GeoJSON FeatureCollection |
| `GET` | `/features/{id}` | Get specific feature | GeoJSON Feature |
| `POST` | `/features` | Create new feature | Feature with ID |
| `PUT` | `/features/{id}` | Update feature | Updated feature |
| `DELETE` | `/features/{id}` | Delete feature | Success message |
| `GET` | `/health` | Health check | Status response |

## Database Schema

```sql
CREATE TABLE features (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    description TEXT,
    geometry GEOMETRY(GEOMETRY, 4326),  -- WGS84 projection
    properties JSONB DEFAULT '{}',      -- Flexible JSON properties
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- GiST spatial index on geometry column
-- Automatic timestamp update trigger
```

## Frontend Capabilities

### Drawing Tools
- Point, Line, and Polygon drawing tools
- Modify tool for editing existing geometries
- Select and delete tools for feature management

### Feature Management  
- Properties editor (name, description)
- Save individual features or batch save all
- Load all features from database
- Clear all features from map

### Map Features
- OpenStreetMap base layer
- Feature styling based on geometry type
- Coordinate transformation (EPSG:3857 ↔ EPSG:4326)
- Automatic geolocation to center map on user's current location
- Manual "My Location" button for re-centering

## Development Setup

### Environment Setup
```bash
# Backend setup
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run development server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Docker Deployment
```bash
# Full stack deployment
docker-compose up -d

# Services:
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:8000  
# - TileServer: http://localhost:8080
# - Database: localhost:5432
```

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection (default: `postgresql+asyncpg://postgres:postgres@db:5432/mapdata`)

## Key Features

### Spatial Data Handling
- Full GeoJSON import/export support
- WGS84 (EPSG:4326) storage, Web Mercator (EPSG:3857) display
- Shapely-based geometry processing and validation
- PostGIS spatial indexing for performance

### Technical Features
- Async database operations with AsyncPG
- CORS enabled for frontend-backend communication
- Auto-reload development mode
- Swagger UI documentation at `/docs`
- Health check endpoints for monitoring

## Project Status

**Fully Functional Components:**
✅ Complete CRUD operations for geographical features
✅ Interactive map editor with drawing tools (Point, Line, Polygon)
✅ Feature modification and selection tools
✅ Spatial database with PostGIS support
✅ API documentation and testing (Swagger UI at /docs)
✅ Containerized deployment with Docker Compose
✅ Reverse proxy configuration with Nginx
✅ Database initialization and migrations
✅ Automatic geolocation support (centers map on user location)
✅ Manual "My Location" button with visual feedback
✅ Coordinate transformation (EPSG:3857 ↔ EPSG:4326)
✅ Feature properties editor (name, description)
✅ Batch operations (Save All, Load All, Clear All)
✅ Real-time feature persistence to PostgreSQL database
✅ GeoJSON import/export functionality
✅ Error handling and user feedback

**Recent Fixes Applied:**
✅ Backend startup issue (DATABASE_URL async driver configuration)
✅ Geolocation functionality with enhanced error handling
✅ Geometry serialization fix (JSON object vs string)
✅ Coordinate projection transformation (Web Mercator to WGS84)
✅ Enhanced API error reporting and debugging

**Optional Enhancements:**
- Map tiles (requires .mbtiles files)
- User authentication/authorization  
- Feature clustering for large datasets
- API pagination
- Advanced spatial queries and analysis
- Offline support
- Feature import from external sources (KML, Shapefile)

## Common Commands

```bash
# Backend development
cd backend && source .venv/bin/activate
uvicorn main:app --reload

# Database access
docker exec -it map-editor-db psql -U postgres -d mapdata

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Reset database
docker-compose down -v && docker-compose up -d

# Rebuild backend after dependency changes
docker-compose build backend --no-cache
docker-compose up -d backend

# Test the application
open http://localhost:3000
# OR visit in browser: http://localhost:3000

# Check backend API
curl http://localhost:8000/health
curl http://localhost:8000/features
```

## Troubleshooting

### Backend Issues
- **SQLAlchemy async driver error**: Ensure `DATABASE_URL` uses `postgresql+asyncpg://` not `postgresql://`
- **Container showing as running but not responding**: Check logs for import/dependency errors, rebuild container if needed
- **Python version compatibility**: Use Python 3.11 for backend development (avoid 3.13 due to package compatibility)

### Frontend Issues
- **Geolocation not working**: Browser will prompt for permission, fallback to default location if denied
- **API calls failing**: Check backend is running on port 8000 and CORS is properly configured
- **422 Unprocessable Entity when saving features**: Fixed - was caused by geometry being sent as string instead of JSON object

### Common Issues (RESOLVED)
- ✅ **Backend container running but not responding**: Fixed DATABASE_URL to use `postgresql+asyncpg://` instead of `postgresql://`
- ✅ **Geolocation button not working**: Enhanced with proper error handling, visual feedback, and smooth animations
- ✅ **Features not saving (422 errors)**: Fixed geometry serialization and coordinate projection issues
- ✅ **Coordinates in wrong projection**: Implemented proper EPSG:3857 to EPSG:4326 transformation

### Development Tips
- Frontend is served on http://localhost:3000 with automatic geolocation
- Backend API documentation available at http://localhost:8000/docs
- Use "My Location" button to re-center map if automatic geolocation fails
- All spatial data stored in WGS84 (EPSG:4326), displayed in Web Mercator (EPSG:3857)
- Features are automatically saved to database with proper coordinate transformation
- Browser console shows detailed logging for debugging API calls and geolocation
- Test feature creation: Draw → Add properties → Save Feature
- Use "Load Features" to retrieve all saved features from database