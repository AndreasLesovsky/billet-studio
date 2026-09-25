import { Component, DestroyRef, afterRenderEffect, computed, inject, input } from '@angular/core';
import { FieldTree } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

let nextId = 0;

/**
 * The one place a field's validation message is rendered: `errors()[0]`, the first rule that broke,
 * translated with the error itself as params ({{maxLength}} etc. come from the rule). Every
 * [formField] with a messaged rule pairs with one of these; form-contract.spec.ts enforces it.
 *
 * The invalid border is not its job (provideSignalFormsConfig applies ui-invalid). What it adds is
 * the link assistive tech needs: while the message shows, the bound control(s) carry
 * aria-invalid="true" and point at it via aria-describedby.
 */
@Component({
  selector: 'app-field-error',
  imports: [TranslatePipe],
  template: `
    @if (shownError(); as error) {
      <p class="ui-field-error" role="alert" [id]="id">
        <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
        <span>{{ error.message | translate: error }}</span>
      </p>
    }
  `,
})
export class FieldError<T> {
  readonly field = input.required<FieldTree<T>>();

  protected readonly id = `app-field-error-${nextId++}`;

  protected readonly shownError = computed(() => {
    const state = this.field()();
    return state.touched() && state.invalid() ? (state.errors()[0] ?? null) : null;
  });

  constructor() {
    const marked = new Set<HTMLElement>();

    const unmark = (element: HTMLElement): void => {
      removeToken(element, 'aria-describedby', this.id);
      element.removeAttribute('aria-invalid');
      marked.delete(element);
    };

    afterRenderEffect({
      write: () => {
        const showing = this.shownError() !== null;
        const bound = showing
          ? this.field()()
              .formFieldBindings()
              .map((b) => b.element)
          : [];
        for (const element of [...marked]) {
          if (!bound.includes(element)) unmark(element);
        }
        for (const element of bound) {
          addToken(element, 'aria-describedby', this.id);
          element.setAttribute('aria-invalid', 'true');
          marked.add(element);
        }
      },
    });

    inject(DestroyRef).onDestroy(() => [...marked].forEach(unmark));
  }
}

function tokens(element: HTMLElement, attribute: string): string[] {
  return (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean);
}

function addToken(element: HTMLElement, attribute: string, token: string): void {
  const list = tokens(element, attribute);
  if (!list.includes(token)) element.setAttribute(attribute, [...list, token].join(' '));
}

function removeToken(element: HTMLElement, attribute: string, token: string): void {
  const list = tokens(element, attribute).filter((t) => t !== token);
  if (list.length > 0) element.setAttribute(attribute, list.join(' '));
  else element.removeAttribute(attribute);
}
