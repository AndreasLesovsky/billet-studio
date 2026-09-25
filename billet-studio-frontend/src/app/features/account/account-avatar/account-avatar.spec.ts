import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountDto } from '../../../core/models/models';
import { AccountApi } from '../../../core/services/account-api';
import { MessageStore } from '../../../core/stores/message-store';
import { createMockMessageStore, fileOf, translateTestingModule } from '../../../../test-helpers';
import { AccountAvatar } from './account-avatar';

const ACCOUNT: AccountDto = {
  id: 7,
  name: 'Anna',
  email: 'anna@example.com',
  role: 'ROLE_USER',
  preferredLanguage: 'de',
  avatarUrl: '/uploads/avatars/7.webp',
  createdAt: '2026-01-01T00:00:00Z',
};

function setup() {
  const accountApi = {
    uploadAvatar: vi.fn(async () => ACCOUNT),
    removeAvatar: vi.fn(async () => ({ ...ACCOUNT, avatarUrl: null })),
  };
  const messageStore = createMockMessageStore();

  TestBed.configureTestingModule({
    imports: [AccountAvatar, translateTestingModule()],
    providers: [
      { provide: AccountApi, useValue: accountApi },
      { provide: MessageStore, useValue: messageStore },
    ],
  });
  TestBed.overrideComponent(AccountAvatar, { set: { template: '<div></div>', imports: [] } });
  const fixture = TestBed.createComponent(AccountAvatar);
  fixture.componentRef.setInput('account', ACCOUNT);
  return { fixture, component: fixture.componentInstance, accountApi, messageStore };
}

/** A drag event as the browser fires it: jsdom has no DragEvent with a DataTransfer. */
function dragEvent(files: File[], relatedTarget: Node | null = null) {
  return {
    preventDefault: vi.fn(),
    relatedTarget,
    currentTarget: document.body,
    dataTransfer: { types: files.length ? ['Files'] : ['text/plain'], files, dropEffect: 'none' },
  } as unknown as DragEvent;
}

describe('AccountAvatar', () => {
  const createObjectURL = vi.fn(() => 'blob:preview');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('a picked image waits as a preview until it is saved', async () => {
    const { component, accountApi } = setup();
    const file = fileOf(1024);

    component.offer(file);
    expect(component.staged()).toBe(file);
    expect(component.preview()).toBe('blob:preview');
    expect(component.hasStaged()).toBe(true);

    await component.save();

    expect(accountApi.uploadAvatar).toHaveBeenCalledWith(file);
    expect(component.hasStaged()).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('keeps the preview when the upload is refused', async () => {
    const { component, accountApi } = setup();
    accountApi.uploadAvatar.mockRejectedValueOnce(new Error('FILE_TOO_LARGE'));
    component.offer(fileOf(1024));

    await component.save();

    expect(component.hasStaged()).toBe(true);
  });

  it('discarding a picked image drops its preview', () => {
    const { component, accountApi } = setup();
    component.offer(fileOf(1024));

    component.discard();

    expect(component.preview()).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    expect(accountApi.uploadAvatar).not.toHaveBeenCalled();
  });

  // Which files are refused is avatar-file.spec.ts's table; this is how a refusal reaches the user.
  it('refuses an image over the limit with a warning that says the limit, and keeps nothing', () => {
    const { component, messageStore } = setup();

    component.offer(fileOf(21 * 1024 * 1024));

    expect(messageStore.addMessage).toHaveBeenCalledWith('warning', 'IMAGE_TOO_LARGE', undefined, {
      maxMb: 20,
    });
    expect(component.hasStaged()).toBe(false);
  });

  it('takes a dropped image like a picked one', () => {
    const { component } = setup();
    const file = fileOf(1024);
    const over = dragEvent([file]);

    component.onDragOver(over);
    expect(over.preventDefault).toHaveBeenCalled();
    expect(component.dragActive()).toBe(true);

    component.onDrop(dragEvent([file]));

    expect(component.dragActive()).toBe(false);
    expect(component.staged()).toBe(file);
  });

  it('ignores a drag that carries no files, so the page keeps its own drop behaviour', () => {
    const { component } = setup();
    const over = dragEvent([]);

    component.onDragOver(over);

    expect(over.preventDefault).not.toHaveBeenCalled();
    expect(component.dragActive()).toBe(false);
  });

  it('moving onto a child of the card is not leaving it', () => {
    const { component } = setup();
    component.onDragOver(dragEvent([fileOf(1)]));
    const child = document.createElement('span');
    document.body.append(child);

    component.onDragLeave(dragEvent([], child));
    expect(component.dragActive()).toBe(true);

    component.onDragLeave(dragEvent([], null));
    expect(component.dragActive()).toBe(false);
    child.remove();
  });
});
