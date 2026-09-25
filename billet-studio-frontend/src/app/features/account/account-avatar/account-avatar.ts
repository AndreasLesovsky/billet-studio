import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { isLoading } from '../../../core/interceptors/loading-interceptor';
import { AccountDto } from '../../../core/models/models';
import { AccountApi } from '../../../core/services/account-api';
import { MessageStore } from '../../../core/stores/message-store';
import { UserAvatar } from '../../../shared/components/user-avatar/user-avatar';
import { AVATAR_TYPES, avatarFileProblem } from '../avatar-file';

/**
 * The account's picture: pick a file or drop one on the card, see it as a preview, then save or
 * discard it. Removing the saved picture is its own action.
 */
@Component({
  selector: 'app-account-avatar',
  imports: [TranslatePipe, UserAvatar],
  templateUrl: './account-avatar.html',
  styleUrl: './account-avatar.scss',
})
export class AccountAvatar {
  private readonly accountApi = inject(AccountApi);
  private readonly messageStore = inject(MessageStore);

  readonly account = input.required<AccountDto>();

  protected readonly loading = isLoading;
  protected readonly accept = AVATAR_TYPES.join(',');

  /** A picked picture waits here, with its preview, until it is saved or discarded. */
  readonly staged = signal<File | null>(null);
  readonly preview = signal<string | null>(null);
  readonly dragActive = signal(false);

  /** Read by the page's leave guard: a picked picture is unsaved work. */
  readonly hasStaged = computed(() => this.staged() !== null);

  protected readonly imageUrl = computed(() => this.preview() ?? this.account().avatarUrl);
  protected readonly pickLabel = computed(() =>
    this.account().avatarUrl ? 'ACCOUNT.AVATAR_CHANGE' : 'ACCOUNT.AVATAR_UPLOAD',
  );
  protected readonly canSave = computed(() => this.hasStaged() && !this.loading());
  protected readonly canRemove = computed(
    () => this.account().avatarUrl !== null && !this.hasStaged() && !this.loading(),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stage(null));
  }

  onPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Picking the same file again must fire `change` again.
    input.value = '';
    if (file) this.offer(file);
  }

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dragActive.set(true);
  }

  onDragLeave(event: DragEvent): void {
    // Moving onto a child of the drop zone is not leaving it.
    const next = event.relatedTarget;
    const zone = event.currentTarget;
    if (next instanceof Node && zone instanceof Node && zone.contains(next)) return;
    this.dragActive.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.offer(file);
  }

  offer(file: File): void {
    const problem = avatarFileProblem(file);
    if (problem) {
      this.messageStore.addMessage('warning', problem.code, undefined, problem.params);
      return;
    }
    this.stage(file);
  }

  discard(): void {
    this.stage(null);
  }

  async save(): Promise<void> {
    const file = this.staged();
    if (!file) return;
    try {
      await this.accountApi.uploadAvatar(file);
    } catch {
      return;
    }
    this.stage(null);
  }

  async remove(): Promise<void> {
    try {
      await this.accountApi.removeAvatar();
    } catch {
      return;
    }
    this.stage(null);
  }

  private stage(file: File | null): void {
    const previous = this.preview();
    if (previous) URL.revokeObjectURL(previous);
    this.staged.set(file);
    this.preview.set(file ? URL.createObjectURL(file) : null);
  }
}
