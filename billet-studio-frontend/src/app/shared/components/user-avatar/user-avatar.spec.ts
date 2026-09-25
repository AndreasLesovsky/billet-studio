import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UserAvatar } from './user-avatar';

describe('UserAvatar', () => {
  let fixture: ComponentFixture<UserAvatar>;

  const root = () => fixture.nativeElement as HTMLElement;

  async function render(inputs: Record<string, unknown>): Promise<void> {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(UserAvatar);
  });

  it('shows the uploaded image first and the initials once it fails to load', async () => {
    await render({ name: 'Anna Berger', imageUrl: 'https://cdn.example.com/gone.webp' });
    const img = root().querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/gone.webp');

    img.dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(fixture.componentInstance.mode()).toBe('initials');
    expect(root().textContent?.trim()).toBe('AB');
  });

  it('shows the guest icon without name, email or image', async () => {
    await render({});

    expect(fixture.componentInstance.mode()).toBe('guest');
    expect(root().querySelector('.bi-person')).not.toBeNull();
  });
});
