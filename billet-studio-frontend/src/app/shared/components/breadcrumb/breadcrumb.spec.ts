import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { translateTestingModule } from '../../../../test-helpers';
import { Breadcrumb } from './breadcrumb';
import { BreadcrumbItem, BreadcrumbService } from './breadcrumb-service';

describe('Breadcrumb', () => {
  let items: WritableSignal<BreadcrumbItem[]>;
  let fixture: ComponentFixture<Breadcrumb>;

  const root = () => fixture.nativeElement as HTMLElement;
  const trail = () => root().querySelector('.breadcrumb--trail');
  const back = () => root().querySelector<HTMLAnchorElement>('.breadcrumb__back');

  async function show(crumbs: BreadcrumbItem[]): Promise<void> {
    items.set(crumbs);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    items = signal<BreadcrumbItem[]>([]);
    TestBed.configureTestingModule({
      imports: [Breadcrumb, translateTestingModule()],
      providers: [provideRouter([]), { provide: BreadcrumbService, useValue: { items } }],
    });
    fixture = TestBed.createComponent(Breadcrumb);
    await fixture.whenStable();
  });

  it('renders nothing for a trail of one: the page is its own crumb', async () => {
    await show([{ name: 'Start', url: '/', active: true }]);

    expect(trail()).toBeNull();
    expect(back()).toBeNull();
  });

  it('links every parent crumb and marks the current page', async () => {
    await show([
      { name: 'Start', url: '/', active: false },
      { name: 'Meine Billets', url: '/billets', active: false },
      { name: 'Muttertag', url: '/billets/7/edit', active: true },
    ]);

    const links = [...trail()!.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/', '/billets']);
    expect(trail()!.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('Muttertag');
  });

  it('the mobile back link leads to the parent of the current page', async () => {
    await show([
      { name: 'Start', url: '/', active: false },
      { name: 'Meine Billets', url: '/billets', active: false },
      { name: 'Muttertag', url: '/billets/7/edit', active: true },
    ]);

    expect(back()?.getAttribute('href')).toBe('/billets');
    expect(back()?.textContent?.trim()).toBe('Meine Billets');
  });
});
