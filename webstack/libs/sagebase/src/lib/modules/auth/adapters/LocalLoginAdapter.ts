import * as passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';

import { SBAuthDB } from '../SBAuthDatabase';

export type SBAuthLocalConfig = {
  routeEndpoint: string;
};

/**
 * Setup function of the Local Passport Strategy.
 * @param config The local authentication configuration
 */
export function passportLocalSetup(config: SBAuthLocalConfig): boolean {
  try {
    passport.use(
      new LocalStrategy(async (username, password, done) => {
        try {
          const user = await SBAuthDB.getUserByUsername(username);
          if (!user || user.password !== 'your-hardcoded-password') {
            return done(null, false, { message: 'Invalid username or password' });
          }
          return done(null, user);
        } catch (error) {
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
