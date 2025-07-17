#!/bin/bash

echo "🗺️  Starting Map Editor for Local Development"
echo "============================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if .env file exists, if not create a basic one
if [ ! -f .env ]; then
    echo "📝 Creating basic .env file for local development..."
    cat > .env << 'EOF'
# Local Development Configuration
DB_HOST=db
DB_PORT=5432
DB_NAME=mapdata
DB_USER=postgres
DB_PASSWORD=postgres
DATABASE_URL=postgresql+asyncpg://postgres:postgres@db:5432/mapdata

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
API_DEBUG=true

# Security Configuration (basic for local dev)
SECRET_KEY=local-dev-secret-key-change-in-production
JWT_SECRET_KEY=local-dev-jwt-secret-key-change-in-production
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# CORS Configuration (permissive for local dev)
CORS_ORIGINS=http://localhost:3000,http://localhost:8000
CORS_ALLOW_CREDENTIALS=true

# Rate Limiting (relaxed for local dev)
RATE_LIMIT_REQUESTS=1000
RATE_LIMIT_WINDOW=3600

# External Services
OSM_API_BASE_URL=https://overpass-api.de/api/interpreter
OSM_API_TIMEOUT=30

# Logging Configuration
LOG_LEVEL=INFO
LOG_FORMAT=json
LOG_FILE=logs/app.log

# SSL/TLS Configuration (disabled for local)
SSL_ENABLED=false

# Cache Configuration
CACHE_TYPE=redis
CACHE_REDIS_URL=redis://:redis_password@redis:6379/0
CACHE_TTL=3600
REDIS_PASSWORD=redis_password

# Feature Configuration
MAX_FEATURES_PER_REQUEST=1000
MAX_GEOMETRY_SIZE=10000000
ENABLE_FEATURE_CACHING=true

# Development Settings
DEV_MODE=true
DEV_RELOAD=true
DEV_DB_ECHO=false
EOF
    echo "✅ Created .env file for local development"
fi

# Create tiles directory if it doesn't exist
mkdir -p tiles

# Start services
echo "🚀 Starting all services..."
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 15

# Check service status
echo ""
echo "📊 Service Status:"
echo "=================="

# Check database
if docker-compose ps db | grep -q "Up"; then
    echo "✅ Database: Running"
else
    echo "❌ Database: Not running"
fi

# Check Redis
if docker-compose ps redis | grep -q "Up"; then
    echo "✅ Redis: Running"
else
    echo "❌ Redis: Not running"
fi

# Check backend
if docker-compose ps backend | grep -q "Up"; then
    echo "✅ Backend API: Running"
else
    echo "❌ Backend API: Not running"
fi

# Check tileserver
if docker-compose ps tileserver | grep -q "Up"; then
    echo "✅ TileServer: Running"
else
    echo "❌ TileServer: Not running"
fi

# Check frontend
if docker-compose ps frontend | grep -q "Up"; then
    echo "✅ Frontend: Running"
else
    echo "❌ Frontend: Not running"
fi

echo ""
echo "🌐 Local Development URLs:"
echo "========================="
echo "📱 Map Editor:    http://localhost:3000"
echo "🔧 Backend API:   http://localhost:8000"
echo "📋 API Docs:      http://localhost:8000/docs"
echo "🏥 Health Check:  http://localhost:8000/health"
echo ""

# Check if tiles exist
if [ -z "$(ls -A tiles/*.mbtiles 2>/dev/null)" ]; then
    echo "⚠️  No .mbtiles files found in tiles/ directory"
    echo "   Download tiles from: https://openmaptiles.org/downloads/"
    echo "   Place .mbtiles files in the tiles/ directory"
    echo ""
fi

echo "📝 Management Commands:"
echo "======================"
echo "View logs:     docker-compose logs -f [service_name]"
echo "Stop services: docker-compose down"
echo "Restart:       docker-compose restart [service_name]"
echo ""

echo "🎉 Map Editor is ready for local development!"
echo "Visit http://localhost:3000 to start editing maps."