# 🔒 Production Security Checklist

## Pre-Deployment Security Verification

### ✅ Environment Configuration
- [ ] `.env` file created from `.env.example`
- [ ] `SECRET_KEY` changed from default value (min 32 characters)
- [ ] `JWT_SECRET_KEY` changed from default value (min 32 characters)
- [ ] `DB_PASSWORD` changed from default value
- [ ] `REDIS_PASSWORD` set to strong password
- [ ] `CORS_ORIGINS` configured for your specific domain(s)
- [ ] `DEV_MODE=false` in production environment

### ✅ SSL/TLS Configuration
- [ ] SSL certificates installed in `ssl/` directory
- [ ] HTTPS redirect working (HTTP → HTTPS)
- [ ] TLS 1.2+ protocols enabled
- [ ] Strong cipher suites configured
- [ ] HSTS headers present

### ✅ Database Security
- [ ] Database not exposed to public internet
- [ ] Custom database credentials (not postgres:postgres)
- [ ] Connection pooling configured
- [ ] Database health checks working

### ✅ Authentication & Authorization
- [ ] JWT authentication working
- [ ] API endpoints require authentication
- [ ] Role-based access control implemented
- [ ] Token expiration configured appropriately

### ✅ Network Security
- [ ] Rate limiting active and tested
- [ ] Security headers present on all responses
- [ ] CORS properly configured (not wildcard *)
- [ ] Input validation working

### ✅ Container Security
- [ ] Containers running as non-root user
- [ ] No development volumes mounted in production
- [ ] Health checks configured for all services
- [ ] Resource limits set (if applicable)

### ✅ Monitoring & Logging
- [ ] Application logs being generated
- [ ] Health endpoints responding
- [ ] Error handling not exposing sensitive data
- [ ] Metrics collection working

## Security Testing Commands

### Test Authentication
```bash
# Should require authentication
curl -X GET http://localhost:8000/features
# Expected: 401 Unauthorized

# Test login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'
```

### Test HTTPS Redirect
```bash
# Should redirect to HTTPS
curl -I http://localhost:3000
# Expected: 301 Moved Permanently, Location: https://...
```

### Test Rate Limiting
```bash
# Make multiple rapid requests
for i in {1..10}; do
  curl -X GET http://localhost:8000/health
done
# Should eventually return 429 Too Many Requests
```

### Test Security Headers
```bash
curl -I https://localhost:3443
# Should include:
# - Strict-Transport-Security
# - X-Frame-Options: DENY
# - X-Content-Type-Options: nosniff
# - Content-Security-Policy
```

### Test Health Checks
```bash
# All should return healthy status
curl http://localhost:8000/health
docker-compose ps
```

## Production Deployment Steps

1. **Environment Setup**
   ```bash
   cp .env.example .env
   # Edit .env with production values
   ```

2. **SSL Certificate Setup**
   ```bash
   # For development (self-signed)
   cd ssl && ./generate-certs.sh
   
   # For production (Let's Encrypt example)
   # certbot certonly --standalone -d yourdomain.com
   # cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ssl/cert.pem
   # cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ssl/key.pem
   ```

3. **Deploy Services**
   ```bash
   ./production-start.sh
   ```

4. **Verify Security**
   - Run all security tests above
   - Check all health endpoints
   - Verify authentication is required
   - Test HTTPS is working

## Security Monitoring

### Regular Security Checks
- [ ] Monitor failed authentication attempts
- [ ] Check for unusual API usage patterns
- [ ] Review application logs for errors
- [ ] Verify SSL certificate expiration dates
- [ ] Update dependencies regularly

### Security Incident Response
1. **Immediate Actions**
   - Stop affected services: `docker-compose stop`
   - Preserve logs: `docker-compose logs > incident.log`
   - Change compromised credentials

2. **Investigation**
   - Review access logs
   - Check for data breaches
   - Identify attack vectors

3. **Recovery**
   - Apply security patches
   - Update credentials
   - Restart services: `./production-start.sh`

## Compliance Notes

This configuration provides:
- **OWASP Top 10** protection
- **GDPR** data protection readiness
- **SOC 2** security controls
- **ISO 27001** security framework alignment

## Emergency Contacts

- **Security Team**: [your-security-team@company.com]
- **DevOps Team**: [your-devops-team@company.com]
- **On-Call**: [your-oncall@company.com]

---

**Last Updated**: [Current Date]
**Security Review**: [Next Review Date]