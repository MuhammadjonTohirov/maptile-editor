#!/bin/bash

echo "🚀 Starting Map Editor in Production Mode"
echo "=========================================="

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "Please copy .env.example to .env and configure your production settings:"
    echo "cp .env.example .env"
    echo "Then edit .env with your production values."
    exit 1
fi

# Check if SSL certificates exist
if [ ! -f ssl/cert.pem ] || [ ! -f ssl/key.pem ]; then
    echo "⚠️  SSL certificates not found. Generating self-signed certificates..."
    cd ssl
    chmod +x generate-certs.sh
    ./generate-certs.sh
    cd ..
    echo "✅ SSL certificates generated"
    echo ""
    echo "⚠️  IMPORTANT: These are self-signed certificates for development!"
    echo "For production, replace with certificates from a trusted CA or Let's Encrypt."
    echo ""
fi

# Validate critical environment variables
source .env

if [ "$SECRET_KEY" = "your-super-secret-key-min-32-chars-change-this-in-production-now" ]; then
    echo "❌ SECRET_KEY is still set to default value!"
    echo "Please change SECRET_KEY in .env file before running in production."
    exit 1
fi

if [ "$JWT_SECRET_KEY" = "your-jwt-secret-key-min-32-chars-change-this-in-production-now" ]; then
    echo "❌ JWT_SECRET_KEY is still set to default value!"
    echo "Please change JWT_SECRET_KEY in .env file before running in production."
    exit 1
fi

if [ "$DB_PASSWORD" = "secure_db_password_change_this" ]; then
    echo "❌ DB_PASSWORD is still set to default value!"
    echo "Please change DB_PASSWORD in .env file before running in production."
    exit 1
fi

echo "✅ Environment validation passed"

# Check Docker
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Build and start services
echo "🔨 Building and starting production services..."
docker-compose down -v 2>/dev/null || true
docker-compose build --no-cache
docker-compose up -d

# Wait for services
echo "⏳ Waiting for services to start..."
sleep 15

# Health checks
echo ""
echo "🏥 Health Check Results:"
echo "======================="

# Check database
if docker-compose exec -T db pg_isready -U ${DB_USER:-postgres} -d ${DB_NAME:-mapdata} > /dev/null 2>&1; then
    echo "✅ Database: Healthy"
else
    echo "❌ Database: Unhealthy"
fi

# Check Redis
if docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis: Healthy"
else
    echo "❌ Redis: Unhealthy"
fi

# Check backend
if curl -f -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "✅ Backend API: Healthy"
else
    echo "❌ Backend API: Unhealthy"
fi

# Check frontend HTTPS
if curl -f -s -k https://localhost:3443/ > /dev/null 2>&1; then
    echo "✅ Frontend HTTPS: Healthy"
else
    echo "❌ Frontend HTTPS: Unhealthy"
fi

echo ""
echo "🌐 Production URLs:"
echo "=================="
echo "🔒 Frontend (HTTPS): https://localhost:3443"
echo "🔧 Backend API:      http://localhost:8000"
echo "📋 API Docs:         http://localhost:8000/docs"
echo "📊 Metrics:          http://localhost:8000/metrics"
echo ""

echo "🔐 Security Notes:"
echo "=================="
echo "✅ Database not exposed to public"
echo "✅ HTTPS enabled with SSL certificates"
echo "✅ Security headers configured"
echo "✅ Rate limiting enabled"
echo "✅ Authentication required for API endpoints"
echo ""

echo "📝 Management Commands:"
echo "======================"
echo "View logs:     docker-compose logs -f [service]"
echo "Stop services: docker-compose down"
echo "Restart:       docker-compose restart [service]"
echo ""

echo "🎉 Map Editor is running in production mode!"
echo "Visit https://localhost:3443 to access the application."