import { inject } from '@angular/core';
import { Router, type UrlTree } from '@angular/router';
import { AuthApi } from '../services/auth-api';
import { AccessToken } from '../services/access-token';
import { MessageStore } from '../stores/message-store';

/**
 * Is someone logged in - answered from state, not from a request. Both guards ask exactly this.
 *
 * The one request left is the recovery case: the hint says this browser has a session but no user is
 * loaded, which happens when startup could not reach the server or a tab sat idle past the window.
 */
async function hasSession(auth: AuthApi, accessToken: AccessToken): Promise<boolean> {
  if (auth.isLoggedIn()) return true;
  if (!accessToken.couldHaveSession()) return false;

  await auth.restoreSession();
  return auth.isLoggedIn();
}

/**
 * The answer both guards give a guest: true for a session, else the login page with a returnUrl.
 * Call it synchronously from the guard, inside its injection context.
 */
export async function sessionOrLogin(returnUrl: string): Promise<true | UrlTree> {
  const auth = inject(AuthApi);
  const accessToken = inject(AccessToken);
  const router = inject(Router);
  const messageStore = inject(MessageStore);

  if (await hasSession(auth, accessToken)) return true;

  // Only tell someone their session expired if they had one. A guest following a link to an account
  // page is not being logged out, they are being asked to log in.
  if (accessToken.couldHaveSession()) {
    messageStore.addMessage('error', 'SESSION_EXPIRED');
  }

  return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
}
