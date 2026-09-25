import { ModuleWithProviders, WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldTree, form, SchemaOrSchemaFn } from '@angular/forms/signals';
import { ActivatedRoute, ActivatedRouteSnapshot, Route, UrlTree } from '@angular/router';
import { TranslateLoader, TranslateModule, TranslationObject } from '@ngx-translate/core';
import { Observable, of, Subject } from 'rxjs';
import { Mock, vi } from 'vitest';

import type { UserWithTokenDto } from './app/core/models/userWithTokenDto';

export interface MockMessageStore {
  addMessage: Mock<
    (type: string, code: string, status?: number, params?: Record<string, unknown>) => void
  >;
}

export function createMockMessageStore(): MockMessageStore {
  return { addMessage: vi.fn() };
}

/** A File whose `size` is controlled without allocating the bytes (upload-limit tests read only size). */
export function fileOf(bytes: number, type = 'image/png'): File {
  const file = new File([''], 'image.png', { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

export interface MockRouter {
  navigate: Mock<(commands: unknown[], extras?: unknown) => Promise<boolean>>;
  navigateByUrl: Mock<(url: string, extras?: unknown) => Promise<boolean>>;
  createUrlTree: Mock<(commands: unknown[], extras?: unknown) => UrlTree>;
  serializeUrl: Mock<(tree: unknown) => string>;
  currentNavigation: Mock<() => unknown>;
  url: string;
  events: Subject<unknown>;
  /** Static route config (for components that derive metadata from it, e.g. the breadcrumb). */
  config: Route[];
  /** Current router state snapshot (for components that read route data on navigation). */
  routerState: { snapshot: { root: ActivatedRouteSnapshot } };
}

export function createMockRouter(initialUrl = '/'): MockRouter {
  return {
    navigate: vi.fn(async () => true),
    navigateByUrl: vi.fn(async () => true),
    createUrlTree: vi.fn(
      (commands: unknown[], extras?: unknown) =>
        ({
          commands,
          extras,
          toString: () => `urltree:${commands.join('/')}`,
        }) as unknown as UrlTree,
    ),
    // Needed when a component template renders a routerLink (RouterLink.updateHref calls it).
    serializeUrl: vi.fn((tree: unknown) => String(tree)),
    currentNavigation: vi.fn(() => null),
    url: initialUrl,
    events: new Subject<unknown>(),
    config: [],
    routerState: {
      snapshot: {
        root: { firstChild: null, routeConfig: null } as unknown as ActivatedRouteSnapshot,
      },
    },
  };
}

export function createMockActivatedRoute(
  queryParams: Record<string, string> = {},
  params: Record<string, string> = {},
): Partial<ActivatedRoute> {
  const mapOf = (source: Record<string, string>) => ({
    get: (key: string) => source[key] ?? null,
    has: (key: string) => key in source,
    getAll: (key: string) => (key in source ? [source[key]] : []),
    keys: Object.keys(source),
  });
  return {
    snapshot: {
      paramMap: mapOf(params),
      queryParamMap: mapOf(queryParams),
    } as unknown as ActivatedRoute['snapshot'],
  };
}

export interface MockAuthApi {
  user: WritableSignal<UserWithTokenDto | null>;
  role: WritableSignal<string | null>;
  isLoggedIn: WritableSignal<boolean>;
  login: Mock<(dto: { email: string; password: string }) => Promise<UserWithTokenDto | null>>;
  logout: Mock<() => Promise<void>>;
  restoreSession: Mock<() => Promise<void>>;
  renewInUse: Mock<() => Promise<string>>;
  rotateCredential: Mock<<T>(call: () => Promise<T>) => Promise<T>>;
  clearTokens: Mock<() => void>;
  endSession: Mock<(opts: { reason: string; returnUrl?: string }) => void>;
  returnUrlBelongsTo: Mock<(url: string, userId: number | undefined) => boolean>;
  forgotPassword: Mock<(email: string) => Promise<void>>;
  resetPassword: Mock<
    (token: string, newPassword: string, confirmPassword: string) => Promise<void>
  >;
  patchAvatar: Mock<(avatarUrl: string | null) => void>;
  patchName: Mock<(name: string) => void>;
}

/** A signed-in user for specs; override what the test is about. */
export function testUser(overrides: Partial<UserWithTokenDto> = {}): UserWithTokenDto {
  return {
    id: 7,
    name: 'Anna',
    email: 'anna@example.com',
    accessToken: 'jwt',
    role: 'ROLE_USER',
    reactivated: false,
    avatarUrl: null,
    expiresInSeconds: 900,
    ...overrides,
  };
}

/**
 * AuthApi mock. `isLoggedIn` is a writable signal here (a computed in the real service), so a spec
 * can flip it; passing a user means logged in.
 */
export function createMockAuthApi(overrides?: {
  loggedIn?: boolean;
  user?: UserWithTokenDto | null;
  role?: string | null;
}): MockAuthApi {
  const user = overrides?.user ?? null;
  const loggedIn = overrides?.loggedIn ?? user !== null;
  return {
    user: signal<UserWithTokenDto | null>(user),
    role: signal<string | null>(overrides?.role ?? user?.role ?? null),
    isLoggedIn: signal(loggedIn),
    login: vi.fn(async () => null),
    logout: vi.fn(async () => undefined),
    restoreSession: vi.fn(async () => undefined),
    renewInUse: vi.fn(async () => 'renewed'),
    rotateCredential: vi.fn(<T>(call: () => Promise<T>) => call()),
    clearTokens: vi.fn(),
    endSession: vi.fn(),
    returnUrlBelongsTo: vi.fn(() => true),
    forgotPassword: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => undefined),
    patchAvatar: vi.fn(),
    patchName: vi.fn(),
  };
}

export interface MockAccessToken {
  get: Mock<() => string | null>;
  set: Mock<(token: string, expiresInSeconds?: number) => void>;
  clear: Mock<() => void>;
  couldHaveSession: Mock<() => boolean>;
  endsAt: WritableSignal<number | null>;
}

/** `couldHaveSession` is the gate on every auth path, so it is the one thing worth varying here. */
export function createMockAccessToken(overrides?: {
  token?: string | null;
  couldHaveSession?: boolean;
}): MockAccessToken {
  const token = overrides?.token ?? null;
  return {
    get: vi.fn(() => token),
    set: vi.fn(),
    clear: vi.fn(),
    couldHaveSession: vi.fn(() => overrides?.couldHaveSession ?? token !== null),
    endsAt: signal<number | null>(null),
  };
}

class StubTranslateLoader implements TranslateLoader {
  getTranslation(): Observable<TranslationObject> {
    return of({});
  }
}

/**
 * Empty-dictionary ngx-translate setup for TestBed `imports`. Provides TranslateService and the
 * translate pipe without HTTP, so templates render in specs (keys render as themselves).
 */
export function translateTestingModule(): ModuleWithProviders<TranslateModule> {
  return TranslateModule.forRoot({
    loader: { provide: TranslateLoader, useClass: StubTranslateLoader },
  });
}

type DialogMethods = Partial<Pick<HTMLDialogElement, 'showModal' | 'close'>>;

/**
 * jsdom has <dialog> but neither showModal() nor close(). These behave like a browser's for what
 * the specs observe: `open`, focus moving to the first button, and the `close` event. Returns the
 * restore function for afterEach.
 */
export function installDialogPolyfill(): () => void {
  const proto = HTMLDialogElement.prototype as DialogMethods;
  const saved: DialogMethods = { showModal: proto.showModal, close: proto.close };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    (this.querySelector<HTMLElement>('[autofocus]') ?? this.querySelector('button'))?.focus();
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  return () => Object.assign(proto, saved);
}

/**
 * A schema's field tree over its own model, for specs that drive the model directly and read the
 * field signals: `const { model, tree } = formFor({ ...EMPTY_MODEL }, loginSchema)`.
 */
export function formFor<T>(
  initial: T,
  schema: SchemaOrSchemaFn<T>,
): { model: WritableSignal<T>; tree: FieldTree<T> } {
  const model = signal(initial);
  const tree = TestBed.runInInjectionContext(() => form(model, schema));
  return { model, tree };
}
