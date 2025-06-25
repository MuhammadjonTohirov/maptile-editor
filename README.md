# 🗺️ Map Editor - Self-Sufficient Map Server

A fully offline, self-hosted map service with feature editing capabilities built with FastAPI, PostgreSQL + PostGIS, OpenLayers, and TileServer GL.

## 🚀 Quick Start

1. **Clone and Setup**
   ```bash
   git clone <repository-url>
   cd map-tile-editor
   ```

2. **Start Services**
   ```bash
   docker-compose up -d
   ```

3. **Access Applications**
   - Frontend Map Editor: http://localhost:3000
   - Backend API: http://localhost:8000
   - TileServer: http://localhost:8080
   - Database: localhost:5432

## 📁 Project Structure

```
map-tile-editor/
├── backend/              # FastAPI backend
│   ├── main.py          # API endpoints
│   ├── models.py        # Database models
│   ├── schemas.py       # Pydantic schemas
│   ├── database.py      # Database connection
│   ├── requirements.txt # Python dependencies
│   └── Dockerfile       # Backend container
├── frontend/            # OpenLayers map editor
│   ├── index.html       # Main HTML page
│   ├── js/map-editor.js # Map editor JavaScript
│   └── nginx.conf       # Nginx configuration
├── db/                  # Database configuration
│   └── init/01-init.sql # Database initialization
├── tiles/               # Vector tiles directory
│   ├── config.json      # TileServer configuration
│   └── README.md        # Tiles setup guide
└── docker-compose.yml   # Service orchestration
```

## 🛠️ Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend | OpenLayers 8.1.0 |
| Backend API | FastAPI + Python 3.12 |
| Database | PostgreSQL 15 + PostGIS 3.3 |
| Tile Server | TileServer GL |
| Container | Docker + Docker Compose |
| Web Server | Nginx |

## 🎯 Features

### Map Editor
- ✅ Draw points, lines, and polygons
- ✅ Edit existing features (modify geometry)
- ✅ Select and delete features
- ✅ Feature properties (name, description)
- ✅ Save features to database
- ✅ Load features from database
- ✅ Clear all features

### Backend API
- ✅ RESTful API for feature CRUD operations
- ✅ GeoJSON format support
- ✅ PostGIS spatial database
- ✅ Async database operations
- ✅ CORS enabled for frontend

### Database
- ✅ PostGIS spatial extensions
- ✅ Feature storage with geometry and properties
- ✅ Spatial indexing for performance
- ✅ Automatic timestamps

## 🗺️ Adding Map Tiles

### Option 1: OpenMapTiles (Recommended)
1. Visit [OpenMapTiles Downloads](https://openmaptiles.org/downloads/)
2. Download desired region in `.mbtiles` format
3. Place file in `tiles/` directory
4. Restart TileServer: `docker-compose restart tileserver`

### Option 2: Generate Custom Tiles
1. Download OSM data (.pbf format) from [Geofabrik](https://download.geofabrik.de/)
2. Use [Tilemaker](https://github.com/systemed/tilemaker) to generate tiles
3. Export as `.mbtiles` format
4. Place in `tiles/` directory

## 🔧 Development

### Backend Development
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Database Access
```bash
# Connect to PostgreSQL
psql -h localhost -U postgres -d mapdata

# View features
SELECT id, name, ST_AsText(geometry) FROM features;
```

### API Documentation
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## 📊 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/features` | Get all features (GeoJSON) |
| GET | `/features/{id}` | Get specific feature |
| POST | `/features` | Create new feature |
| PUT | `/features/{id}` | Update feature |
| DELETE | `/features/{id}` | Delete feature |
| GET | `/health` | Health check |

## 🔒 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@db:5432/mapdata` | Database connection |

## 🚨 Troubleshooting

### Common Issues

1. **Database Connection Error**
   ```bash
   docker-compose logs db
   docker-compose restart db
   ```

2. **TileServer Not Loading**
   - Ensure `.mbtiles` files are in `tiles/` directory
   - Check TileServer logs: `docker-compose logs tileserver`

3. **Frontend API Errors**
   - Check backend logs: `docker-compose logs backend`
   - Verify CORS settings in `backend/main.py`

### Reset Database
```bash
docker-compose down -v
docker-compose up -d
```

## 🎨 Customization

### Styling Features
Edit `frontend/js/map-editor.js` - `getFeatureStyle()` method

### Adding New Properties
1. Update database schema in `db/init/01-init.sql`
2. Update Pydantic schemas in `backend/schemas.py`
3. Update frontend form in `frontend/index.html`

### Custom Base Maps
Replace OpenStreetMap with custom tiles in `frontend/js/map-editor.js`

## 📈 Performance Tips

1. **Large Datasets**: Implement pagination in API endpoints
2. **Spatial Queries**: Use PostGIS spatial indexes
3. **Frontend**: Consider clustering for many features
4. **Tiles**: Use vector tiles for better performance

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes following SOLID/DRY principles
4. Test thoroughly
5. Submit pull request

## 📄 License

MIT License - see LICENSE file for details

---

**Ready to edit maps!** 🎉

Start with `docker-compose up -d` and visit http://localhost:3000