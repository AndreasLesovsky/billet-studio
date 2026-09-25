import { AuthApi, POST_LOGIN_ROUTE } from '../../core/services/auth-api';
import { isValidReturnUrl } from '../../core/utils/return-url';

/**
 * Where a fresh sign-in lands, for the login and the sign-up alike: the returnUrl when it is a safe
 * in-app path AND this user's (the page an expired session left belongs to the account it ended,
 * not to whoever signs in next on the tab), else the billet list.
 */
export function postLoginTarget(
  returnUrl: string | null,
  authApi: Pick<AuthApi, 'returnUrlBelongsTo'>,
  userId: number,
): string {
  return isValidReturnUrl(returnUrl) && authApi.returnUrlBelongsTo(returnUrl, userId)
    ? returnUrl
    : POST_LOGIN_ROUTE;
}
