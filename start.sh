#!/bin/bash

echo "🗺️  Starting Map Editor Services..."
echo "=================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create tiles directory if it doesn't exist
mkdir -p tiles

# Start services
echo "🚀 Starting all services..."
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

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
echo "🌐 Access URLs:"
echo "=============="
echo "📱 Map Editor:    http://localhost:3000"
echo "🔧 Backend API:   http://localhost:8000"
echo "📋 API Docs:      http://localhost:8000/docs"
echo "🗺️  TileServer:    http://localhost:8080"
echo ""

# Check if tiles exist
if [ -z "$(ls -A tiles/*.mbtiles 2>/dev/null)" ]; then
    echo "⚠️  No .mbtiles files found in tiles/ directory"
    echo "   Download tiles from: https://openmaptiles.org/downloads/"
    echo "   Place .mbtiles files in the tiles/ directory"
    echo ""
fi

echo "📝 To view logs: docker-compose logs -f [service_name]"
echo "🛑 To stop:      docker-compose down"
echo ""
echo "🎉 Map Editor is ready! Visit http://localhost:3000 to start editing."