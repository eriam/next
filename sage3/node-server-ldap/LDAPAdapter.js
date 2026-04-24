"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.passportLDAPSetup = passportLDAPSetup;
const tslib_1 = require("tslib");
const passport = require("passport");
const LdapStrategy = require("passport-ldapauth");
const SBAuthDatabase_1 = require("../SBAuthDatabase");

/**
 * Setup function for the LDAP/Active Directory Passport Strategy.
 * Replaces the local login strategy - the frontend's username/password form
 * POSTs to /auth/local which is handled by this LDAP adapter.
 * @param {object} config - LDAP configuration from sage3-prod.hjson
 */
function passportLDAPSetup(config) {
    try {
        const opts = {
            server: {
                url: config.url,
                bindDN: config.bindDN,
                bindCredentials: config.bindCredentials,
                searchBase: config.searchBase,
                searchFilter: config.searchFilter || "(sAMAccountName={{username}})",
                searchAttributes: ["sAMAccountName", "displayName", "mail", "memberOf"],
                tlsOptions: { rejectUnauthorized: false }
            },
            usernameField: "username",
            passwordField: "password"
        };

        passport.use("ldapauth", new LdapStrategy(opts,
            (user, done) => tslib_1.__awaiter(void 0, void 0, void 0, function* () {
                try {
                    const email = user.mail || user.userPrincipalName || "";
                    const displayName = user.displayName || user.sAMAccountName || "";
                    const providerId = user.sAMAccountName || user.dn;

                    const extras = {
                        displayName: displayName,
                        email: email,
                        picture: ""
                    };

                    console.log("LDAP> Authenticated user:", displayName, "(" + email + ")");

                    const authRecord = yield SBAuthDatabase_1.SBAuthDB.findOrAddAuth("ldap", providerId, extras);
                    if (authRecord) {
                        done(null, authRecord);
                    } else {
                        done(null, false);
                    }
                } catch (error) {
                    console.log("LDAP> Auth error:", error);
                    return done(error);
                }
            })
        ));

        console.log("LDAP> Setup done - AD authentication via", config.url);
        return true;
    } catch (error) {
        console.log("LDAP> Failed setup", error);
        return false;
    }
}
