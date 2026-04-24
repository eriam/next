FROM sage-05:latest

# Install passport-ldapauth
RUN cd /app && npm install --legacy-peer-deps passport-ldapauth

# Copy patch script
COPY patch-auth.sh /tmp/patch-auth.sh

# Patch the bundled auth system in main.js
RUN chmod +x /tmp/patch-auth.sh && /tmp/patch-auth.sh

# Cleanup
RUN rm /tmp/patch-auth.sh
