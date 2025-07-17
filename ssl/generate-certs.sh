#!/bin/bash

# Generate self-signed SSL certificates for development/testing
# For production, replace with real certificates from Let's Encrypt or CA

echo "Generating SSL certificates..."

# Generate private key
openssl genrsa -out key.pem 2048

# Generate certificate signing request
openssl req -new -key key.pem -out cert.csr -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Generate self-signed certificate
openssl x509 -req -in cert.csr -signkey key.pem -out cert.pem -days 365

# Clean up CSR
rm cert.csr

echo "SSL certificates generated:"
echo "- cert.pem (certificate)"
echo "- key.pem (private key)"
echo ""
echo "⚠️  These are self-signed certificates for development only!"
echo "For production, use certificates from a trusted CA or Let's Encrypt."

chmod 600 key.pem
chmod 644 cert.pem