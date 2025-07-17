"""
SSL/TLS Configuration for Production Deployment
"""

import os
import ssl
from pathlib import Path
from typing import Optional, Tuple
import logging

from config import settings

logger = logging.getLogger(__name__)

class SSLConfig:
    """SSL/TLS Configuration Manager"""
    
    def __init__(self):
        self.cert_path = settings.ssl_cert_path
        self.key_path = settings.ssl_key_path
        self.ca_cert_path = settings.ssl_ca_cert_path
    
    def validate_ssl_files(self) -> bool:
        """Validate SSL certificate files exist and are readable"""
        if not self.cert_path or not self.key_path:
            logger.warning("SSL certificate or key path not configured")
            return False
        
        cert_file = Path(self.cert_path)
        key_file = Path(self.key_path)
        
        if not cert_file.exists():
            logger.error(f"SSL certificate file not found: {self.cert_path}")
            return False
        
        if not key_file.exists():
            logger.error(f"SSL key file not found: {self.key_path}")
            return False
        
        if not cert_file.is_file():
            logger.error(f"SSL certificate path is not a file: {self.cert_path}")
            return False
        
        if not key_file.is_file():
            logger.error(f"SSL key path is not a file: {self.key_path}")
            return False
        
        # Check file permissions (should not be world-readable)
        key_stat = key_file.stat()
        if key_stat.st_mode & 0o077:  # Check if group or others have access
            logger.warning(f"SSL key file has overly permissive permissions: {self.key_path}")
        
        logger.info("SSL certificate and key files validated successfully")
        return True
    
    def create_ssl_context(self) -> Optional[ssl.SSLContext]:
        """Create SSL context with proper security settings"""
        if not self.validate_ssl_files():
            return None
        
        try:
            # Create SSL context with TLS 1.2+ only
            context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
            
            # Load certificate and key
            context.load_cert_chain(
                certfile=self.cert_path,
                keyfile=self.key_path
            )
            
            # Security settings
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.maximum_version = ssl.TLSVersion.TLSv1_3
            
            # Disable weak ciphers
            context.set_ciphers('HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA')
            
            # Enable OCSP stapling if available
            context.check_hostname = False  # We're the server
            context.verify_mode = ssl.CERT_NONE  # Client verification handled separately
            
            # Load CA certificates if provided
            if self.ca_cert_path and Path(self.ca_cert_path).exists():
                context.load_verify_locations(cafile=self.ca_cert_path)
                logger.info(f"CA certificates loaded from: {self.ca_cert_path}")
            
            logger.info("SSL context created successfully")
            return context
            
        except Exception as e:
            logger.error(f"Failed to create SSL context: {e}")
            return None
    
    def get_ssl_keyfile_password(self) -> Optional[str]:
        """Get SSL key file password if encrypted"""
        return settings.ssl_key_password
    
    def generate_self_signed_cert(self, host: str = "localhost") -> Tuple[str, str]:
        """Generate self-signed certificate for development"""
        try:
            from cryptography import x509
            from cryptography.x509.oid import NameOID
            from cryptography.hazmat.primitives import serialization, hashes
            from cryptography.hazmat.primitives.asymmetric import rsa
            from datetime import datetime, timedelta
            import ipaddress
            
            # Generate private key
            private_key = rsa.generate_private_key(
                public_exponent=65537,
                key_size=2048,
            )
            
            # Create certificate
            subject = issuer = x509.Name([
                x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
                x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "CA"),
                x509.NameAttribute(NameOID.LOCALITY_NAME, "San Francisco"),
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Map Editor"),
                x509.NameAttribute(NameOID.COMMON_NAME, host),
            ])
            
            cert = x509.CertificateBuilder().subject_name(
                subject
            ).issuer_name(
                issuer
            ).public_key(
                private_key.public_key()
            ).serial_number(
                x509.random_serial_number()
            ).not_valid_before(
                datetime.utcnow()
            ).not_valid_after(
                datetime.utcnow() + timedelta(days=365)
            ).add_extension(
                x509.SubjectAlternativeName([
                    x509.DNSName(host),
                    x509.DNSName("localhost"),
                    x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
                    x509.IPAddress(ipaddress.IPv6Address("::1")),
                ]),
                critical=False,
            ).sign(private_key, hashes.SHA256())
            
            # Serialize certificate and key
            cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
            key_pem = private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption()
            ).decode()
            
            # Save to files
            cert_path = "ssl/cert.pem"
            key_path = "ssl/key.pem"
            
            os.makedirs("ssl", exist_ok=True)
            
            with open(cert_path, "w") as f:
                f.write(cert_pem)
            
            with open(key_path, "w") as f:
                f.write(key_pem)
            
            # Set proper permissions
            os.chmod(key_path, 0o600)
            os.chmod(cert_path, 0o644)
            
            logger.info(f"Self-signed certificate generated: {cert_path}, {key_path}")
            return cert_path, key_path
            
        except ImportError:
            logger.error("cryptography library not installed. Cannot generate self-signed certificate.")
            raise
        except Exception as e:
            logger.error(f"Failed to generate self-signed certificate: {e}")
            raise

def setup_ssl_for_uvicorn() -> dict:
    """Setup SSL configuration for Uvicorn server"""
    ssl_config = SSLConfig()
    
    if not settings.ssl_enabled:
        logger.info("SSL disabled in configuration")
        return {}
    
    context = ssl_config.create_ssl_context()
    if not context:
        logger.warning("Failed to create SSL context, falling back to HTTP")
        return {}
    
    return {
        "ssl_keyfile": ssl_config.key_path,
        "ssl_certfile": ssl_config.cert_path,
        "ssl_keyfile_password": ssl_config.get_ssl_keyfile_password(),
        "ssl_ca_certs": ssl_config.ca_cert_path,
        "ssl_version": ssl.PROTOCOL_TLS_SERVER,
        "ssl_ciphers": "HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA",
    }

def setup_ssl_for_gunicorn() -> dict:
    """Setup SSL configuration for Gunicorn server"""
    ssl_config = SSLConfig()
    
    if not settings.ssl_enabled:
        return {}
    
    context = ssl_config.create_ssl_context()
    if not context:
        return {}
    
    return {
        "keyfile": ssl_config.key_path,
        "certfile": ssl_config.cert_path,
        "ca_certs": ssl_config.ca_cert_path,
        "ssl_version": ssl.PROTOCOL_TLS_SERVER,
        "ciphers": "HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA",
    }