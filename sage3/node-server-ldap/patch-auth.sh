#!/bin/bash
# Patches the bundled Sage3 main.js to replace local auth with LDAP/AD.
set -euo pipefail

echo "=== Patching Sage3 auth for LDAP/AD ==="

python3 << 'PYEOF'
import sys

main_file = "/app/dist/apps/homebase/main.js"

with open(main_file, 'r') as f:
    content = f.read()

# The original local auth block (entire expression):
old_block = 'strategies.includes("local")&&r.localConfig&&function(){try{return N.use(new D.Strategy(((e,a,r)=>(0,c.__awaiter)(this,void 0,void 0,(function*(){try{const a=(0,w.v4)(),t={displayName:e,email:"",picture:""},n=yield I.findOrAddAuth("local",a,t);n?(console.log("authRecord OK"),r(null,n)):(console.log("authRecord NOK"),r(null,!1))}catch(e){return console.log("authRecord NOK"+e),r(e)}}))))),console.log("Local Login> Setup done"),!0}catch(e){return console.log("Local Login> Failed setup",e),!1}}()&&t.post(r.localConfig.routeEndpoint,N.authenticate("local",{successRedirect:"/",failureRedirect:"/"}))'

# Replace with LDAP auth block:
new_block = 'strategies.includes("local")&&r.ldapConfig&&function(){try{var _LDAP=require("passport-ldapauth");var _opts={server:{url:r.ldapConfig.url,bindDN:r.ldapConfig.bindDN,bindCredentials:r.ldapConfig.bindCredentials,searchBase:r.ldapConfig.searchBase,searchFilter:r.ldapConfig.searchFilter||"(sAMAccountName={{username}})",searchAttributes:["sAMAccountName","displayName","mail","memberOf"],tlsOptions:{rejectUnauthorized:false}},usernameField:"username",passwordField:"password"};N.use("ldapauth",new _LDAP(_opts,function(e,a){var email=e.mail||e.userPrincipalName||"";var displayName=e.displayName||e.sAMAccountName||"";var providerId=e.sAMAccountName||e.dn;var extras={displayName:displayName,email:email,picture:""};console.log("LDAP> Authenticated:",displayName,"("+email+")");I.findOrAddAuth("ldap",providerId,extras).then(function(n){n?a(null,n):a(null,false)}).catch(function(err){console.log("LDAP> Auth error:",err);a(err)})}));console.log("LDAP> Setup done");return!0}catch(e){return console.log("LDAP> Failed setup",e),!1}}()&&t.post(r.ldapConfig.routeEndpoint||"/auth/local",N.authenticate("ldapauth",{successRedirect:"/",failureRedirect:"/"}))'

if old_block not in content:
    print("ERROR: Could not find local auth block in main.js", file=sys.stderr)
    sys.exit(1)

content = content.replace(old_block, new_block, 1)

with open(main_file, 'w') as f:
    f.write(content)

print("  main.js patched successfully")
PYEOF

# Verify syntax
node --check /app/dist/apps/homebase/main.js && echo "  Syntax check passed" || { echo "  ERROR: Syntax check failed"; exit 1; }

echo "=== LDAP/AD patch complete ==="
