import * as passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';

import { SBAuthDB } from '../SBAuthDatabase';
import { v4 } from 'uuid';

export type SBAuthLocalConfig = {
  routeEndpoint: string;
};

/**
 * Setup function of the Local Passport Strategy.
 */
export function passportLocalSetup(): boolean {
  try {
    passport.use(
      new LocalStrategy(async (username, password, done) => {
        try {

          const providerId = v4();
          const extras = { displayName: username, email: '', picture: '' };
          const authRecord = await SBAuthDB.findOrAddAuth('local', providerId, extras);
          if (authRecord) {
            console.log("authRecord OK");
            done(null, authRecord);
          } else {
            console.log("authRecord NOK");
            done(null, false);
          }
          /*
          const user = await SBAuthDB.getUserByUsername(username);
          if (!user || user.password !== 'your-hardcoded-password') {
            return done(null, false, { message: 'Invalid username or password' });
          }
          return done(null, user);
          */
        } catch (error) {
          console.log("authRecord NOK" + error);
          return done(error);
        }
      })
    );

    console.log('Local Login> Setup done');
    return true;
  } catch (error) {
    console.log('Local Login> Failed setup', error);
    return false;
  }
}
